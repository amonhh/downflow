import { describe, expect, it } from 'vitest';
import {
  detectDownloadableLink,
  detectMediaUrl,
  isIgnoredHost,
  isProbablyDownloadLink,
  makeMediaResource,
} from '../src/shared/detection';

describe('download link detection', () => {
  const pageUrl = 'https://site.example/articles/1';

  it('detects supported document, archive and software links', () => {
    for (const path of ['report.pdf', 'bundle.zip', 'setup.exe', 'clip.mp4']) {
      const detected = detectDownloadableLink(`https://cdn.example/${path}`, { pageUrl });
      expect(detected, path).not.toBeNull();
      expect(detected?.filename).toBe(path);
      expect(detected?.pageUrl).toBe(pageUrl);
    }
  });

  it('uses and sanitizes a hint filename', () => {
    const detected = detectDownloadableLink('https://cdn.example/download?id=9', {
      pageUrl,
      hintFilename: '..\\My File.zip',
      mime: 'application/zip',
    });
    expect(detected?.filename).toBe('My File.zip');
  });

  it('rejects ordinary pages, unsafe protocols and extensionless targets', () => {
    expect(detectDownloadableLink('https://site.example/about', { pageUrl })).toBeNull();
    expect(detectDownloadableLink('javascript:alert(1)', { pageUrl })).toBeNull();
    expect(detectDownloadableLink('https://site.example/download', { pageUrl })).toBeNull();
  });

  it('respects download attributes and MIME hints', () => {
    expect(
      detectDownloadableLink('https://site.example/export', {
        pageUrl,
        hintFilename: 'export.csv',
        hasDownloadAttribute: true,
      })?.filename,
    ).toBe('export.csv');
    expect(isProbablyDownloadLink('https://site.example/export', true)).toBe(true);
    expect(isProbablyDownloadLink('https://site.example/stream', false, 'video/mp4')).toBe(true);
    expect(isProbablyDownloadLink('https://site.example/page', false)).toBe(false);
  });

  it('adds a missing extension to a hint filename from its MIME type', () => {
    const detected = detectDownloadableLink('https://cdn.example/watch/42', {
      pageUrl,
      hintFilename: 'Holiday Video',
      hasDownloadAttribute: true,
      mime: 'video/mp4',
    });
    expect(detected?.filename).toBe('Holiday Video.mp4');
  });

  it('matches ignored hosts including subdomains', () => {
    expect(isIgnoredHost('https://cdn.example.com/a', ['example.com'])).toBe(true);
    expect(isIgnoredHost('https://notexample.com/a', ['example.com'])).toBe(false);
    expect(isIgnoredHost('not a url', ['example.com'])).toBe(true);
  });
});

describe('media detection', () => {
  it('identifies direct video and audio URLs', () => {
    expect(detectMediaUrl('https://cdn.example/movie.mp4', 'https://site.example/watch')?.kind).toBe('video');
    expect(detectMediaUrl('https://cdn.example/song.mp3', 'https://site.example/watch')?.kind).toBe('audio');
  });

  it('identifies HLS and DASH manifests', () => {
    expect(detectMediaUrl('https://cdn.example/master.m3u8', 'https://site.example/watch')?.kind).toBe('hls');
    expect(detectMediaUrl('https://cdn.example/manifest.mpd', 'https://site.example/watch')?.kind).toBe('dash');
  });

  it('accepts media MIME types without a useful extension', () => {
    expect(detectMediaUrl('https://cdn.example/stream?id=1', 'https://site.example/watch', undefined, 'audio/mpeg')?.kind).toBe(
      'audio',
    );
    expect(detectMediaUrl('https://cdn.example/file.pdf', 'https://site.example/watch')).toBeNull();
  });

  it('creates normalized media resources', () => {
    const detected = detectMediaUrl('https://cdn.example/movie.mp4', 'https://www.site.example/watch', 'Movie night');
    expect(detected).not.toBeNull();
    const resource = makeMediaResource(detected!, 'media-1', 1234);
    expect(resource).toMatchObject({
      id: 'media-1',
      sourceDomain: 'site.example',
      kind: 'video',
      title: 'Movie night',
      discoveredAt: 1234,
      protected: false,
    });
  });

  it('falls back to a cleaned page title when the media item has no title', () => {
    const resource = makeMediaResource(
      {
        url: 'https://cdn.example/stream?id=7',
        kind: 'video',
        mime: 'video/mp4',
        pageUrl: 'https://www.site.example/watch',
        pageTitle: 'Guitar Practice Session - YouTube',
      },
      'media-2',
      1234,
    );
    expect(resource.title).toBe('Guitar Practice Session');
  });
});
