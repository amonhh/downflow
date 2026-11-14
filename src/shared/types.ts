export type DownloadStatus =
  | 'queued'
  | 'probing'
  | 'downloading'
  | 'paused'
  | 'delivering'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type DownloadKind = 'standard' | 'segmented' | 'hls' | 'dash' | 'site';

export type DownloadSource = 'dashboard' | 'popup' | 'detection' | 'context-menu' | 'chrome' | 'media' | 'scheduler';

export type FileCategory =
  | 'documents'
  | 'videos'
  | 'audio'
  | 'images'
  | 'archives'
  | 'software'
  | 'other';

export type SegmentStatus = 'pending' | 'downloading' | 'completed' | 'failed';

export interface SegmentMeta {
  index: number;
  start: number;
  end: number;
  downloaded: number;
  status: SegmentStatus;
  error?: string;
}

export interface DownloadRecord {
  id: string;
  url: string;
  finalUrl?: string;
  filename: string;
  mime: string;
  category: FileCategory;
  sourceDomain: string;
  pageUrl?: string;
  pageTitle?: string;
  status: DownloadStatus;
  kind: DownloadKind;
  source: DownloadSource;
  totalBytes: number;
  downloadedBytes: number;
  speedBps: number;
  etaSeconds: number | null;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  errorCode?: string;
  chromeDownloadId?: number;
  canResume: boolean;
  segments: SegmentMeta[];
  segmentCount: number;
  priority: number;
  queueOrder: number;
  attempts: number;
  maxAttempts: number;
  bandwidthLimitBps: number;
  etag?: string;
  lastModified?: string;
  deliveryFilename?: string;
  deliveryBlobUrl?: string;
  outputPath?: string;
  pageHost?: string;
  recovered?: boolean;
  fallbackReason?: string;
  customFilename?: boolean;
  saveAs?: boolean;
  mediaId?: string;
  representationId?: string;
  variantUri?: string;
  siteFormatId?: string;
  siteFormatLabel?: string;
  siteFormatExt?: string;
  siteMerge?: boolean;
  siteStage?: 'downloading' | 'merging' | 'finalizing';
  siteHelperInstalled?: boolean;
}

export interface QueueState {
  paused: boolean;
  updatedAt: number;
}

export interface StartDownloadInput {
  url: string;
  filename?: string;
  pageUrl?: string;
  pageTitle?: string;
  source?: DownloadSource;
  kind?: DownloadKind;
  priority?: number;
  addToQueue?: boolean;
  saveAs?: boolean;
  segments?: number;
  mime?: string;
  totalBytes?: number;
  bandwidthLimitBps?: number;
}

export interface AppSettings {
  theme: 'dark' | 'light' | 'system';
  language: 'en';
  defaultFolder: string;
  categoryFolders: Record<FileCategory, string>;
  autoCategorize: boolean;
  categorizeFolders: boolean;
  notifications: boolean;
  confirmBeforeDownload: boolean;
  maxConcurrent: number;
  segmentedEnabled: boolean;
  segmentCount: number;
  maxConnections: number;
  autoRetry: boolean;
  maxRetries: number;
  autoStartQueue: boolean;
  detectionEnabled: boolean;
  interceptClicks: boolean;
  mediaDetection: boolean;
  hlsDetection: boolean;
  dashDetection: boolean;
  mediaNotifications: boolean;
  bandwidthLimitBps: number;
  perDownloadLimitBps: number;
  memoryLimitMb: number;
  keepHistory: boolean;
  saveAsOnStart: boolean;
  duplicatePolicy: 'uniquify' | 'overwrite' | 'prompt';
}

export interface MediaVariant {
  uri: string;
  name?: string;
  bandwidth?: number;
  resolution?: string;
  codecs?: string;
}

export interface DashRepresentation {
  id: string;
  type: 'video' | 'audio' | 'text';
  mime: string;
  codecs?: string;
  bandwidth?: number;
  width?: number;
  height?: number;
  baseUrl: string;
  initUrl?: string;
  mediaTemplate?: string;
  segmentUrls?: string[];
  startNumber: number;
  timescale?: number;
  segmentDuration?: number;
  presentationDuration?: number;
  segmentCount?: number;
  audioSamplingRate?: string;
}

export type MediaResourceKind = 'video' | 'audio' | 'hls' | 'dash' | 'unknown';

export interface MediaResource {
  id: string;
  url: string;
  pageUrl?: string;
  pageTitle?: string;
  sourceDomain: string;
  kind: MediaResourceKind;
  mime: string;
  title: string;
  size: number;
  duration?: number;
  discoveredAt: number;
  updatedAt: number;
  protected: boolean;
  protectionSystem?: string;
  variants?: MediaVariant[];
  representations?: DashRepresentation[];
  manifestFetched?: boolean;
  contentLength?: number;
}

export interface Schedule {
  id: string;
  name: string;
  action: 'start-queue' | 'pause-all';
  mode: 'once' | 'daily';
  runAt?: number;
  time?: string;
  maxDownloads: number;
  enabled: boolean;
  createdAt: number;
  lastRunAt?: number;
  nextRunAt?: number;
}

export interface ScheduleInput {
  name: string;
  action: 'start-queue' | 'pause-all';
  mode: 'once' | 'daily';
  runAt?: number;
  time?: string;
  maxDownloads: number;
  enabled: boolean;
}

export interface StatsSummary {
  totalDownloads: number;
  activeDownloads: number;
  completedDownloads: number;
  failedDownloads: number;
  pausedDownloads: number;
  queuedDownloads: number;
  totalDownloadedBytes: number;
  speedBps: number;
  downloadsToday: number;
  downloadsThisWeek: number;
  downloadsThisMonth: number;
  averageSpeedBps: number;
  largestFile: { name: string; size: number } | null;
  mostCommonType: { category: FileCategory; count: number } | null;
  categoryCounts: Record<FileCategory, number>;
  last7Days: Array<{ day: string; count: number; bytes: number }>;
}

export interface DownloadsListResponse {
  downloads: DownloadRecord[];
  queuePaused: boolean;
  activeSpeedBps: number;
}

export interface StartDownloadResult {
  record: DownloadRecord;
  queued: boolean;
}

export interface ProbeResult {
  supported: boolean;
  status: number;
  totalBytes: number;
  acceptRanges: boolean;
  filename?: string;
  contentDispositionFilename?: string;
  mime?: string;
  etag?: string;
  lastModified?: string;
  finalUrl: string;
  reason?: string;
}

export interface DetectedResource {
  url: string;
  filename: string;
  mime?: string;
  size?: number;
  pageUrl: string;
  pageTitle?: string;
}

export interface DetectedMedia {
  url: string;
  kind: MediaResourceKind;
  mime?: string;
  title?: string;
  pageUrl: string;
  pageTitle?: string;
  size?: number;
  duration?: number;
}

export interface EngineProgress {
  downloadId: string;
  downloadedBytes: number;
  totalBytes: number;
  speedBps: number;
  etaSeconds: number | null;
  segments?: SegmentMeta[];
}

export interface EngineComplete {
  downloadId: string;
  blobUrl: string;
  totalBytes: number;
  filename: string;
  mime: string;
  finalUrl?: string;
}

export interface EngineError {
  downloadId: string;
  message: string;
  code?: string;
}

export interface EngineFallback {
  downloadId: string;
  reason: string;
}

export interface MediaDownloadInput {
  mediaId: string;
  representationId?: string;
  variantUri?: string;
}

export type SiteFormatKind = 'video+audio' | 'video' | 'audio';

/**
 * A yt-dlp format exactly as reported by the optional native helper. Values
 * may be missing because extractors differ between sites.
 */
export interface SiteRawFormat {
  format_id?: string;
  format_note?: string;
  ext?: string;
  protocol?: string;
  width?: number;
  height?: number;
  fps?: number;
  vcodec?: string;
  acodec?: string;
  resolution?: string;
  filesize?: number;
  filesize_approx?: number;
  tbr?: number;
  abr?: number;
  vbr?: number;
  audio_ext?: string;
  video_ext?: string;
  has_drm?: boolean;
  language?: string;
  url?: string;
}

export interface SiteRawProbe {
  id?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  duration?: number;
  thumbnail?: string;
  extractor_key?: string;
  extractor?: string;
  webpage_url?: string;
  _type?: string;
  is_live?: boolean;
  formats?: SiteRawFormat[];
}

export interface SiteToolStatus {
  available: boolean;
  version?: string;
  path?: string;
}

export interface SiteHelperStatus {
  /** True when the native host answered at all. */
  available: boolean;
  hostVersion?: string;
  ytDlp: SiteToolStatus;
  ffmpeg: SiteToolStatus;
  outputDir?: string;
  jobsDir?: string;
  platform?: string;
  error?: string;
}

export interface SiteFormat {
  /** Value passed to yt-dlp (`137+bestaudio/best` for merge options). */
  id: string;
  /** Raw yt-dlp format id when this choice needs a separate audio track. */
  sourceFormatId: string;
  label: string;
  shortLabel: string;
  kind: SiteFormatKind;
  ext: string;
  width?: number;
  height?: number;
  fps?: number;
  bitrateKbps?: number;
  filesize?: number;
  needsMerge: boolean;
  downloadable: boolean;
  best?: boolean;
  note?: string;
}

export interface SiteProbe {
  url: string;
  title: string;
  uploader?: string;
  durationSeconds?: number;
  thumbnail?: string;
  extractor?: string;
  isLive: boolean;
  formats: SiteFormat[];
  helper: SiteHelperStatus;
  warning?: string;
}

export type SiteJobStatus = 'queued' | 'downloading' | 'merging' | 'finalizing' | 'completed' | 'failed' | 'cancelled';

export interface SiteJobState {
  id: string;
  status: SiteJobStatus;
  title?: string;
  filename?: string;
  outputPath?: string;
  totalBytes?: number;
  downloadedBytes?: number;
  speedBps?: number;
  etaSeconds?: number | null;
  percent?: number;
  error?: string;
  pid?: number;
  startedAt?: number;
  completedAt?: number;
  updatedAt: number;
}

export interface SiteDownloadInput {
  url: string;
  formatId: string;
  formatLabel?: string;
  ext?: string;
  merge?: boolean;
  filename?: string;
  pageTitle?: string;
  source?: DownloadSource;
  priority?: number;
  addToQueue?: boolean;
  totalBytes?: number;
}

export type AppRequest =
  | { type: 'downloads:list' }
  | { type: 'downloads:get'; id: string }
  | { type: 'downloads:start'; payload: StartDownloadInput }
  | { type: 'downloads:pause'; id: string }
  | { type: 'downloads:resume'; id: string }
  | { type: 'downloads:cancel'; id: string }
  | { type: 'downloads:retry'; id: string }
  | { type: 'downloads:remove'; id: string; deleteRecordOnly?: boolean }
  | { type: 'downloads:pause-all' }
  | { type: 'downloads:resume-all' }
  | { type: 'downloads:open'; id: string }
  | { type: 'downloads:show'; id: string }
  | { type: 'downloads:set-priority'; id: string; priority: number }
  | { type: 'downloads:reorder'; ids: string[] }
  | { type: 'downloads:probe'; url: string }
  | { type: 'queue:pause' }
  | { type: 'queue:resume' }
  | { type: 'queue:start'; max?: number }
  | { type: 'queue:stop' }
  | { type: 'queue:reorder'; ids: string[] }
  | { type: 'settings:get' }
  | { type: 'settings:update'; patch: Partial<AppSettings> }
  | { type: 'stats:get' }
  | { type: 'media:list' }
  | { type: 'media:remove'; id: string }
  | { type: 'media:download'; payload: MediaDownloadInput }
  | { type: 'media:discovered'; payload: DetectedMedia }
  | { type: 'media:probe'; id: string }
  | { type: 'site:status'; force?: boolean }
  | { type: 'site:probe'; url: string }
  | { type: 'site:start'; payload: SiteDownloadInput }
  | { type: 'site:sync' }
  | { type: 'detect:resource'; payload: DetectedResource }
  | { type: 'schedules:list' }
  | { type: 'schedules:create'; payload: ScheduleInput }
  | { type: 'schedules:update'; id: string; payload: Partial<ScheduleInput> }
  | { type: 'schedules:delete'; id: string }
  | { type: 'schedules:run'; id: string }
  | { type: 'system:open-dashboard'; page?: string }
  | { type: 'system:clear-history' }
  | { type: 'system:clear-segments' }
  | { type: 'system:get-info' }
  | { type: 'engine:progress'; payload: EngineProgress }
  | { type: 'engine:complete'; payload: EngineComplete }
  | { type: 'engine:error'; payload: EngineError }
  | { type: 'engine:fallback'; payload: EngineFallback }
  | { type: 'engine:paused'; downloadId: string }
  | { type: 'engine:resumed'; downloadId: string };

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  error: string;
  code?: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface ExtensionInfo {
  version: string;
  downloads: number;
  segmentedActive: number;
  media: number;
  storageEstimate?: { usage: number; quota: number };
  limitations: string[];
}
