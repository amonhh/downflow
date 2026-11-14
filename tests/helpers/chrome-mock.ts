export interface ChromeMock {
  chrome: typeof chrome;
  storage: Map<string, unknown>;
  downloadRequests: chrome.downloads.DownloadOptions[];
  paused: number[];
  resumed: number[];
  cancelled: number[];
  notifications: Array<{ id: string; options: chrome.notifications.NotificationOptions }>;
  alarms: Map<string, chrome.alarms.AlarmCreateInfo>;
  badges: string[];
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/**
 * Minimal, stateful mock of the Chrome extension APIs DownFlow uses.
 * It intentionally models async Chrome methods with resolved promises.
 */
export function installChromeMock(): ChromeMock {
  const storage = new Map<string, unknown>();
  const downloadRequests: chrome.downloads.DownloadOptions[] = [];
  const paused: number[] = [];
  const resumed: number[] = [];
  const cancelled: number[] = [];
  const notifications: ChromeMock['notifications'] = [];
  const alarms = new Map<string, chrome.alarms.AlarmCreateInfo>();
  const badges: string[] = [];
  let nextDownloadId = 1;

  const storageArea = {
    async get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> {
      if (keys === null || keys === undefined) return Object.fromEntries(storage);
      const names = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const result: Record<string, unknown> = {};
      for (const name of names) {
        if (storage.has(name)) result[name] = clone(storage.get(name));
        else if (!Array.isArray(keys) && typeof keys !== 'string' && keys) result[name] = keys[name];
      }
      return result;
    },
    async set(values: Record<string, unknown>): Promise<void> {
      for (const [key, value] of Object.entries(values)) storage.set(key, clone(value));
      const changes = Object.fromEntries(
        Object.entries(values).map(([key, value]) => [key, { newValue: clone(value), oldValue: undefined }]),
      );
      storageListeners.forEach((listener) => listener(changes, 'local'));
    },
    async remove(keys: string | string[]): Promise<void> {
      for (const key of Array.isArray(keys) ? keys : [keys]) storage.delete(key);
    },
  };

  const storageListeners: Array<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void> = [];

  const chromeMock = {
    storage: {
      local: storageArea,
      onChanged: {
        addListener: (listener: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void) => {
          storageListeners.push(listener);
        },
        removeListener: (listener: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void) => {
          const index = storageListeners.indexOf(listener);
          if (index >= 0) storageListeners.splice(index, 1);
        },
        hasListener: (listener: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void) =>
          storageListeners.includes(listener),
      },
    },
    runtime: {
      getManifest: () => ({ version: '1.0.0', manifest_version: 3, name: 'DownFlow' }),
      getURL: (path: string) => `chrome-extension://downflow/${path.replace(/^\//, '')}`,
      lastError: undefined,
      async sendMessage(_message: unknown): Promise<unknown> {
        return { ok: true, data: undefined };
      },
    },
    downloads: {
      async download(options: chrome.downloads.DownloadOptions): Promise<number> {
        downloadRequests.push(options);
        return nextDownloadId++;
      },
      async search(): Promise<chrome.downloads.DownloadItem[]> {
        return [];
      },
      async pause(id: number): Promise<void> {
        paused.push(id);
      },
      async resume(id: number): Promise<void> {
        resumed.push(id);
      },
      async cancel(id: number): Promise<void> {
        cancelled.push(id);
      },
      async open(): Promise<void> {},
      async show(): Promise<void> {},
      async erase(): Promise<void> {},
    },
    notifications: {
      async create(id: string, options: chrome.notifications.NotificationOptions): Promise<string> {
        notifications.push({ id, options });
        return id;
      },
    },
    action: {
      async setBadgeBackgroundColor(): Promise<void> {},
      async setBadgeText(details: chrome.action.BadgeTextDetails): Promise<void> {
        badges.push(details.text);
      },
      async setTitle(): Promise<void> {},
    },
    alarms: {
      async create(name: string, info: chrome.alarms.AlarmCreateInfo): Promise<void> {
        alarms.set(name, info);
      },
      async clear(name: string): Promise<boolean> {
        return alarms.delete(name);
      },
      async getAll(): Promise<chrome.alarms.Alarm[]> {
        return [...alarms.entries()].map(([name, info]) => ({
          name,
          scheduledTime: info.when ?? Date.now(),
          periodInMinutes: info.periodInMinutes,
        }));
      },
    },
    offscreen: {
      async hasDocument(): Promise<boolean> {
        return false;
      },
      async createDocument(): Promise<void> {},
      Reason: { BLOBS: 'BLOBS', WORKERS: 'WORKERS', CLIPBOARD: 'CLIPBOARD' },
    },
    tabs: {
      async create(): Promise<void> {},
    },
  } as unknown as typeof chrome;

  (globalThis as { chrome?: typeof chrome }).chrome = chromeMock;

  return {
    chrome: chromeMock,
    storage,
    downloadRequests,
    paused,
    resumed,
    cancelled,
    notifications,
    alarms,
    badges,
  };
}

export function uninstallChromeMock(): void {
  delete (globalThis as { chrome?: typeof chrome }).chrome;
}
