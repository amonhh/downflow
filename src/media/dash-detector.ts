import type { DashRepresentation } from '../shared/types';
import { resolveMediaUrl } from './hls-detector';

export interface DashManifest {
  url: string;
  representations: DashRepresentation[];
  duration?: number;
  isDynamic: boolean;
  protected: boolean;
  protectionSystems: string[];
}

export function parseIsoDuration(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(value.trim());
  if (!match) return undefined;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);
  return days * 86_400 + hours * 3600 + minutes * 60 + seconds;
}

function directChildren(node: Element | Document, tagName: string): Element[] {
  return Array.from(node.children ?? []).filter((child) => child.tagName === tagName);
}

function descendants(node: Document, tagName: string): Element[] {
  return Array.from(node.getElementsByTagName(tagName));
}

function directChild(node: Element | Document, tagName: string): Element | undefined {
  return (Array.from(node.children ?? []) as Element[]).find((child) => child.tagName === tagName);
}

function accumulatedBaseUrl(element: Element, manifestUrl: string): string {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current) {
    const base = directChild(current, 'BaseURL');
    if (base?.textContent?.trim()) parts.unshift(base.textContent.trim());
    if (current.tagName === 'MPD') break;
    current = current.parentElement;
  }
  return parts.reduce((base, part) => resolveMediaUrl(part, base), manifestUrl);
}

function inheritedTemplate(representation: Element): Element | undefined {
  const chain: Element[] = [];
  let current: Element | null = representation;
  while (current && current.tagName !== 'MPD') {
    const template = directChild(current, 'SegmentTemplate');
    if (template) chain.unshift(template);
    current = current.parentElement;
  }
  if (chain.length === 0) return undefined;
  if (chain.length === 1) return chain[0];
  const merged = chain[0].cloneNode(false) as Element;
  for (const template of chain) {
    for (const attribute of Array.from(template.attributes)) {
      merged.setAttribute(attribute.name, attribute.value);
    }
  }
  return merged;
}

function applyTemplate(template: string, values: { id: string; bandwidth?: number; number?: number; time?: number }): string {
  return template
    .replace(/\$RepresentationID\$/g, values.id)
    .replace(/\$Bandwidth(?::\d+)?\$/g, String(values.bandwidth ?? 0))
    .replace(/\$Number(?:%0(\d+)d)?\$/g, (_match, width) => {
      const number = values.number ?? 0;
      return width ? String(number).padStart(Number(width), '0') : String(number);
    })
    .replace(/\$Time(?:%0(\d+)d)?\$/g, (_match, width) => {
      const time = values.time ?? 0;
      return width ? String(time).padStart(Number(width), '0') : String(time);
    });
}

function parseTimeline(template: Element | undefined): number[] {
  if (!template) return [];
  const timeline = directChild(template, 'SegmentTimeline');
  if (!timeline) return [];
  const times: number[] = [];
  let cursor = 0;
  for (const segment of directChildren(timeline, 'S')) {
    const t = segment.getAttribute('t');
    if (t !== null) cursor = Number(t);
    const duration = Number(segment.getAttribute('d') ?? 0);
    const repeat = Number(segment.getAttribute('r') ?? 0);
    if (!Number.isFinite(duration) || duration <= 0) continue;
    const count = Math.min(Math.max(0, repeat) + 1, 100_000 - times.length);
    for (let index = 0; index < count; index++) {
      times.push(cursor);
      cursor += duration;
    }
    if (times.length >= 100_000) break;
  }
  return times;
}

function inferType(contentType: string | null, mimeType: string): 'video' | 'audio' | 'text' {
  if (contentType === 'audio' || mimeType.startsWith('audio/')) return 'audio';
  if (contentType === 'text' || mimeType.startsWith('text/')) return 'text';
  return 'video';
}

export function parseDashManifest(xml: string, manifestUrl: string): DashManifest {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.getElementsByTagName('parsererror').length > 0) {
    throw new Error('The DASH manifest is not valid XML.');
  }
  const mpd = document.documentElement;
  if (mpd.tagName !== 'MPD') throw new Error('The document is not a DASH MPD manifest.');

  const protectionElements = descendants(document, 'ContentProtection');
  const protectionSystems = Array.from(
    new Set(
      protectionElements
        .map((element) => element.getAttribute('schemeIdUri') || element.getAttribute('value') || 'unknown')
        .filter(Boolean),
    ),
  );
  const protectedManifest = protectionElements.length > 0;
  const duration = parseIsoDuration(mpd.getAttribute('mediaPresentationDuration'));
  const isDynamic = mpd.getAttribute('type') === 'dynamic';
  const periods = descendants(document, 'Period');
  const representations: DashRepresentation[] = [];

  for (const period of periods) {
    const periodDuration = parseIsoDuration(period.getAttribute('duration')) ?? duration;
    const adaptations = directChildren(period, 'AdaptationSet');
    for (const adaptation of adaptations) {
      const adaptationMime = adaptation.getAttribute('mimeType') ?? '';
      const adaptationType = adaptation.getAttribute('contentType');
      for (const rep of directChildren(adaptation, 'Representation')) {
        const id = rep.getAttribute('id') ?? `representation-${representations.length + 1}`;
        const mime = rep.getAttribute('mimeType') ?? adaptationMime;
        const bandwidth = Number(rep.getAttribute('bandwidth') ?? adaptation.getAttribute('bandwidth') ?? 0) || undefined;
        const baseUrl = accumulatedBaseUrl(rep, manifestUrl);
        const template = inheritedTemplate(rep);
        const representation: DashRepresentation = {
          id,
          type: inferType(adaptationType, mime),
          mime,
          codecs: rep.getAttribute('codecs') ?? adaptation.getAttribute('codecs') ?? undefined,
          bandwidth,
          width: Number(rep.getAttribute('width') ?? adaptation.getAttribute('width') ?? 0) || undefined,
          height: Number(rep.getAttribute('height') ?? adaptation.getAttribute('height') ?? 0) || undefined,
          audioSamplingRate: rep.getAttribute('audioSamplingRate') ?? undefined,
          baseUrl,
          startNumber: 1,
          presentationDuration: periodDuration,
        };

        if (template) {
          const startNumber = Number(template.getAttribute('startNumber') ?? 1);
          const timescale = Number(template.getAttribute('timescale') ?? 1);
          const segmentDurationRaw = Number(template.getAttribute('duration') ?? 0);
          representation.startNumber = Number.isFinite(startNumber) ? startNumber : 1;
          representation.timescale = timescale || 1;
          representation.segmentDuration = segmentDurationRaw > 0 ? segmentDurationRaw / (timescale || 1) : undefined;
          const initTemplate = template.getAttribute('initialization');
          if (initTemplate) {
            representation.initUrl = resolveMediaUrl(
              applyTemplate(initTemplate, { id, bandwidth, number: representation.startNumber }),
              baseUrl,
            );
          }
          const mediaTemplate = template.getAttribute('media');
          if (mediaTemplate) {
            representation.mediaTemplate = resolveMediaUrl(mediaTemplate, baseUrl);
            if (mediaTemplate.includes('$Time$') || /\$Time%0\d+d\$/.test(mediaTemplate)) {
              const timeline = parseTimeline(template);
              if (timeline.length > 0) {
                representation.segmentUrls = timeline.map((time) =>
                  applyTemplate(representation.mediaTemplate!, { id, bandwidth, time }),
                );
                representation.segmentCount = timeline.length;
              }
            } else {
              const endNumber = Number(template.getAttribute('endNumber') ?? 0);
              const count =
                endNumber >= representation.startNumber
                  ? endNumber - representation.startNumber + 1
                  : periodDuration && representation.segmentDuration
                    ? Math.ceil(periodDuration / representation.segmentDuration)
                    : undefined;
              if (count && count > 0 && count <= 100_000) {
                representation.segmentCount = count;
                representation.segmentUrls = Array.from({ length: count }, (_, index) =>
                  applyTemplate(representation.mediaTemplate!, {
                    id,
                    bandwidth,
                    number: representation.startNumber + index,
                  }),
                );
              }
            }
          }
        } else {
          const segmentList = directChild(rep, 'SegmentList') ?? directChild(adaptation, 'SegmentList');
          if (segmentList) {
            const init = directChild(segmentList, 'Initialization');
            if (init?.getAttribute('sourceURL')) {
              representation.initUrl = resolveMediaUrl(init.getAttribute('sourceURL')!, baseUrl);
            }
            representation.segmentUrls = directChildren(segmentList, 'SegmentURL')
              .map((segment) => segment.getAttribute('media'))
              .filter((media): media is string => Boolean(media))
              .map((media) => resolveMediaUrl(media, baseUrl));
            representation.segmentCount = representation.segmentUrls.length;
          }
        }
        representations.push(representation);
      }
    }
  }

  if (representations.length === 0) throw new Error('No downloadable representations were found in this DASH manifest.');

  return {
    url: manifestUrl,
    representations,
    duration,
    isDynamic,
    protected: protectedManifest,
    protectionSystems,
  };
}

export function selectDashRepresentations(representations: DashRepresentation[]): {
  video: DashRepresentation[];
  audio: DashRepresentation[];
} {
  return {
    video: representations
      .filter((representation) => representation.type === 'video' && (representation.segmentUrls?.length || representation.mediaTemplate))
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bandwidth ?? 0) - (a.bandwidth ?? 0)),
    audio: representations
      .filter((representation) => representation.type === 'audio' && (representation.segmentUrls?.length || representation.mediaTemplate))
      .sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0)),
  };
}
