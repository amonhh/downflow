import { DOWNLOAD_EXTENSIONS, STREAM_EXTENSIONS } from './constants';
import type { DetectedMedia, DetectedResource, MediaResourceKind } from './types';
import {
  cleanTitleForFilename,
  ensureFilenameExtension,
  filenameFromUrl,
  getExtensionFromUrl,
  inferMediaKind,
  isDownloadableFilename,
  isMediaMime,
  sanitizeFilename,
  sourceDomain,
  validateDownloadUrl,
} from './utilities';

export interface LinkDetectionOptions {
  pageUrl: string;
  pageTitle?: string;
  hintFilename?: string;
  hasDownloadAttribute?: boolean;
  mime?: string;
}

export function detectDownloadableLink(
  href: string,
  options: LinkDetectionOptions,
): DetectedResource | null {
  const validated = validateDownloadUrl(href);
  if (!validated.valid || !validated.url) return null;
  const extension = getExtensionFromUrl(validated.url);
  const baseFilename = options.hintFilename
    ? sanitizeFilename(options.hintFilename)
    : filenameFromUrl(validated.url);
  const filename = ensureFilenameExtension(baseFilename, {
    url: validated.url,
    mime: options.mime,
  });
  const downloadable =
    DOWNLOAD_EXTENSIONS.includes(extension) ||
    options.hasDownloadAttribute === true ||
    isDownloadableFilename(filename);
  if (!downloadable) return null;
  if (!filename.includes('.') && !extension) return null;
  return {
    url: validated.url,
    filename,
    mime: options.mime,
    pageUrl: options.pageUrl,
    pageTitle: options.pageTitle,
  };
}

export function detectMediaUrl(
  url: string,
  pageUrl: string,
  pageTitle?: string,
  mime = '',
  kindHint?: MediaResourceKind,
): DetectedMedia | null {
  const validated = validateDownloadUrl(url);
  if (!validated.valid || !validated.url) return null;
  const extension = getExtensionFromUrl(validated.url);
  const isStream = STREAM_EXTENSIONS.includes(extension);
  const isMedia = isMediaMime(mime) || ['mp4', 'webm', 'mov', 'mkv', 'm4v', 'ts', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus'].includes(extension);
  if (!isStream && !isMedia) return null;
  return {
    url: validated.url,
    kind: kindHint ?? inferMediaKind(validated.url, mime),
    mime,
    pageUrl,
    pageTitle,
    title: pageTitle?.trim() || filenameFromUrl(validated.url, 'media'),
  };
}

export function isProbablyDownloadLink(
  href: string,
  downloadAttribute: boolean,
  mime = '',
): boolean {
  if (!/^https?:/i.test(href)) return false;
  if (downloadAttribute) return true;
  const extension = getExtensionFromUrl(href);
  if (DOWNLOAD_EXTENSIONS.includes(extension)) return true;
  return isMediaMime(mime);
}

export function isIgnoredHost(url: string, ignoredHosts: string[]): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return ignoredHosts.some((ignored) => host === ignored || host.endsWith(`.${ignored}`));
  } catch {
    return true;
  }
}

export function makeMediaResource(
  media: DetectedMedia,
  id: string,
  now = Date.now(),
): {
  id: string;
  url: string;
  pageUrl: string;
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
} {
  return {
    id,
    url: media.url,
    pageUrl: media.pageUrl,
    pageTitle: media.pageTitle,
    sourceDomain: sourceDomain(media.pageUrl || media.url),
    kind: media.kind,
    mime: media.mime ?? '',
    title:
      cleanTitleForFilename(media.title) ||
      cleanTitleForFilename(media.pageTitle) ||
      filenameFromUrl(media.url, 'media'),
    size: media.size ?? 0,
    duration: media.duration,
    discoveredAt: now,
    updatedAt: now,
    protected: false,
  };
}
