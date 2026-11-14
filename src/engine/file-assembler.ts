import { MIN_SEGMENT_SIZE } from '../shared/constants';

export interface SegmentRange {
  index: number;
  start: number;
  end: number;
  size: number;
}

export function planSegments(totalBytes: number, requestedCount: number): SegmentRange[] {
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0) {
    throw new Error('A positive, exact file size is required for segmented downloading.');
  }
  const countBasedOnSize = Math.max(1, Math.floor(totalBytes / MIN_SEGMENT_SIZE));
  const count = Math.max(1, Math.min(Math.round(requestedCount), countBasedOnSize, 16));
  const baseSize = Math.floor(totalBytes / count);
  const remainder = totalBytes % count;
  const segments: SegmentRange[] = [];
  let start = 0;
  for (let index = 0; index < count; index++) {
    const size = baseSize + (index < remainder ? 1 : 0);
    const end = start + size - 1;
    segments.push({ index, start, end, size });
    start = end + 1;
  }
  return segments;
}

export function verifySegmentCoverage(
  ranges: Array<{ start: number; end: number }>,
  totalBytes: number,
): { valid: boolean; reason?: string } {
  if (ranges.length === 0) return { valid: false, reason: 'No segments were planned.' };
  let cursor = 0;
  for (const range of ranges) {
    if (range.start !== cursor) {
      return { valid: false, reason: `Segment gap or overlap detected at byte ${cursor}.` };
    }
    if (range.end < range.start) {
      return { valid: false, reason: 'A segment has an invalid byte range.' };
    }
    cursor = range.end + 1;
  }
  if (cursor !== totalBytes) {
    return { valid: false, reason: `Segments cover ${cursor} bytes but the file is ${totalBytes} bytes.` };
  }
  return { valid: true };
}

export function verifyFinalSize(actualBytes: number, expectedBytes: number): void {
  if (actualBytes !== expectedBytes) {
    throw new Error(`File integrity check failed: assembled ${actualBytes} bytes, expected ${expectedBytes}.`);
  }
}

export function segmentExpectedSize(segment: { start: number; end: number }): number {
  return segment.end - segment.start + 1;
}
