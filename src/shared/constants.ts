import type { AppSettings, FileCategory } from './types';

export const EXTENSION_CATEGORIES: Record<string, FileCategory> = {
  pdf: 'documents',
  doc: 'documents',
  docx: 'documents',
  xls: 'documents',
  xlsx: 'documents',
  ppt: 'documents',
  pptx: 'documents',
  txt: 'documents',
  rtf: 'documents',
  csv: 'documents',
  epub: 'documents',
  mp4: 'videos',
  webm: 'videos',
  mov: 'videos',
  mkv: 'videos',
  avi: 'videos',
  m4v: 'videos',
  ts: 'videos',
  mpg: 'videos',
  mpeg: 'videos',
  mp3: 'audio',
  wav: 'audio',
  aac: 'audio',
  m4a: 'audio',
  ogg: 'audio',
  opus: 'audio',
  flac: 'audio',
  zip: 'archives',
  rar: 'archives',
  '7z': 'archives',
  tar: 'archives',
  gz: 'archives',
  bz2: 'archives',
  xz: 'archives',
  jpg: 'images',
  jpeg: 'images',
  png: 'images',
  gif: 'images',
  webp: 'images',
  svg: 'images',
  bmp: 'images',
  ico: 'images',
  avif: 'images',
  exe: 'software',
  msi: 'software',
  apk: 'software',
  dmg: 'software',
  iso: 'software',
  deb: 'software',
  rpm: 'software',
  appimage: 'software',
  jar: 'software',
};

export const DOWNLOAD_EXTENSIONS = Object.keys(EXTENSION_CATEGORIES);
export const MEDIA_EXTENSIONS = ['mp4', 'webm', 'mov', 'mkv', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'm4v', 'ts'];
export const STREAM_EXTENSIONS = ['m3u8', 'mpd'];

export const MIME_CATEGORIES: Array<[RegExp, FileCategory]> = [
  [/^application\/(pdf|msword|vnd\.openxmlformats|vnd\.ms-excel|vnd\.ms-powerpoint|rtf)/i, 'documents'],
  [/^text\/(plain|csv|rtf)/i, 'documents'],
  [/^video\//i, 'videos'],
  [/^audio\//i, 'audio'],
  [/^image\//i, 'images'],
  [/^application\/(zip|x-rar|vnd\.rar|x-7z|x-tar|gzip|x-gzip|x-bzip2|x-xz)/i, 'archives'],
  [/^application\/(vnd\.android\.package-archive|x-msdownload|x-msi|x-apple-diskimage|x-iso9660|x-debian-package)/i, 'software'],
];

export const MEDIA_MIME_PATTERNS = [
  /^video\//i,
  /^audio\//i,
  /^application\/(vnd\.apple\.mpegurl|x-mpegurl|dash\+xml|ogg|octet-stream)/i,
];

export const CATEGORY_LABELS: Record<FileCategory, string> = {
  documents: 'Documents',
  videos: 'Videos',
  audio: 'Audio',
  images: 'Images',
  archives: 'Archives',
  software: 'Software',
  other: 'Other',
};

export const CATEGORY_FOLDERS: Record<FileCategory, string> = {
  documents: 'Documents',
  videos: 'Videos',
  audio: 'Audio',
  images: 'Images',
  archives: 'Archives',
  software: 'Software',
  other: 'Other',
};

export const STATUS_LABELS = {
  queued: 'Queued',
  probing: 'Checking server',
  downloading: 'Downloading',
  paused: 'Paused',
  delivering: 'Saving file',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
} as const;

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  language: 'en',
  defaultFolder: 'DownFlow',
  categoryFolders: { ...CATEGORY_FOLDERS },
  autoCategorize: true,
  categorizeFolders: true,
  notifications: true,
  confirmBeforeDownload: false,
  maxConcurrent: 3,
  segmentedEnabled: true,
  segmentCount: 4,
  maxConnections: 8,
  autoRetry: true,
  maxRetries: 3,
  autoStartQueue: true,
  detectionEnabled: true,
  interceptClicks: true,
  mediaDetection: true,
  hlsDetection: true,
  dashDetection: true,
  mediaNotifications: false,
  bandwidthLimitBps: 0,
  perDownloadLimitBps: 0,
  memoryLimitMb: 512,
  keepHistory: true,
  saveAsOnStart: false,
  duplicatePolicy: 'uniquify',
};

export const DEFAULT_QUEUE_STATE = {
  paused: false,
  updatedAt: 0,
};

export const MAX_SEGMENT_COUNT = 16;
export const MIN_SEGMENT_SIZE = 2 * 1024 * 1024;
export const POLL_INTERVAL_MS = 1000;
export const PROGRESS_FLUSH_MS = 400;
export const MAX_FILENAME_LENGTH = 180;
export const CHUNK_SIZE = 512 * 1024;

export const LIMITATIONS = [
  'Chrome controls the final file write. DownFlow can save files through the Downloads API, but cannot bypass Chrome prompts or protected system folders.',
  'Bandwidth limiting is enforced for DownFlow’s segmented and media transfers. Chrome’s native Downloads API does not expose throttling for ordinary downloads.',
  'Automatic interception cannot replace every website download handler. Direct HTTP(S) links and Downloads API events are covered; other sites may require the context menu or manual add.',
  'HLS downloads are available for unencrypted, accessible VOD playlists. DRM-protected streams are detected and never bypassed. DownFlow concatenates HLS media segments into a .ts file and does not remux every stream.',
  'DASH support covers accessible non-DRM representations using SegmentTemplate/SegmentList metadata. It does not merge separate audio and video tracks.',
  'Downloads run only while Chrome is running. Scheduled jobs cannot run after Chrome is fully closed.',
  'Segmented downloads require HTTP Range support, a trustworthy Content-Length, and stable ETag/Last-Modified metadata. Other servers automatically use the standard engine.',
  'Video-site downloads such as YouTube require the optional DownFlow native helper plus yt-dlp. Without them DownFlow reports the page as unsupported instead of downloading the HTML page.',
  'The native helper saves videos to its own folder (Downloads\\DownFlow by default), outside Chrome’s download manager. FFmpeg is required to merge separate video-only and audio streams; combined formats work without it, and the installer can fetch FFmpeg with --download-ffmpeg.',
  'The helper does not bypass DRM, paywalls, logins or region locks, and live streams are not supported by the current helper. Pages that require an account may fail even with yt-dlp installed.',
];
