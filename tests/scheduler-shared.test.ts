import { describe, expect, it } from 'vitest';
import {
  computeNextDailyRun,
  computeNextRun,
  formatCountdown,
  parseDailyTime,
  scheduleIsDue,
} from '../src/shared/scheduler';
import { makeSchedule } from './helpers/factories';

describe('daily time parsing', () => {
  it('accepts 24-hour HH:MM values', () => {
    expect(parseDailyTime('00:00')).toEqual({ hours: 0, minutes: 0 });
    expect(parseDailyTime('23:59')).toEqual({ hours: 23, minutes: 59 });
  });

  it('rejects malformed or out-of-range values', () => {
    for (const value of ['2:05', '24:00', '12:60', '12', '', 'ab:cd']) {
      expect(parseDailyTime(value), value).toBeNull();
    }
  });
});

describe('next-run calculation', () => {
  const now = new Date(2026, 0, 15, 10, 30, 0, 0).getTime();

  it('schedules later today or tomorrow for daily jobs', () => {
    const later = new Date(computeNextDailyRun('11:45', now));
    expect(later.getDate()).toBe(15);
    expect(later.getHours()).toBe(11);
    expect(later.getMinutes()).toBe(45);

    const tomorrow = new Date(computeNextDailyRun('09:00', now));
    expect(tomorrow.getDate()).toBe(16);
    expect(tomorrow.getHours()).toBe(9);
  });

  it('rejects invalid daily times', () => {
    expect(() => computeNextDailyRun('99:99', now)).toThrow(/24-hour/);
  });

  it('honors enabled state and one-off times', () => {
    expect(computeNextRun(makeSchedule({ enabled: false }), now)).toBeNull();
    expect(computeNextRun(makeSchedule({ mode: 'daily', time: undefined }), now)).toBeNull();
    const future = now + 60_000;
    expect(computeNextRun(makeSchedule({ mode: 'once', runAt: future }), now)).toBe(future);
    expect(computeNextRun(makeSchedule({ mode: 'once', runAt: now - 1 }), now)).toBeNull();
  });
});

describe('due detection and countdown labels', () => {
  const now = new Date(2026, 0, 15, 10, 0, 0, 0).getTime();

  it('detects schedules within the alarm tolerance', () => {
    const due = makeSchedule({ mode: 'once', runAt: now + 500, enabled: true });
    expect(scheduleIsDue(due, now)).toBe(true);
    expect(scheduleIsDue(makeSchedule({ ...due, enabled: false }), now)).toBe(false);
    expect(scheduleIsDue(makeSchedule({ mode: 'once', runAt: now - 120_000 }), now)).toBe(false);
    expect(scheduleIsDue(makeSchedule({ mode: 'daily', nextRunAt: now - 30_000 }), now)).toBe(true);
    expect(scheduleIsDue(makeSchedule({ mode: 'daily', nextRunAt: undefined }), now)).toBe(false);
  });

  it('formats human-readable countdowns', () => {
    expect(formatCountdown(null, now)).toBe('Not scheduled');
    expect(formatCountdown(now - 1, now)).toBe('Due now');
    expect(formatCountdown(now + 30_000, now)).toBe('in 1 min');
    expect(formatCountdown(now + 90 * 60_000, now)).toBe('in 1h 30m');
    expect(formatCountdown(now + 3 * 86_400_000, now)).toBe('in 3 days');
  });
});
