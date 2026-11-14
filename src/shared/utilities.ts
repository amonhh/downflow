import {
  CATEGORY_FOLDERS,
  DOWNLOAD_EXTENSIONS,
  EXTENSION_CATEGORIES,
  MAX_FILENAME_LENGTH,
  MEDIA_EXTENSIONS,
  MIME_CATEGORIES,
  STREAM_EXTENSIONS,
} from './constants';
import type { AppSettings, DownloadRecord, DownloadStatus, FileCategory, MediaResourceKind } from './types';

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const INVALID_FILENAME = /[<>:"/\\|?*\u0000-\u001f]/g;

export function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function truncateFilename(name: string, maxLength = MAX_FILENAME_LENGTH): string {
  if (name.length <= maxLength) return name;
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : '';
  const stemLength = Math.max(1, maxLength - extension.length);
  return `${name.slice(0, stemLength).trimEnd()}${extension}`;
}

export function sanitizeFilename(input: string): string {
  let value = (input || 'download').normalize('NFKC');
  value = value.split(/[\\/]/).pop() || 'download';
  value = value.replace(INVALID_FILENAME, '_');
  value = value.replace(/[\u200e\u200f\u202a-\u202e]/g, '');
  value = value.replace(/\s+/g, ' ').replace(/^\.+/, '').replace(/[. ]+$/g, '').trim();
  if (!value || value === '.' || value === '..') value = 'download';
  const dot = value.lastIndexOf('.');
  const stem = dot > 0 ? value.slice(0, dot) : value;
  if (WINDOWS_RESERVED.test(stem)) value = `_${value}`;
  return truncateFilename(value);
}

export function sanitizeFolder(input: string): string {
  return (input || 'DownFlow')
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter((part) => part && part !== '.' && part !== '..')
    .map((part) => sanitizeFilename(part))
    .filter(Boolean)
    .slice(0, 5)
    .join('/');
}

export function buildDownloadPath(filename: string, category: FileCategory, settings: AppSettings): string {
  const safeName = sanitizeFilename(filename);
  if (!settings.categorizeFolders) return safeName;
  const root = sanitizeFolder(settings.defaultFolder || 'DownFlow');
  const folder = sanitizeFolder(settings.categoryFolders?.[category] || CATEGORY_FOLDERS[category]);
  return [root, folder, safeName].filter(Boolean).join('/');
}

export function getExtension(filename: string): string {
  const clean = filename.split(/[?#]/)[0] ?? '';
  const dot = clean.lastIndexOf('.');
  if (dot <= 0 || dot === clean.length - 1) return '';
  return clean.slice(dot + 1).toLowerCase().slice(0, 16);
}

export function getExtensionFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    return getExtension(decodeURIComponent(pathname.split('/').pop() || ''));
  } catch {
    return getExtension(url);
  }
}

export function mimeToCategory(mime: string): FileCategory | null {
  for (const [pattern, category] of MIME_CATEGORIES) {
    if (pattern.test(mime)) return category;
  }
  return null;
}

export function getFileCategory(filename: string, mime = ''): FileCategory {
  const extension = getExtension(filename);
  if (extension && EXTENSION_CATEGORIES[extension]) return EXTENSION_CATEGORIES[extension];
  const mimeCategory = mimeToCategory(mime);
  if (mimeCategory) return mimeCategory;
  return 'other';
}

export function isDownloadableFilename(filename: string): boolean {
  return DOWNLOAD_EXTENSIONS.includes(getExtension(filename));
}

export function isDirectDownloadUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return isDownloadableFilename(parsed.pathname.split('/').pop() || '');
  } catch {
    return false;
  }
}

export function isStreamUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return path.endsWith('.m3u8') || path.endsWith('.mpd');
  } catch {
    return false;
  }
}

export function filenameFromUrl(url: string, fallback = 'download'): string {
  try {
    const parsed = new URL(url);
    const last = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
    if (last && last.includes('.')) return sanitizeFilename(last);
    if (last) return sanitizeFilename(last);
    return sanitizeFilename(`${parsed.hostname.replace(/^www\./, '')}-${fallback}`);
  } catch {
    return sanitizeFilename(fallback);
  }
}

export function parseContentDisposition(header: string | null): string | undefined {
  if (!header) return undefined;
  const encoded = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (encoded?.[1]) {
    try {
      return sanitizeFilename(decodeURIComponent(encoded[1].trim().replace(/^"|"$/g, '')));
    } catch {
      // Fall through to the plain form.
    }
  }
  const plain = /filename=(?:"((?:\\.|[^"])*)"|([^;]+))/i.exec(header);
  const value = plain?.[1] ?? plain?.[2];
  if (!value) return undefined;
  return sanitizeFilename(value.trim().replace(/^"|"$/g, '').replace(/\\(.)/g, '$1'));
}

const SITE_TITLE_SUFFIXES = [
  /\s*[|•]\s*(?:YouTube|Vimeo|Dailymotion|Facebook|Instagram|TikTok|Twitter|X|SoundCloud|Twitch|Reddit|Netflix|Prime Video|Hulu|Disney\+|Spotify|Bilibili|Vevo)\s*$/i,
  /\s*[-–—:]\s*(?:YouTube|Vimeo|Dailymotion|Facebook|Instagram|TikTok|Twitter|X|SoundCloud|Twitch|Reddit|Netflix|Prime Video|Hulu|Disney\+|Spotify|Bilibili|Vevo)\s*$/i,
];

const GENERIC_FILENAME_STEMS = new Set([
  'download',
  'file',
  '__down',
  'videoplayback',
  'playback',
  'index',
  'get',
  'media',
  'stream',
  'watch',
  'video',
  'audio',
  'default',
  'output',
  'blob',
  'unknown',
  'unnamed',
  'content',
  'play',
  'redirect',
]);

const DYNAMIC_EXTENSIONS = new Set([
  'php',
  'php5',
  'asp',
  'aspx',
  'jsp',
  'jspx',
  'cgi',
  'pl',
  'do',
  'action',
  'cfm',
  'shtml',
]);

const MIME_EXTENSION_RULES: Array<[RegExp, string]> = [
  [/^video\/mp4/i, 'mp4'],
  [/^video\/webm/i, 'webm'],
  [/^video\/quicktime/i, 'mov'],
  [/^video\/x-matroska/i, 'mkv'],
  [/^video\/mp2t/i, 'ts'],
  [/^video\/x-m4v/i, 'm4v'],
  [/^video\/ogg/i, 'ogv'],
  [/^audio\/mpeg/i, 'mp3'],
  [/^audio\/mp4/i, 'm4a'],
  [/^audio\/x-m4a/i, 'm4a'],
  [/^audio\/(?:x-)?wav/i, 'wav'],
  [/^audio\/aac/i, 'aac'],
  [/^audio\/ogg/i, 'ogg'],
  [/^audio\/opus/i, 'opus'],
  [/^audio\/(?:x-)?flac/i, 'flac'],
  [/^application\/(?:vnd\.apple\.mpegurl|x-mpegurl)/i, 'ts'],
  [/^application\/dash\+xml/i, 'mp4'],
  [/^application\/pdf/i, 'pdf'],
  [/^application\/zip/i, 'zip'],
  [/^application\/(?:x-rar-compressed|vnd\.rar)/i, 'rar'],
  [/^application\/x-7z-compressed/i, '7z'],
  [/^application\/(?:gzip|x-gzip)/i, 'gz'],
  [/^application\/x-tar/i, 'tar'],
  [/^image\/jpeg/i, 'jpg'],
  [/^image\/png/i, 'png'],
  [/^image\/gif/i, 'gif'],
  [/^image\/webp/i, 'webp'],
  [/^image\/svg\+xml/i, 'svg'],
  [/^text\/csv/i, 'csv'],
  [/^text\/plain/i, 'txt'],
  [/^text\/html/i, 'html'],
  [/^application\/vnd\.android\.package-archive/i, 'apk'],
  [/^application\/(?:x-msdownload|x-ms-installer|vnd\.microsoft\.portable-executable)/i, 'exe'],
  [/^application\/x-msi/i, 'msi'],
  [/^application\/x-apple-diskimage/i, 'dmg'],
];

function basenameFromUrl(url: string): string {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '');
    return last ? sanitizeFilename(last) : '';
  } catch {
    return '';
  }
}

function stemOf(filename: string): string {
  const extension = getExtension(filename);
  const stem = extension ? filename.slice(0, filename.length - extension.length - 1) : filename;
  return stem.trim().toLowerCase();
}

function withExtension(filename: string, extension: string): string {
  const current = getExtension(filename);
  const stem = current ? filename.slice(0, filename.length - current.length - 1) : filename;
  return sanitizeFilename(`${stem.trim() || 'download'}.${extension}`);
}

export function cleanTitleForFilename(title?: string): string {
  if (!title) return '';
  let value = title
    .normalize('NFKC')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  let previous = '';
  while (value && value !== previous) {
    previous = value;
    for (const pattern of SITE_TITLE_SUFFIXES) value = value.replace(pattern, '').trim();
  }
  return value ? sanitizeFilename(value) : '';
}

export function extensionFromMime(mime: string): string | undefined {
  const clean = (mime || '').split(';')[0]?.trim() ?? '';
  for (const [pattern, extension] of MIME_EXTENSION_RULES) {
    if (pattern.test(clean)) return extension;
  }
  return undefined;
}

export function inferFilenameExtension(options: {
  url?: string;
  mime?: string;
  mediaKind?: MediaResourceKind;
}): string | undefined {
  const mime = options.mime ?? '';
  const urlExtension = options.url ? getExtensionFromUrl(options.url) : '';
  if (urlExtension && !DYNAMIC_EXTENSIONS.has(urlExtension) && !STREAM_EXTENSIONS.includes(urlExtension)) {
    return urlExtension;
  }
  const mimeExtension = extensionFromMime(mime);
  if (mimeExtension) return mimeExtension;
  switch (options.mediaKind) {
    case 'video':
      return 'mp4';
    case 'audio':
      return 'm4a';
    case 'hls':
      return 'ts';
    case 'dash':
      return 'mp4';
    default:
      break;
  }
  if (urlExtension && !DYNAMIC_EXTENSIONS.has(urlExtension)) return urlExtension;
  if (/^application\/octet-stream/i.test(mime)) return 'bin';
  return undefined;
}

export function ensureFilenameExtension(
  filename: string,
  options: { url?: string; mime?: string; mediaKind?: MediaResourceKind },
): string {
  const safe = sanitizeFilename(filename);
  const current = getExtension(safe);
  const inferred = inferFilenameExtension(options);
  const urlExtension = options.url ? getExtensionFromUrl(options.url) : '';
  const mediaLike =
    isMediaMime(options.mime ?? '') ||
    options.mediaKind === 'video' ||
    options.mediaKind === 'audio' ||
    options.mediaKind === 'hls' ||
    options.mediaKind === 'dash' ||
    MEDIA_EXTENSIONS.includes(urlExtension);

  if (!current) {
    return inferred ? sanitizeFilename(`${safe}.${inferred}`) : safe;
  }
  if (DYNAMIC_EXTENSIONS.has(current)) {
    return withExtension(safe, inferred ?? 'bin');
  }
  if (options.mediaKind !== 'hls' && options.mediaKind !== 'dash' && mediaLike && !MEDIA_EXTENSIONS.includes(current)) {
    return inferred ? withExtension(safe, inferred) : safe;
  }
  if (current === 'exe' && inferred && inferred !== 'exe' && inferred !== 'bin') {
    return withExtension(safe, inferred);
  }
  return safe;
}

export interface ResolveFilenameOptions {
  url: string;
  requested?: string;
  title?: string;
  contentDisposition?: string | null;
  mime?: string;
  mediaKind?: MediaResourceKind;
  fallback?: string;
}

export function resolveDownloadFilename(options: ResolveFilenameOptions): string {
  const { url, requested, title, contentDisposition, mime = '', mediaKind, fallback = 'download' } = options;
  const explicit = requested?.trim() ? cleanTitleForFilename(requested) : '';
  if (explicit) return ensureFilenameExtension(explicit, { url, mime, mediaKind });

  const candidates = [
    parseContentDisposition(contentDisposition ?? null),
    cleanTitleForFilename(title),
    basenameFromUrl(url),
  ].filter((candidate): candidate is string => Boolean(candidate));

  const meaningful = candidates.find((candidate) => !GENERIC_FILENAME_STEMS.has(stemOf(candidate)));
  const base = meaningful ?? candidates[0] ?? sanitizeFilename(fallback);
  return ensureFilenameExtension(base, { url, mime, mediaKind });
}

export function validateDownloadUrl(input: string): { valid: boolean; url?: string; reason?: string } {
  const trimmed = (input || '').trim();
  if (!trimmed) return { valid: false, reason: 'Enter a download URL.' };
  if (trimmed.length > 16_384) return { valid: false, reason: 'The URL is too long.' };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, reason: 'This is not a valid URL. Include http:// or https://.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, reason: 'Only HTTP and HTTPS downloads are supported.' };
  }
  if (parsed.username || parsed.password) {
    return { valid: false, reason: 'URLs containing embedded credentials are blocked for safety.' };
  }
  if (!parsed.hostname || parsed.hostname.includes('..')) {
    return { valid: false, reason: 'The URL has an invalid hostname.' };
  }
  return { valid: true, url: parsed.href };
}

const MEDIA_PAGE_HOSTS = [
  'youtube.com',
  'youtube-nocookie.com',
  'youtu.be',
  'vimeo.com',
  'dailymotion.com',
  'dai.ly',
  'tiktok.com',
  'instagram.com',
  'facebook.com',
  'fb.watch',
  'fb.com',
  'twitter.com',
  'x.com',
  'twitch.tv',
  'netflix.com',
  'hulu.com',
  'primevideo.com',
  'disneyplus.com',
  'soundcloud.com',
  'spotify.com',
  'reddit.com',
  'rumble.com',
  'odysee.com',
  'bitchute.com',
  'bilibili.com',
  'kick.com',
  'streamable.com',
];

const PAGE_PATH_PATTERN = /^\/(?:watch|shorts|embed|reel|reels|status|clip|clips|live|video|videos|player)(?:\/|$)/i;

/** True when the URL path ends in an extension that denotes a real file. */
export function isDirectFileUrl(url: string): boolean {
  const extension = getExtensionFromUrl(url);
  return Boolean(extension) && !DYNAMIC_EXTENSIONS.has(extension);
}

/** True when the URL is a page that hosts playable video rather than a file. */
export function isVideoPageUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (isDirectFileUrl(parsed.href)) return false;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  return (
    MEDIA_PAGE_HOSTS.some((pageHost) => host === pageHost || host.endsWith(`.${pageHost}`)) ||
    PAGE_PATH_PATTERN.test(parsed.pathname)
  );
}

/**
 * Detects URLs that point at a web page rather than a file. Downloading one of
 * these only saves the HTML page (for example a YouTube `watch` page), which is
 * never what the user wanted. Returns a user-facing reason, or null when the URL
 * may be a direct download.
 */
export function pageDownloadHint(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (isDirectFileUrl(parsed.href)) return null;

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (MEDIA_PAGE_HOSTS.some((pageHost) => host === pageHost || host.endsWith(`.${pageHost}`))) {
    return 'This is a video/audio web page, not a file. DownFlow cannot download the page itself. Open the page and use the Video & Audio tab to detect the real media file, or paste a direct media URL.';
  }
  if (PAGE_PATH_PATTERN.test(parsed.pathname)) {
    return 'This link points to a web page, not a file. Paste a direct file URL, or open the page and use the Video & Audio tab to detect the media.';
  }
  return null;
}


export function sourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  const precision = index === 0 ? 0 : decimals;
  return `${value.toFixed(precision).replace(/\.0$/, '')} ${units[index]}`;
}

export function formatSpeed(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return '0 B/s';
  return `${formatBytes(bps, bps >= 1024 * 1024 ? 2 : 1)}/s`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const value = Math.round(seconds);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = value % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

export function formatEta(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 1) return '< 1s';
  return formatDuration(seconds);
}

export function formatTime(timestamp?: number): string {
  if (!timestamp) return '—';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(timestamp);
}

export function formatDate(timestamp?: number): string {
  if (!timestamp) return '—';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(timestamp);
}

export function formatDateTime(timestamp?: number): string {
  if (!timestamp) return '—';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp);
}

export function timeAgo(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  if (seconds < 604_800) return `${Math.round(seconds / 86_400)}d ago`;
  return formatDate(timestamp);
}

export function progressPercent(record: Pick<DownloadRecord, 'downloadedBytes' | 'totalBytes' | 'status'>): number {
  if (record.status === 'completed') return 100;
  if (!record.totalBytes || record.totalBytes <= 0) return 0;
  return clamp((record.downloadedBytes / record.totalBytes) * 100, 0, 100);
}

export function estimateEta(remainingBytes: number, speedBps: number): number | null {
  if (!speedBps || speedBps <= 0 || remainingBytes < 0) return null;
  return Math.ceil(remainingBytes / speedBps);
}

export function calculateSpeed(previousBytes: number, currentBytes: number, elapsedMs: number): number {
  if (elapsedMs <= 0 || currentBytes < previousBytes) return 0;
  return Math.max(0, ((currentBytes - previousBytes) * 1000) / elapsedMs);
}

export function activeStatus(status: DownloadStatus): boolean {
  return status === 'downloading' || status === 'probing' || status === 'delivering';
}

export function durableStatus(status: DownloadStatus): status is 'queued' | 'paused' | 'failed' | 'completed' | 'cancelled' {
  return ['queued', 'paused', 'failed', 'completed', 'cancelled'].includes(status);
}

export function statusGroup(
  record: DownloadRecord,
): 'downloading' | 'queued' | 'completed' | 'paused' | 'failed' | 'all' {
  if (record.status === 'downloading' || record.status === 'probing' || record.status === 'delivering') return 'downloading';
  if (record.status === 'queued') return 'queued';
  if (record.status === 'completed') return 'completed';
  if (record.status === 'failed' || record.status === 'cancelled') return 'failed';
  return 'paused';
}

export function inferMediaKind(url: string, mime = ''): MediaResourceKind {
  const lowerUrl = url.toLowerCase();
  const lowerMime = mime.toLowerCase();
  if (lowerUrl.includes('.m3u8') || lowerMime.includes('mpegurl')) return 'hls';
  if (lowerUrl.includes('.mpd') || lowerMime.includes('dash+xml')) return 'dash';
  if (lowerMime.startsWith('audio/')) return 'audio';
  if (lowerMime.startsWith('video/')) return 'video';
  const extension = getExtensionFromUrl(url);
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'flac'].includes(extension)) return 'audio';
  if (['mp4', 'webm', 'mov', 'mkv', 'm4v', 'ts'].includes(extension)) return 'video';
  return 'unknown';
}

export function isMediaMime(mime: string): boolean {
  return /^(video|audio)\//i.test(mime) || /mpegurl|dash\+xml/i.test(mime);
}

export function cleanErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'An unexpected error occurred.';
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export function throttle<Args extends unknown[]>(fn: (...args: Args) => void, interval: number): (...args: Args) => void {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Args | undefined;
  return (...args: Args) => {
    const now = Date.now();
    const remaining = interval - (now - last);
    pending = args;
    if (remaining <= 0) {
      last = now;
      fn(...pending);
      pending = undefined;
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = undefined;
        if (pending) {
          last = Date.now();
          fn(...pending);
          pending = undefined;
        }
      }, remaining);
    }
  };
}

export function makeUniqueFilename(filename: string, existing: Set<string>): string {
  if (!existing.has(filename.toLowerCase())) return filename;
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const extension = dot > 0 ? filename.slice(dot) : '';
  let counter = 2;
  let candidate = `${stem} (${counter})${extension}`;
  while (existing.has(candidate.toLowerCase())) {
    counter += 1;
    candidate = `${stem} (${counter})${extension}`;
  }
  return candidate;
}

export function localDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function isRecordTerminal(record: DownloadRecord): boolean {
  return record.status === 'completed' || record.status === 'failed' || record.status === 'cancelled';
}
