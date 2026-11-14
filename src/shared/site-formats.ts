import type { SiteFormat, SiteRawFormat } from './types';
import { formatBytes } from './utilities';

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mkv', 'mov', 'flv', '3gp', 'avi']);
const AUDIO_EXTENSIONS = new Set(['m4a', 'webm', 'mp3', 'opus', 'ogg', 'aac', 'wav', 'flac']);

function present(value: string | undefined): boolean {
  return Boolean(value && value !== 'none');
}

function hasVideo(format: SiteRawFormat): boolean {
  return present(format.vcodec) && format.video_ext !== 'none';
}

function hasAudio(format: SiteRawFormat): boolean {
  return present(format.acodec) && format.audio_ext !== 'none';
}

function isStoryboard(format: SiteRawFormat): boolean {
  return format.ext === 'mhtml' || /storyboard/i.test(format.format_note ?? '');
}

function extensionFor(format: SiteRawFormat, kind: SiteFormat['kind']): string {
  const ext = (format.ext || (kind === 'audio' ? format.audio_ext : format.video_ext) || '').toLowerCase();
  if (kind === 'audio' && AUDIO_EXTENSIONS.has(ext)) return ext;
  if (kind !== 'audio' && VIDEO_EXTENSIONS.has(ext)) return ext;
  return kind === 'audio' ? 'm4a' : 'mp4';
}

function codecLabel(codec: string | undefined): string | undefined {
  if (!present(codec)) return undefined;
  const value = (codec ?? '').toLowerCase();
  const family = value.split('.')[0];
  if (family.startsWith('avc') || family === 'h264') return 'H.264';
  if (family.startsWith('hev') || family === 'h265') return 'HEVC';
  if (family.startsWith('vp9') || family === 'vp9') return 'VP9';
  if (family.startsWith('vp8')) return 'VP8';
  if (family.startsWith('av01')) return 'AV1';
  if (family.includes('opus')) return 'Opus';
  if (family.includes('mp4a') || family.includes('aac')) return 'AAC';
  return (codec ?? '').split('.')[0].toUpperCase();
}

function resolutionLabel(format: SiteRawFormat): string | undefined {
  if (format.height && format.height > 0) {
    const fps = format.fps && format.fps >= 48 ? ` ${Math.round(format.fps)}fps` : '';
    return `${format.height}p${fps}`;
  }
  if (format.resolution && format.resolution !== 'audio only') return format.resolution;
  return undefined;
}

function sizeLabel(bytes: number | undefined): string | undefined {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return undefined;
  return formatBytes(bytes);
}

function bitrateLabel(kbps: number | undefined): string | undefined {
  if (!kbps || !Number.isFinite(kbps) || kbps <= 0) return undefined;
  return `${Math.round(kbps)} kbps`;
}

function dedupe(formats: SiteFormat[]): SiteFormat[] {
  const seen = new Map<string, SiteFormat>();
  for (const format of formats) {
    const key =
      format.kind === 'audio'
        ? `audio|${format.ext}|${format.bitrateKbps ?? 0}`
        : `${format.kind}|${format.ext}|${format.height ?? 0}|${Math.round(format.fps ?? 0)}`;
    const existing = seen.get(key);
    if (!existing || (format.bitrateKbps ?? 0) > (existing.bitrateKbps ?? 0)) {
      seen.set(key, format);
    }
  }
  return [...seen.values()];
}

/**
 * Turns raw yt-dlp format metadata into the ordered, human-readable choices
 * shown in the download dialog. Video choices are best-first; audio choices
 * follow. Video-only streams are only downloadable when FFmpeg is available
 * to merge them with an audio track.
 */
export function normalizeSiteFormats(
  raw: SiteRawFormat[] | undefined,
  options: { ffmpeg: boolean; isLive?: boolean },
): SiteFormat[] {
  if (!Array.isArray(raw)) return [];
  const results: SiteFormat[] = [];

  for (const format of raw) {
    if (!format || !format.format_id) continue;
    if (isStoryboard(format)) continue;
    if (format.has_drm) continue;

    const video = hasVideo(format);
    const audio = hasAudio(format);
    if (!video && !audio) continue;

    const kind: SiteFormat['kind'] = video && audio ? 'video+audio' : video ? 'video' : 'audio';
    const ext = extensionFor(format, kind);
    const resolution = resolutionLabel(format);
    const fps = format.fps && format.fps > 0 ? Math.round(format.fps) : undefined;
    const bitrate = kind === 'audio' ? (format.abr ?? format.tbr) : (format.tbr ?? format.vbr);
    const bytes = format.filesize ?? format.filesize_approx;
    const codec = codecLabel(kind === 'audio' ? format.acodec : format.vcodec);
    const needsMerge = kind === 'video';
    const downloadable = !options.isLive && (!needsMerge || options.ffmpeg);

    const parts: string[] = [];
    if (kind === 'audio') {
      parts.push('Audio');
      parts.push(ext.toUpperCase());
      const rate = bitrateLabel(bitrate);
      if (rate) parts.push(rate);
      if (codec && codec !== 'AAC' && codec !== 'OPUS') parts.push(codec);
    } else {
      parts.push(resolution ?? 'Video');
      parts.push(ext.toUpperCase());
      if (codec) parts.push(codec);
      if (kind === 'video') parts.push('video only');
      const size = sizeLabel(bytes);
      if (size) parts.push(size);
    }

    let note: string | undefined;
    if (needsMerge) {
      note = options.ffmpeg
        ? 'Downloads this video stream and merges it with the best audio track using FFmpeg.'
        : 'Needs FFmpeg to merge this video-only stream with an audio track. Install FFmpeg to enable it.';
    } else if (options.isLive) {
      note = 'Live streams are not supported by this helper yet.';
    } else if (format.format_note && !/^(default|storyboard)$/i.test(format.format_note)) {
      note = format.format_note;
    }

    const shortLabel =
      kind === 'audio'
        ? `Audio ${ext.toUpperCase()}${bitrateLabel(bitrate) ? ` ${Math.round(bitrate ?? 0)}k` : ''}`
        : `${resolution ?? 'Video'} ${ext.toUpperCase()}`;

    results.push({
      id: needsMerge ? `${format.format_id}+bestaudio/best` : format.format_id,
      sourceFormatId: format.format_id,
      label: parts.filter(Boolean).join(' · '),
      shortLabel,
      kind,
      ext,
      width: format.width,
      height: format.height,
      fps,
      bitrateKbps: bitrate ? Math.round(bitrate) : undefined,
      filesize: bytes,
      needsMerge,
      downloadable,
      note,
    });
  }

  const video = dedupe(results.filter((format) => format.kind !== 'audio')).sort(
    (a, b) =>
      (b.height ?? 0) - (a.height ?? 0) ||
      (b.fps ?? 0) - (a.fps ?? 0) ||
      (a.kind === 'video+audio' ? 0 : 1) - (b.kind === 'video+audio' ? 0 : 1) ||
      (b.bitrateKbps ?? 0) - (a.bitrateKbps ?? 0),
  );
  const audio = dedupe(results.filter((format) => format.kind === 'audio')).sort(
    (a, b) => (b.bitrateKbps ?? 0) - (a.bitrateKbps ?? 0) || a.ext.localeCompare(b.ext),
  );

  const ordered = [...video, ...audio].slice(0, 80);
  const best = ordered.find((format) => format.kind !== 'audio' && format.downloadable);
  if (best) best.best = true;
  return ordered;
}

export function defaultSiteFormat(formats: SiteFormat[]): SiteFormat | undefined {
  return formats.find((format) => format.best) ?? formats.find((format) => format.downloadable) ?? formats[0];
}

export function siteFormatSummary(format: SiteFormat | undefined): string {
  if (!format) return 'Automatic quality';
  return format.shortLabel;
}
