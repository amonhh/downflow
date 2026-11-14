import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/constants';
import {
  getQueueState,
  getSchedules,
  getSettings,
  normalizeSchedule,
  normalizeSettings,
  saveSchedules,
  setQueuePaused,
  updateSettings,
  watchSettings,
} from '../src/storage/settings-store';
import { installChromeMock, uninstallChromeMock } from './helpers/chrome-mock';
import { makeSchedule } from './helpers/factories';

beforeEach(() => {
  installChromeMock();
});

afterEach(() => {
  uninstallChromeMock();
});

describe('settings normalization', () => {
  it('returns safe defaults when nothing is stored', async () => {
    const settings = await getSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps numeric ranges and normalizes folders and enums', () => {
    const settings = normalizeSettings({
      theme: 'neon' as never,
      defaultFolder: '..\\..\\Unsafe//Folder',
      maxConcurrent: 99,
      segmentCount: 1,
      maxConnections: 0,
      maxRetries: 99,
      bandwidthLimitBps: -5,
      perDownloadLimitBps: 1234.6,
      memoryLimitMb: 10,
      duplicatePolicy: 'invalid' as never,
      categoryFolders: { documents: '..\\Docs: 2026', videos: '' } as never,
    });
    expect(settings.theme).toBe('dark');
    expect(settings.defaultFolder).toBe('Unsafe/Folder');
    expect(settings.maxConcurrent).toBe(20);
    expect(settings.segmentCount).toBe(2);
    expect(settings.maxConnections).toBe(1);
    expect(settings.maxRetries).toBe(10);
    expect(settings.bandwidthLimitBps).toBe(0);
    expect(settings.perDownloadLimitBps).toBe(1235);
    expect(settings.memoryLimitMb).toBe(64);
    expect(settings.duplicatePolicy).toBe('uniquify');
    expect(settings.categoryFolders.documents).toBe('Docs_ 2026');
    expect(settings.categoryFolders.videos).toBe('Videos');
  });

  it('persists updates and notifies settings watchers', async () => {
    const watcher = vi.fn();
    const unwatch = watchSettings(watcher);
    const updated = await updateSettings({ maxConcurrent: 5, theme: 'light' });
    expect(updated.maxConcurrent).toBe(5);
    expect(updated.theme).toBe('light');
    expect((await getSettings()).maxConcurrent).toBe(5);
    expect(watcher).toHaveBeenCalled();
    expect(watcher.mock.calls.at(-1)?.[0]).toMatchObject({ maxConcurrent: 5, theme: 'light' });
    unwatch();
  });
});

describe('queue state', () => {
  it('defaults to running and persists pause/resume', async () => {
    expect(await getQueueState()).toMatchObject({ paused: false });
    const paused = await setQueuePaused(true);
    expect(paused.paused).toBe(true);
    expect(paused.updatedAt).toBeGreaterThan(0);
    expect(await getQueueState()).toMatchObject({ paused: true });
    await setQueuePaused(false);
    expect(await getQueueState()).toMatchObject({ paused: false });
  });
});

describe('schedule persistence', () => {
  it('rejects schedules that are missing required fields', () => {
    expect(normalizeSchedule({})).toBeNull();
    expect(normalizeSchedule({ id: 'x', name: '', mode: 'daily', time: '01:00' })).toBeNull();
    expect(normalizeSchedule({ id: 'x', name: 'One off', mode: 'once' })).toBeNull();
    expect(normalizeSchedule({ id: 'x', name: 'Daily', mode: 'daily', time: '9:00' })).toBeNull();
  });

  it('normalizes valid schedules and clamps the download count', () => {
    const schedule = normalizeSchedule({
      id: 's1',
      name: '  Nightly  ',
      action: 'pause-all',
      mode: 'daily',
      time: '03:15',
      maxDownloads: 99,
      enabled: false,
    });
    expect(schedule).toMatchObject({
      id: 's1',
      name: 'Nightly',
      action: 'pause-all',
      mode: 'daily',
      time: '03:15',
      maxDownloads: 20,
      enabled: false,
    });
    expect(schedule?.runAt).toBeUndefined();
  });

  it('saves, filters invalid rows and sorts by next run', async () => {
    await saveSchedules([
      makeSchedule({ id: 'later', nextRunAt: 5000 }),
      makeSchedule({ id: 'sooner', nextRunAt: 1000 }),
      { id: 'invalid', name: '', mode: 'daily', action: 'start-queue', maxDownloads: 1, enabled: true, createdAt: 1 },
    ] as never);
    expect((await getSchedules()).map((schedule) => schedule.id)).toEqual(['sooner', 'later']);
  });
});
