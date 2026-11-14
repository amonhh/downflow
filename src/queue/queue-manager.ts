import type { DownloadRecord } from '../shared/types';
import { activeStatus } from '../shared/utilities';

export function sortQueue(records: DownloadRecord[]): DownloadRecord[] {
  return [...records].sort(
    (a, b) => b.priority - a.priority || a.queueOrder - b.queueOrder || a.createdAt - b.createdAt,
  );
}

export function countActive(records: DownloadRecord[]): number {
  return records.filter((record) => activeStatus(record.status)).length;
}

export function nextQueueCandidates(
  records: DownloadRecord[],
  maxConcurrent: number,
  maxToStart = Number.POSITIVE_INFINITY,
): DownloadRecord[] {
  const queued = sortQueue(records.filter((record) => record.status === 'queued'));
  const slots = Math.max(0, maxConcurrent - countActive(records));
  return queued.slice(0, Math.min(slots, maxToStart));
}

export function nextQueueOrder(records: DownloadRecord[]): number {
  const max = records.reduce((value, record) => Math.max(value, record.queueOrder || 0), 0);
  return max + 1;
}

export function reorderQueued(records: DownloadRecord[], orderedIds: string[]): DownloadRecord[] {
  const queuedIds = new Set(records.filter((record) => record.status === 'queued').map((record) => record.id));
  const ids = orderedIds.filter((id) => queuedIds.has(id));
  for (const id of queuedIds) {
    if (!ids.includes(id)) ids.push(id);
  }
  const positions = new Map(ids.map((id, index) => [id, index]));
  const now = Date.now();
  return records.map((record) => {
    if (!positions.has(record.id)) return record;
    return { ...record, queueOrder: positions.get(record.id)!, updatedAt: now };
  });
}

export function moveQueueItem(records: DownloadRecord[], id: string, direction: -1 | 1): DownloadRecord[] {
  const queued = sortQueue(records.filter((record) => record.status === 'queued'));
  const index = queued.findIndex((record) => record.id === id);
  if (index < 0) return records;
  const target = index + direction;
  if (target < 0 || target >= queued.length) return records;
  const ids = queued.map((record) => record.id);
  [ids[index], ids[target]] = [ids[target], ids[index]];
  return reorderQueued(records, ids);
}
