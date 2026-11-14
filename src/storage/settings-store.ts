import { CATEGORY_FOLDERS, DEFAULT_SETTINGS, DEFAULT_QUEUE_STATE } from '../shared/constants';
import type { AppSettings, FileCategory, QueueState, Schedule } from '../shared/types';
import { clamp, sanitizeFolder } from '../shared/utilities';

export const SETTINGS_KEY = 'downflow.settings';
const QUEUE_KEY = 'downflow.queue';
const SCHEDULES_KEY = 'downflow.schedules';

export function normalizeSettings(input: Partial<AppSettings> | undefined): AppSettings {
  const merged = { ...DEFAULT_SETTINGS, ...(input ?? {}) };
  const categoryFolders = Object.fromEntries(
    (Object.keys(CATEGORY_FOLDERS) as FileCategory[]).map((category) => {
      const configured = merged.categoryFolders?.[category];
      return [category, sanitizeFolder(configured || CATEGORY_FOLDERS[category]) || CATEGORY_FOLDERS[category]];
    }),
  ) as Record<FileCategory, string>;
  return {
    ...merged,
    categoryFolders,
    theme: ['dark', 'light', 'system'].includes(merged.theme) ? merged.theme : 'dark',
    language: 'en',
    defaultFolder: sanitizeFolder(merged.defaultFolder || DEFAULT_SETTINGS.defaultFolder) || 'DownFlow',
    maxConcurrent: clamp(Math.round(merged.maxConcurrent), 1, 20),
    segmentCount: clamp(Math.round(merged.segmentCount), 2, 16),
    maxConnections: clamp(Math.round(merged.maxConnections), 1, 16),
    maxRetries: clamp(Math.round(merged.maxRetries), 0, 10),
    bandwidthLimitBps: Math.max(0, Math.round(merged.bandwidthLimitBps)),
    perDownloadLimitBps: Math.max(0, Math.round(merged.perDownloadLimitBps)),
    memoryLimitMb: clamp(Math.round(merged.memoryLimitMb), 64, 4096),
    duplicatePolicy: ['uniquify', 'overwrite', 'prompt'].includes(merged.duplicatePolicy)
      ? merged.duplicatePolicy
      : 'uniquify',
    autoCategorize: Boolean(merged.autoCategorize),
    categorizeFolders: Boolean(merged.categorizeFolders),
    notifications: Boolean(merged.notifications),
    confirmBeforeDownload: Boolean(merged.confirmBeforeDownload),
    segmentedEnabled: Boolean(merged.segmentedEnabled),
    autoRetry: Boolean(merged.autoRetry),
    autoStartQueue: Boolean(merged.autoStartQueue),
    detectionEnabled: Boolean(merged.detectionEnabled),
    interceptClicks: Boolean(merged.interceptClicks),
    mediaDetection: Boolean(merged.mediaDetection),
    hlsDetection: Boolean(merged.hlsDetection),
    dashDetection: Boolean(merged.dashDetection),
    mediaNotifications: Boolean(merged.mediaNotifications),
    keepHistory: Boolean(merged.keepHistory),
    saveAsOnStart: Boolean(merged.saveAsOnStart),
  };
}

export async function getSettings(): Promise<AppSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(stored[SETTINGS_KEY] as Partial<AppSettings> | undefined);
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const next = normalizeSettings({ ...current, ...patch });
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export function watchSettings(callback: (settings: AppSettings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local' || !changes[SETTINGS_KEY]) return;
    callback(normalizeSettings(changes[SETTINGS_KEY].newValue as Partial<AppSettings> | undefined));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export async function getQueueState(): Promise<QueueState> {
  const stored = await chrome.storage.local.get(QUEUE_KEY);
  const value = stored[QUEUE_KEY] as QueueState | undefined;
  return {
    paused: Boolean(value?.paused),
    updatedAt: value?.updatedAt ?? DEFAULT_QUEUE_STATE.updatedAt,
  };
}

export async function setQueuePaused(paused: boolean): Promise<QueueState> {
  const state = { paused, updatedAt: Date.now() };
  await chrome.storage.local.set({ [QUEUE_KEY]: state });
  return state;
}

export function normalizeSchedule(input: Partial<Schedule>): Schedule | null {
  if (!input.id) return null;
  const action = input.action === 'pause-all' ? 'pause-all' : 'start-queue';
  const mode = input.mode === 'daily' ? 'daily' : 'once';
  if (!input.name?.trim()) return null;
  if (mode === 'once' && (!input.runAt || !Number.isFinite(input.runAt))) return null;
  if (mode === 'daily' && !/^\d{2}:\d{2}$/.test(input.time ?? '')) return null;
  return {
    id: input.id,
    name: input.name.trim().slice(0, 80),
    action,
    mode,
    runAt: mode === 'once' ? input.runAt : undefined,
    time: mode === 'daily' ? input.time : undefined,
    maxDownloads: clamp(Math.round(input.maxDownloads || 1), 1, 20),
    enabled: input.enabled !== false,
    createdAt: input.createdAt ?? Date.now(),
    lastRunAt: input.lastRunAt,
    nextRunAt: input.nextRunAt,
  };
}

export async function getSchedules(): Promise<Schedule[]> {
  const stored = await chrome.storage.local.get(SCHEDULES_KEY);
  const values = Array.isArray(stored[SCHEDULES_KEY]) ? (stored[SCHEDULES_KEY] as Partial<Schedule>[]) : [];
  return values
    .map(normalizeSchedule)
    .filter((schedule): schedule is Schedule => schedule !== null)
    .sort((a, b) => (a.nextRunAt ?? a.runAt ?? Number.MAX_SAFE_INTEGER) - (b.nextRunAt ?? b.runAt ?? Number.MAX_SAFE_INTEGER));
}

export async function saveSchedules(schedules: Schedule[]): Promise<void> {
  await chrome.storage.local.set({ [SCHEDULES_KEY]: schedules });
}
