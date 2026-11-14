import { describe, expect, it } from 'vitest';
import { defaultSiteFormat, normalizeSiteFormats, siteFormatSummary } from '../src/shared/site-formats';
import type { SiteRawFormat } from '../src/shared/types';

const formats: SiteRawFormat[] = [
  {
    format_id: '18',
    ext: 'mp4',
    width: 640,
    height: 360,
    fps: 30,
    vcodec: 'avc1.42001E',
    acodec: 'mp4a.40.2',
    tbr: 500,
    filesize: 10_000_000,
  },
  {
    format_id: '22',
    ext: 'mp4',
    width: 1280,
    height: 720,
    fps: 30,
    vcodec: 'avc1.64001F',
    acodec: 'mp4a.40.2',
    tbr: 1500,
    filesize: 40_000_000,
  },
  {
    format_id: '137',
    ext: 'mp4',
    width: 1920,
    height: 1080,
    fps: 30,
    vcodec: 'avc1.640028',
    acodec: 'none',
    tbr: 4000,
    filesize: 120_000_000,
  },
  {
    format_id: '248',
    ext: 'webm',
    width: 1920,
    height: 1080,
    fps: 60,
    vcodec: 'vp9',
    acodec: 'none',
    tbr: 3500,
    filesize_approx: 90_000_000,
  },
  {
    format_id: '140',
    ext: 'm4a',
    vcodec: 'none',
    acodec: 'mp4a.40.2',
    abr: 128,
    filesize: 3_000_000,
  },
  {
    format_id: '251',
    ext: 'webm',
    vcodec: 'none',
    acodec: 'opus',
    abr: 160,
    filesize: 3_500_000,
  },
  {
    format_id: 'sb0',
    ext: 'mhtml',
    vcodec: 'none',
    acodec: 'none',
    format_note: 'storyboard',
  },
];

describe('site format normalization', () => {
  it('sorts video choices best-first and audio choices by bitrate', () => {
    const normalized = normalizeSiteFormats(formats, { ffmpeg: true });
    const video = normalized.filter((format) => format.kind !== 'audio');
    const audio = normalized.filter((format) => format.kind === 'audio');

    expect(video.map((format) => format.height)).toEqual([1080, 1080, 720, 360]);
    expect(video[0].fps).toBe(60);
    expect(audio.map((format) => format.bitrateKbps)).toEqual([160, 128]);
  });

  it('marks video-only streams as merge choices with a yt-dlp expression', () => {
    const normalized = normalizeSiteFormats(formats, { ffmpeg: true });
    const videoOnly = normalized.find((format) => format.sourceFormatId === '137');

    expect(videoOnly).toMatchObject({
      kind: 'video',
      needsMerge: true,
      downloadable: true,
      id: '137+bestaudio/best',
    });
    expect(videoOnly?.label).toContain('video only');
    expect(videoOnly?.note).toMatch(/FFmpeg/);
  });

  it('disables merge-only choices when FFmpeg is unavailable', () => {
    const normalized = normalizeSiteFormats(formats, { ffmpeg: false });
    const videoOnly = normalized.filter((format) => format.needsMerge);

    expect(videoOnly.length).toBeGreaterThan(0);
    expect(videoOnly.every((format) => format.downloadable === false)).toBe(true);
    expect(normalized.find((format) => format.kind === 'video+audio' && format.height === 720)?.downloadable).toBe(true);
  });

  it('chooses the best downloadable format and skips storyboards and DRM', () => {
    const withDrm: SiteRawFormat[] = [
      ...formats,
      {
        format_id: 'drm',
        ext: 'mp4',
        height: 2160,
        vcodec: 'avc1',
        acodec: 'mp4a',
        has_drm: true,
      },
    ];
    const normalized = normalizeSiteFormats(withDrm, { ffmpeg: false });
    const best = defaultSiteFormat(normalized);

    expect(normalized.some((format) => format.sourceFormatId === 'sb0')).toBe(false);
    expect(normalized.some((format) => format.sourceFormatId === 'drm')).toBe(false);
    expect(best?.height).toBe(720);
    expect(best?.downloadable).toBe(true);

    const mergeBest = defaultSiteFormat(normalizeSiteFormats(withDrm, { ffmpeg: true }));
    expect(mergeBest?.height).toBe(1080);
    expect(mergeBest?.downloadable).toBe(true);
  });

  it('keeps only the highest bitrate option for duplicate resolution and container', () => {
    const duplicate: SiteRawFormat[] = [
      { format_id: 'a', ext: 'mp4', height: 720, fps: 30, vcodec: 'avc1', acodec: 'mp4a', tbr: 1000 },
      { format_id: 'b', ext: 'mp4', height: 720, fps: 30, vcodec: 'avc1', acodec: 'mp4a', tbr: 2000 },
    ];
    const normalized = normalizeSiteFormats(duplicate, { ffmpeg: true });
    expect(normalized).toHaveLength(1);
    expect(normalized[0].sourceFormatId).toBe('b');
  });

  it('marks live streams as unavailable and tolerates empty metadata', () => {
    const live = normalizeSiteFormats(formats, { ffmpeg: true, isLive: true });
    expect(live.every((format) => format.downloadable === false)).toBe(true);
    expect(normalizeSiteFormats(undefined, { ffmpeg: true })).toEqual([]);
  });

  it('produces a short summary for the queue UI', () => {
    const normalized = normalizeSiteFormats(formats, { ffmpeg: true });
    expect(siteFormatSummary(normalized[0])).toMatch(/1080p/);
    expect(siteFormatSummary(undefined)).toBe('Automatic quality');
  });
});
