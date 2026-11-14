import { describe, expect, it } from 'vitest';
import {
  countActive,
  moveQueueItem,
  nextQueueCandidates,
  nextQueueOrder,
  reorderQueued,
  sortQueue,
} from '../src/queue/queue-manager';
import { makeDownload } from './helpers/factories';

describe('queue sorting and selection', () => {
  it('sorts by priority, then queue order, then creation time', () => {
    const records = [
      makeDownload({ id: 'low', priority: 0, queueOrder: 1, createdAt: 1 }),
      makeDownload({ id: 'high-late', priority: 2, queueOrder: 5, createdAt: 1 }),
      makeDownload({ id: 'high-early', priority: 2, queueOrder: 2, createdAt: 1 }),
      makeDownload({ id: 'mid', priority: 1, queueOrder: 0, createdAt: 1 }),
    ];
    expect(sortQueue(records).map((record) => record.id)).toEqual(['high-early', 'high-late', 'mid', 'low']);
  });

  it('counts probing, downloading and delivering as active', () => {
    const records = [
      makeDownload({ status: 'downloading' }),
      makeDownload({ status: 'probing' }),
      makeDownload({ status: 'delivering' }),
      makeDownload({ status: 'queued' }),
      makeDownload({ status: 'paused' }),
    ];
    expect(countActive(records)).toBe(3);
  });

  it('starts only as many queued downloads as there are free slots', () => {
    const records = [
      makeDownload({ id: 'active', status: 'downloading' }),
      makeDownload({ id: 'a', status: 'queued', priority: 2, queueOrder: 1 }),
      makeDownload({ id: 'b', status: 'queued', priority: 1, queueOrder: 2 }),
      makeDownload({ id: 'c', status: 'queued', priority: 0, queueOrder: 3 }),
    ];
    expect(nextQueueCandidates(records, 3).map((record) => record.id)).toEqual(['a', 'b']);
    expect(nextQueueCandidates(records, 3, 1).map((record) => record.id)).toEqual(['a']);
    expect(nextQueueCandidates(records, 1)).toEqual([]);
  });

  it('continues queue order after the highest existing order', () => {
    expect(nextQueueOrder([])).toBe(1);
    expect(nextQueueOrder([makeDownload({ queueOrder: 4 }), makeDownload({ queueOrder: 9 })])).toBe(10);
  });
});

describe('queue reordering', () => {
  it('reorders queued records and keeps active records untouched', () => {
    const records = [
      makeDownload({ id: 'a', status: 'queued', queueOrder: 0 }),
      makeDownload({ id: 'b', status: 'queued', queueOrder: 1 }),
      makeDownload({ id: 'c', status: 'queued', queueOrder: 2 }),
      makeDownload({ id: 'active', status: 'downloading', queueOrder: 0 }),
    ];
    const reordered = reorderQueued(records, ['c']);
    expect(reordered.find((record) => record.id === 'c')?.queueOrder).toBe(0);
    expect(reordered.find((record) => record.id === 'a')?.queueOrder).toBe(1);
    expect(reordered.find((record) => record.id === 'b')?.queueOrder).toBe(2);
    expect(reordered.find((record) => record.id === 'active')?.queueOrder).toBe(0);
  });

  it('ignores unknown ids and appends omitted queued ids', () => {
    const records = [
      makeDownload({ id: 'a', status: 'queued', queueOrder: 5 }),
      makeDownload({ id: 'b', status: 'queued', queueOrder: 6 }),
    ];
    const reordered = reorderQueued(records, ['missing']);
    expect(reordered.find((record) => record.id === 'a')?.queueOrder).toBe(0);
    expect(reordered.find((record) => record.id === 'b')?.queueOrder).toBe(1);
  });

  it('moves queued records up and down without crossing the edges', () => {
    const records = [
      makeDownload({ id: 'a', status: 'queued', queueOrder: 0 }),
      makeDownload({ id: 'b', status: 'queued', queueOrder: 1 }),
      makeDownload({ id: 'c', status: 'queued', queueOrder: 2 }),
    ];
    const up = moveQueueItem(records, 'b', -1);
    expect(up.find((record) => record.id === 'b')?.queueOrder).toBe(0);
    expect(up.find((record) => record.id === 'a')?.queueOrder).toBe(1);
    expect(moveQueueItem(records, 'a', -1)).toBe(records);
    expect(moveQueueItem(records, 'c', 1)).toBe(records);
    expect(moveQueueItem(records, 'missing', 1)).toBe(records);
  });
});
