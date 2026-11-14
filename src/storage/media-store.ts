import type { MediaResource } from '../shared/types';
import { cleanErrorMessage } from '../shared/utilities';
import { dbClear, dbDelete, dbGet, dbGetAll, dbPut } from './database';

export async function listMedia(): Promise<MediaResource[]> {
  const media = await dbGetAll<MediaResource>('media');
  return media.sort((a, b) => b.discoveredAt - a.discoveredAt);
}

export async function getMedia(id: string): Promise<MediaResource | undefined> {
  return dbGet<MediaResource>('media', id);
}

export async function saveMedia(resource: MediaResource): Promise<void> {
  await dbPut('media', resource);
}

export async function deleteMedia(id: string): Promise<void> {
  await dbDelete('media', id);
}

export async function clearMedia(): Promise<void> {
  await dbClear('media');
}

export async function pruneMedia(maxAgeMs = 7 * 86_400_000, maxRecords = 250): Promise<void> {
  const media = await listMedia();
  const cutoff = Date.now() - maxAgeMs;
  const keep: MediaResource[] = [];
  const remove: MediaResource[] = [];
  for (const [index, resource] of media.entries()) {
    if (resource.discoveredAt < cutoff || index >= maxRecords) remove.push(resource);
    else keep.push(resource);
  }
  for (const resource of remove) await deleteMedia(resource.id);
  void keep;
}

export function mediaErrorMessage(error: unknown): string {
  return cleanErrorMessage(error);
}
