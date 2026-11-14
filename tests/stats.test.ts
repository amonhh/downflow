import { describe, expect, it } from 'vitest';
import { computeStats } from '../src/shared/stats';
import { makeDownload } from './helpers/factories';

const now = new Date(2026, 2, 15, 12, 0, 0, 0).getTime();
const day = 86_400_000;

describe('statistics from stored downloads', () => {
  it('derives counts, byte totals, categories and speed from real records', () => {
    const records = [
      makeDownload({
        id: 'complete-today',
        status: 'completed',
        totalBytes: 1000,
        downloadedBytes: 1000,
        category: 'documents',
        createdAt: now - 3_600_000,
        startedAt: now - 2000,
        completedAt: now,
        speedBps: 500,
      }),
      makeDownload({
        id: 'complete-old',
        status: 'completed',
        totalBytes: 500,
        downloadedBytes: 500,
        category: 'videos',
        createdAt: now - 2 * day,
        startedAt: now - 2 * day - 2000,
        completedAt: now - 2 * day,
        speedBps: 250,
      }),
      makeDownload({
        id: 'active',
        status: 'downloading',
        totalBytes: 4000,
        downloadedBytes: 1200,
        category: 'documents',
        speedBps: 100,
        createdAt: now - 60_000,
      }),
      makeDownload({
        id: 'failed',
        status: 'failed',
        totalBytes: 200,
        downloadedBytes: 50,
        category: 'documents',
        createdAt: now - 7_200_000,
      }),
      makeDownload({
        id: 'paused',
        status: 'paused',
        totalBytes: 300,
        downloadedBytes: 100,
        category: 'audio',
        createdAt: now - day,
      }),
      makeDownload({
        id: 'queued',
        status: 'queued',
        totalBytes: 0,
        downloadedBytes: 0,
        category: 'archives',
        createdAt: now - 2 * day,
      }),
    ];

    const stats = computeStats(records, now);
    expect(stats.totalDownloads).toBe(6);
    expect(stats.activeDownloads).toBe(1);
    expect(stats.completedDownloads).toBe(2);
    expect(stats.failedDownloads).toBe(1);
    expect(stats.pausedDownloads).toBe(1);
    expect(stats.queuedDownloads).toBe(1);
    expect(stats.totalDownloadedBytes).toBe(1500);
    expect(stats.speedBps).toBe(100);
    expect(stats.downloadsToday).toBe(3);
    expect(stats.downloadsThisWeek).toBe(6);
    expect(stats.downloadsThisMonth).toBe(6);
    expect(stats.largestFile).toEqual({ name: 'report.pdf', size: 1000 });
    expect(stats.mostCommonType).toEqual({ category: 'documents', count: 3 });
    expect(stats.categoryCounts).toMatchObject({
      documents: 3,
      videos: 1,
      audio: 1,
      archives: 1,
    });
    expect(stats.last7Days).toHaveLength(7);
    expect(stats.last7Days.at(-1)?.day).toBe('2026-03-15');
    expect(stats.last7Days.reduce((sum, entry) => sum + entry.count, 0)).toBe(6);
  });

  it('falls back to the average of completed speeds when timings are missing', () => {
    const stats = computeStats(
      [
        makeDownload({ status: 'completed', speedBps: 100, totalBytes: 10, downloadedBytes: 10 }),
        makeDownload({ status: 'completed', speedBps: 300, totalBytes: 20, downloadedBytes: 20 }),
      ],
      now,
    );
    expect(stats.averageSpeedBps).toBe(200);
  });

  it('returns zeros and empty structures for an empty history', () => {
    const stats = computeStats([], now);
    expect(stats.totalDownloads).toBe(0);
    expect(stats.averageSpeedBps).toBe(0);
    expect(stats.largestFile).toBeNull();
    expect(stats.mostCommonType).toBeNull();
    expect(stats.last7Days).toHaveLength(7);
    expect(stats.last7Days.every((entry) => entry.count === 0 && entry.bytes === 0)).toBe(true);
  });

  it('uses completion duration when available for average speed', () => {
    const stats = computeStats(
      [
        makeDownload({
          status: 'completed',
          totalBytes: 2_000,
          downloadedBytes: 2_000,
          startedAt: now - 2_000,
          completedAt: now,
        }),
      ],
      now,
    );
    expect(stats.averageSpeedBps).toBe(1000);
  });
});
