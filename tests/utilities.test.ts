import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/constants';
import {
  buildDownloadPath,
  calculateSpeed,
  cleanTitleForFilename,
  ensureFilenameExtension,
  estimateEta,
  extensionFromMime,
  formatBytes,
  formatDuration,
  formatEta,
  formatSpeed,
  getExtension,
  getExtensionFromUrl,
  getFileCategory,
  inferFilenameExtension,
  isDirectFileUrl,
  localDayKey,
  makeUniqueFilename,
  pageDownloadHint,
  parseContentDisposition,
  progressPercent,
  resolveDownloadFilename,
  sanitizeFilename,
  sanitizeFolder,
  sourceDomain,
  truncateFilename,
  validateDownloadUrl,
} from '../src/shared/utilities';

describe('filename and path safety', () => {
  it('removes path traversal, reserved names and invalid characters', () => {
    expect(sanitizeFilename('../../evil<file>.zip')).toBe('evil_file_.zip');
    expect(sanitizeFilename('CON.txt')).toBe('_CON.txt');
    expect(sanitizeFilename('...hidden...pdf')).toBe('hidden...pdf');
    expect(sanitizeFilename('')).toBe('download');
    expect(sanitizeFilename('a\\b\\c.tar.gz')).toBe('c.tar.gz');
  });

  it('truncates long names but preserves the extension', () => {
    const long = `${'a'.repeat(300)}.exe`;
    const result = truncateFilename(long, 60);
    expect(result.length).toBeLessThanOrEqual(60);
    expect(result.endsWith('.exe')).toBe(true);
  });

  it('sanitizes folder segments and blocks parent traversal', () => {
    expect(sanitizeFolder('..\\..\\My Stuff//Bad:Name')).toBe('My Stuff/Bad_Name');
    expect(sanitizeFolder('../../')).toBe('');
  });

  it('builds category-aware download paths', () => {
    const path = buildDownloadPath('report.pdf', 'documents', DEFAULT_SETTINGS);
    expect(path).toBe('DownFlow/Documents/report.pdf');
    const flat = buildDownloadPath('report.pdf', 'documents', {
      ...DEFAULT_SETTINGS,
      categorizeFolders: false,
    });
    expect(flat).toBe('report.pdf');
  });
});

describe('extension and category detection', () => {
  it('extracts extensions from names and URLs', () => {
    expect(getExtension('archive.tar.gz')).toBe('gz');
    expect(getExtension('file')).toBe('');
    expect(getExtensionFromUrl('https://x.test/a/My%20File.MP4?token=1')).toBe('mp4');
  });

  it('maps extensions and MIME types to categories', () => {
    expect(getFileCategory('movie.MP4')).toBe('videos');
    expect(getFileCategory('unknown', 'image/png')).toBe('images');
    expect(getFileCategory('setup.exe')).toBe('software');
    expect(getFileCategory('notes.bin')).toBe('other');
  });
});

describe('URL validation', () => {
  it('accepts only safe http(s) URLs', () => {
    expect(validateDownloadUrl('https://example.com/file.zip').valid).toBe(true);
    expect(validateDownloadUrl('ftp://example.com/file.zip').valid).toBe(false);
    expect(validateDownloadUrl('https://user:pass@example.com/file.zip').valid).toBe(false);
    expect(validateDownloadUrl('example.com/file.zip').valid).toBe(false);
    expect(validateDownloadUrl('').reason).toMatch(/Enter a download URL/);
  });

  it('normalizes the source domain', () => {
    expect(sourceDomain('https://www.example.com/a')).toBe('example.com');
    expect(sourceDomain('not a url')).toBe('unknown');
  });
});

describe('formatting helpers', () => {
  it('formats byte and speed values with binary units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(-1)).toBe('Unknown');
    expect(formatSpeed(1048576)).toBe('1.00 MB/s');
    expect(formatSpeed(0)).toBe('0 B/s');
  });

  it('formats durations and ETAs', () => {
    expect(formatDuration(9)).toBe('9s');
    expect(formatDuration(125)).toBe('2m 5s');
    expect(formatDuration(3660)).toBe('1h 1m');
    expect(formatEta(0.2)).toBe('< 1s');
    expect(formatEta(null)).toBe('—');
  });

  it('computes progress, speed and ETA from raw counters', () => {
    expect(progressPercent({ downloadedBytes: 50, totalBytes: 100, status: 'downloading' })).toBe(50);
    expect(progressPercent({ downloadedBytes: 0, totalBytes: 0, status: 'downloading' })).toBe(0);
    expect(progressPercent({ downloadedBytes: 1, totalBytes: 1, status: 'completed' })).toBe(100);
    expect(calculateSpeed(100, 300, 1000)).toBe(200);
    expect(calculateSpeed(300, 100, 1000)).toBe(0);
    expect(estimateEta(1000, 100)).toBe(10);
    expect(estimateEta(1000, 0)).toBeNull();
  });
});

describe('filename resolution for real downloads', () => {
  it('names each download from its own title, not a shared placeholder', () => {
    const lecture = resolveDownloadFilename({
      url: 'https://media.example.com/videoplayback?id=1',
      title: 'Physics Lecture 3',
      mime: 'video/mp4',
    });
    const concert = resolveDownloadFilename({
      url: 'https://media.example.com/videoplayback?id=2',
      title: 'Summer Concert Highlights - YouTube',
      mime: 'video/mp4',
    });
    expect(lecture).toBe('Physics Lecture 3.mp4');
    expect(concert).toBe('Summer Concert Highlights.mp4');
    expect(lecture).not.toBe(concert);
  });

  it('adds the correct media extension to an extensionless title', () => {
    expect(
      resolveDownloadFilename({
        url: 'https://cdn.example.com/stream/48291',
        title: 'Family Holiday Video',
        mime: 'video/mp4',
      }),
    ).toBe('Family Holiday Video.mp4');
    expect(
      resolveDownloadFilename({
        url: 'https://cdn.example.com/audio/track',
        title: 'Episode 12 - My Podcast',
        mime: 'audio/mpeg',
      }),
    ).toBe('Episode 12 - My Podcast.mp3');
    expect(
      resolveDownloadFilename({
        url: 'https://cdn.example.com/listen',
        title: 'Piano Session',
        mediaKind: 'audio',
      }),
    ).toBe('Piano Session.m4a');
  });

  it('keeps a real extension and replaces a misleading one', () => {
    expect(
      resolveDownloadFilename({
        url: 'https://cdn.example.com/files/movie.mkv',
        mime: 'application/octet-stream',
      }),
    ).toBe('movie.mkv');
    expect(
      resolveDownloadFilename({
        url: 'https://cdn.example.com/watch',
        requested: 'Holiday Clip.exe',
        mime: 'video/mp4',
      }),
    ).toBe('Holiday Clip.mp4');
    expect(
      resolveDownloadFilename({
        url: 'https://cdn.example.com/watch',
        requested: 'Holiday Clip',
        mime: 'video/mp4',
      }),
    ).toBe('Holiday Clip.mp4');
  });

  it('prefers a server filename and never invents a shared name', () => {
    expect(
      resolveDownloadFilename({
        url: 'https://files.example.com/download.php?id=9',
        contentDisposition: 'attachment; filename="Annual Report 2026.pdf"',
        mime: 'application/pdf',
      }),
    ).toBe('Annual Report 2026.pdf');
    expect(
      resolveDownloadFilename({
        url: 'https://files.example.com/download.php?id=9',
        mime: 'application/pdf',
      }),
    ).toBe('download.pdf');
  });

  it('uses a meaningful title over a generic URL basename', () => {
    expect(
      resolveDownloadFilename({
        url: 'https://cdn.example.com/__down?bytes=1024',
        title: 'Project Backup',
        mime: 'application/zip',
      }),
    ).toBe('Project Backup.zip');
    expect(
      resolveDownloadFilename({
        url: 'https://cdn.example.com/__down?bytes=1024',
        mime: 'application/octet-stream',
      }),
    ).toBe('__down.bin');
  });

  it('resolves stream filenames and cleans site suffixes', () => {
    expect(cleanTitleForFilename('Live Session - YouTube')).toBe('Live Session');
    expect(cleanTitleForFilename('Documentary | Vimeo')).toBe('Documentary');
    expect(
      resolveDownloadFilename({
        url: 'https://cdn.example.com/live/index.m3u8',
        title: 'Live Session - YouTube',
        mime: 'application/vnd.apple.mpegurl',
        mediaKind: 'hls',
      }),
    ).toBe('Live Session.ts');
    expect(
      resolveDownloadFilename({
        url: 'https://cdn.example.com/live/manifest.mpd',
        title: 'Documentary',
        mime: 'application/dash+xml',
        mediaKind: 'dash',
      }),
    ).toBe('Documentary.mp4');
  });

  it('exposes extension inference helpers', () => {
    expect(extensionFromMime('audio/mpeg; charset=utf-8')).toBe('mp3');
    expect(extensionFromMime('image/jpeg')).toBe('jpg');
    expect(inferFilenameExtension({ url: 'https://x.test/clip.webm', mime: 'application/octet-stream' })).toBe('webm');
    expect(ensureFilenameExtension('notes', { mime: 'text/plain' })).toBe('notes.txt');
    expect(ensureFilenameExtension('notes.txt', { mime: 'text/plain' })).toBe('notes.txt');
  });
});

describe('page URL detection', () => {
  it('rejects video and audio pages that only contain HTML', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=wHfaCXRVO8U',
      'https://youtu.be/wHfaCXRVO8U',
      'https://music.youtube.com/watch?v=abc',
      'https://vimeo.com/123456789',
      'https://www.tiktok.com/@user/video/7300000000000000000',
      'https://www.instagram.com/reel/abc123/',
      'https://x.com/user/status/123456789',
      'https://www.twitch.tv/somechannel',
    ]) {
      expect(pageDownloadHint(url), url).toBeTruthy();
    }
  });

  it('rejects page-shaped paths on ordinary hosts', () => {
    expect(pageDownloadHint('https://example.com/watch/42')).toBeTruthy();
    expect(pageDownloadHint('https://example.com/video/42')).toBeTruthy();
    expect(pageDownloadHint('https://example.com/live')).toBeTruthy();
  });

  it('allows direct files, stream manifests and media CDNs', () => {
    for (const url of [
      'https://cdn.example.com/files/movie.mp4',
      'https://example.com/files/report.pdf?token=abc',
      'https://example.com/live/stream.m3u8',
      'https://example.com/manifest.mpd',
      'https://example.com/download.php?id=42',
      'https://googlevideo.com/videoplayback?id=abc',
      'https://example.com/watch/clip.mp4',
    ]) {
      expect(pageDownloadHint(url), url).toBeNull();
    }
  });

  it('reports whether a URL path looks like a real file', () => {
    expect(isDirectFileUrl('https://example.com/movie.mp4')).toBe(true);
    expect(isDirectFileUrl('https://example.com/download.php')).toBe(false);
    expect(isDirectFileUrl('https://example.com/watch')).toBe(false);
  });
});

describe('content disposition and duplicates', () => {
  it('parses plain and RFC 5987 filenames', () => {
    expect(parseContentDisposition('attachment; filename="report final.pdf"')).toBe('report final.pdf');
    expect(parseContentDisposition("attachment; filename*=UTF-8''caf%C3%A9.pdf")).toBe('café.pdf');
    expect(parseContentDisposition(null)).toBeUndefined();
  });

  it('uniquifies names case-insensitively', () => {
    const existing = new Set(['report.pdf', 'report (2).pdf']);
    expect(makeUniqueFilename('report.pdf', existing)).toBe('report (3).pdf');
    expect(makeUniqueFilename('other.pdf', existing)).toBe('other.pdf');
  });

  it('creates stable local day keys', () => {
    expect(localDayKey(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05');
  });
});
