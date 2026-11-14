import type { DownloadRecord } from '../shared/types';
import { dbDelete, dbGet, dbGetAll, dbPut, dbPutMany, dbClear } from './database';

export async function listDownloads(): Promise<DownloadRecord[]> {
  const records = await dbGetAll<DownloadRecord>('downloads');
  return records.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getDownload(id: string): Promise<DownloadRecord | undefined> {
  return dbGet<DownloadRecord>('downloads', id);
}

export async function saveDownload(record: DownloadRecord): Promise<void> {
  await dbPut('downloads', { ...record, updatedAt: Date.now() });
}

export async function saveDownloads(records: DownloadRecord[]): Promise<void> {
  const now = Date.now();
  await dbPutMany(
    'downloads',
    records.map((record) => ({ ...record, updatedAt: now })),
  );
}

export async function deleteDownload(id: string): Promise<void> {
  await dbDelete('downloads', id);
}

export async function clearDownloads(): Promise<void> {
  await dbClear('downloads');
}

export async function findDownloadByChromeId(chromeDownloadId: number): Promise<DownloadRecord | undefined> {
  const records = await listDownloads();
  return records.find((record) => record.chromeDownloadId === chromeDownloadId);
}

export async function findActiveDownloads(): Promise<DownloadRecord[]> {
  const records = await listDownloads();
  return records.filter(
    (record) =>
      record.status === 'downloading' || record.status === 'probing' || record.status === 'delivering',
  );
}

export async function findQueuedDownloads(): Promise<DownloadRecord[]> {
  const records = await listDownloads();
  return records
    .filter((record) => record.status === 'queued')
    .sort((a, b) => b.priority - a.priority || a.queueOrder - b.queueOrder || a.createdAt - b.createdAt);
}

export async function recoverInterruptedSegmentedDownloads(): Promise<number> {
  const records = await listDownloads();
  let recovered = 0;
  const now = Date.now();
  const next = records.map((record) => {
    if (
      (record.status === 'downloading' || record.status === 'probing' || record.status === 'delivering') &&
      record.kind !== 'standard' &&
      !record.chromeDownloadId
    ) {
      recovered += 1;
      return {
        ...record,
        status: 'paused' as const,
        speedBps: 0,
        etaSeconds: null,
        updatedAt: now,
        recovered: true,
        error: 'Transfer interrupted when Chrome closed. Resume to continue from saved segment data.',
      };
    }
    return record;
  });
  if (recovered > 0) {
    const changed = next.filter((record, index) => record !== records[index]);
    await saveDownloads(changed);
  }
  return recovered;
}
