import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearDownloads,
  deleteDownload,
  findActiveDownloads,
  findDownloadByChromeId,
  findQueuedDownloads,
  getDownload,
  listDownloads,
  recoverInterruptedSegmentedDownloads,
  saveDownload,
  saveDownloads,
} from '../src/storage/downloads-store';
import { makeDownload } from './helpers/factories';
import { resetDatabase } from './helpers/db';

beforeEach(async () => {
  await resetDatabase();
});

describe('download metadata persistence', () => {
  it('stores, reads and lists records newest first', async () => {
    const older = makeDownload({ id: 'older', createdAt: 1000, filename: 'older.pdf' });
    const newer = makeDownload({ id: 'newer', createdAt: 2000, filename: 'newer.pdf' });
    await saveDownload(older);
    await saveDownload(newer);

    expect((await getDownload('older'))?.filename).toBe('older.pdf');
    expect(await getDownload('missing')).toBeUndefined();
    expect((await listDownloads()).map((record) => record.id)).toEqual(['newer', 'older']);
  });

  it('updates the updatedAt timestamp on save', async () => {
    const before = Date.now();
    const record = makeDownload({ id: 'stamped', updatedAt: 1 });
    await saveDownload(record);
    const saved = await getDownload('stamped');
    expect(saved?.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('finds records by Chrome download id', async () => {
    await saveDownloads([
      makeDownload({ id: 'a', chromeDownloadId: 11 }),
      makeDownload({ id: 'b', chromeDownloadId: 12 }),
    ]);
    expect((await findDownloadByChromeId(12))?.id).toBe('b');
    expect(await findDownloadByChromeId(99)).toBeUndefined();
  });

  it('filters active and queued downloads with priority ordering', async () => {
    await saveDownloads([
      makeDownload({ id: 'queued-low', status: 'queued', priority: 0, queueOrder: 0 }),
      makeDownload({ id: 'queued-high', status: 'queued', priority: 2, queueOrder: 5 }),
      makeDownload({ id: 'probing', status: 'probing' }),
      makeDownload({ id: 'delivering', status: 'delivering' }),
      makeDownload({ id: 'completed', status: 'completed' }),
    ]);
    expect((await findActiveDownloads()).map((record) => record.id).sort()).toEqual(['delivering', 'probing']);
    expect((await findQueuedDownloads()).map((record) => record.id)).toEqual(['queued-high', 'queued-low']);
  });

  it('deletes individual records and clears history', async () => {
    await saveDownloads([makeDownload({ id: 'a' }), makeDownload({ id: 'b' })]);
    await deleteDownload('a');
    expect((await listDownloads()).map((record) => record.id)).toEqual(['b']);
    await clearDownloads();
    expect(await listDownloads()).toEqual([]);
  });
});

describe('interruption recovery', () => {
  it('pauses segmented transfers that lost their worker but leaves native items alone', async () => {
    await saveDownloads([
      makeDownload({ id: 'segmented', status: 'downloading', kind: 'segmented', recovered: false }),
      makeDownload({ id: 'segmented-native', status: 'downloading', kind: 'segmented', chromeDownloadId: 4 }),
      makeDownload({ id: 'standard', status: 'downloading', kind: 'standard' }),
      makeDownload({ id: 'queued', status: 'queued', kind: 'segmented' }),
    ]);

    const recovered = await recoverInterruptedSegmentedDownloads();
    expect(recovered).toBe(1);
    const segmented = await getDownload('segmented');
    expect(segmented?.status).toBe('paused');
    expect(segmented?.recovered).toBe(true);
    expect(segmented?.error).toMatch(/interrupted/);
    expect((await getDownload('standard'))?.status).toBe('downloading');
    expect((await getDownload('segmented-native'))?.status).toBe('downloading');
    expect((await getDownload('queued'))?.status).toBe('queued');
  });
});
