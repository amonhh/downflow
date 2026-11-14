import { describe, expect, it } from 'vitest';
import {
  hlsFilenameFromTitle,
  parseHlsAttributes,
  parseHlsManifest,
  resolveMediaUrl,
} from '../src/media/hls-detector';

const master = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2"
low/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1920x1080
high/index.m3u8
`;

const media = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:5
#EXT-X-MAP:URI="init.mp4",BYTERANGE="720@0"
#EXTINF:9.5,
seg0.m4s
#EXT-X-BYTERANGE:1000@720
#EXTINF:10,
seg1.m4s
#EXT-X-ENDLIST
`;

describe('HLS manifest parsing', () => {
  it('parses attribute lists with quoted values', () => {
    expect(parseHlsAttributes('BANDWIDTH=800000,CODECS="avc1,mp4a",RESOLUTION=1280x720')).toEqual({
      BANDWIDTH: '800000',
      CODECS: 'avc1,mp4a',
      RESOLUTION: '1280x720',
    });
  });

  it('resolves relative media URLs safely', () => {
    expect(resolveMediaUrl('low/index.m3u8', 'https://cdn.example/stream/master.m3u8')).toBe(
      'https://cdn.example/stream/low/index.m3u8',
    );
    expect(resolveMediaUrl('http://[', 'https://cdn.example/')).toBe('http://[');
  });

  it('extracts master variants with absolute URLs', () => {
    const playlist = parseHlsManifest(master, 'https://cdn.example/stream/master.m3u8');
    expect(playlist.kind).toBe('master');
    expect(playlist.segments).toEqual([]);
    expect(playlist.variants).toHaveLength(2);
    expect(playlist.variants[0]).toMatchObject({
      uri: 'https://cdn.example/stream/low/index.m3u8',
      bandwidth: 800000,
      resolution: '1280x720',
    });
    expect(playlist.variants[1].uri).toBe('https://cdn.example/stream/high/index.m3u8');
  });

  it('extracts VOD segments, init maps, byte ranges and sequences', () => {
    const playlist = parseHlsManifest(media, 'https://cdn.example/vod/index.m3u8');
    expect(playlist.kind).toBe('media');
    expect(playlist.targetDuration).toBe(10);
    expect(playlist.mediaSequence).toBe(5);
    expect(playlist.endList).toBe(true);
    expect(playlist.initUrl).toBe('https://cdn.example/vod/init.mp4');
    expect(playlist.initByteRange).toEqual({ length: 720, offset: 0 });
    expect(playlist.outputExtension).toBe('mp4');
    expect(playlist.segments).toHaveLength(2);
    expect(playlist.segments[0]).toMatchObject({ sequence: 5, duration: 9.5 });
    expect(playlist.segments[1].byteRange).toEqual({ length: 1000, offset: 720 });
  });

  it('flags encrypted streams instead of pretending to support them', () => {
    const encrypted = parseHlsManifest(
      `#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="key.bin"
#EXTINF:4,
seg.ts
#EXT-X-ENDLIST
`,
      'https://cdn.example/encrypted/index.m3u8',
    );
    expect(encrypted.encrypted).toBe(true);
    expect(encrypted.encryptionMethod).toBe('AES-128');
    expect(encrypted.outputExtension).toBe('ts');
  });

  it('treats METHOD=NONE as unencrypted', () => {
    const clear = parseHlsManifest(
      `#EXTM3U
#EXT-X-KEY:METHOD=NONE
#EXTINF:4,
seg.ts
#EXT-X-ENDLIST
`,
      'https://cdn.example/clear/index.m3u8',
    );
    expect(clear.encrypted).toBe(false);
  });

  it('creates safe stream filenames', () => {
    expect(hlsFilenameFromTitle('My Show.mp4', 'ts')).toBe('My Show.ts');
    expect(hlsFilenameFromTitle(undefined, 'mp4')).toBe('downflow-stream.mp4');
  });
});
