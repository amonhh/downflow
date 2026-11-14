import { clearMedia } from '../../src/storage/media-store';
import { clearDownloads } from '../../src/storage/downloads-store';
import { closeDatabase, openDatabase, resetDatabaseForTests } from '../../src/storage/database';

/** Ensures each storage test starts from an empty, open in-memory database. */
export async function resetDatabase(): Promise<void> {
  await closeDatabase();
  resetDatabaseForTests();
  await openDatabase();
  await clearDownloads();
  await clearMedia();
}
