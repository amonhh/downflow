import type { ApiResponse, AppSettings, ProbeResult } from '../shared/types';
import { detectDownloadableLink, isProbablyDownloadLink } from '../shared/detection';
import { filenameFromUrl, sourceDomain } from '../shared/utilities';
import { showDetectionPrompt } from './overlay';

interface SettingsResponse {
  ok: boolean;
  data?: AppSettings;
}

let installed = false;
let settings: AppSettings | null = null;
let bypassAnchor: HTMLAnchorElement | null = null;

async function loadSettings(): Promise<AppSettings | null> {
  try {
    const response = (await chrome.runtime.sendMessage({ type: 'settings:get' })) as SettingsResponse;
    if (response?.ok && response.data) return response.data;
  } catch {
    // Extension context may have been invalidated during a reload.
  }
  return null;
}

async function probe(url: string): Promise<ProbeResult | null> {
  try {
    const response = (await chrome.runtime.sendMessage({ type: 'downloads:probe', url })) as ApiResponse<ProbeResult>;
    return response?.ok ? response.data : null;
  } catch {
    return null;
  }
}

async function startDownload(url: string, filename: string, mime?: string, totalBytes?: number): Promise<void> {
  const response = (await chrome.runtime.sendMessage({
    type: 'downloads:start',
    payload: {
      url,
      filename,
      pageUrl: location.href,
      pageTitle: document.title,
      source: 'detection',
      mime,
      totalBytes,
    },
  })) as ApiResponse<unknown>;
  if (!response?.ok) throw new Error(response?.error ?? 'DownFlow could not start this download.');
}

function continueNormally(anchor: HTMLAnchorElement): void {
  bypassAnchor = anchor;
  try {
    if (anchor.hasAttribute('download')) {
      anchor.click();
    } else {
      window.location.assign(anchor.href);
    }
  } finally {
    setTimeout(() => {
      bypassAnchor = null;
    }, 0);
  }
}

function isModifiedClick(event: MouseEvent): boolean {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

function handleClick(event: MouseEvent): void {
  if (!settings?.detectionEnabled || !settings.interceptClicks || isModifiedClick(event) || event.defaultPrevented) {
    return;
  }
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest<HTMLAnchorElement>('a[href]');
  if (!anchor || anchor === bypassAnchor) return;
  if (anchor.protocol !== 'http:' && anchor.protocol !== 'https:') return;
  if (!isProbablyDownloadLink(anchor.href, anchor.hasAttribute('download'))) return;

  const detected = detectDownloadableLink(anchor.href, {
    pageUrl: location.href,
    pageTitle: document.title,
    hintFilename: anchor.getAttribute('download') || filenameFromUrl(anchor.href),
    hasDownloadAttribute: anchor.hasAttribute('download'),
  });
  if (!detected) return;

  event.preventDefault();
  const host = sourceDomain(detected.url);
  const probePromise = probe(detected.url);
  showDetectionPrompt({
    filename: detected.filename,
    domain: host,
    mime: detected.mime,
    probe: probePromise,
    onDownload: async () => {
      const result = await probePromise;
      await startDownload(detected.url, result?.filename || detected.filename, result?.mime, result?.totalBytes);
    },
    onNormal: () => continueNormally(anchor),
    onClose: () => undefined,
  });
}

export async function initDetector(): Promise<void> {
  if (installed) return;
  installed = true;
  settings = await loadSettings();
  if (!settings?.detectionEnabled) return;
  document.addEventListener('click', handleClick, true);

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes['downflow.settings']) return;
      const next = changes['downflow.settings'].newValue as AppSettings | undefined;
      if (next && typeof next === 'object' && 'detectionEnabled' in next) {
        settings = next;
      }
    });
  } catch {
    // Optional live settings updates.
  }
}
