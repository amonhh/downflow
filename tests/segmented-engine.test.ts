import { afterEach, describe, expect, it } from 'vitest';
import { MIN_SEGMENT_SIZE } from '../src/shared/constants';
import type { SegmentMeta } from '../src/shared/types';
import { planSegments } from '../src/engine/file-assembler';
import { SegmentedDownload, type SegmentedResult } from '../src/engine/segmented-engine';
import { MemorySegmentStorage } from '../src/storage/segment-storage';
import { startRangeServer, type MockServer } from './helpers/server';

const servers: MockServer[] = [];
const total = MIN_SEGMENT_SIZE * 2;

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function makePayload(size = total): Buffer {
  const payload = Buffer.alloc(size);
  for (let index = 0; index < size; index++) payload[index] = index % 251;
  return payload;
}

/**
 * Deep-equality on a multi-megabyte typed array is extremely slow inside
 * Vitest, so compare the raw bytes with Buffer.compare instead.
 */
async function expectBlobEquals(blob: Blob, expected: Buffer): Promise<void> {
  const actual = Buffer.from(await blob.arrayBuffer());
  expect(actual.length).toBe(expected.length);
  expect(Buffer.compare(actual, expected)).toBe(0);
}

function runDownload(
  url: string,
  storage: MemorySegmentStorage,
  callbacks: {
    onProgress?: (progress: { downloadedBytes: number; segments: SegmentMeta[] }) => void;
    segments?: SegmentMeta[];
  } = {},
): Promise<SegmentedResult> {
  return new Promise<SegmentedResult>((resolve, reject) => {
    const download = new SegmentedDownload({
      downloadId: 'segmented-job',
      url,
      filename: 'video.mp4',
      mime: 'video/mp4',
      totalBytes: total,
      segmentCount: 4,
      connections: 2,
      maxAttempts: 2,
      maxBytes: total * 2,
      storage,
      segments: callbacks.segments,
      callbacks: {
        onProgress: (progress) => callbacks.onProgress?.(progress),
        onComplete: resolve,
        onPaused: () => reject(new Error('Unexpected pause')),
        onError: (error) => reject(new Error(`${error.code}: ${error.message}`)),
        onFallback: (reason) => reject(new Error(`Unexpected fallback: ${reason}`)),
      },
    });
    void download.start();
  });
}

describe('segmented transfer engine', () => {
  it('downloads, assembles and verifies a multi-segment file over HTTP Range', async () => {
    const payload = makePayload();
    const ranges: string[] = [];
    const server = await startRangeServer(payload, {
      contentType: 'video/mp4',
      onRequest: (request) => {
        if (request.headers.range) ranges.push(request.headers.range);
      },
    });
    servers.push(server);

    const updates: Array<{ downloadedBytes: number; segments: SegmentMeta[] }> = [];
    const result = await runDownload(`${server.url}/video.mp4`, new MemorySegmentStorage(), {
      onProgress: (progress) => updates.push(progress),
    });

    expect(result.totalBytes).toBe(total);
    expect(result.filename).toBe('video.mp4');
    expect(result.mime).toBe('video/mp4');
    await expectBlobEquals(result.blob, payload);
    expect(ranges.length).toBeGreaterThanOrEqual(2);
    expect(ranges[0]).toMatch(/^bytes=0-/);
    expect(updates.at(-1)?.downloadedBytes).toBe(total);
    expect(updates.at(-1)?.segments.every((segment) => segment.status === 'completed')).toBe(true);
  });

  it('resumes from persisted segment data', async () => {
    const payload = makePayload();
    const planned = planSegments(total, 4);
    const storage = new MemorySegmentStorage();
    await storage.append('segmented-job', 0, new Uint8Array(payload.subarray(planned[0].start, planned[0].end + 1)));

    const segments: SegmentMeta[] = planned.map((segment, index) => ({
      index,
      start: segment.start,
      end: segment.end,
      downloaded: index === 0 ? segment.size : 0,
      status: index === 0 ? 'completed' : 'pending',
    }));

    const ranges: string[] = [];
    const server = await startRangeServer(payload, {
      onRequest: (request) => {
        if (request.headers.range) ranges.push(request.headers.range);
      },
    });
    servers.push(server);

    const result = await runDownload(`${server.url}/resume.mp4`, storage, { segments });
    await expectBlobEquals(result.blob, payload);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toBe(`bytes=${planned[1].start}-${planned[1].end}`);
  });

  it('falls back honestly when the server ignores Range', async () => {
    const server = await startRangeServer(makePayload(), { supportRanges: false });
    servers.push(server);

    const reason = await new Promise<string>((resolve, reject) => {
      const download = new SegmentedDownload({
        downloadId: 'fallback-job',
        url: `${server.url}/plain.mp4`,
        filename: 'plain.mp4',
        mime: 'video/mp4',
        totalBytes: total,
        segmentCount: 4,
        connections: 2,
        maxAttempts: 1,
        maxBytes: total * 2,
        storage: new MemorySegmentStorage(),
        callbacks: {
          onProgress: () => undefined,
          onComplete: () => reject(new Error('Should not complete')),
          onPaused: () => reject(new Error('Should not pause')),
          onError: (error) => reject(new Error(`${error.code}: ${error.message}`)),
          onFallback: resolve,
        },
      });
      void download.start();
    });

    expect(reason).toMatch(/HTTP 200|Range/i);
  });

  it('falls back when the file exceeds the configured segmented safety limit', async () => {
    const server = await startRangeServer(makePayload(16));
    servers.push(server);

    const reason = await new Promise<string>((resolve, reject) => {
      const download = new SegmentedDownload({
        downloadId: 'limit-job',
        url: `${server.url}/huge.bin`,
        filename: 'huge.bin',
        mime: 'application/octet-stream',
        totalBytes: 10 * 1024 * 1024,
        segmentCount: 4,
        connections: 2,
        maxAttempts: 1,
        maxBytes: 1024,
        storage: new MemorySegmentStorage(),
        callbacks: {
          onProgress: () => undefined,
          onComplete: () => reject(new Error('Should not complete')),
          onPaused: () => reject(new Error('Should not pause')),
          onError: (error) => reject(new Error(`${error.code}: ${error.message}`)),
          onFallback: resolve,
        },
      });
      void download.start();
    });

    expect(reason).toMatch(/safety limit/);
  });
});
