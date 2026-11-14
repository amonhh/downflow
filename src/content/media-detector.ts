import type { ApiResponse, AppSettings, DetectedMedia, MediaResourceKind } from '../shared/types';
import { detectMediaUrl } from '../shared/detection';
import { getExtensionFromUrl } from '../shared/utilities';

let started = false;
const reported = new Set<string>();
let settings: AppSettings | null = null;
let reportTimer: ReturnType<typeof setTimeout> | undefined;

function shouldReport(url: string): boolean {
  if (!/^https?:/i.test(url) || reported.has(url)) return false;
  const extension = getExtensionFromUrl(url);
  return ['m3u8', 'mpd', 'mp4', 'webm', 'mov', 'mkv', 'm4v', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus'].includes(extension);
}

function report(url: string, kindHint?: MediaResourceKind, mime = '', duration?: number): void {
  if (!settings || reported.size > 300 || !shouldReport(url)) return;
  if (kindHint === 'hls' && !settings.hlsDetection) return;
  if (kindHint === 'dash' && !settings.dashDetection) return;
  const media = detectMediaUrl(url, location.href, document.title, mime, kindHint);
  if (!media) return;
  media.duration = duration;
  reported.add(url);
  try {
    void chrome.runtime.sendMessage({
      type: 'media:discovered',
      payload: media,
    } satisfies { type: 'media:discovered'; payload: DetectedMedia });
  } catch {
    // The extension may have been reloaded.
  }
}

function scanner(): void {
  for (const element of Array.from(document.querySelectorAll<HTMLMediaElement>('video, audio'))) {
    const source = element.currentSrc || element.src;
    if (source) {
      const kind: MediaResourceKind = element.tagName === 'AUDIO' ? 'audio' : 'video';
      const duration = Number.isFinite(element.duration) ? element.duration : undefined;
      report(source, kind, '', duration);
    }
    for (const child of Array.from(element.querySelectorAll<HTMLSourceElement>('source[src]'))) {
      report(child.src, element.tagName === 'AUDIO' ? 'audio' : 'video', child.type);
    }
  }
  for (const link of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    if (/\.(m3u8|mpd)(?:$|\?)/i.test(link.href)) report(link.href, /\.mpd/i.test(link.href) ? 'dash' : 'hls');
  }
}

function performanceScan(): void {
  try {
    for (const entry of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
      if (!entry.name) continue;
      if (/\.(m3u8|mpd)(?:$|\?)/i.test(entry.name)) {
        report(entry.name, /\.mpd/i.test(entry.name) ? 'dash' : 'hls');
      } else if (/\.(mp4|webm|m4a|mp3|ogg)(?:$|\?)/i.test(entry.name)) {
        report(entry.name);
      }
    }
  } catch {
    // Performance resource timing is best-effort.
  }
}

function scheduleScan(): void {
  if (reportTimer) return;
  reportTimer = setTimeout(() => {
    reportTimer = undefined;
    scanner();
    performanceScan();
  }, 1200);
}

export async function initMediaDetector(): Promise<void> {
  if (started) return;
  started = true;
  try {
    const response = (await chrome.runtime.sendMessage({ type: 'settings:get' })) as ApiResponse<AppSettings>;
    if (!response?.ok || !response.data.mediaDetection) return;
    settings = response.data;
  } catch {
    return;
  }
  scanner();
  performanceScan();
  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('load', scheduleScan, { once: true });
  setTimeout(scheduleScan, 2500);
  try {
    const performanceObserver = new PerformanceObserver(() => performanceScan());
    performanceObserver.observe({ type: 'resource', buffered: true });
  } catch {
    // Resource timing is optional.
  }
}
