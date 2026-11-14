import { afterEach, describe, expect, it } from 'vitest';
import { DownFlowEngineError } from '../src/engine/engine-errors';
import { runHlsDownload, runMediaDownload } from '../src/media/media-engine';
import { MemorySegmentStorage } from '../src/storage/segment-storage';
import { makeMedia } from './helpers/factories';
import { startServer, type MockServer } from './helpers/server';

const servers: MockServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

const masterPlaylist = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360
media.m3u8
`;

const mediaPlaylist = `#EXTM3U
#EXT-X-TARGETDURATION:4
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:4,
seg-0.ts
#EXTINF:4,
seg-1.ts
#EXTINF:4,
seg-2.ts
#EXT-X-ENDLIST
`;

function hlsHandler(request: { url?: string }, response: import('node:http').ServerResponse): void {
  const path = request.url ?? '';
  if (path.endsWith('/master.m3u8')) {
    response.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
    response.end(masterPlaylist);
    return;
  }
  if (path.endsWith('/media.m3u8')) {
    response.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
    response.end(mediaPlaylist);
    return;
  }
  if (path.endsWith('/seg-0.ts')) {
    response.writeHead(200, { 'Content-Type': 'video/mp2t' });
    response.end('AAA');
    return;
  }
  if (path.endsWith('/seg-1.ts')) {
    response.writeHead(200, { 'Content-Type': 'video/mp2t' });
    response.end('BBB');
    return;
  }
  if (path.endsWith('/seg-2.ts')) {
    response.writeHead(200, { 'Content-Type': 'video/mp2t' });
    response.end('CCC');
    return;
  }
  response.writeHead(404);
  response.end();
}

function mediaOptions(url: string, storage: MemorySegmentStorage, overrides: Record<string, unknown> = {}) {
  return {
    downloadId: 'media-job',
    media: makeMedia({ kind: 'hls', url, title: 'My Show', mime: 'application/vnd.apple.mpegurl' }),
    connections: 2,
    bandwidthLimitBps: 0,
    storage,
    signal: new AbortController().signal,
    onProgress: () => undefined,
    ...overrides,
  };
}

describe('HLS media engine', () => {
  it('downloads a master playlist variant and assembles segments in order', async () => {
    const server = await startServer(hlsHandler);
    servers.push(server);

    const progress: number[] = [];
    const result = await runHlsDownload(
      mediaOptions(`${server.url}/master.m3u8`, new MemorySegmentStorage(), {
        onProgress: (update: { downloadedBytes: number }) => progress.push(update.downloadedBytes),
      }),
    );

    expect(result.filename).toBe('My Show.ts');
    expect(result.mime).toBe('video/mp2t');
    expect(result.totalBytes).toBe(9);
    expect(await result.blob.text()).toBe('AAABBBCCC');
    expect(progress.at(-1)).toBe(9);
  });

  it('refuses encrypted playlists without attempting a workaround', async () => {
    const server = await startServer((request, response) => {
      if (request.url?.endsWith('encrypted.m3u8')) {
        response.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
        response.end(`#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="key.bin"
#EXTINF:4,
seg.ts
#EXT-X-ENDLIST
`);
        return;
      }
      response.writeHead(404);
      response.end();
    });
    servers.push(server);

    await expect(
      runHlsDownload(mediaOptions(`${server.url}/encrypted.m3u8`, new MemorySegmentStorage())),
    ).rejects.toMatchObject({ code: 'DRM_PROTECTED' });
  });

  it('refuses live playlists that have not ended', async () => {
    const server = await startServer((request, response) => {
      if (request.url?.endsWith('live.m3u8')) {
        response.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
        response.end(`#EXTM3U
#EXT-X-TARGETDURATION:4
#EXTINF:4,
live-0.ts
`);
        return;
      }
      response.writeHead(404);
      response.end();
    });
    servers.push(server);

    await expect(runHlsDownload(mediaOptions(`${server.url}/live.m3u8`, new MemorySegmentStorage()))).rejects.toMatchObject(
      { code: 'LIVE_STREAM_UNSUPPORTED' },
    );
  });

  it('routes direct media to the standard engine instead of faking stream support', async () => {
    const error = await runMediaDownload(
      mediaOptions('https://cdn.example/video.mp4', new MemorySegmentStorage(), {
        media: makeMedia({ kind: 'video', url: 'https://cdn.example/video.mp4' }),
      }),
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DownFlowEngineError);
    expect((error as DownFlowEngineError).code).toBe('DIRECT_MEDIA_STANDARD');
  });
});
