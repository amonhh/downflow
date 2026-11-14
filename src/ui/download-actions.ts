import type { DownloadRecord } from '../shared/types';
import { sendRequest } from '../shared/messaging';
import type { DownloadAction } from './DownloadCard';

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the legacy clipboard path.
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

export async function performDownloadAction(action: DownloadAction, record: DownloadRecord): Promise<void> {
  switch (action) {
    case 'pause':
      await sendRequest({ type: 'downloads:pause', id: record.id });
      return;
    case 'resume':
      await sendRequest({ type: 'downloads:resume', id: record.id });
      return;
    case 'cancel':
      await sendRequest({ type: 'downloads:cancel', id: record.id });
      return;
    case 'retry':
      await sendRequest({ type: 'downloads:retry', id: record.id });
      return;
    case 'remove':
      await sendRequest({ type: 'downloads:remove', id: record.id });
      return;
    case 'open':
      await sendRequest({ type: 'downloads:open', id: record.id });
      return;
    case 'show':
      await sendRequest({ type: 'downloads:show', id: record.id });
      return;
    case 'copy':
      await copyText(record.url);
      return;
  }
}

export async function setDownloadPriority(record: DownloadRecord, priority: number): Promise<void> {
  await sendRequest({ type: 'downloads:set-priority', id: record.id, priority });
}

export async function reorderQueue(ids: string[]): Promise<void> {
  await sendRequest({ type: 'downloads:reorder', ids });
}

export async function pauseQueue(): Promise<void> {
  await sendRequest({ type: 'queue:pause' });
}

export async function resumeQueue(): Promise<void> {
  await sendRequest({ type: 'queue:resume' });
}

export async function startQueue(max?: number): Promise<void> {
  await sendRequest({ type: 'queue:start', max });
}

export async function stopQueue(): Promise<void> {
  await sendRequest({ type: 'queue:stop' });
}

export async function pauseAll(): Promise<{ paused: number; skipped: number }> {
  return sendRequest<{ paused: number; skipped: number }>({ type: 'downloads:pause-all' });
}

export async function resumeAll(): Promise<{ resumed: number }> {
  return sendRequest<{ resumed: number }>({ type: 'downloads:resume-all' });
}

export async function clearHistory(): Promise<{ removed: number; kept: number }> {
  return sendRequest<{ removed: number; kept: number }>({ type: 'system:clear-history' });
}

export async function clearSegments(): Promise<void> {
  await sendRequest({ type: 'system:clear-segments' });
}
