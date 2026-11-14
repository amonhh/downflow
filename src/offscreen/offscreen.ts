import { RateLimiter } from '../engine/bandwidth-limiter';
import { isAbortError } from '../engine/engine-errors';
import { SegmentedDownload, type SegmentedDownloadOptions } from '../engine/segmented-engine';
import { runMediaDownload, type MediaResult } from '../media/media-engine';
import type { AppSettings, MediaResource, SegmentMeta } from '../shared/types';
import { cleanErrorMessage, sanitizeFilename } from '../shared/utilities';
import { getMedia } from '../storage/media-store';
import { OpfsSegmentStorage } from '../storage/segment-storage';
import { normalizeSettings } from '../storage/settings-store';

interface SegmentJobConfig {
  downloadId: string;
  url: string;
  filename: string;
  mime: string;
  totalBytes: number;
  finalUrl?: string;
  etag?: string;
  lastModified?: string;
  segments?: SegmentMeta[];
  segmentCount: number;
  connections: number;
  maxAttempts: number;
  maxBytes: number;
  bandwidthLimitBps: number;
  referer?: string;
}

interface MediaJobConfig {
  downloadId: string;
  mediaId: string;
  representationId?: string;
  variantUri?: string;
  connections: number;
  bandwidthLimitBps: number;
}

interface Delivery {
  blobUrl: string;
  storage: OpfsSegmentStorage;
}

const segmentedJobs = new Map<string, SegmentedDownload>();
const mediaJobs = new Map<string, AbortController>();
const deliveries = new Map<string, Delivery>();
const globalLimiter = new RateLimiter(0);
const storage = new OpfsSegmentStorage();

/**
 * Offscreen documents only expose a subset of extension APIs. In particular
 * `chrome.storage` is not guaranteed to exist there, so settings are fetched
 * from the background service worker over the runtime message channel and the
 * storage-change subscription lives in the worker instead.
 */
async function refreshSettings(): Promise<AppSettings> {
  let stored: Partial<AppSettings> | undefined;
  try {
    const response = (await chrome.runtime.sendMessage({ type: 'settings:get' })) as
      | { ok?: boolean; data?: Partial<AppSettings> }
      | undefined;
    if (response?.ok && response.data) stored = response.data;
  } catch {
    stored = undefined;
  }
  const settings = normalizeSettings(stored);
  globalLimiter.setRate(settings.bandwidthLimitBps);
  return settings;
}

void refreshSettings().catch(() => undefined);

function sendToBackground(message: unknown): void {
  void chrome.runtime.sendMessage(message).catch(() => undefined);
}

async function sendToBackgroundRequest(message: unknown): Promise<void> {
  const response = (await chrome.runtime.sendMessage(message)) as { ok?: boolean; error?: string } | undefined;
  if (!response) throw new Error('The DownFlow background service did not acknowledge the assembled file.');
  if (response.ok === false) throw new Error(response.error || 'The background service rejected the assembled file.');
}

/**
 * Blob downloads started with chrome.downloads.download ignore the `filename`
 * option and are saved under the blob UUID. A temporary blob link keeps the
 * real filename. Chrome's own download folder is used for these deliveries.
 */
function triggerBlobDownload(blobUrl: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = sanitizeFilename(filename);
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to a temporary textarea below.
    }
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  const copied = document.execCommand('copy');
  area.remove();
  if (!copied) throw new Error('Chrome blocked clipboard access.');
}

function createDelivery(downloadId: string, blob: Blob): string {
  const existing = deliveries.get(downloadId);
  if (existing) {
    URL.revokeObjectURL(existing.blobUrl);
    deliveries.delete(downloadId);
  }
  const blobUrl = URL.createObjectURL(blob);
  deliveries.set(downloadId, { blobUrl, storage });
  return blobUrl;
}

async function releaseDelivery(downloadId: string): Promise<void> {
  const delivery = deliveries.get(downloadId);
  if (delivery) {
    URL.revokeObjectURL(delivery.blobUrl);
    deliveries.delete(downloadId);
  }
  await storage.remove(downloadId);
}

function segmentOptions(config: SegmentJobConfig): SegmentedDownloadOptions {
  return {
    downloadId: config.downloadId,
    url: config.url,
    filename: config.filename,
    mime: config.mime,
    totalBytes: config.totalBytes,
    finalUrl: config.finalUrl,
    etag: config.etag,
    lastModified: config.lastModified,
    segments: config.segments,
    segmentCount: config.segmentCount,
    connections: config.connections,
    maxAttempts: config.maxAttempts,
    maxBytes: config.maxBytes,
    storage,
    globalLimiter,
    localLimitBps: config.bandwidthLimitBps,
    callbacks: {
      onProgress: (progress) => {
        sendToBackground({
          type: 'engine:progress',
          payload: {
            downloadId: config.downloadId,
            downloadedBytes: progress.downloadedBytes,
            totalBytes: progress.totalBytes,
            speedBps: progress.speedBps,
            etaSeconds: progress.etaSeconds,
            segments: progress.segments,
          },
        });
      },
      onComplete: (result) => {
        void (async () => {
          try {
            const blobUrl = createDelivery(config.downloadId, result.blob);
            await sendToBackgroundRequest({
              type: 'engine:complete',
              payload: {
                downloadId: config.downloadId,
                blobUrl,
                totalBytes: result.totalBytes,
                filename: result.filename,
                mime: result.mime,
                finalUrl: result.finalUrl,
              },
            });
            triggerBlobDownload(blobUrl, result.filename || config.filename);
          } catch (error) {
            sendToBackground({
              type: 'engine:error',
              payload: {
                downloadId: config.downloadId,
                message: `The assembled file could not be handed to Chrome. ${cleanErrorMessage(error)}`,
                code: 'DELIVERY_PREPARATION_FAILED',
              },
            });
          } finally {
            segmentedJobs.delete(config.downloadId);
          }
        })();
      },
      onPaused: () => {
        sendToBackground({ type: 'engine:paused', downloadId: config.downloadId });
      },
      onError: (error) => {
        segmentedJobs.delete(config.downloadId);
        sendToBackground({
          type: 'engine:error',
          payload: { downloadId: config.downloadId, message: error.message, code: error.code },
        });
      },
      onFallback: (reason) => {
        segmentedJobs.delete(config.downloadId);
        void storage.remove(config.downloadId);
        sendToBackground({
          type: 'engine:fallback',
          payload: { downloadId: config.downloadId, reason },
        });
      },
    },
  };
}

async function startSegmented(config: SegmentJobConfig): Promise<{ started: boolean; resumed: boolean }> {
  if (!config?.downloadId || !config.url) throw new Error('Invalid segmented download request.');
  await refreshSettings();
  const existing = segmentedJobs.get(config.downloadId);
  if (existing) {
    if (existing.isCompleted) return { started: false, resumed: false };
    const resumed = !existing.isRunning;
    void existing.start();
    return { started: true, resumed };
  }
  const runner = new SegmentedDownload(segmentOptions(config));
  segmentedJobs.set(config.downloadId, runner);
  void runner.start();
  return { started: true, resumed: false };
}

async function startMedia(config: MediaJobConfig): Promise<MediaResource> {
  if (!config?.downloadId || !config.mediaId) throw new Error('Invalid media download request.');
  if (mediaJobs.has(config.downloadId)) throw new Error('This media download is already running.');
  await refreshSettings();
  const media = await getMedia(config.mediaId);
  if (!media) throw new Error('The detected media resource has expired. Reload the page and detect it again.');
  if (media.kind !== 'hls' && media.kind !== 'dash') {
    throw new Error('This media resource is a direct file and should use the standard download engine.');
  }
  const controller = new AbortController();
  mediaJobs.set(config.downloadId, controller);
  const localStorage = new OpfsSegmentStorage();
  const reporter = (progress: { downloadedBytes: number; speedBps: number }) => {
    sendToBackground({
      type: 'engine:progress',
      payload: {
        downloadId: config.downloadId,
        downloadedBytes: progress.downloadedBytes,
        totalBytes: 0,
        speedBps: progress.speedBps,
        etaSeconds: null,
      },
    });
  };

  void runMediaDownload({
    downloadId: config.downloadId,
    media,
    representationId: config.representationId,
    variantUri: config.variantUri,
    connections: config.connections,
    bandwidthLimitBps: config.bandwidthLimitBps,
    storage: localStorage,
    globalLimiter,
    signal: controller.signal,
    onProgress: reporter,
  })
    .then(async (result: MediaResult) => {
      const blobUrl = URL.createObjectURL(result.blob);
      deliveries.set(config.downloadId, { blobUrl, storage: localStorage });
      await sendToBackgroundRequest({
        type: 'engine:complete',
        payload: {
          downloadId: config.downloadId,
          blobUrl,
          totalBytes: result.totalBytes,
          filename: result.filename,
          mime: result.mime,
        },
      });
      triggerBlobDownload(blobUrl, result.filename);
    })
    .catch(async (error) => {
      await localStorage.remove(config.downloadId);
      if (isAbortError(error)) return;
      sendToBackground({
        type: 'engine:error',
        payload: {
          downloadId: config.downloadId,
          message: cleanErrorMessage(error),
          code: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'MEDIA_ENGINE_ERROR',
        },
      });
    })
    .finally(() => {
      mediaJobs.delete(config.downloadId);
    });

  return media;
}

function handleCommand(type: string, payload: unknown): Promise<unknown> {
  switch (type) {
    case 'offscreen:start-segmented':
      return startSegmented(payload as SegmentJobConfig);
    case 'offscreen:pause-segmented': {
      const { downloadId } = payload as { downloadId: string };
      const runner = segmentedJobs.get(downloadId);
      if (!runner) return Promise.resolve({ paused: false });
      return runner.pause().then(() => ({ paused: true }));
    }
    case 'offscreen:cancel-segmented': {
      const { downloadId } = payload as { downloadId: string };
      const runner = segmentedJobs.get(downloadId);
      if (runner) {
        segmentedJobs.delete(downloadId);
        return runner.cancel().then(() => releaseDelivery(downloadId)).then(() => ({ cancelled: true }));
      }
      return storage.remove(downloadId).then(() => ({ cancelled: true }));
    }
    case 'offscreen:start-media':
      return startMedia(payload as MediaJobConfig);
    case 'offscreen:cancel-media': {
      const { downloadId } = payload as { downloadId: string };
      mediaJobs.get(downloadId)?.abort();
      mediaJobs.delete(downloadId);
      return releaseDelivery(downloadId).then(() => ({ cancelled: true }));
    }
    case 'offscreen:release-delivery': {
      const { downloadId } = payload as { downloadId: string };
      return releaseDelivery(downloadId).then(() => ({ released: true }));
    }
    case 'offscreen:redeliver': {
      const { downloadId, filename } = payload as { downloadId: string; filename?: string };
      const delivery = deliveries.get(downloadId);
      if (!delivery) throw new Error('The assembled file is no longer available; starting a fresh transfer.');
      triggerBlobDownload(delivery.blobUrl, filename || 'download');
      return Promise.resolve({ redelivered: true });
    }
    case 'offscreen:clear-segments': {
      if (segmentedJobs.size > 0 || mediaJobs.size > 0) {
        throw new Error('Cancel active transfers before clearing temporary segment data.');
      }
      return storage.clearAll().then(() => ({ cleared: true }));
    }
    case 'offscreen:sync-settings':
      return refreshSettings().then((settings) => ({ bandwidthLimitBps: settings.bandwidthLimitBps }));
    case 'offscreen:copy-text': {
      const { text } = payload as { text?: unknown };
      if (typeof text !== 'string' || text.length === 0) throw new Error('There is no text to copy.');
      if (text.length > 100_000) throw new Error('The text is too large to copy.');
      return copyText(text).then(() => ({ copied: true }));
    }
    default:
      return Promise.reject(new Error(`Unknown offscreen command: ${type}`));
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const type = (message as { type?: unknown })?.type;
  if (typeof type !== 'string' || !type.startsWith('offscreen:')) return false;
  const payload = (message as { payload?: unknown }).payload;
  handleCommand(type, payload)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: cleanErrorMessage(error) }));
  return true;
});
