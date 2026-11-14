import type { AppSettings, DownloadRecord, DownloadStatus } from '../shared/types';
import { buildDownloadPath, cleanErrorMessage } from '../shared/utilities';

export interface StartStandardOptions {
  url: string;
  filename: string;
  category: DownloadRecord['category'];
  mime?: string;
  saveAs?: boolean;
  duplicatePolicy?: AppSettings['duplicatePolicy'];
}

export function chromeStateToStatus(
  item: Pick<chrome.downloads.DownloadItem, 'state' | 'paused' | 'canResume' | 'error'>,
): DownloadStatus {
  if (item.state === 'complete') return 'completed';
  if (item.state === 'in_progress') return item.paused ? 'paused' : 'downloading';
  if (item.state === 'interrupted') {
    return item.canResume ? 'paused' : 'failed';
  }
  return 'downloading';
}

export async function startStandardDownload(
  options: StartStandardOptions,
  settings?: AppSettings,
): Promise<number> {
  const filename = settings
    ? buildDownloadPath(options.filename, options.category, settings)
    : options.filename;
  const conflictAction: chrome.downloads.FilenameConflictAction =
    options.duplicatePolicy === 'overwrite'
      ? 'overwrite'
      : options.duplicatePolicy === 'prompt'
        ? 'prompt'
        : 'uniquify';
  try {
    const id = await chrome.downloads.download({
      url: options.url,
      filename,
      conflictAction,
      saveAs: options.saveAs ?? false,
    });
    if (typeof id !== 'number') {
      throw new Error('Chrome did not return a download identifier.');
    }
    return id;
  } catch (error) {
    throw new Error(`Chrome could not start this download. ${cleanErrorMessage(error)}`);
  }
}

export async function searchChromeDownload(id: number): Promise<chrome.downloads.DownloadItem | undefined> {
  try {
    const items = await chrome.downloads.search({ id });
    return items[0];
  } catch {
    return undefined;
  }
}

export async function pauseChromeDownload(id: number): Promise<void> {
  await chrome.downloads.pause(id);
}

export async function resumeChromeDownload(id: number): Promise<void> {
  await chrome.downloads.resume(id);
}

export async function cancelChromeDownload(id: number): Promise<void> {
  try {
    await chrome.downloads.cancel(id);
  } catch {
    // The download may already be complete or gone.
  }
}

export async function eraseChromeDownload(id: number): Promise<void> {
  try {
    await chrome.downloads.erase({ id });
  } catch {
    // History may already be gone.
  }
}

export async function openChromeDownload(id: number): Promise<void> {
  await chrome.downloads.open(id);
}

export async function showChromeDownload(id: number): Promise<void> {
  await chrome.downloads.show(id);
}

export function applyChromeItem(record: DownloadRecord, item: chrome.downloads.DownloadItem, now = Date.now()): DownloadRecord {
  const status = chromeStateToStatus(item);
  const totalBytes = item.totalBytes > 0 ? item.totalBytes : item.fileSize > 0 ? item.fileSize : record.totalBytes;
  const downloadedBytes =
    status === 'completed'
      ? totalBytes || item.bytesReceived
      : Math.max(record.downloadedBytes, item.bytesReceived || 0);
  const elapsedSeconds = record.startedAt ? Math.max(0.5, (now - record.startedAt) / 1000) : 0;
  const speedBps =
    status === 'downloading' && record.startedAt
      ? Math.max(0, Math.min(downloadedBytes, item.bytesReceived) / elapsedSeconds)
      : status === 'completed'
        ? 0
        : 0;
  return {
    ...record,
    status,
    filename: item.filename ? item.filename.split(/[\\/]/).pop() || record.filename : record.filename,
    outputPath: item.filename || record.outputPath,
    totalBytes,
    downloadedBytes,
    speedBps,
    etaSeconds:
      speedBps > 0 && totalBytes > downloadedBytes ? Math.ceil((totalBytes - downloadedBytes) / speedBps) : null,
    completedAt: status === 'completed' ? item.endTime ? Date.parse(item.endTime) : now : record.completedAt,
    error:
      status === 'failed'
        ? item.error || 'Chrome could not complete this download.'
        : status === 'downloading'
          ? undefined
          : record.error,
    errorCode: status === 'failed' ? item.error || 'CHROME_INTERRUPTED' : undefined,
    chromeDownloadId: item.id,
    canResume: status === 'completed' ? false : Boolean(item.canResume),
  };
}

export function recordFromChromeItem(item: chrome.downloads.DownloadItem): DownloadRecord {
  const now = Date.now();
  const base: DownloadRecord = {
    id: `chrome-${item.id}-${now}`,
    url: item.finalUrl || item.url,
    finalUrl: item.finalUrl || item.url,
    filename: item.filename.split(/[\\/]/).pop() || 'download',
    mime: item.mime || '',
    category: 'other',
    sourceDomain: 'unknown',
    status: chromeStateToStatus(item),
    kind: 'standard',
    source: 'chrome',
    totalBytes: item.totalBytes > 0 ? item.totalBytes : item.fileSize > 0 ? item.fileSize : 0,
    downloadedBytes: item.bytesReceived || 0,
    speedBps: 0,
    etaSeconds: null,
    createdAt: item.startTime ? Date.parse(item.startTime) : now,
    updatedAt: now,
    startedAt: item.startTime ? Date.parse(item.startTime) : now,
    completedAt: item.endTime ? Date.parse(item.endTime) : undefined,
    chromeDownloadId: item.id,
    canResume: Boolean(item.canResume),
    segments: [],
    segmentCount: 1,
    priority: 0,
    queueOrder: 0,
    attempts: 0,
    maxAttempts: 3,
    bandwidthLimitBps: 0,
    outputPath: item.filename,
    error: item.error,
    errorCode: item.error,
    pageUrl: item.referrer,
  };
  return base;
}
