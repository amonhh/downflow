import { describe, expect, it } from 'vitest';
import { MIN_SEGMENT_SIZE } from '../src/shared/constants';
import {
  planSegments,
  segmentExpectedSize,
  verifyFinalSize,
  verifySegmentCoverage,
} from '../src/engine/file-assembler';

describe('segment planning', () => {
  it('splits an exact byte total into contiguous, gap-free ranges', () => {
    const total = 8 * 1024 * 1024;
    const segments = planSegments(total, 4);
    expect(segments).toHaveLength(4);
    expect(segments[0].start).toBe(0);
    expect(segments[0].end).toBe(2 * 1024 * 1024 - 1);
    expect(verifySegmentCoverage(segments, total).valid).toBe(true);
    for (const segment of segments) expect(segmentExpectedSize(segment)).toBe(segment.size);
  });

  it('reduces the segment count for files that are too small', () => {
    expect(planSegments(MIN_SEGMENT_SIZE - 1, 8)).toHaveLength(1);
    expect(planSegments(MIN_SEGMENT_SIZE * 2, 8)).toHaveLength(2);
    expect(planSegments(5, 16)).toHaveLength(1);
  });

  it('caps the number of segments at 16', () => {
    const segments = planSegments(MIN_SEGMENT_SIZE * 40, 100);
    expect(segments).toHaveLength(16);
    expect(verifySegmentCoverage(segments, MIN_SEGMENT_SIZE * 40).valid).toBe(true);
  });

  it('distributes remainder bytes across the first segments', () => {
    const total = 3 * 1024 * 1024 + 5;
    const segments = planSegments(total, 2);
    expect(segments).toHaveLength(1); // One 2 MB chunk is the minimum size rule.
    const totalWithTwo = MIN_SEGMENT_SIZE * 2 + 3;
    const two = planSegments(totalWithTwo, 2);
    expect(two[0].size - two[1].size).toBe(1);
    expect(two[0].start).toBe(0);
    expect(two[1].end).toBe(totalWithTwo - 1);
  });

  it('rejects invalid file sizes', () => {
    expect(() => planSegments(0, 4)).toThrow(/positive, exact file size/);
    expect(() => planSegments(-1, 4)).toThrow();
    expect(() => planSegments(Number.NaN, 4)).toThrow();
  });
});

describe('integrity checks', () => {
  it('detects gaps, overlaps and short coverage', () => {
    expect(verifySegmentCoverage([], 10)).toMatchObject({ valid: false });
    expect(
      verifySegmentCoverage(
        [
          { start: 0, end: 4 },
          { start: 6, end: 9 },
        ],
        10,
      ).reason,
    ).toMatch(/gap or overlap/);
    expect(verifySegmentCoverage([{ start: 0, end: 8 }], 10).reason).toMatch(/cover 9 bytes/);
    expect(
      verifySegmentCoverage(
        [
          { start: 0, end: 5 },
          { start: 5, end: 9 },
        ],
        10,
      ).reason,
    ).toMatch(/gap or overlap/);
  });

  it('throws when the assembled size differs from the expected size', () => {
    expect(() => verifyFinalSize(100, 100)).not.toThrow();
    expect(() => verifyFinalSize(99, 100)).toThrow(/integrity check failed/);
  });
});
