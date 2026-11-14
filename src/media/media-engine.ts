import type { DashRepresentation, MediaResource } from '../shared/types';
import { sanitizeFilename } from '../shared/utilities';
import type { RateLimiter } from '../engine/bandwidth-limiter';
import { RateLimiter as Limiter } from '../engine/bandwidth-limiter';
import { DownFlowEngineError, isAbortError, toEngineError } from '../engine/engine-errors';
import { withRetry } from '../engine/retry-manager';
import type { SegmentStorage } from '../storage/segment-storage';
import { parseDashManifest, selectDashRepresentations } from './dash-detector';
import { hlsFilenameFromTitle, parseHlsManifest, resolveMediaUrl, type HlsPlaylist, type HlsSegment } from './hls-detector';

export interface MediaProgress {
  downloadedBytes: number;
  totalBytes: number;
  speedBps: number;
  etaSeconds: number | null;
}

export interface MediaResult {
  blob: Blob;
  filename: string;
  mime: string;
  totalBytes: number;
}

export interface MediaEngineOptions {
  downloadId: string;
  media: MediaResource;
  representationId?: string;
  variantUri?: string;
  connections: number;
  bandwidthLimitBps: number;
  storage: SegmentStorage;
  globalLimiter?: RateLimiter;
  signal: AbortSignal;
  onProgress: (progress: MediaProgress) => void;
}

const MAX_MANIFEST_BYTES = 10 * 1024 * 1024;
const MEDIA_PARTS_BASE = 0;

function ensureHttpUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new DownFlowEngineError('Only HTTP(S) media segments are supported.', { code: 'UNSAFE_MEDIA_URL' });
  }
  return parsed.href;
}

async function fetchText(url: string, signal: AbortSignal): Promise<string> {
  ensureHttpUrl(url);
  const response = await fetch(url, { credentials: 'include', redirect: 'follow', cache: 'no-store', signal });
  if (response.status === 401 || response.status === 403) {
    throw new DownFlowEngineError('The media server requires authentication. Open the source site, sign in, and retry.', {
      code: 'AUTH_REQUIRED',
    });
  }
  if (!response.ok) {
    throw new DownFlowEngineError(`The media manifest returned HTTP ${response.status}.`, {
      code: `MANIFEST_HTTP_${response.status}`,
      retryable: response.status >= 500,
    });
  }
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > MAX_MANIFEST_BYTES) {
    throw new DownFlowEngineError('The media manifest is too large to process safely.', { code: 'MANIFEST_TOO_LARGE' });
  }
  return response.text();
}

class MediaProgressReporter {
  private samples: Array<{ time: number; bytes: number }> = [];
  private lastEmit = 0;
  private bytes = 0;
  private readonly onProgress: MediaEngineOptions['onProgress'];

  constructor(onProgress: MediaEngineOptions['onProgress']) {
    this.onProgress = onProgress;
  }

  addBytes(bytes: number): void {
    this.bytes += bytes;
  }

  emit(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastEmit < 500) return;
    this.lastEmit = now;
    this.samples.push({ time: now, bytes: this.bytes });
    while (this.samples.length > 2 && now - this.samples[0].time > 4000) this.samples.shift();
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const speed =
      this.samples.length > 1 ? Math.max(0, ((last.bytes - first.bytes) * 1000) / Math.max(1, last.time - first.time)) : 0;
    this.onProgress({ downloadedBytes: this.bytes, totalBytes: 0, speedBps: speed, etaSeconds: null });
  }
}

async function fetchPart(
  url: string,
  index: number,
  storage: SegmentStorage,
  downloadId: string,
  signal: AbortSignal,
  globalLimiter: RateLimiter | undefined,
  localLimiter: RateLimiter,
  reporter: MediaProgressReporter,
  byteRange?: { offset: number; length: number },
  attempts = 3,
): Promise<number> {
  return withRetry(
    async () => {
      await storage.resetSegment(downloadId, index);
      ensureHttpUrl(url);
      const headers: Record<string, string> = { Accept: '*/*' };
      if (byteRange) headers.Range = `bytes=${byteRange.offset}-${byteRange.offset + byteRange.length - 1}`;
      const response = await fetch(url, {
        headers,
        credentials: 'include',
        redirect: 'follow',
        cache: 'no-store',
        signal,
      });
      if (response.status === 401 || response.status === 403) {
        throw new DownFlowEngineError('The media segment requires authentication or is no longer available.', {
          code: 'AUTH_REQUIRED',
        });
      }
      if (response.status === 429) {
        throw new DownFlowEngineError('The media server is rate-limiting requests.', {
          code: 'RATE_LIMITED',
          retryable: true,
          retryAfterMs: 5000,
        });
      }
      if (byteRange && response.status !== 206) {
        throw new DownFlowEngineError('The media server ignored a byte-range request.', {
          code: 'RANGE_UNSUPPORTED',
          retryable: false,
        });
      }
      if (!response.ok) {
        throw new DownFlowEngineError(`Media segment returned HTTP ${response.status}.`, {
          code: `SEGMENT_HTTP_${response.status}`,
          retryable: response.status >= 500,
        });
      }
      if (!response.body) throw new DownFlowEngineError('The media segment was empty.', { code: 'EMPTY_SEGMENT', retryable: true });
      const reader = response.body.getReader();
      let written = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value?.byteLength) continue;
          await Promise.all([
            globalLimiter?.consume(value.byteLength, signal) ?? Promise.resolve(),
            localLimiter.consume(value.byteLength, signal),
          ]);
          await storage.append(downloadId, index, value);
          written += value.byteLength;
          reporter.addBytes(value.byteLength);
          reporter.emit();
        }
      } finally {
        reader.releaseLock();
      }
      if (written === 0) throw new DownFlowEngineError('The media server returned no data.', { code: 'EMPTY_SEGMENT', retryable: true });
      return written;
    },
    { attempts, signal },
  );
}

async function downloadParts(
  urls: string[],
  options: {
    downloadId: string;
    storage: SegmentStorage;
    connections: number;
    signal: AbortSignal;
    globalLimiter?: RateLimiter;
    localLimiter: RateLimiter;
    reporter: MediaProgressReporter;
    byteRanges?: Array<{ offset: number; length: number } | undefined>;
  },
): Promise<number[]> {
  const indexes = urls.map((_, index) => index + MEDIA_PARTS_BASE);
  await options.storage.prepare(
    options.downloadId,
    indexes.map((index) => ({ index, expectedSize: Number.MAX_SAFE_INTEGER })),
  );
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (!options.signal.aborted) {
      const current = cursor++;
      if (current >= urls.length) return;
      await fetchPart(
        urls[current],
        indexes[current],
        options.storage,
        options.downloadId,
        options.signal,
        options.globalLimiter,
        options.localLimiter,
        options.reporter,
        options.byteRanges?.[current],
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.connections, urls.length) }, () => worker()));
  return indexes;
}

async function loadHlsPlaylist(url: string, signal: AbortSignal): Promise<HlsPlaylist> {
  const text = await fetchText(url, signal);
  return parseHlsManifest(text, url);
}

function pickHlsPlaylist(
  master: HlsPlaylist,
  variantUri: string | undefined,
  signal: AbortSignal,
): Promise<HlsPlaylist> {
  if (master.kind !== 'master' || master.variants.length === 0) return Promise.resolve(master);
  let variant = master.variants.find((item) => item.uri === variantUri);
  if (!variant) {
    variant = [...master.variants].sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0))[0];
  }
  return loadHlsPlaylist(variant.uri, signal);
}

export async function runHlsDownload(options: MediaEngineOptions): Promise<MediaResult> {
  const { signal, storage, media, downloadId } = options;
  const reporter = new MediaProgressReporter(options.onProgress);
  const localLimiter = new Limiter(options.bandwidthLimitBps);
  let master = await loadHlsPlaylist(media.url, signal);
  master = await pickHlsPlaylist(master, options.variantUri, signal);
  if (master.encrypted) {
    throw new DownFlowEngineError(
      `This HLS stream is encrypted (${master.encryptionMethod ?? 'unknown method'}). DownFlow does not bypass DRM or stream encryption.`,
      { code: 'DRM_PROTECTED' },
    );
  }
  if (!master.endList) {
    throw new DownFlowEngineError(
      'This is a live HLS playlist. DownFlow supports completed VOD playlists; recording a live stream is not supported.',
      { code: 'LIVE_STREAM_UNSUPPORTED' },
    );
  }
  if (master.segments.length === 0) {
    throw new DownFlowEngineError('No media segments were found in this HLS playlist.', { code: 'NO_SEGMENTS' });
  }

  const urls: string[] = [];
  const byteRanges: Array<{ offset: number; length: number } | undefined> = [];
  if (master.initUrl) {
    urls.push(master.initUrl);
    byteRanges.push(master.initByteRange);
  }
  for (const segment of master.segments) {
    urls.push(segment.url);
    byteRanges.push(segment.byteRange);
  }
  const indexes = await downloadParts(urls, {
    downloadId,
    storage,
    connections: options.connections,
    signal,
    globalLimiter: options.globalLimiter,
    localLimiter,
    reporter,
    byteRanges,
  });
  const assembled = await storage.assemble(downloadId, indexes, master.outputExtension === 'mp4' ? 'video/mp4' : 'video/mp2t');
  if (assembled.totalBytes <= 0) throw new DownFlowEngineError('The assembled HLS file was empty.', { code: 'EMPTY_OUTPUT' });
  reporter.emit(true);
  return {
    blob: assembled.blob,
    filename: hlsFilenameFromTitle(media.title, master.outputExtension),
    mime: assembled.blob.type,
    totalBytes: assembled.totalBytes,
  };
}

function chooseRepresentation(
  representations: DashRepresentation[],
  representationId?: string,
): DashRepresentation {
  if (representationId) {
    const selected = representations.find((representation) => representation.id === representationId);
    if (!selected) throw new DownFlowEngineError('The selected DASH representation is no longer available.', { code: 'REPRESENTATION_GONE' });
    return selected;
  }
  const { video, audio } = selectDashRepresentations(representations);
  const selected = video[0] ?? audio[0];
  if (!selected) throw new DownFlowEngineError('This DASH manifest has no downloadable representations.', { code: 'NO_REPRESENTATION' });
  return selected;
}

export async function runDashDownload(options: MediaEngineOptions): Promise<MediaResult> {
  const { signal, storage, media, downloadId } = options;
  const reporter = new MediaProgressReporter(options.onProgress);
  const localLimiter = new Limiter(options.bandwidthLimitBps);
  const manifestText = await fetchText(media.url, signal);
  const manifest = parseDashManifest(manifestText, media.url);
  if (manifest.protected) {
    throw new DownFlowEngineError(
      `This DASH stream is protected (${manifest.protectionSystems.join(', ') || 'ContentProtection'}). DownFlow does not bypass DRM.`,
      { code: 'DRM_PROTECTED' },
    );
  }
  if (manifest.isDynamic) {
    throw new DownFlowEngineError(
      'This is a dynamic DASH manifest. DownFlow only assembles completed static VOD representations.',
      { code: 'LIVE_STREAM_UNSUPPORTED' },
    );
  }
  const representation = chooseRepresentation(manifest.representations, options.representationId);
  let segmentUrls = representation.segmentUrls ?? [];
  if (segmentUrls.length === 0 && representation.mediaTemplate && representation.segmentCount) {
    segmentUrls = Array.from({ length: representation.segmentCount }, (_, index) =>
      representation.mediaTemplate!
        .replace(/\$Number(?:%0(\d+)d)?\$/g, (_match, width) =>
          width ? String(representation.startNumber + index).padStart(Number(width), '0') : String(representation.startNumber + index),
        )
        .replace(/\$RepresentationID\$/g, representation.id)
        .replace(/\$Bandwidth(?::\d+)?\$/g, String(representation.bandwidth ?? 0)),
    );
  }
  if (segmentUrls.length === 0) {
    const directBase = representation.baseUrl;
    if (/\.(mp4|m4a|m4v|webm|mp3|aac)(?:$|\?)/i.test(directBase)) segmentUrls = [directBase];
  }
  if (segmentUrls.length === 0) {
    throw new DownFlowEngineError(
      'This DASH representation does not expose a supported segment structure. Try the direct media resource instead.',
      { code: 'UNSUPPORTED_DASH_STRUCTURE' },
    );
  }
  ensureHttpUrl(representation.baseUrl);
  segmentUrls = segmentUrls.map((url) => resolveMediaUrl(url, representation.baseUrl)).map(ensureHttpUrl);
  const urls = representation.initUrl ? [ensureHttpUrl(representation.initUrl), ...segmentUrls] : segmentUrls;
  const indexes = await downloadParts(urls, {
    downloadId,
    storage,
    connections: options.connections,
    signal,
    globalLimiter: options.globalLimiter,
    localLimiter,
    reporter,
  });
  const mime = representation.mime || (representation.type === 'audio' ? 'audio/mp4' : 'video/mp4');
  const assembled = await storage.assemble(downloadId, indexes, mime);
  if (assembled.totalBytes <= 0) throw new DownFlowEngineError('The assembled DASH file was empty.', { code: 'EMPTY_OUTPUT' });
  reporter.emit(true);
  const base = sanitizeFilename(media.title || `dash-${representation.id}`).replace(/\.[a-z0-9]{2,5}$/i, '');
  return {
    blob: assembled.blob,
    filename: `${base}.${representation.type === 'audio' ? 'm4a' : 'mp4'}`,
    mime,
    totalBytes: assembled.totalBytes,
  };
}

export async function runMediaDownload(options: MediaEngineOptions): Promise<MediaResult> {
  try {
    if (options.media.kind === 'hls') return await runHlsDownload(options);
    if (options.media.kind === 'dash') return await runDashDownload(options);
    throw new DownFlowEngineError('This media resource must be downloaded through the standard engine.', {
      code: 'DIRECT_MEDIA_STANDARD',
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw toEngineError(error);
  }
}

export function mediaSegmentLabel(segment: HlsSegment): string {
  return `Segment ${segment.sequence + 1}`;
}
