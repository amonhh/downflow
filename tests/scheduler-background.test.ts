import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DownloadCoordinator } from '../src/background/coordinator';
import { Scheduler } from '../src/background/scheduler';
import { getSchedules } from '../src/storage/settings-store';
import { installChromeMock, uninstallChromeMock, type ChromeMock } from './helpers/chrome-mock';

let mock: ChromeMock;
let coordinator: { startQueue: ReturnType<typeof vi.fn>; stopQueue: ReturnType<typeof vi.fn> };
let scheduler: Scheduler;

beforeEach(() => {
  mock = installChromeMock();
  coordinator = {
    startQueue: vi.fn(async () => undefined),
    stopQueue: vi.fn(async () => undefined),
  };
  scheduler = new Scheduler(coordinator as unknown as DownloadCoordinator);
});

afterEach(() => {
  uninstallChromeMock();
});

describe('scheduler CRUD and alarms', () => {
  it('creates a daily schedule, stores it and arms a Chrome alarm', async () => {
    const schedule = await scheduler.create({
      name: 'Nightly queue',
      action: 'start-queue',
      mode: 'daily',
      time: '23:59',
      maxDownloads: 4,
      enabled: true,
    });

    expect(schedule.nextRunAt).toBeGreaterThan(Date.now());
    expect(await scheduler.list()).toHaveLength(1);
    expect(mock.alarms.has(`downflow:schedule:${schedule.id}`)).toBe(true);
  });

  it('validates one-off times before saving', async () => {
    await expect(
      scheduler.create({
        name: 'Past',
        action: 'start-queue',
        mode: 'once',
        runAt: Date.now() - 1000,
        maxDownloads: 1,
        enabled: true,
      }),
    ).rejects.toThrow(/future/);
    expect(await getSchedules()).toEqual([]);
  });

  it('runs a one-off schedule now, records the run and disarms it', async () => {
    const schedule = await scheduler.create({
      name: 'One-off',
      action: 'start-queue',
      mode: 'once',
      runAt: Date.now() + 120_000,
      maxDownloads: 2,
      enabled: true,
    });

    const updated = await scheduler.runNow(schedule.id);
    expect(coordinator.startQueue).toHaveBeenCalledWith(2);
    expect(updated.lastRunAt).toBeTypeOf('number');
    expect(updated.enabled).toBe(false);
    expect(updated.nextRunAt).toBeUndefined();
    expect(mock.alarms.has(`downflow:schedule:${schedule.id}`)).toBe(false);
  });

  it('executes pause-all schedules through the coordinator', async () => {
    const schedule = await scheduler.create({
      name: 'Pause at night',
      action: 'pause-all',
      mode: 'daily',
      time: '23:59',
      maxDownloads: 1,
      enabled: true,
    });
    await scheduler.runNow(schedule.id);
    expect(coordinator.stopQueue).toHaveBeenCalledTimes(1);
  });

  it('handles only its own alarm names', async () => {
    expect(await scheduler.handleAlarm('unrelated-alarm')).toBe(false);
    const schedule = await scheduler.create({
      name: 'Alarm job',
      action: 'start-queue',
      mode: 'daily',
      time: '23:59',
      maxDownloads: 1,
      enabled: true,
    });
    expect(await scheduler.handleAlarm(`downflow:schedule:${schedule.id}`)).toBe(true);
    expect(coordinator.startQueue).toHaveBeenCalled();
  });

  it('updates, disables and deletes schedules', async () => {
    const schedule = await scheduler.create({
      name: 'Mutable',
      action: 'start-queue',
      mode: 'daily',
      time: '23:59',
      maxDownloads: 1,
      enabled: true,
    });

    const disabled = await scheduler.update(schedule.id, { enabled: false, maxDownloads: 5 });
    expect(disabled.enabled).toBe(false);
    expect(disabled.maxDownloads).toBe(5);
    expect(mock.alarms.has(`downflow:schedule:${schedule.id}`)).toBe(false);

    await scheduler.delete(schedule.id);
    expect(await getSchedules()).toEqual([]);
    expect(mock.alarms.has(`downflow:schedule:${schedule.id}`)).toBe(false);
  });

  it('disables expired one-off jobs and clears stale alarms on resync', async () => {
    await mock.chrome.alarms.create('downflow:schedule:ghost', { when: 1 });
    const expired = {
      id: 'expired',
      name: 'Expired',
      action: 'start-queue' as const,
      mode: 'once' as const,
      runAt: Date.now() - 60_000,
      maxDownloads: 1,
      enabled: true,
      createdAt: Date.now() - 120_000,
    };
    const daily = {
      id: 'daily',
      name: 'Daily',
      action: 'start-queue' as const,
      mode: 'daily' as const,
      time: '23:59',
      maxDownloads: 1,
      enabled: true,
      createdAt: Date.now(),
    };
    await mock.chrome.storage.local.set({ 'downflow.schedules': [expired, daily] });

    await scheduler.resync();
    const schedules = await getSchedules();
    expect(schedules.find((schedule) => schedule.id === 'expired')?.enabled).toBe(false);
    expect(schedules.find((schedule) => schedule.id === 'daily')?.nextRunAt).toBeGreaterThan(Date.now());
    expect(mock.alarms.has('downflow:schedule:ghost')).toBe(false);
    expect(mock.alarms.has('downflow:schedule:daily')).toBe(true);
  });
});
