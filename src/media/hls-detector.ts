import type { MediaVariant } from '../shared/types';
import { sanitizeFilename } from '../shared/utilities';

export interface HlsByteRange {
  length: number;
  offset: number;
}

export interface HlsSegment {
  url: string;
  duration: number;
  sequence: number;
  byteRange?: HlsByteRange;
}

export interface HlsPlaylist {
  kind: 'master' | 'media';
  url: string;
  variants: MediaVariant[];
  segments: HlsSegment[];
  targetDuration: number;
  mediaSequence: number;
  endList: boolean;
  encrypted: boolean;
  encryptionMethod?: string;
  initUrl?: string;
  initByteRange?: HlsByteRange;
  outputExtension: 'ts' | 'mp4';
}

export function parseHlsAttributes(value: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const regex = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(value))) {
    attributes[match[1].toUpperCase()] = match[2].replace(/^"|"$/g, '');
  }
  return attributes;
}

export function resolveMediaUrl(uri: string, baseUrl: string): string {
  try {
    return new URL(uri, baseUrl).href;
  } catch {
    return uri;
  }
}

function parseByteRange(value: string | undefined, previousEnd = 0): HlsByteRange | undefined {
  if (!value) return undefined;
  const [lengthRaw, offsetRaw] = value.split('@');
  const length = Number(lengthRaw);
  const offset = offsetRaw ? Number(offsetRaw) : previousEnd;
  if (!Number.isFinite(length) || length <= 0 || !Number.isFinite(offset) || offset < 0) return undefined;
  return { length, offset };
}

export function parseHlsManifest(text: string, playlistUrl: string): HlsPlaylist {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const variants: MediaVariant[] = [];
  const segments: HlsSegment[] = [];
  let kind: 'master' | 'media' = 'media';
  let targetDuration = 0;
  let mediaSequence = 0;
  let endList = false;
  let encrypted = false;
  let encryptionMethod: string | undefined;
  let initUrl: string | undefined;
  let initByteRange: HlsByteRange | undefined;
  let nextDuration = 0;
  let nextByteRange: string | undefined;
  let byteCursor = 0;
  let sequence = 0;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      kind = 'master';
      const attributes = parseHlsAttributes(line.slice('#EXT-X-STREAM-INF:'.length));
      const uri = lines.slice(index + 1).find((candidate) => !candidate.startsWith('#'));
      if (uri) {
        variants.push({
          uri: resolveMediaUrl(uri, playlistUrl),
          bandwidth: attributes.BANDWIDTH ? Number(attributes.BANDWIDTH) : undefined,
          resolution: attributes.RESOLUTION,
          codecs: attributes.CODECS,
          name: attributes.NAME,
        });
      }
    } else if (line.startsWith('#EXT-X-KEY:')) {
      const attributes = parseHlsAttributes(line.slice('#EXT-X-KEY:'.length));
      if (attributes.METHOD && attributes.METHOD.toUpperCase() !== 'NONE') {
        encrypted = true;
        encryptionMethod = attributes.METHOD;
      }
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const attributes = parseHlsAttributes(line.slice('#EXT-X-MAP:'.length));
      if (attributes.URI) initUrl = resolveMediaUrl(attributes.URI, playlistUrl);
      initByteRange = parseByteRange(attributes.BYTERANGE);
      if (initUrl && initUrl.includes('.m4s')) kind = 'media';
    } else if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      targetDuration = Number(line.split(':')[1]) || 0;
    } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      mediaSequence = Number(line.split(':')[1]) || 0;
      sequence = mediaSequence;
    } else if (line.startsWith('#EXT-X-ENDLIST')) {
      endList = true;
    } else if (line.startsWith('#EXTINF:')) {
      nextDuration = Number(line.slice('#EXTINF:'.length).split(',')[0]) || 0;
    } else if (line.startsWith('#EXT-X-BYTERANGE:')) {
      nextByteRange = line.slice('#EXT-X-BYTERANGE:'.length);
    } else if (!line.startsWith('#')) {
      if (kind === 'master') continue;
      const byteRange = parseByteRange(nextByteRange, byteCursor);
      segments.push({
        url: resolveMediaUrl(line, playlistUrl),
        duration: nextDuration,
        sequence: sequence++,
        byteRange,
      });
      if (byteRange) byteCursor = byteRange.offset + byteRange.length;
      nextDuration = 0;
      nextByteRange = undefined;
    }
  }

  const outputExtension: 'ts' | 'mp4' =
    initUrl || segments.some((segment) => /\.m4s(?:$|\?)/i.test(segment.url)) ? 'mp4' : 'ts';

  return {
    kind: variants.length > 0 && segments.length === 0 ? 'master' : kind,
    url: playlistUrl,
    variants,
    segments,
    targetDuration,
    mediaSequence,
    endList,
    encrypted,
    encryptionMethod,
    initUrl,
    initByteRange,
    outputExtension,
  };
}

export function hlsFilenameFromTitle(title: string | undefined, extension: 'ts' | 'mp4'): string {
  const base = sanitizeFilename(title?.trim() || 'downflow-stream');
  return `${base.replace(/\.[a-z0-9]{2,5}$/i, '')}.${extension}`;
}
