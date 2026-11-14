const DB_NAME = 'downflow-db';
const DB_VERSION = 1;

let databasePromise: Promise<IDBDatabase> | null = null;

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionAsPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction was aborted.'));
  });
}

export function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this context.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('downloads')) {
        const downloads = db.createObjectStore('downloads', { keyPath: 'id' });
        downloads.createIndex('status', 'status', { unique: false });
        downloads.createIndex('createdAt', 'createdAt', { unique: false });
        downloads.createIndex('category', 'category', { unique: false });
        downloads.createIndex('chromeDownloadId', 'chromeDownloadId', { unique: false });
      }
      if (!db.objectStoreNames.contains('media')) {
        const media = db.createObjectStore('media', { keyPath: 'id' });
        media.createIndex('discoveredAt', 'discoveredAt', { unique: false });
        media.createIndex('kind', 'kind', { unique: false });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        databasePromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      databasePromise = null;
      reject(request.error ?? new Error('Could not open the DownFlow database.'));
    };
    request.onblocked = () => {
      databasePromise = null;
      reject(new Error('The DownFlow database is blocked by another extension window.'));
    };
  });
  return databasePromise;
}

export async function dbGetAll<T>(storeName: 'downloads' | 'media'): Promise<T[]> {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, 'readonly');
  return requestAsPromise(transaction.objectStore(storeName).getAll()) as Promise<T[]>;
}

export async function dbGet<T>(storeName: 'downloads' | 'media', key: IDBValidKey): Promise<T | undefined> {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, 'readonly');
  return (await requestAsPromise(transaction.objectStore(storeName).get(key))) as T | undefined;
}

export async function dbPut<T>(storeName: 'downloads' | 'media', value: T): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, 'readwrite');
  transaction.objectStore(storeName).put(value);
  await transactionAsPromise(transaction);
}

export async function dbPutMany<T>(storeName: 'downloads' | 'media', values: T[]): Promise<void> {
  if (values.length === 0) return;
  const db = await openDatabase();
  const transaction = db.transaction(storeName, 'readwrite');
  const store = transaction.objectStore(storeName);
  for (const value of values) store.put(value);
  await transactionAsPromise(transaction);
}

export async function dbDelete(storeName: 'downloads' | 'media', key: IDBValidKey): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, 'readwrite');
  transaction.objectStore(storeName).delete(key);
  await transactionAsPromise(transaction);
}

export async function dbClear(storeName: 'downloads' | 'media'): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, 'readwrite');
  transaction.objectStore(storeName).clear();
  await transactionAsPromise(transaction);
}

export async function closeDatabase(): Promise<void> {
  if (!databasePromise) return;
  const db = await databasePromise;
  db.close();
  databasePromise = null;
}

export function resetDatabaseForTests(): void {
  databasePromise = null;
}
