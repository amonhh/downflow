import type { DownloadCoordinator } from './coordinator';
import type { Schedule, ScheduleInput } from '../shared/types';
import { computeNextRun } from '../shared/scheduler';
import { uuid } from '../shared/utilities';
import { getSchedules, normalizeSchedule, saveSchedules } from '../storage/settings-store';

export const SCHEDULE_ALARM_PREFIX = 'downflow:schedule:';

function alarmName(scheduleId: string): string {
  return `${SCHEDULE_ALARM_PREFIX}${scheduleId}`;
}

function validateWindow(schedule: Schedule, now = Date.now()): void {
  if (schedule.mode === 'once' && (!schedule.runAt || schedule.runAt <= now)) {
    throw new Error('Choose a start time in the future for a one-off schedule.');
  }
  if (schedule.mode === 'daily' && !schedule.time) {
    throw new Error('Choose a daily time in 24-hour HH:MM format.');
  }
}

export class Scheduler {
  constructor(private readonly coordinator: DownloadCoordinator) {}

  async list(): Promise<Schedule[]> {
    return getSchedules();
  }

  async create(input: ScheduleInput): Promise<Schedule> {
    const now = Date.now();
    const schedule = normalizeSchedule({
      ...input,
      id: uuid(),
      createdAt: now,
    });
    if (!schedule) throw new Error('Enter a schedule name, action and valid time.');
    validateWindow(schedule, now);
    schedule.nextRunAt = computeNextRun(schedule, now) ?? undefined;
    const schedules = await getSchedules();
    schedules.push(schedule);
    await saveSchedules(schedules);
    await this.arm(schedule);
    return schedule;
  }

  async update(id: string, patch: Partial<ScheduleInput>): Promise<Schedule> {
    const schedules = await getSchedules();
    const index = schedules.findIndex((schedule) => schedule.id === id);
    if (index < 0) throw new Error('Schedule not found.');
    const now = Date.now();
    const merged = normalizeSchedule({ ...schedules[index], ...patch, id });
    if (!merged) throw new Error('The schedule settings are not valid.');
    const changedTiming =
      merged.mode !== schedules[index].mode ||
      merged.runAt !== schedules[index].runAt ||
      merged.time !== schedules[index].time ||
      merged.enabled !== schedules[index].enabled;
    if (merged.enabled && changedTiming) validateWindow(merged, now);
    merged.createdAt = schedules[index].createdAt;
    merged.nextRunAt = merged.enabled ? computeNextRun(merged, now) ?? undefined : undefined;
    schedules[index] = merged;
    await saveSchedules(schedules);
    await this.arm(merged);
    return merged;
  }

  async delete(id: string): Promise<void> {
    const schedules = await getSchedules();
    const next = schedules.filter((schedule) => schedule.id !== id);
    await saveSchedules(next);
    await chrome.alarms.clear(alarmName(id)).catch(() => false);
  }

  async runNow(id: string): Promise<Schedule> {
    const schedules = await getSchedules();
    const schedule = schedules.find((item) => item.id === id);
    if (!schedule) throw new Error('Schedule not found.');
    await this.execute(schedule);
    return (await getSchedules()).find((item) => item.id === id) ?? schedule;
  }

  async handleAlarm(name: string): Promise<boolean> {
    if (!name.startsWith(SCHEDULE_ALARM_PREFIX)) return false;
    const id = name.slice(SCHEDULE_ALARM_PREFIX.length);
    const schedules = await getSchedules();
    const schedule = schedules.find((item) => item.id === id);
    if (!schedule || !schedule.enabled) return false;
    await this.execute(schedule);
    return true;
  }

  async resync(): Promise<void> {
    const schedules = await getSchedules();
    const now = Date.now();
    let changed = false;
    const next = schedules.map((schedule) => {
      if (!schedule.enabled) return schedule;
      if (schedule.mode === 'once') {
        if (!schedule.runAt || schedule.runAt <= now) {
          changed = true;
          return { ...schedule, enabled: false, nextRunAt: undefined };
        }
        const nextRunAt = schedule.nextRunAt && schedule.nextRunAt > now ? schedule.nextRunAt : schedule.runAt;
        if (nextRunAt !== schedule.nextRunAt) changed = true;
        return { ...schedule, nextRunAt };
      }
      const nextRunAt = schedule.nextRunAt && schedule.nextRunAt > now ? schedule.nextRunAt : computeNextRun(schedule, now) ?? undefined;
      if (nextRunAt !== schedule.nextRunAt) changed = true;
      return { ...schedule, nextRunAt };
    });
    if (changed) await saveSchedules(next);

    const alarms = await chrome.alarms.getAll().catch(() => []);
    const valid = new Set(next.filter((schedule) => schedule.enabled && schedule.nextRunAt).map((schedule) => alarmName(schedule.id)));
    for (const alarm of alarms) {
      if (alarm.name.startsWith(SCHEDULE_ALARM_PREFIX) && !valid.has(alarm.name)) {
        await chrome.alarms.clear(alarm.name).catch(() => false);
      }
    }
    for (const schedule of next) {
      if (schedule.enabled && schedule.nextRunAt) await this.arm(schedule);
    }
  }

  private async arm(schedule: Schedule): Promise<void> {
    const name = alarmName(schedule.id);
    await chrome.alarms.clear(name).catch(() => false);
    if (!schedule.enabled || !schedule.nextRunAt) return;
    await chrome.alarms.create(name, { when: Math.max(Date.now() + 1000, schedule.nextRunAt) });
  }

  private async execute(schedule: Schedule): Promise<void> {
    if (schedule.action === 'start-queue') {
      await this.coordinator.startQueue(schedule.maxDownloads);
    } else {
      await this.coordinator.stopQueue();
    }
    const now = Date.now();
    const schedules = await getSchedules();
    const index = schedules.findIndex((item) => item.id === schedule.id);
    if (index < 0) return;
    const current = schedules[index];
    const updated: Schedule = {
      ...current,
      lastRunAt: now,
    };
    if (current.mode === 'once') {
      updated.enabled = false;
      updated.nextRunAt = undefined;
    } else {
      updated.nextRunAt = current.enabled ? computeNextRun(current, now) ?? undefined : undefined;
    }
    schedules[index] = updated;
    await saveSchedules(schedules);
    await this.arm(updated);
  }
}
