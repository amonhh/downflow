import { PROGRESS_FLUSH_MS } from '../shared/constants';
import type { SegmentMeta } from '../shared/types';
import { cleanErrorMessage, estimateEta } from '../shared/utilities';
import type { SegmentStorage } from '../storage/segment-storage';
import { RateLimiter } from './bandwidth-limiter';
import {
  AuthorizationError,
  DiskError,
  DownFlowEngineError,
  RangeUnsupportedError,
  RemoteChangedError,
  isAbortError,
  toEngineError,
} from './engine-errors';
import { planSegments, segmentExpectedSize, verifyFinalSize, verifySegmentCoverage } from './file-assembler';
import { validateSegmentResponse } from './range-validator';
import { withRetry } from './retry-manager';

export interface SegmentedProgress {
  downloadedBytes: number;
  totalBytes: number;
  speedBps: number;
  etaSeconds: number | null;
  segments: SegmentMeta[];
}

export interface SegmentedResult {
  blob: Blob;
  filename: string;
  mime: string;
  totalBytes: number;
  finalUrl?: string;
}

export interface SegmentedCallbacks {
  onProgress: (progress: SegmentedProgress) => void;
  onComplete: (result: SegmentedResult) => void;
  onPaused: () => void;
  onError: (error: { message: string; code: string }) => void;
  onFallback: (reason: string) => void;
}

export interface SegmentedDownloadOptions {
  downloadId: string;
  url: string;
  filename: string;
  mime: string;
  totalBytes: number;
  finalUrl?: string;
  etag?: string;
  lastModified?: string;
  segments?: SegmentMeta[];
  segmentCount: number;
  connections: number;
  maxAttempts: number;
  maxBytes: number;
  storage: SegmentStorage;
  globalLimiter?: RateLimiter;
  localLimitBps?: number;
  referer?: string;
  callbacks: SegmentedCallbacks;
}

interface SpeedSample {
  time: number;
  bytes: number;
}

export class SegmentedDownload {
  private readonly options: SegmentedDownloadOptions;
  private segments: SegmentMeta[];
  private downloadedBytes = 0;
  private controller: AbortController | null = null;
  private running = false;
  private runPromise: Promise<void> | null = null;
  private pauseRequested = false;
  private cancelled = false;
  private failedError: unknown;
  private lastProgressAt = 0;
  private speedSamples: SpeedSample[] = [];
  private localLimiter: RateLimiter;
  private completed = false;

  constructor(options: SegmentedDownloadOptions) {
    this.options = options;
    this.localLimiter = new RateLimiter(options.localLimitBps ?? 0);
    const planned = planSegments(options.totalBytes, options.segmentCount);
    const existing = options.segments ?? [];
    const validExisting =
      existing.length === planned.length &&
      verifySegmentCoverage(existing, options.totalBytes).valid &&
      existing.every((segment, index) => segment.start === planned[index].start && segment.end === planned[index].end);
    this.segments = (validExisting ? existing : planned).map((segment, index) => ({
      index,
      start: segment.start,
      end: segment.end,
      downloaded: validExisting && 'downloaded' in segment ? segment.downloaded : 0,
      status: 'pending',
    }));
    this.recalculateDownloaded();
  }

  get isRunning(): boolean {
    return this.running;
  }

  get isCompleted(): boolean {
    return this.completed;
  }

  get segmentState(): SegmentMeta[] {
    return this.segments.map((segment) => ({ ...segment }));
  }

  start(): Promise<void> {
    if (this.running) return this.runPromise ?? Promise.resolve();
    if (this.completed || this.cancelled) return Promise.resolve();
    this.runPromise = this.run();
    return this.runPromise;
  }

  async pause(): Promise<void> {
    if (!this.running) return;
    this.pauseRequested = true;
    this.controller?.abort();
    await this.runPromise?.catch(() => undefined);
  }

  async cancel(): Promise<void> {
    if (this.completed) return;
    this.cancelled = true;
    this.pauseRequested = false;
    this.controller?.abort();
    await this.runPromise?.catch(() => undefined);
    await this.options.storage.remove(this.options.downloadId);
  }

  private recalculateDownloaded(): void {
    this.downloadedBytes = this.segments.reduce((sum, segment) => sum + segment.downloaded, 0);
  }

  private async prepareSegments(): Promise<void> {
    const sizes = await this.options.storage.prepare(
      this.options.downloadId,
      this.segments.map((segment) => ({ index: segment.index, expectedSize: segmentExpectedSize(segment) })),
    );
    for (const segment of this.segments) {
      const expected = segmentExpectedSize(segment);
      let stored = sizes[segment.index] ?? 0;
      if (stored > expected) {
        await this.options.storage.resetSegment(this.options.downloadId, segment.index);
        stored = 0;
      }
      segment.downloaded = stored;
      if (stored === expected) {
        segment.status = 'completed';
      } else if (segment.status === 'completed') {
        segment.status = 'pending';
      }
    }
    this.recalculateDownloaded();
  }

  private async run(): Promise<void> {
    this.running = true;
    this.pauseRequested = false;
    this.cancelled = false;
    this.failedError = undefined;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.speedSamples = [];
    this.lastProgressAt = 0;

    try {
      if (this.options.totalBytes > this.options.maxBytes) {
        throw new DownFlowEngineError(
          `This file is larger than the configured ${Math.round(this.options.maxBytes / 1024 / 1024)} MB segmented-download safety limit.`,
          { code: 'SEGMENT_MEMORY_LIMIT', fallback: true },
        );
      }
      await this.prepareSegments();
      this.emitProgress(true);
      const pending = this.segments.filter((segment) => segment.downloaded < segmentExpectedSize(segment));
      if (pending.length > 0) {
        await this.downloadPending(pending, signal);
      }

      if (this.cancelled) return;
      if (this.pauseRequested) {
        this.markPausedState();
        this.emitProgress(true);
        this.options.callbacks.onPaused();
        return;
      }
      if (this.failedError) throw this.failedError;

      const incomplete = this.segments.filter(
        (segment) => segment.downloaded !== segmentExpectedSize(segment) || segment.status !== 'completed',
      );
      if (incomplete.length > 0) {
        throw new DownFlowEngineError('Some segments are incomplete. Resume the download to continue.', {
          code: 'INCOMPLETE_SEGMENTS',
          retryable: true,
        });
      }

      const assembled = await this.options.storage.assemble(
        this.options.downloadId,
        this.segments.map((segment) => segment.index),
        this.options.mime,
      );
      verifyFinalSize(assembled.totalBytes, this.options.totalBytes);
      this.completed = true;
      this.emitProgress(true, 0);
      this.options.callbacks.onComplete({
        blob: assembled.blob,
        filename: this.options.filename,
        mime: this.options.mime || assembled.blob.type || 'application/octet-stream',
        totalBytes: assembled.totalBytes,
        finalUrl: this.options.finalUrl,
      });
    } catch (error) {
      if (this.cancelled) return;
      if (this.pauseRequested && isAbortError(error)) {
        this.markPausedState();
        this.emitProgress(true);
        this.options.callbacks.onPaused();
        return;
      }
      const engineError = toEngineError(error);
      if (engineError.code === 'ABORTED' && this.pauseRequested) {
        this.markPausedState();
        this.emitProgress(true);
        this.options.callbacks.onPaused();
        return;
      }
      for (const segment of this.segments) {
        if (segment.status === 'downloading') segment.status = 'pending';
      }
      if (engineError.fallback) {
        this.options.callbacks.onFallback(engineError.message);
      } else {
        this.options.callbacks.onError({ message: engineError.message, code: engineError.code });
      }
    } finally {
      this.running = false;
      this.controller = null;
    }
  }

  private markPausedState(): void {
    for (const segment of this.segments) {
      if (segment.status === 'downloading') segment.status = 'pending';
    }
  }

  private async downloadPending(pending: SegmentMeta[], signal: AbortSignal): Promise<void> {
    let cursor = 0;
    const workerCount = Math.max(1, Math.min(this.options.connections, pending.length));
    const worker = async (): Promise<void> => {
      while (!signal.aborted) {
        const current = cursor++;
        if (current >= pending.length) return;
        const segment = pending[current];
        try {
          await this.downloadSegment(segment, signal);
        } catch (error) {
          if (!this.failedError && !isAbortError(error) && !this.pauseRequested) {
            this.failedError = error;
          }
          this.controller?.abort();
          throw error;
        }
      }
    };
    const workers = Array.from({ length: workerCount }, () => worker());
    try {
      await Promise.all(workers);
    } catch (error) {
      if (this.failedError) throw this.failedError;
      throw error;
    }
  }

  private async downloadSegment(segment: SegmentMeta, signal: AbortSignal): Promise<void> {
    const expectedTotal = this.options.totalBytes;
    if (segment.downloaded === segmentExpectedSize(segment)) {
      segment.status = 'completed';
      return;
    }

    await withRetry(
      async () => {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const start = segment.start + segment.downloaded;
        const end = segment.end;
        const expectedLength = end - start + 1;
        segment.status = 'downloading';
        segment.error = undefined;
        this.emitProgress(true);

        let response: Response;
        try {
          response = await fetch(this.options.url, {
            method: 'GET',
            headers: {
              Range: `bytes=${start}-${end}`,
              Accept: '*/*',
              ...(this.options.referer ? { Referer: this.options.referer } : {}),
            },
            credentials: 'include',
            redirect: 'follow',
            cache: 'no-store',
            signal,
          });
        } catch (error) {
          if (isAbortError(error)) throw error;
          throw new DownFlowEngineError(`Network error while downloading segment ${segment.index + 1}.`, {
            code: 'NETWORK_ERROR',
            retryable: true,
          });
        }

        const range = validateSegmentResponse(response, { start, end, total: expectedTotal });
        if (!range) throw new DownFlowEngineError('Missing Content-Range.', { code: 'INVALID_CONTENT_RANGE' });
        const responseEtag = response.headers.get('etag');
        const responseModified = response.headers.get('last-modified');
        if (this.options.etag && responseEtag && responseEtag !== this.options.etag) {
          throw new RemoteChangedError();
        }
        if (!this.options.etag && this.options.lastModified && responseModified && responseModified !== this.options.lastModified) {
          throw new RemoteChangedError();
        }
        if (!response.body) {
          throw new DownFlowEngineError('The server returned an empty response body.', {
            code: 'EMPTY_RESPONSE',
            retryable: true,
          });
        }

        const reader = response.body.getReader();
        let received = 0;
        try {
          while (received < expectedLength) {
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
            const { done, value } = await reader.read();
            if (done) break;
            if (!value || value.byteLength === 0) continue;
            const remaining = expectedLength - received;
            const piece = value.byteLength > remaining ? value.subarray(0, remaining) : value;
            try {
              await Promise.all([
                this.options.globalLimiter?.consume(piece.byteLength, signal) ?? Promise.resolve(),
                this.localLimiter.consume(piece.byteLength, signal),
              ]);
              await this.options.storage.append(this.options.downloadId, segment.index, piece);
            } catch (error) {
              if (isAbortError(error)) throw error;
              throw new DiskError(
                `Could not save segment data locally. ${error instanceof Error ? error.message : ''}`.trim(),
              );
            }
            segment.downloaded += piece.byteLength;
            this.downloadedBytes += piece.byteLength;
            received += piece.byteLength;
            this.emitProgress();
          }
        } finally {
          reader.releaseLock();
        }

        if (received !== expectedLength) {
          throw new DownFlowEngineError(
            `Segment ${segment.index + 1} ended early (${received} of ${expectedLength} bytes). It will resume automatically.`,
            { code: 'EARLY_EOF', retryable: true },
          );
        }
        segment.status = 'completed';
        this.emitProgress(true);
      },
      {
        attempts: this.options.maxAttempts,
        signal,
        shouldRetry: (error) => {
          if (isAbortError(error)) return false;
          if (error instanceof AuthorizationError) return false;
          if (error instanceof RangeUnsupportedError || error instanceof RemoteChangedError) return false;
          if (error instanceof DiskError) return false;
          if (error instanceof DownFlowEngineError) return error.retryable;
          return true;
        },
        onRetry: (_attempt, _delay, error) => {
          segment.error = cleanErrorMessage(error);
          segment.status = 'pending';
          this.emitProgress(true);
        },
      },
    );
  }

  private emitProgress(force = false, forcedSpeed?: number): void {
    const now = Date.now();
    if (!force && now - this.lastProgressAt < PROGRESS_FLUSH_MS) return;
    this.lastProgressAt = now;
    this.speedSamples.push({ time: now, bytes: this.downloadedBytes });
    while (this.speedSamples.length > 2 && now - this.speedSamples[0].time > 4000) {
      this.speedSamples.shift();
    }
    const first = this.speedSamples[0];
    const last = this.speedSamples[this.speedSamples.length - 1];
    const elapsed = Math.max(1, last.time - first.time);
    const speedBps =
      forcedSpeed ?? (this.speedSamples.length > 1 ? Math.max(0, ((last.bytes - first.bytes) * 1000) / elapsed) : 0);
    const remaining = Math.max(0, this.options.totalBytes - this.downloadedBytes);
    this.options.callbacks.onProgress({
      downloadedBytes: this.downloadedBytes,
      totalBytes: this.options.totalBytes,
      speedBps,
      etaSeconds: estimateEta(remaining, speedBps),
      segments: this.segmentState,
    });
  }
}
