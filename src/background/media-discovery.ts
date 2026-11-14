import type { DetectedMedia, MediaResource } from '../shared/types';
import { inferMediaKind, uuid } from '../shared/utilities';
import { makeMediaResource } from '../shared/detection';
import { parseDashManifest } from '../media/dash-detector';
import { parseHlsManifest } from '../media/hls-detector';
import { listMedia, saveMedia } from '../storage/media-store';
import { getSettings } from '../storage/settings-store';

const MAX_MANIFEST_BYTES = 6 * 1024 * 1024;
let knownUrls: Set<string> | null = null;

async function getKnownUrls(): Promise<Set<string>> {
  if (!knownUrls) {
    knownUrls = new Set((await listMedia()).map((resource) => resource.url));
  }
  return knownUrls;
}

export async function discoverMedia(input: DetectedMedia): Promise<MediaResource | null> {
  if (!/^https?:\/\//i.test(input.url)) return null;
  const settings = await getSettings();
  if (!settings.mediaDetection) return null;
  const kind = input.kind ?? inferMediaKind(input.url, input.mime);
  if (kind === 'hls' && !settings.hlsDetection) return null;
  if (kind === 'dash' && !settings.dashDetection) return null;

  const known = await getKnownUrls();
  if (known.has(input.url)) return null;

  const resource: MediaResource = {
    ...makeMediaResource({ ...input, kind }, uuid()),
    protected: false,
  };
  await saveMedia(resource);
  known.add(input.url);
  void enrichMedia(resource).catch(() => undefined);

  if (settings.mediaNotifications && (kind === 'hls' || kind === 'dash')) {
    try {
      await chrome.notifications.create(`media-${resource.id}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
        title: 'DownFlow detected a stream',
        message: `${resource.title}`.slice(0, 160),
        priority: 0,
      });
    } catch {
      // Notifications are optional.
    }
  }
  return resource;
}

async function fetchManifestText(url: string): Promise<string> {
  const response = await fetch(url, {
    credentials: 'include',
    redirect: 'follow',
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Manifest request failed with HTTP ${response.status}.`);
  const size = Number(response.headers.get('content-length') ?? 0);
  if (size > MAX_MANIFEST_BYTES) throw new Error('Manifest is too large.');
  const text = await response.text();
  if (text.length > MAX_MANIFEST_BYTES) throw new Error('Manifest is too large.');
  return text;
}

export async function enrichMedia(resource: MediaResource): Promise<void> {
  if (resource.kind !== 'hls' && resource.kind !== 'dash') return;
  try {
    const text = await fetchManifestText(resource.url);
    if (resource.kind === 'hls') {
      const playlist = parseHlsManifest(text, resource.url);
      if (playlist.kind === 'master') {
        resource.variants = playlist.variants;
        resource.manifestFetched = true;
      } else {
        resource.variants = playlist.variants;
        resource.protected = playlist.encrypted;
        resource.protectionSystem = playlist.encryptionMethod;
        resource.duration = playlist.segments.reduce((sum, segment) => sum + segment.duration, 0);
        resource.manifestFetched = true;
      }
    } else {
      const manifest = parseDashManifest(text, resource.url);
      resource.representations = manifest.representations.map((representation) => ({
        ...representation,
        segmentUrls: undefined,
      }));
      resource.protected = manifest.protected;
      resource.protectionSystem = manifest.protectionSystems.join(', ') || undefined;
      resource.duration = manifest.duration;
      resource.manifestFetched = true;
    }
    resource.updatedAt = Date.now();
    await saveMedia(resource);
  } catch {
    resource.manifestFetched = false;
    resource.updatedAt = Date.now();
    await saveMedia(resource).catch(() => undefined);
  }
}

export function mediaFromResponse(
  url: string,
  contentType: string,
  tabUrl?: string,
  pageTitle?: string,
): DetectedMedia | null {
  if (!/^https?:\/\//i.test(url)) return null;
  const lowerUrl = url.toLowerCase();
  if (/\.(ts|m4s|aac|vtt|key)(?:$|\?)/i.test(lowerUrl)) return null;
  const kind = inferMediaKind(url, contentType);
  if (kind === 'unknown') return null;
  if (kind === 'video' && !/\.(mp4|webm|mov|mkv|m4v)(?:$|\?)/i.test(lowerUrl) && !/^video\//i.test(contentType)) {
    return null;
  }
  return {
    url,
    kind,
    mime: contentType.split(';')[0].trim(),
    pageUrl: tabUrl ?? url,
    pageTitle,
    title: pageTitle || undefined,
  };
}
