import type { Schedule } from './types';

export function parseDailyTime(value: string): { hours: number; minutes: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

export function computeNextDailyRun(time: string, now = Date.now()): number {
  const parsed = parseDailyTime(time);
  if (!parsed) throw new Error('Time must use the 24-hour HH:MM format.');
  const next = new Date(now);
  next.setHours(parsed.hours, parsed.minutes, 0, 0);
  if (next.getTime() <= now) next.setDate(next.getDate() + 1);
  return next.getTime();
}

export function computeNextRun(schedule: Schedule, now = Date.now()): number | null {
  if (!schedule.enabled) return null;
  if (schedule.mode === 'daily') {
    if (!schedule.time) return null;
    return computeNextDailyRun(schedule.time, now);
  }
  if (!schedule.runAt) return null;
  return schedule.runAt > now ? schedule.runAt : null;
}

export function scheduleIsDue(schedule: Schedule, now = Date.now(), toleranceMs = 60_000): boolean {
  if (!schedule.enabled) return false;
  const target = schedule.mode === 'daily' ? schedule.nextRunAt : schedule.runAt;
  if (!target) return false;
  return target <= now + 1000 && target >= now - toleranceMs;
}

export function formatCountdown(target: number | undefined | null, now = Date.now()): string {
  if (!target) return 'Not scheduled';
  const diff = target - now;
  if (diff <= 0) return 'Due now';
  const minutes = Math.ceil(diff / 60_000);
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `in ${hours}h ${minutes % 60}m`;
  return `in ${Math.ceil(hours / 24)} days`;
}
