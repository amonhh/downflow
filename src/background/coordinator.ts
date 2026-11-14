import { MIN_SEGMENT_SIZE } from '../shared/constants';
import type {
  AppSettings,
  DownloadRecord,
  DownloadsListResponse,
  EngineComplete,
  EngineError,
  EngineFallback,
  EngineProgress,
  ExtensionInfo,
  FileCategory,
  MediaDownloadInput,
  SiteDownloadInput,
  SiteJobState,
  SiteProbe,
  StartDownloadInput,
  StartDownloadResult,
  StatsSummary,
} from '../shared/types';
import { normalizeSiteFormats } from '../shared/site-formats';
import {
  activeStatus,
  buildDownloadPath,
  clamp,
  cleanErrorMessage,
  cleanTitleForFilename,
  getExtension,
  getExtensionFromUrl,
  getFileCategory,
  pageDownloadHint,
  progressPercent,
  resolveDownloadFilename,
  sanitizeFilename,
  sourceDomain,
  uuid,
  validateDownloadUrl,
} from '../shared/utilities';
import { computeStats } from '../shared/stats';
import { planSegments } from '../engine/file-assembler';
import { probeRangeSupport } from '../engine/range-validator';
import {
  applyChromeItem,
  cancelChromeDownload,
  openChromeDownload,
  pauseChromeDownload,
  recordFromChromeItem,
  resumeChromeDownload,
  showChromeDownload,
  startStandardDownload,
} from '../engine/standard-engine';
import { nextQueueCandidates, nextQueueOrder, reorderQueued } from '../queue/queue-manager';
import {
  clearDownloads,
  deleteDownload,
  getDownload,
  listDownloads,
  saveDownload,
  saveDownloads,
} from '../storage/downloads-store';
import { getMedia, listMedia } from '../storage/media-store';
import {
  getQueueState,
  getSettings,
  setQueuePaused,
  updateSettings,
} from '../storage/settings-store';
import { LIMITATIONS } from '../shared/constants';
import { releaseOffscreenDelivery, sendToOffscreen, syncOffscreenSettings } from './offscreen-manager';
import {
  cancelNativeSiteJob,
  getHelperStatus,
  getNativeSiteJobs,
  openNativeSitePath,
  probeSiteUrl,
  revealNativeSitePath,
  startNativeSiteJob,
} from './site-helper';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const DELIVERY_WATCHDOG_MS = 60_000;
const DELIVERY_STALE_MS = 2 * 60_000;
export const SITE_POLL_ALARM = 'downflow:site-poll';
const SITE_POLL_MS = 1500;
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mkv', 'mov', 'm4v']);
const AUDIO_EXTENSIONS = new Set(['m4a', 'mp3', 'opus', 'ogg', 'wav', 'flac']);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || 'download';
}

const PAGE_RESPONSE_ERROR =
  'This link returned a web page (HTML), not a file, so DownFlow discarded it. Open the page and use the Video & Audio tab to detect the real media, or paste a direct file URL.';

function siteMime(ext: string): string {
  switch (ext) {
    case 'm4a':
      return 'audio/mp4';
    case 'mp3':
      return 'audio/mpeg';
    case 'opus':
      return 'audio/opus';
    case 'ogg':
      return 'audio/ogg';
    case 'wav':
      return 'audio/wav';
    case 'flac':
      return 'audio/flac';
    case 'webm':
      return 'video/webm';
    case 'mkv':
      return 'video/x-matroska';
    default:
      return 'video/mp4';
  }
}

function siteCategory(ext: string): FileCategory {
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (VIDEO_EXTENSIONS.has(ext)) return 'videos';
  return 'other';
}

function isHtmlPageResponse(record: DownloadRecord, item: chrome.downloads.DownloadItem): boolean {
  if (record.source === 'chrome') return false;
  if (!/^text\/html/i.test(item.mime || '')) return false;
  const urlExtension = getExtensionFromUrl(item.finalUrl || item.url);
  if (urlExtension === 'html' || urlExtension === 'htm') return false;
  const nameExtension = getExtension(record.filename);
  return nameExtension !== 'html' && nameExtension !== 'htm';
}

function isRetryableChromeError(error: string | undefined): boolean {
  if (!error) return true;
  return !/SERVER_UNAUTHORIZED|SERVER_FORBIDDEN|USER_CANCELED|CRASH|FILE_ACCESS_DENIED|FILE_NO_SPACE/i.test(error);
}

function chromeErrorMessage(error: string | undefined): string {
  switch (error) {
    case 'SERVER_UNAUTHORIZED':
      return 'The server requires authentication. Open the source site, sign in, and try again.';
    case 'SERVER_FORBIDDEN':
      return 'The server denied access to this file.';
    case 'NETWORK_FAILED':
    case 'NETWORK_TIMEOUT':
    case 'NETWORK_DISCONNECTED':
      return 'The network connection was interrupted.';
    case 'FILE_NO_SPACE':
      return 'There is not enough disk space for this download.';
    case 'FILE_ACCESS_DENIED':
      return 'Chrome was not allowed to write this file. Choose another download folder.';
    case 'USER_CANCELED':
      return 'The download was cancelled.';
    case 'CRASH':
      return 'The download was interrupted unexpectedly.';
    default:
      return error ? `Chrome download error: ${error}` : 'The download failed.';
  }
}

export class DownloadCoordinator {
  private activeStarts = new Set<string>();
  private pumpChain: Promise<void> = Promise.resolve();
  private nativeSyncPromise: Promise<void> | null = null;
  private lastNativeSync = 0;
  private speedSamples = new Map<number, { bytes: number; time: number; speed: number }>();
  private deliveryWatchers = new Map<string, ReturnType<typeof setTimeout>>();
  private sitePollTimer: ReturnType<typeof setTimeout> | undefined;
  private sitePollBusy = false;

  async initialize(): Promise<void> {
    await this.updateBadge();
  }

  async list(): Promise<DownloadsListResponse> {
    await this.syncNativeDownloads();
    void this.syncSiteJobs();
    const [downloads, queue] = await Promise.all([listDownloads(), getQueueState()]);
    const activeSpeedBps = downloads.reduce(
      (sum, record) => sum + (record.status === 'downloading' ? Math.max(0, record.speedBps) : 0),
      0,
    );
    return { downloads, queuePaused: queue.paused, activeSpeedBps };
  }

  async getStats(): Promise<StatsSummary> {
    return computeStats(await listDownloads());
  }

  async get(id: string): Promise<DownloadRecord | undefined> {
    return getDownload(id);
  }

  async startDownload(input: StartDownloadInput): Promise<StartDownloadResult> {
    const validation = validateDownloadUrl(input.url);
    if (!validation.valid || !validation.url) throw new Error(validation.reason ?? 'Invalid download URL.');
    const pageHint = pageDownloadHint(validation.url);
    if (pageHint) throw new Error(pageHint);
    const settings = await getSettings();
    const records = await listDownloads();
    const now = Date.now();
    const filename = resolveDownloadFilename({
      url: validation.url,
      requested: input.filename,
      title: input.pageTitle,
      mime: input.mime,
      fallback: 'download',
    });
    const category = getFileCategory(filename, input.mime ?? '');
    const kind = input.kind === 'standard' ? 'standard' : settings.segmentedEnabled ? 'segmented' : 'standard';
    const record: DownloadRecord = {
      id: uuid(),
      url: validation.url,
      filename,
      mime: input.mime ?? '',
      category,
      sourceDomain: sourceDomain(input.pageUrl || validation.url),
      pageUrl: input.pageUrl,
      pageTitle: input.pageTitle,
      status: 'queued',
      kind,
      source: input.source ?? 'dashboard',
      totalBytes: Math.max(0, input.totalBytes ?? 0),
      downloadedBytes: 0,
      speedBps: 0,
      etaSeconds: null,
      createdAt: now,
      updatedAt: now,
      canResume: true,
      segments: [],
      segmentCount: clamp(input.segments ?? settings.segmentCount, 2, 16),
      priority: clamp(Math.round(input.priority ?? 0), 0, 2),
      queueOrder: nextQueueOrder(records),
      attempts: 0,
      maxAttempts: Math.max(1, settings.autoRetry ? settings.maxRetries + 1 : 1),
      bandwidthLimitBps: Math.max(0, input.bandwidthLimitBps ?? settings.perDownloadLimitBps),
      customFilename: Boolean(input.filename),
      saveAs: input.saveAs ?? settings.saveAsOnStart,
    };
    await saveDownload(record);
    if (!input.addToQueue) await this.processQueue();
    const latest = (await getDownload(record.id)) ?? record;
    return { record: latest, queued: latest.status === 'queued' };
  }

  async startMediaDownload(input: MediaDownloadInput): Promise<StartDownloadResult> {
    const media = await getMedia(input.mediaId);
    if (!media) throw new Error('This media resource is no longer available. Detect it again from its page.');
    if (media.protected) {
      throw new Error(
        'This media is protected by DRM or stream encryption. DownFlow will not attempt to bypass access controls.',
      );
    }
    if (media.kind === 'hls' || media.kind === 'dash') {
      const settings = await getSettings();
      const records = await listDownloads();
      const now = Date.now();
      const extension = media.kind === 'hls' ? 'ts' : 'mp4';
      const title = cleanTitleForFilename(media.title) || 'downflow-stream';
      const stem = title.replace(/\.[a-z0-9]{2,5}$/i, '');
      const record: DownloadRecord = {
        id: uuid(),
        url: media.url,
        finalUrl: media.url,
        filename: sanitizeFilename(`${stem}.${extension}`),
        mime: media.mime || (media.kind === 'hls' ? 'video/mp2t' : 'video/mp4'),
        category: 'videos',
        sourceDomain: media.sourceDomain,
        pageUrl: media.pageUrl,
        pageTitle: media.pageTitle,
        status: 'queued',
        kind: media.kind,
        source: 'media',
        totalBytes: 0,
        downloadedBytes: 0,
        speedBps: 0,
        etaSeconds: null,
        createdAt: now,
        updatedAt: now,
        canResume: false,
        segments: [],
        segmentCount: 1,
        priority: 0,
        queueOrder: nextQueueOrder(records),
        attempts: 0,
        maxAttempts: 1,
        bandwidthLimitBps: settings.perDownloadLimitBps,
        mediaId: media.id,
        representationId: input.representationId,
        variantUri: input.variantUri,
        customFilename: false,
      };
      await saveDownload(record);
      await this.processQueue();
      return { record: (await getDownload(record.id)) ?? record, queued: true };
    }
    return this.startDownload({
      url: media.url,
      filename: resolveDownloadFilename({
        url: media.url,
        title: media.title,
        mime: media.mime,
        mediaKind: media.kind,
        fallback: 'media',
      }),
      pageUrl: media.pageUrl,
      pageTitle: media.pageTitle,
      source: 'media',
      mime: media.mime,
      kind: 'standard',
      totalBytes: media.size,
    });
  }

  async probeSite(url: string): Promise<SiteProbe> {
    const validation = validateDownloadUrl(url);
    if (!validation.valid || !validation.url) throw new Error(validation.reason ?? 'Invalid video page URL.');
    const helper = await getHelperStatus(true);
    if (!helper.available) {
      throw new Error(
        helper.error ??
          'The optional DownFlow helper is not installed. Add it from Settings → Video sites, then reload the extension.',
      );
    }
    if (!helper.ytDlp.available) {
      throw new Error(
        'The DownFlow helper is installed, but yt-dlp was not found. Install yt-dlp or run: npm run native:install -- --download-ytdlp',
      );
    }
    const raw = await probeSiteUrl(validation.url);
    const formats = normalizeSiteFormats(raw.formats, {
      ffmpeg: helper.ffmpeg.available,
      isLive: raw.is_live,
    });
    const warnings: string[] = [];
    if (raw.is_live) warnings.push('This is a live stream. The helper cannot save live streams yet.');
    if (formats.length === 0) {
      warnings.push('No downloadable formats were found. The site may require a login, DRM or a newer yt-dlp.');
    }
    if (!helper.ffmpeg.available && formats.some((format) => format.needsMerge)) {
      warnings.push(
        'FFmpeg is not installed. High-quality video-only streams are disabled; combined formats still work.',
      );
    }
    return {
      url: raw.webpage_url || validation.url,
      title: cleanTitleForFilename(raw.title) || 'Video',
      uploader: raw.uploader,
      durationSeconds: raw.duration,
      thumbnail: raw.thumbnail,
      extractor: raw.extractor_key || raw.extractor,
      isLive: Boolean(raw.is_live),
      formats,
      helper,
      warning: warnings.join(' ') || undefined,
    };
  }

  async startSiteDownload(input: SiteDownloadInput): Promise<StartDownloadResult> {
    const validation = validateDownloadUrl(input.url);
    if (!validation.valid || !validation.url) throw new Error(validation.reason ?? 'Invalid video page URL.');
    if (!input.formatId) throw new Error('Choose a video or audio quality first.');
    const helper = await getHelperStatus();
    if (!helper.available) {
      throw new Error(
        helper.error ??
          'The optional DownFlow helper is not installed. Add it from Settings → Video sites, then reload the extension.',
      );
    }
    if (!helper.ytDlp.available) throw new Error('yt-dlp is not available to the DownFlow helper.');
    if (input.merge && !helper.ffmpeg.available) {
      throw new Error('This quality needs FFmpeg to merge video and audio. Install FFmpeg and try again.');
    }

    const settings = await getSettings();
    const records = await listDownloads();
    const now = Date.now();
    const requested = (input.filename || input.pageTitle || 'video').trim();
    const requestedExtension = getExtension(requested);
    const ext = (input.ext || requestedExtension || 'mp4').replace(/^\./, '').toLowerCase();
    const stem = requestedExtension ? requested.slice(0, -(requestedExtension.length + 1)) : requested;
    const filename = sanitizeFilename(`${cleanTitleForFilename(stem) || 'video'}.${ext}`);
    const category = siteCategory(ext);
    const record: DownloadRecord = {
      id: uuid(),
      url: validation.url,
      filename,
      mime: siteMime(ext),
      category,
      sourceDomain: sourceDomain(validation.url),
      pageTitle: input.pageTitle,
      status: 'queued',
      kind: 'site',
      source: input.source ?? 'dashboard',
      totalBytes: Math.max(0, input.totalBytes ?? 0),
      downloadedBytes: 0,
      speedBps: 0,
      etaSeconds: null,
      createdAt: now,
      updatedAt: now,
      canResume: true,
      segments: [],
      segmentCount: 1,
      priority: clamp(Math.round(input.priority ?? 0), 0, 2),
      queueOrder: nextQueueOrder(records),
      attempts: 0,
      maxAttempts: Math.max(1, settings.autoRetry ? 2 : 1),
      bandwidthLimitBps: settings.perDownloadLimitBps,
      customFilename: Boolean(input.filename),
      siteFormatId: input.formatId,
      siteFormatLabel: input.formatLabel,
      siteFormatExt: ext,
      siteMerge: Boolean(input.merge),
      siteHelperInstalled: true,
    };
    await saveDownload(record);
    if (!input.addToQueue) await this.processQueue();
    const latest = (await getDownload(record.id)) ?? record;
    return { record: latest, queued: latest.status === 'queued' };
  }

  private async startSiteRecord(record: DownloadRecord): Promise<void> {
    if (!record.siteFormatId) throw new Error('The selected site format is missing.');
    record.status = 'downloading';
    record.siteStage = 'downloading';
    record.error = undefined;
    record.errorCode = undefined;
    record.updatedAt = Date.now();
    record.startedAt = record.startedAt ?? Date.now();
    await saveDownload(record);
    try {
      await startNativeSiteJob({
        id: record.id,
        url: record.url,
        format: record.siteFormatId,
        title: record.pageTitle || record.filename,
        filename: record.filename,
        filenameStem: record.filename.replace(/\.[^.]+$/, ''),
        customFilename: Boolean(record.customFilename),
        ext: record.siteFormatExt,
        merge: Boolean(record.siteMerge),
        totalBytes: record.totalBytes,
      });
      this.scheduleSitePoll(500);
    } catch (error) {
      await this.failRecord(record, cleanErrorMessage(error), 'SITE_HELPER_FAILED', false);
    }
  }

  private scheduleSitePoll(delay = SITE_POLL_MS): void {
    if (this.sitePollTimer) return;
    this.sitePollTimer = setTimeout(() => {
      this.sitePollTimer = undefined;
      void this.syncSiteJobs();
    }, delay);
    try {
      void chrome.alarms.create(SITE_POLL_ALARM, { periodInMinutes: 0.5 });
    } catch {
      // The in-page polling loop still runs while the extension UI is open.
    }
  }

  async syncSiteJobs(): Promise<void> {
    if (this.sitePollBusy) return;
    this.sitePollBusy = true;
    try {
      const records = await listDownloads();
      const active = records.filter(
        (record) =>
          record.kind === 'site' &&
          (record.status === 'downloading' || record.status === 'probing' || record.status === 'delivering'),
      );
      if (active.length === 0) {
        if (this.sitePollTimer) {
          clearTimeout(this.sitePollTimer);
          this.sitePollTimer = undefined;
        }
        try {
          await chrome.alarms.clear(SITE_POLL_ALARM);
        } catch {
          // No alarm to clear.
        }
        return;
      }

      let states: Record<string, SiteJobState | null>;
      try {
        states = await getNativeSiteJobs(active.map((record) => record.id));
      } catch (error) {
        for (const record of active) {
          await this.failRecord(
            record,
            cleanErrorMessage(error),
            /not connected|not installed/i.test(cleanErrorMessage(error)) ? 'HELPER_UNAVAILABLE' : 'HELPER_FAILED',
            false,
          );
        }
        return;
      }

      let stillActive = false;
      for (const record of active) {
        const current = (await getDownload(record.id)) ?? record;
        if (current.status !== 'downloading' && current.status !== 'probing' && current.status !== 'delivering') {
          continue;
        }
        const state = states[record.id];
        if (!state) {
          if (Date.now() - current.updatedAt < 8000) {
            stillActive = true;
            continue;
          }
          await this.failRecord(
            current,
            'The helper lost track of this download. Retry to start it again.',
            'HELPER_JOB_MISSING',
            false,
          );
          continue;
        }
        const activeAfter = await this.applySiteJobState(current, state);
        if (activeAfter) stillActive = true;
      }

      if (stillActive) this.scheduleSitePoll();
    } finally {
      this.sitePollBusy = false;
    }
  }

  private async applySiteJobState(record: DownloadRecord, state: SiteJobState): Promise<boolean> {
    if (record.status === 'cancelled' || record.status === 'paused' || record.status === 'completed') return false;

    if (state.totalBytes && state.totalBytes > 0) record.totalBytes = state.totalBytes;
    if (typeof state.downloadedBytes === 'number') {
      record.downloadedBytes = Math.max(record.downloadedBytes, state.downloadedBytes);
    }
    if (typeof state.speedBps === 'number') record.speedBps = Math.max(0, state.speedBps);
    record.etaSeconds = state.etaSeconds ?? null;
    if (state.outputPath) record.outputPath = state.outputPath;

    if (state.status === 'completed') {
      const path = state.outputPath;
      if (path) {
        record.outputPath = path;
        record.filename = sanitizeFilename(path.split(/[\\/]/).pop() || state.filename || record.filename);
        record.category = getFileCategory(record.filename, record.mime);
      }
      record.status = 'completed';
      record.siteStage = undefined;
      record.totalBytes = state.totalBytes || record.totalBytes || state.downloadedBytes || 0;
      record.downloadedBytes = record.totalBytes;
      record.speedBps = 0;
      record.etaSeconds = null;
      record.canResume = false;
      record.error = undefined;
      record.errorCode = undefined;
      record.completedAt = state.completedAt ?? Date.now();
      record.updatedAt = Date.now();
      await saveDownload(record);
      await this.notify('Download complete', `${record.filename} is ready.`);
      await this.updateBadge();
      void this.processQueue();
      return false;
    }

    if (state.status === 'failed') {
      await this.failRecord(record, state.error || 'The helper could not finish this download.', 'SITE_DOWNLOAD_FAILED', false);
      return false;
    }

    if (state.status === 'cancelled') {
      record.status = 'cancelled';
      record.siteStage = undefined;
      record.speedBps = 0;
      record.etaSeconds = null;
      record.updatedAt = Date.now();
      await saveDownload(record);
      await this.updateBadge();
      void this.processQueue();
      return false;
    }

    record.status = 'downloading';
    record.siteStage =
      state.status === 'merging' ? 'merging' : state.status === 'finalizing' ? 'finalizing' : 'downloading';
    record.updatedAt = Date.now();
    await saveDownload(record);
    return true;
  }

  private enqueuePump(maxToStart = Number.POSITIVE_INFINITY): Promise<void> {
    const task = () => this.doProcessQueue(maxToStart);
    this.pumpChain = this.pumpChain.then(task, task);
    return this.pumpChain;
  }

  processQueue(maxToStart = Number.POSITIVE_INFINITY): Promise<void> {
    return this.enqueuePump(maxToStart);
  }

  private async doProcessQueue(maxToStart: number): Promise<void> {
    const [settings, queue, records] = await Promise.all([getSettings(), getQueueState(), listDownloads()]);
    if (queue.paused) return;
    const eligible = records.filter((record) => !this.activeStarts.has(record.id));
    const candidates = nextQueueCandidates(eligible, settings.maxConcurrent, maxToStart);
    for (const candidate of candidates) {
      void this.startRecord(candidate.id);
    }
  }

  private async startRecord(id: string): Promise<void> {
    if (this.activeStarts.has(id)) return;
    const initial = await getDownload(id);
    if (!initial || initial.status !== 'queued') return;
    this.activeStarts.add(id);
    try {
      const settings = await getSettings();
      const record = await getDownload(id);
      if (!record || record.status !== 'queued') return;
      record.status = 'probing';
      record.error = undefined;
      record.errorCode = undefined;
      record.updatedAt = Date.now();
      record.startedAt = record.startedAt ?? Date.now();
      await saveDownload(record);

      if (record.kind === 'standard') {
        await this.startStandardRecord(record, settings);
        return;
      }
      if (record.kind === 'site') {
        await this.startSiteRecord(record);
        return;
      }
      if (record.kind === 'hls' || record.kind === 'dash') {
        await this.startMediaRecord(record, settings);
        return;
      }
      await this.startSegmentedOrFallback(record, settings);
    } catch (error) {
      const current = await getDownload(id);
      if (current && current.status !== 'cancelled' && current.status !== 'paused') {
        await this.failRecord(current, cleanErrorMessage(error), 'START_FAILED');
      }
    } finally {
      this.activeStarts.delete(id);
      await this.updateBadge();
    }
  }

  private async startSegmentedOrFallback(record: DownloadRecord, settings: AppSettings): Promise<void> {
    if (!settings.segmentedEnabled) {
      await this.fallbackToStandard(record, 'Segmented downloads are disabled.');
      return;
    }

    const canResume = record.totalBytes > 0 && record.segments.length > 0;
    if (canResume) {
      const latest = await getDownload(record.id);
      if (!latest || latest.status !== 'probing') return;
      await this.startSegmentedJob(latest, settings);
      return;
    }

    let probe;
    try {
      probe = await probeRangeSupport(record.url, { referer: record.pageUrl });
    } catch {
      await this.fallbackToStandard(record, 'The Range probe failed; using Chrome’s standard engine.');
      return;
    }
    const latest = await getDownload(record.id);
    if (!latest || latest.status !== 'probing') return;

    const totalBytes = probe.totalBytes;
    const memoryLimitBytes = settings.memoryLimitMb * 1024 * 1024;
    const planned = probe.supported ? planSegments(totalBytes, latest.segmentCount) : [];
    const canSegment =
      probe.supported &&
      totalBytes > MIN_SEGMENT_SIZE &&
      totalBytes <= memoryLimitBytes &&
      planned.length >= 2;

    if (!canSegment) {
      latest.totalBytes = totalBytes || latest.totalBytes;
      latest.mime = latest.mime || probe.mime || '';
      if (!latest.customFilename) {
        latest.filename = resolveDownloadFilename({
          url: probe.finalUrl || latest.url,
          title: latest.pageTitle,
          contentDisposition: probe.contentDispositionFilename,
          mime: latest.mime || probe.mime,
          fallback: 'download',
        });
        latest.category = getFileCategory(latest.filename, latest.mime);
      }
      await this.fallbackToStandard(
        latest,
        probe.supported
          ? totalBytes > memoryLimitBytes
            ? 'File exceeds the configured segmented-download safety limit.'
            : 'File is too small to benefit from segmentation.'
          : probe.reason ?? 'The server does not support segmented downloading.',
      );
      return;
    }

    latest.kind = 'segmented';
    latest.totalBytes = totalBytes;
    latest.mime = latest.mime || probe.mime || '';
    latest.finalUrl = probe.finalUrl;
    latest.etag = probe.etag;
    latest.lastModified = probe.lastModified;
    if (!latest.customFilename) {
      latest.filename = resolveDownloadFilename({
        url: probe.finalUrl || latest.url,
        title: latest.pageTitle,
        contentDisposition: probe.contentDispositionFilename,
        mime: latest.mime || probe.mime,
        fallback: 'download',
      });
    }
    latest.category = getFileCategory(latest.filename, latest.mime);
    latest.segments = planned.map((segment) => ({
      index: segment.index,
      start: segment.start,
      end: segment.end,
      downloaded: 0,
      status: 'pending',
    }));
    latest.segmentCount = planned.length;
    await saveDownload(latest);
    await this.startSegmentedJob(latest, settings);
  }

  private async startSegmentedJob(record: DownloadRecord, settings: AppSettings): Promise<void> {
    if (record.totalBytes <= 0 || record.segments.length === 0) {
      await this.fallbackToStandard(record, 'Segment metadata was missing.');
      return;
    }
    if (record.totalBytes > settings.memoryLimitMb * 1024 * 1024) {
      await this.fallbackToStandard(record, 'File exceeds the configured segmented-download safety limit.');
      return;
    }
    record.status = 'downloading';
    record.error = undefined;
    record.errorCode = undefined;
    record.fallbackReason = undefined;
    record.updatedAt = Date.now();
    await saveDownload(record);
    try {
      await sendToOffscreen('offscreen:start-segmented', {
        downloadId: record.id,
        url: record.url,
        filename: record.filename,
        mime: record.mime,
        totalBytes: record.totalBytes,
        finalUrl: record.finalUrl,
        etag: record.etag,
        lastModified: record.lastModified,
        segments: record.segments,
        segmentCount: record.segmentCount,
        connections: Math.min(settings.maxConnections, record.segments.length),
        maxAttempts: Math.max(1, record.maxAttempts),
        maxBytes: settings.memoryLimitMb * 1024 * 1024,
        bandwidthLimitBps: record.bandwidthLimitBps,
        referer: record.pageUrl,
      });
    } catch (error) {
      await releaseOffscreenDelivery(record.id);
      await this.fallbackToStandard(record, `The transfer engine could not start: ${cleanErrorMessage(error)}`);
    }
  }

  private async startMediaRecord(record: DownloadRecord, settings: AppSettings): Promise<void> {
    if (!record.mediaId) throw new Error('Media metadata is missing.');
    const media = await getMedia(record.mediaId);
    if (!media) throw new Error('The detected media resource has expired. Reload the page and try again.');
    if (media.protected) throw new Error('This media is DRM-protected and cannot be downloaded.');
    if (!record.pageUrl && media.pageUrl) record.pageUrl = media.pageUrl;
    record.status = 'downloading';
    record.updatedAt = Date.now();
    await saveDownload(record);
    try {
      await sendToOffscreen('offscreen:start-media', {
        downloadId: record.id,
        mediaId: record.mediaId,
        representationId: record.representationId,
        variantUri: record.variantUri,
        connections: Math.min(settings.maxConnections, 8),
        bandwidthLimitBps: record.bandwidthLimitBps,
      });
    } catch (error) {
      await this.failRecord(record, cleanErrorMessage(error), 'MEDIA_START_FAILED', false);
    }
  }

  private async startStandardRecord(record: DownloadRecord, settings: AppSettings): Promise<void> {
    record.kind = 'standard';
    record.status = 'probing';
    record.error = undefined;
    record.errorCode = undefined;
    record.updatedAt = Date.now();
    record.startedAt = record.startedAt ?? Date.now();
    await saveDownload(record);
    try {
      const id = await startStandardDownload(
        {
          url: record.url,
          filename: record.filename,
          category: record.category,
          mime: record.mime,
          saveAs: record.saveAs,
          duplicatePolicy: settings.duplicatePolicy,
        },
        settings,
      );
      const latest = (await getDownload(record.id)) ?? record;
      latest.chromeDownloadId = id;
      latest.status = 'downloading';
      latest.canResume = true;
      latest.updatedAt = Date.now();
      latest.outputPath = buildDownloadPath(latest.filename, latest.category, settings);
      await saveDownload(latest);
      this.speedSamples.set(id, { bytes: latest.downloadedBytes, time: Date.now(), speed: 0 });
    } catch (error) {
      await this.failRecord(record, cleanErrorMessage(error), 'CHROME_START_FAILED');
      await this.syncNativeDownloads(true);
    }
  }

  private async fallbackToStandard(record: DownloadRecord, reason: string): Promise<void> {
    const latest = (await getDownload(record.id)) ?? record;
    if (latest.status === 'paused' || latest.status === 'cancelled') return;
    latest.kind = 'standard';
    latest.segments = [];
    latest.segmentCount = 1;
    latest.status = 'probing';
    latest.error = undefined;
    latest.errorCode = undefined;
    latest.recovered = true;
    latest.fallbackReason = reason || 'The segmented engine was not available.';
    latest.updatedAt = Date.now();
    if (reason) latest.mime = latest.mime || '';
    await saveDownload(latest);
    const settings = await getSettings();
    await this.startStandardRecord(latest, settings);
  }

  async pause(id: string): Promise<DownloadRecord> {
    const record = await getDownload(id);
    if (!record) throw new Error('Download not found.');
    if (TERMINAL_STATUSES.has(record.status)) throw new Error('This download has already finished.');
    if (record.kind === 'site') {
      if (record.status === 'downloading' || record.status === 'probing') {
        await cancelNativeSiteJob(record.id).catch(() => undefined);
      }
      record.status = 'paused';
      record.siteStage = undefined;
      record.speedBps = 0;
      record.etaSeconds = null;
      record.canResume = true;
      record.updatedAt = Date.now();
      await saveDownload(record);
      await this.updateBadge();
      void this.processQueue();
      return record;
    }
    if (record.kind === 'hls' || record.kind === 'dash') {
      throw new Error('Stream assembly transfers cannot be paused. Cancel and retry if needed.');
    }
    if (record.chromeDownloadId) {
      try {
        await pauseChromeDownload(record.chromeDownloadId);
      } catch {
        // The browser item may have completed between the UI refresh and this action.
      }
    } else if (record.kind === 'segmented' && (record.status === 'downloading' || record.status === 'probing')) {
      await sendToOffscreen('offscreen:pause-segmented', { downloadId: record.id }).catch(() => undefined);
    }
    record.status = 'paused';
    record.speedBps = 0;
    record.etaSeconds = null;
    record.updatedAt = Date.now();
    await saveDownload(record);
    await this.updateBadge();
    void this.processQueue();
    return record;
  }

  async resume(id: string): Promise<DownloadRecord> {
    const record = await getDownload(id);
    if (!record) throw new Error('Download not found.');
    if (activeStatus(record.status)) return record;
    if (record.status === 'completed') throw new Error('This download is already complete.');
    if (record.status === 'failed' || record.status === 'cancelled') return this.retry(id);
    if (record.status === 'delivering') {
      if (!record.chromeDownloadId) throw new Error('The file is being prepared. Wait a moment.');
      await resumeChromeDownload(record.chromeDownloadId);
      record.status = 'downloading';
      await saveDownload(record);
      return record;
    }
    if (record.status === 'paused' && record.chromeDownloadId) {
      try {
        await resumeChromeDownload(record.chromeDownloadId);
        record.status = 'downloading';
        record.error = undefined;
        record.updatedAt = Date.now();
        await saveDownload(record);
        await this.updateBadge();
        return record;
      } catch {
        record.chromeDownloadId = undefined;
      }
    }
    record.status = 'queued';
    record.error = undefined;
    record.errorCode = undefined;
    record.siteStage = undefined;
    record.updatedAt = Date.now();
    await saveDownload(record);
    await this.processQueue();
    return (await getDownload(record.id)) ?? record;
  }

  async cancel(id: string): Promise<DownloadRecord> {
    const record = await getDownload(id);
    if (!record) throw new Error('Download not found.');
    if (record.status === 'completed') throw new Error('Completed downloads can be removed from history instead.');
    if (record.kind === 'site') {
      await cancelNativeSiteJob(record.id).catch(() => undefined);
    }
    if (record.chromeDownloadId) await cancelChromeDownload(record.chromeDownloadId);
    if (record.kind === 'segmented') {
      await sendToOffscreen('offscreen:cancel-segmented', { downloadId: record.id }).catch(() => undefined);
    } else if (record.kind === 'hls' || record.kind === 'dash') {
      await sendToOffscreen('offscreen:cancel-media', { downloadId: record.id }).catch(() => undefined);
    } else if (record.deliveryBlobUrl) {
      await releaseOffscreenDelivery(record.id);
    }
    record.status = 'cancelled';
    record.speedBps = 0;
    record.etaSeconds = null;
    record.siteStage = undefined;
    record.deliveryBlobUrl = undefined;
    record.updatedAt = Date.now();
    await saveDownload(record);
    await this.updateBadge();
    void this.processQueue();
    return record;
  }

  async retry(id: string, automatic = false, attemptsAlreadyCounted = false): Promise<DownloadRecord> {
    const record = await getDownload(id);
    if (!record) throw new Error('Download not found.');
    if (record.status !== 'failed' && record.status !== 'cancelled') {
      throw new Error('Only failed or cancelled downloads can be retried.');
    }
    if (record.deliveryBlobUrl && record.kind !== 'standard') {
      try {
        record.status = 'delivering';
        record.error = undefined;
        record.errorCode = undefined;
        record.updatedAt = Date.now();
        await saveDownload(record);
        await sendToOffscreen('offscreen:redeliver', {
          downloadId: record.id,
          filename: record.filename,
        });
        this.watchDelivery(record.id);
        return (await getDownload(id)) ?? record;
      } catch {
        // The assembled blob is gone; fall through to a fresh transfer.
        record.deliveryBlobUrl = undefined;
      }
    }
    if (!attemptsAlreadyCounted) record.attempts += 1;
    record.status = 'queued';
    record.error = undefined;
    record.errorCode = undefined;
    record.speedBps = 0;
    record.etaSeconds = null;
    record.chromeDownloadId = undefined;
    record.siteStage = undefined;
    record.startedAt = undefined;
    record.completedAt = undefined;
    record.deliveryBlobUrl = undefined;
    record.recovered = false;
    if (record.kind === 'segmented') {
      const resets =
        record.errorCode === 'REMOTE_FILE_CHANGED' ||
        record.errorCode === 'INTEGRITY_FAILED' ||
        record.errorCode === 'RANGE_NOT_SATISFIABLE';
      if (resets) {
        record.segments = [];
        record.totalBytes = 0;
      }
    } else if (record.kind === 'hls' || record.kind === 'dash') {
      record.segments = [];
    } else {
      record.segments = [];
    }
    record.updatedAt = Date.now();
    await saveDownload(record);
    await this.processQueue();
    void automatic;
    return (await getDownload(id)) ?? record;
  }

  async remove(id: string): Promise<void> {
    const record = await getDownload(id);
    if (!record) return;
    if (!TERMINAL_STATUSES.has(record.status)) {
      await this.cancel(id).catch(() => undefined);
    }
    if (record.deliveryBlobUrl) await releaseOffscreenDelivery(record.id);
    if (record.kind === 'segmented') {
      await sendToOffscreen('offscreen:cancel-segmented', { downloadId: record.id }).catch(() => undefined);
    } else if (record.kind === 'hls' || record.kind === 'dash') {
      await sendToOffscreen('offscreen:cancel-media', { downloadId: record.id }).catch(() => undefined);
    }
    await deleteDownload(id);
    await this.updateBadge();
    void this.processQueue();
  }

  async pauseAll(): Promise<{ paused: number; skipped: number }> {
    const records = await listDownloads();
    let paused = 0;
    let skipped = 0;
    await setQueuePaused(true);
    for (const record of records) {
      if (!activeStatus(record.status)) continue;
      if (record.kind === 'site') {
        await cancelNativeSiteJob(record.id).catch(() => undefined);
        record.status = 'paused';
        record.siteStage = undefined;
        record.speedBps = 0;
        record.etaSeconds = null;
        record.canResume = true;
        await saveDownload(record);
        paused += 1;
        continue;
      }
      if (record.kind === 'hls' || record.kind === 'dash') {
        skipped += 1;
        continue;
      }
      if (record.chromeDownloadId) await pauseChromeDownload(record.chromeDownloadId).catch(() => undefined);
      if (record.kind === 'segmented' && !record.chromeDownloadId) {
        await sendToOffscreen('offscreen:pause-segmented', { downloadId: record.id }).catch(() => undefined);
      }
      record.status = 'paused';
      record.speedBps = 0;
      record.etaSeconds = null;
      await saveDownload(record);
      paused += 1;
    }
    await this.updateBadge();
    return { paused, skipped };
  }

  async resumeAll(): Promise<{ resumed: number }> {
    const records = await listDownloads();
    let resumed = 0;
    await setQueuePaused(false);
    for (const record of records) {
      if (record.status !== 'paused') continue;
      if (record.chromeDownloadId && record.kind !== 'segmented') {
        try {
          await resumeChromeDownload(record.chromeDownloadId);
          record.status = 'downloading';
          record.updatedAt = Date.now();
          await saveDownload(record);
          resumed += 1;
          continue;
        } catch {
          record.chromeDownloadId = undefined;
        }
      }
      record.status = 'queued';
      record.siteStage = undefined;
      record.updatedAt = Date.now();
      await saveDownload(record);
      resumed += 1;
    }
    await this.processQueue();
    await this.updateBadge();
    return { resumed };
  }

  async pauseQueue(): Promise<void> {
    await setQueuePaused(true);
    await this.updateBadge();
  }

  async resumeQueue(): Promise<void> {
    await setQueuePaused(false);
    await this.processQueue();
    await this.updateBadge();
  }

  async startQueue(max?: number): Promise<void> {
    await setQueuePaused(false);
    await this.processQueue(max ?? Number.POSITIVE_INFINITY);
    await this.updateBadge();
  }

  async stopQueue(): Promise<void> {
    await setQueuePaused(true);
    await this.pauseAll();
    await this.updateBadge();
  }

  async setPriority(id: string, priority: number): Promise<void> {
    const record = await getDownload(id);
    if (!record) throw new Error('Download not found.');
    record.priority = clamp(Math.round(priority), 0, 2);
    record.updatedAt = Date.now();
    await saveDownload(record);
    await this.processQueue();
  }

  async reorder(ids: string[]): Promise<void> {
    const records = await listDownloads();
    const next = reorderQueued(records, ids);
    const changed = next.filter((record, index) => record.queueOrder !== records[index].queueOrder);
    if (changed.length > 0) await saveDownloads(changed);
    await this.processQueue();
  }

  async openFile(id: string): Promise<void> {
    const record = await getDownload(id);
    if (record?.kind === 'site') {
      if (!record.outputPath) throw new Error('This video is still being prepared. Wait for it to finish.');
      await openNativeSitePath(record.outputPath);
      return;
    }
    if (!record?.chromeDownloadId) throw new Error('This file is not available in Chrome’s download history.');
    await openChromeDownload(record.chromeDownloadId);
  }

  async showInFolder(id: string): Promise<void> {
    const record = await getDownload(id);
    if (record?.kind === 'site') {
      if (!record.outputPath) throw new Error('This video is still being prepared. Wait for it to finish.');
      await revealNativeSitePath(record.outputPath);
      return;
    }
    if (!record?.chromeDownloadId) throw new Error('This file is not available in Chrome’s download history.');
    await showChromeDownload(record.chromeDownloadId);
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const settings = await updateSettings(patch);
    void syncOffscreenSettings();
    await this.processQueue();
    return settings;
  }

  async handleEngineProgress(progress: EngineProgress): Promise<void> {
    const record = await getDownload(progress.downloadId);
    if (!record || record.status === 'cancelled' || record.status === 'completed' || record.status === 'paused') return;
    record.status = 'downloading';
    record.downloadedBytes = Math.max(record.downloadedBytes, progress.downloadedBytes);
    if (progress.totalBytes > 0) record.totalBytes = progress.totalBytes;
    record.speedBps = progress.speedBps;
    record.etaSeconds = progress.etaSeconds;
    if (progress.segments) record.segments = progress.segments;
    record.error = undefined;
    record.updatedAt = Date.now();
    if (progressPercent(record) >= 99.99 && record.totalBytes > 0) {
      record.downloadedBytes = record.totalBytes;
    }
    await saveDownload(record);
  }

  async handleEngineComplete(complete: EngineComplete): Promise<void> {
    const record = await getDownload(complete.downloadId);
    if (!record) return;
    record.filename = sanitizeFilename(complete.filename || record.filename);
    record.mime = complete.mime || record.mime;
    record.category = getFileCategory(record.filename, record.mime);
    record.totalBytes = complete.totalBytes;
    record.downloadedBytes = complete.totalBytes;
    record.finalUrl = complete.finalUrl ?? record.finalUrl;
    record.status = 'delivering';
    record.speedBps = 0;
    record.etaSeconds = null;
    record.error = undefined;
    record.errorCode = undefined;
    record.deliveryBlobUrl = complete.blobUrl;
    record.deliveryFilename = record.filename;
    record.updatedAt = Date.now();
    await saveDownload(record);
    this.watchDelivery(record.id);
  }

  /**
   * Offscreen documents deliver assembled files by clicking a blob: link.
   * Chrome's downloads API ignores `filename` for blob URLs (the file would be
   * named after the blob UUID), while the anchor download attribute preserves
   * the real filename. The browser's own download folder is therefore used for
   * segmented deliveries; the standard engine still applies the configured
   * folders and duplicate policy.
   */
  private watchDelivery(downloadId: string): void {
    this.clearDeliveryWatch(downloadId);
    const timer = setTimeout(() => {
      void this.failStalledDelivery(downloadId).catch(() => undefined);
    }, DELIVERY_WATCHDOG_MS);
    this.deliveryWatchers.set(downloadId, timer);
  }

  private clearDeliveryWatch(downloadId: string): void {
    const timer = this.deliveryWatchers.get(downloadId);
    if (timer) clearTimeout(timer);
    this.deliveryWatchers.delete(downloadId);
  }

  private async failStalledDelivery(downloadId: string): Promise<void> {
    const record = await getDownload(downloadId);
    if (!record || record.status !== 'delivering' || record.chromeDownloadId) return;
    await this.failRecord(
      record,
      'The assembled file could not be handed to Chrome’s download manager. Try the download again or use a standard download.',
      'DELIVERY_FAILED',
    );
  }

  async handleEngineFallback(fallback: EngineFallback): Promise<void> {
    const record = await getDownload(fallback.downloadId);
    if (!record || record.status === 'cancelled' || record.status === 'paused') return;
    record.kind = 'standard';
    record.segments = [];
    record.segmentCount = 1;
    record.status = 'queued';
    record.error = undefined;
    record.errorCode = undefined;
    record.recovered = true;
    record.updatedAt = Date.now();
    await saveDownload(record);
    await this.processQueue();
  }

  async handleEngineError(error: EngineError): Promise<void> {
    const record = await getDownload(error.downloadId);
    if (!record || record.status === 'cancelled') return;
    record.canResume = record.kind === 'segmented';
    await this.failRecord(record, error.message, error.code ?? 'ENGINE_ERROR', record.kind !== 'hls' && record.kind !== 'dash');
  }

  async handleEnginePaused(id: string): Promise<void> {
    const record = await getDownload(id);
    if (!record || record.status === 'cancelled') return;
    record.status = 'paused';
    record.speedBps = 0;
    record.etaSeconds = null;
    record.canResume = true;
    record.updatedAt = Date.now();
    await saveDownload(record);
    await this.updateBadge();
    void this.processQueue();
  }

  async handleEngineResumed(id: string): Promise<void> {
    const record = await getDownload(id);
    if (!record) return;
    record.status = 'downloading';
    record.speedBps = 0;
    record.updatedAt = Date.now();
    await saveDownload(record);
  }

  private async failRecord(
    record: DownloadRecord,
    message: string,
    code: string,
    autoRetryAllowed = true,
  ): Promise<void> {
    record.status = 'failed';
    record.error = message;
    record.errorCode = code;
    record.siteStage = undefined;
    record.speedBps = 0;
    record.etaSeconds = null;
    record.canResume = record.kind === 'segmented' || record.kind === 'site' || Boolean(record.chromeDownloadId);
    record.updatedAt = Date.now();
    await saveDownload(record);
    await this.updateBadge();
    if (record.source !== 'chrome') {
      await this.notify('Download failed', `${record.filename}\n${message}`.slice(0, 240));
    }
    if (autoRetryAllowed && record.source !== 'chrome' && isRetryableChromeError(code)) {
      await this.scheduleAutomaticRetry(record);
    }
    void this.processQueue();
  }

  private async scheduleAutomaticRetry(record: DownloadRecord): Promise<void> {
    const settings = await getSettings();
    if (!settings.autoRetry || record.attempts >= record.maxAttempts) return;
    if (/AUTH|DRM|PROTECTED|FORBIDDEN|UNAUTHORIZED/i.test(record.errorCode ?? '')) return;
    try {
      await chrome.alarms.create(`downflow:retry:${record.id}`, { when: Date.now() + 30_000 });
    } catch {
      // A manual retry remains available.
    }
  }

  async autoRetry(id: string): Promise<void> {
    const settings = await getSettings();
    if (!settings.autoRetry) return;
    const record = await getDownload(id);
    if (!record || record.status !== 'failed' || record.attempts >= record.maxAttempts) return;
    record.attempts += 1;
    record.status = 'queued';
    record.error = undefined;
    record.errorCode = undefined;
    record.updatedAt = Date.now();
    await saveDownload(record);
    await this.retry(id, true, true);
  }

  async syncNativeDownloads(force = false): Promise<void> {
    if (this.nativeSyncPromise) return this.nativeSyncPromise;
    if (!force && Date.now() - this.lastNativeSync < 1200) return;
    this.nativeSyncPromise = (async () => {
      try {
        const startedAfter = new Date(Date.now() - 7 * 86_400_000).toISOString();
        const items = await chrome.downloads.search({ startedAfter, limit: 120 });
        await this.applyNativeItems(items);
        this.lastNativeSync = Date.now();
      } catch {
        // Downloads API access can transiently fail while Chrome is shutting down.
      } finally {
        this.nativeSyncPromise = null;
      }
    })();
    return this.nativeSyncPromise;
  }

  async handleChromeCreated(item: chrome.downloads.DownloadItem): Promise<void> {
    await delay(120);
    await this.applyNativeItems([item]);
  }

  async handleChromeChanged(): Promise<void> {
    await this.syncNativeDownloads(true);
  }

  private matchesPendingRecord(record: DownloadRecord, item: chrome.downloads.DownloadItem): boolean {
    if (record.chromeDownloadId) return record.chromeDownloadId === item.id;
    if (record.deliveryBlobUrl && record.deliveryBlobUrl === item.url) return true;
    if (!['probing', 'downloading', 'delivering'].includes(record.status)) return false;
    return record.url === item.url || record.url === item.finalUrl || record.finalUrl === item.url;
  }

  private async applyNativeItems(items: chrome.downloads.DownloadItem[]): Promise<void> {
    if (items.length === 0) return;
    const records = await listDownloads();
    const changed: DownloadRecord[] = [];
    let completedForNotification: DownloadRecord[] = [];
    let failedForNotification: DownloadRecord[] = [];
    let terminalTransition = false;

    for (const item of items) {
      let record = records.find((candidate) => candidate.chromeDownloadId === item.id);
      let imported = false;
      if (!record) {
        const pending = records.find(
          (candidate) => !candidate.chromeDownloadId && this.matchesPendingRecord(candidate, item),
        );
        if (pending) record = pending;
      }
      if (!record) {
        if (item.url.startsWith('blob:') || !/^https?:/i.test(item.url)) continue;
        record = recordFromChromeItem(item);
        record.filename = basename(item.filename) || record.filename;
        record.category = getFileCategory(record.filename, record.mime);
        record.sourceDomain = sourceDomain(item.url);
        record.chromeDownloadId = item.id;
        record.totalBytes = item.totalBytes > 0 ? item.totalBytes : item.fileSize > 0 ? item.fileSize : 0;
        record.downloadedBytes = item.bytesReceived || 0;
        record.canResume = item.canResume;
        record.outputPath = item.filename;
        imported = true;
      }

      const previousStatus = record.status;
      if (record.status === 'cancelled' && item.state !== 'complete') continue;
      const before = { ...record };
      let next = applyChromeItem(record, item);
      const now = Date.now();
      if (next.status === 'downloading') {
        const sample = this.speedSamples.get(item.id);
        if (sample) {
          const elapsed = now - sample.time;
          if (elapsed > 250) {
            const instant = Math.max(0, ((item.bytesReceived - sample.bytes) * 1000) / elapsed);
            const smoothed = sample.speed > 0 ? sample.speed * 0.65 + instant * 0.35 : instant;
            next.speedBps = smoothed;
            next.etaSeconds =
              smoothed > 0 && next.totalBytes > next.downloadedBytes
                ? Math.ceil((next.totalBytes - next.downloadedBytes) / smoothed)
                : null;
            this.speedSamples.set(item.id, { bytes: item.bytesReceived, time: now, speed: smoothed });
          } else {
            next.speedBps = sample.speed;
          }
        } else {
          this.speedSamples.set(item.id, { bytes: item.bytesReceived, time: now, speed: 0 });
          next.speedBps = 0;
        }
      } else {
        next.speedBps = 0;
        next.etaSeconds = null;
        this.speedSamples.delete(item.id);
      }
      if (next.status === 'failed') {
        next.error = chromeErrorMessage(item.error);
        next.errorCode = item.error || 'CHROME_FAILED';
      }
      if (next.status === 'completed') {
        next.totalBytes = item.fileSize > 0 ? item.fileSize : next.totalBytes;
        next.downloadedBytes = next.totalBytes;
        next.canResume = false;
        if (isHtmlPageResponse(next, item)) {
          next.status = 'failed';
          next.error = PAGE_RESPONSE_ERROR;
          next.errorCode = 'NOT_A_FILE';
          next.completedAt = undefined;
          void chrome.downloads.removeFile(item.id).catch(() => undefined);
          void chrome.downloads.erase({ id: item.id }).catch(() => undefined);
        }
      }
      next.chromeDownloadId = item.id;
      next.updatedAt = now;
      record = next;
      this.clearDeliveryWatch(record.id);

      if (previousStatus !== next.status) {
        changed.push(record);
        if (previousStatus !== 'completed' && next.status === 'completed') {
          completedForNotification = [...completedForNotification, record];
          terminalTransition = true;
          if (record.deliveryBlobUrl) {
            await releaseOffscreenDelivery(record.id);
            record.deliveryBlobUrl = undefined;
            await saveDownload(record);
          }
        }
        if (previousStatus !== 'failed' && next.status === 'failed') {
          failedForNotification = [...failedForNotification, record];
          terminalTransition = true;
        }
      } else if (!imported && (before.downloadedBytes !== record.downloadedBytes || before.status !== record.status)) {
        changed.push(record);
      }
      if (imported) changed.push(record);
    }

    const unique = new Map(changed.map((record) => [record.id, record]));
    if (unique.size > 0) await saveDownloads([...unique.values()]);
    for (const record of completedForNotification) {
      if (record.source !== 'chrome') {
        await this.notify('Download complete', `${record.filename} is ready.`);
      }
    }
    for (const record of failedForNotification) {
      if (record.source !== 'chrome') {
        await this.notify('Download failed', `${record.filename}\n${record.error ?? ''}`.slice(0, 240));
        await this.scheduleAutomaticRetry(record).catch(() => undefined);
      }
    }
    if (completedForNotification.length > 0 || failedForNotification.length > 0) {
      await this.updateBadge();
    }
    if (terminalTransition) void this.processQueue();
  }

  async recoverOnStartup(): Promise<void> {
    const records = await listDownloads();
    for (const record of records) {
      if (record.kind === 'site') {
        // Site jobs run in the optional native helper. Reconcile their real
        // state below instead of assuming the transfer was interrupted.
        continue;
      }
      if (record.status === 'delivering' && !record.chromeDownloadId) {
        if (Date.now() - record.updatedAt > DELIVERY_STALE_MS) {
          await this.failRecord(
            record,
            'The assembled file was not handed to Chrome’s download manager before the browser restarted.',
            'DELIVERY_FAILED',
          );
        } else {
          this.watchDelivery(record.id);
        }
        continue;
      }
      if (
        (record.status === 'downloading' || record.status === 'probing') &&
        !record.chromeDownloadId &&
        record.kind !== 'standard'
      ) {
        record.status = 'paused';
        record.speedBps = 0;
        record.etaSeconds = null;
        record.recovered = true;
        record.error = 'Chrome closed during this transfer. Resume to continue from saved segment data.';
        await saveDownload(record);
      }
    }
    await this.syncSiteJobs();
    await this.syncNativeDownloads(true);
    await this.processQueue();
    await this.updateBadge();
  }

  async clearHistory(): Promise<{ removed: number; kept: number }> {
    const records = await listDownloads();
    let removed = 0;
    let kept = 0;
    for (const record of records) {
      if (TERMINAL_STATUSES.has(record.status)) {
        if (record.deliveryBlobUrl) await releaseOffscreenDelivery(record.id);
        await deleteDownload(record.id);
        removed += 1;
      } else {
        kept += 1;
      }
    }
    await this.updateBadge();
    return { removed, kept };
  }

  async clearAllHistory(): Promise<void> {
    await clearDownloads();
    await this.updateBadge();
  }

  async clearSegments(): Promise<void> {
    await sendToOffscreen('offscreen:clear-segments');
  }

  async getInfo(): Promise<ExtensionInfo> {
    const [downloads, media] = await Promise.all([listDownloads(), listMedia()]);
    let storageEstimate: { usage: number; quota: number } | undefined;
    try {
      const estimate = await navigator.storage.estimate();
      storageEstimate = { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
    } catch {
      storageEstimate = undefined;
    }
    return {
      version: chrome.runtime.getManifest().version,
      downloads: downloads.length,
      segmentedActive: downloads.filter((record) => record.kind === 'segmented' && activeStatus(record.status)).length,
      media: media.length,
      storageEstimate,
      limitations: LIMITATIONS,
    };
  }

  async restoreDefaultsHint(): Promise<{ bandwidthLimitingStandard: string }> {
    return { bandwidthLimitingStandard: 'Not supported by Chrome Downloads API; segmented transfers are limited.' };
  }

  async getSettings(): Promise<AppSettings> {
    return getSettings();
  }

  async updateBadge(): Promise<void> {
    try {
      const records = await listDownloads();
      const active = records.filter((record) => activeStatus(record.status)).length;
      const queued = records.filter((record) => record.status === 'queued').length;
      await chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
      await chrome.action.setBadgeText({ text: active > 0 ? String(active) : '' });
      await chrome.action.setTitle({
        title: active > 0 ? `DownFlow — ${active} active, ${queued} queued` : 'DownFlow Download Manager',
      });
    } catch {
      // Badge is cosmetic.
    }
  }

  private async notify(title: string, message: string): Promise<void> {
    try {
      const settings = await getSettings();
      if (!settings.notifications) return;
      await chrome.notifications.create(`downflow-${uuid()}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
        title,
        message: message.slice(0, 240),
        priority: 0,
      });
    } catch {
      // Notification failures should not affect transfers.
    }
  }
}
