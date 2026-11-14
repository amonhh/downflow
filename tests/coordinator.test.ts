import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DownloadCoordinator } from '../src/background/coordinator';
import { getDownload, listDownloads, saveDownload } from '../src/storage/downloads-store';
import { getQueueState } from '../src/storage/settings-store';
import { installChromeMock, uninstallChromeMock, type ChromeMock } from './helpers/chrome-mock';
import { makeDownload } from './helpers/factories';
import { resetDatabase } from './helpers/db';

let mock: ChromeMock;
let coordinator: DownloadCoordinator;

async function waitFor<T>(check: () => Promise<T | null | undefined>, timeoutMs = 3000): Promise<T> {
  const started = Date.now();
  let last: T | null | undefined;
  while (Date.now() - started < timeoutMs) {
    last = await check();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for state. Last value: ${JSON.stringify(last)}`);
}

beforeEach(async () => {
  mock = installChromeMock();
  await resetDatabase();
  coordinator = new DownloadCoordinator();
});

afterEach(async () => {
  uninstallChromeMock();
});

describe('coordinator download state machine', () => {
  it('queues, starts through Chrome, pauses, resumes, cancels and removes a standard download', async () => {
    const started = await coordinator.startDownload({
      url: 'https://example.com/report.pdf',
      filename: 'report.pdf',
      kind: 'standard',
      addToQueue: true,
    });
    expect(started.record.status).toBe('queued');
    expect(started.queued).toBe(true);

    await coordinator.processQueue();
    const active = await waitFor(async () => {
      const record = await getDownload(started.record.id);
      return record?.status === 'downloading' && record.chromeDownloadId ? record : null;
    });
    expect(active.status).toBe('downloading');
    expect(mock.downloadRequests[0]).toMatchObject({
      url: 'https://example.com/report.pdf',
      filename: 'DownFlow/Documents/report.pdf',
    });

    const paused = await coordinator.pause(started.record.id);
    expect(paused.status).toBe('paused');
    expect(mock.paused).toEqual([active.chromeDownloadId]);

    const resumed = await coordinator.resume(started.record.id);
    expect(resumed.status).toBe('downloading');
    expect(mock.resumed).toEqual([active.chromeDownloadId]);

    const cancelled = await coordinator.cancel(started.record.id);
    expect(cancelled.status).toBe('cancelled');
    expect(mock.cancelled).toEqual([active.chromeDownloadId]);

    await coordinator.remove(started.record.id);
    expect(await getDownload(started.record.id)).toBeUndefined();
  });

  it('keeps queued work on hold while the queue is paused and resumes it later', async () => {
    await coordinator.pauseQueue();
    expect((await getQueueState()).paused).toBe(true);

    const started = await coordinator.startDownload({
      url: 'https://example.com/held.zip',
      filename: 'held.zip',
      kind: 'standard',
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect((await getDownload(started.record.id))?.status).toBe('queued');

    await coordinator.resumeQueue();
    const active = await waitFor(async () => {
      const record = await getDownload(started.record.id);
      return record?.status === 'downloading' ? record : null;
    });
    expect(active.chromeDownloadId).toBeTypeOf('number');
  });

  it('stops the queue by pausing active transfers and can resume them all', async () => {
    const started = await coordinator.startDownload({
      url: 'https://example.com/busy.iso',
      filename: 'busy.iso',
      kind: 'standard',
    });
    await waitFor(async () => {
      const record = await getDownload(started.record.id);
      return record?.status === 'downloading' ? record : null;
    });

    await coordinator.stopQueue();
    expect((await getQueueState()).paused).toBe(true);
    expect((await getDownload(started.record.id))?.status).toBe('paused');
    expect(mock.paused).toHaveLength(1);

    await coordinator.startQueue();
    expect((await getQueueState()).paused).toBe(false);
    await coordinator.resumeAll();
    expect((await getDownload(started.record.id))?.status).toBe('downloading');
  });
});

describe('queue priority and ordering', () => {
  it('clamps priorities and reorders queued records', async () => {
    await coordinator.pauseQueue();
    const first = await coordinator.startDownload({
      url: 'https://example.com/a.bin',
      filename: 'a.bin',
      kind: 'standard',
    });
    const second = await coordinator.startDownload({
      url: 'https://example.com/b.bin',
      filename: 'b.bin',
      kind: 'standard',
    });

    await coordinator.setPriority(first.record.id, 99);
    expect((await getDownload(first.record.id))?.priority).toBe(2);

    await coordinator.reorder([second.record.id, first.record.id]);
    const records = await listDownloads();
    expect(records.find((record) => record.id === second.record.id)?.queueOrder).toBe(0);
    expect(records.find((record) => record.id === first.record.id)?.queueOrder).toBe(1);
  });
});

describe('page URL guard', () => {
  it('refuses to save a video watch page as a file', async () => {
    await expect(
      coordinator.startDownload({
        url: 'https://www.youtube.com/watch?v=wHfaCXRVO8U',
        kind: 'standard',
      }),
    ).rejects.toThrow(/not a file/i);
    expect(await listDownloads()).toHaveLength(0);
  });

  it('accepts a direct media file URL', async () => {
    const started = await coordinator.startDownload({
      url: 'https://cdn.example.com/files/movie.mp4',
      kind: 'standard',
      addToQueue: true,
    });
    expect(started.record.filename).toBe('movie.mp4');
    expect(started.record.status).toBe('queued');
  });
});

describe('engine events and history maintenance', () => {
  it('applies engine progress and converts engine failures to resumable records', async () => {
    const record = makeDownload({ status: 'downloading', kind: 'segmented', totalBytes: 1000, downloadedBytes: 0 });
    await saveDownload(record);

    await coordinator.handleEngineProgress({
      downloadId: record.id,
      downloadedBytes: 400,
      totalBytes: 1000,
      speedBps: 200,
      etaSeconds: 3,
      segments: [{ index: 0, start: 0, end: 999, downloaded: 400, status: 'downloading' }],
    });
    const progressed = await getDownload(record.id);
    expect(progressed).toMatchObject({ status: 'downloading', downloadedBytes: 400, speedBps: 200, etaSeconds: 3 });
    expect(progressed?.segments[0].downloaded).toBe(400);

    await coordinator.handleEngineError({ downloadId: record.id, message: 'Network lost', code: 'NETWORK_ERROR' });
    const failed = await getDownload(record.id);
    expect(failed).toMatchObject({ status: 'failed', error: 'Network lost', errorCode: 'NETWORK_ERROR' });
    expect(failed?.canResume).toBe(true);
  });

  it('moves a failed segmented transfer back to the standard queue on fallback', async () => {
    await coordinator.pauseQueue();
    const record = makeDownload({ status: 'downloading', kind: 'segmented', segments: [] });
    await saveDownload(record);
    await coordinator.handleEngineFallback({ downloadId: record.id, reason: 'Range unsupported' });
    const fallback = await getDownload(record.id);
    expect(fallback).toMatchObject({ status: 'queued', kind: 'standard', segments: [] });
  });

  it('clears terminal history but keeps active work', async () => {
    await saveDownload(makeDownload({ id: 'complete', status: 'completed' }));
    await saveDownload(makeDownload({ id: 'failed', status: 'failed' }));
    await saveDownload(makeDownload({ id: 'queued', status: 'queued' }));
    await saveDownload(makeDownload({ id: 'active', status: 'downloading' }));

    const result = await coordinator.clearHistory();
    expect(result).toEqual({ removed: 2, kept: 2 });
    expect((await listDownloads()).map((record) => record.id).sort()).toEqual(['active', 'queued']);
  });

  it('derives stats from persisted records', async () => {
    await saveDownload(makeDownload({ status: 'completed', totalBytes: 50, downloadedBytes: 50 }));
    await saveDownload(makeDownload({ status: 'failed' }));
    const stats = await coordinator.getStats();
    expect(stats.totalDownloads).toBe(2);
    expect(stats.completedDownloads).toBe(1);
    expect(stats.failedDownloads).toBe(1);
  });
});
