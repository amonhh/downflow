import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearMedia,
  deleteMedia,
  getMedia,
  listMedia,
  mediaErrorMessage,
  pruneMedia,
  saveMedia,
} from '../src/storage/media-store';
import { makeMedia } from './helpers/factories';
import { resetDatabase } from './helpers/db';

beforeEach(async () => {
  await resetDatabase();
});

describe('detected media persistence', () => {
  it('stores and lists media newest first', async () => {
    await saveMedia(makeMedia({ id: 'old', discoveredAt: 1000 }));
    await saveMedia(makeMedia({ id: 'new', discoveredAt: 2000 }));
    expect((await getMedia('old'))?.id).toBe('old');
    expect((await listMedia()).map((resource) => resource.id)).toEqual(['new', 'old']);
  });

  it('deletes and clears media entries', async () => {
    await saveMedia(makeMedia({ id: 'a' }));
    await saveMedia(makeMedia({ id: 'b' }));
    await deleteMedia('a');
    expect((await listMedia()).map((resource) => resource.id)).toEqual(['b']);
    await clearMedia();
    expect(await listMedia()).toEqual([]);
  });

  it('prunes expired and excess records', async () => {
    const now = Date.now();
    await saveMedia(makeMedia({ id: 'expired', discoveredAt: now - 10_000 }));
    await saveMedia(makeMedia({ id: 'recent-1', discoveredAt: now - 100 }));
    await saveMedia(makeMedia({ id: 'recent-2', discoveredAt: now - 50 }));
    await saveMedia(makeMedia({ id: 'recent-3', discoveredAt: now }));

    await pruneMedia(5000, 2);
    expect((await listMedia()).map((resource) => resource.id)).toEqual(['recent-3', 'recent-2']);
  });

  it('surfaces readable error messages', () => {
    expect(mediaErrorMessage(new Error('broken manifest'))).toBe('broken manifest');
    expect(mediaErrorMessage('plain')).toBe('plain');
    expect(mediaErrorMessage({})).toMatch(/unexpected/);
  });
});
