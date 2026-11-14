import { describe, expect, it } from 'vitest';
import { MemorySegmentStorage, opfsAvailable } from '../src/storage/segment-storage';

describe('in-memory segment storage', () => {
  it('reports zero for new segments and tracks appended bytes', async () => {
    const storage = new MemorySegmentStorage();
    expect(await storage.prepare('job', [{ index: 0, expectedSize: 10 }])).toEqual([0]);
    await storage.append('job', 0, new Uint8Array([1, 2, 3]));
    await storage.append('job', 0, new Uint8Array([4, 5]));
    expect(await storage.size('job', 0)).toBe(5);
    expect(await storage.prepare('job', [{ index: 0, expectedSize: 10 }])).toEqual([5]);
  });

  it('resets a segment when stored data exceeds the expected size', async () => {
    const storage = new MemorySegmentStorage();
    await storage.append('job', 0, new Uint8Array(10));
    expect(await storage.prepare('job', [{ index: 0, expectedSize: 5 }])).toEqual([0]);
    expect(await storage.size('job', 0)).toBe(0);
  });

  it('assembles segments in the requested order with the right type', async () => {
    const storage = new MemorySegmentStorage();
    await storage.append('job', 0, new TextEncoder().encode('AAA'));
    await storage.append('job', 1, new TextEncoder().encode('BB'));
    await storage.append('job', 2, new TextEncoder().encode('C'));
    const assembled = await storage.assemble('job', [0, 1, 2], 'video/mp2t');
    expect(assembled.totalBytes).toBe(6);
    expect(assembled.blob.type).toBe('video/mp2t');
    expect(await assembled.blob.text()).toBe('AAABBC');
  });

  it('copies appended chunks so later mutation cannot corrupt the transfer', async () => {
    const storage = new MemorySegmentStorage();
    const chunk = new Uint8Array([10, 20]);
    await storage.append('job', 0, chunk);
    chunk[0] = 99;
    const assembled = await storage.assemble('job', [0], 'application/octet-stream');
    expect(new Uint8Array(await assembled.blob.arrayBuffer())).toEqual(new Uint8Array([10, 20]));
  });

  it('resets individual segments and removes whole jobs', async () => {
    const storage = new MemorySegmentStorage();
    await storage.append('job', 0, new Uint8Array([1]));
    await storage.append('job', 1, new Uint8Array([2]));
    await storage.resetSegment('job', 0);
    expect(await storage.size('job', 0)).toBe(0);
    expect(await storage.size('job', 1)).toBe(1);
    await storage.remove('job');
    expect(await storage.size('job', 1)).toBe(0);
    await storage.append('other', 0, new Uint8Array([3]));
    await storage.clearAll();
    expect(await storage.size('other', 0)).toBe(0);
  });

  it('reports OPFS availability honestly in a non-browser runtime', async () => {
    expect(await opfsAvailable()).toBe(false);
  });
});
