import type { DownloadRecord, FileCategory, StatsSummary } from './types';
import { localDayKey } from './utilities';

const EMPTY_CATEGORIES: Record<FileCategory, number> = {
  documents: 0,
  videos: 0,
  audio: 0,
  images: 0,
  archives: 0,
  software: 0,
  other: 0,
};

export function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function computeStats(records: DownloadRecord[], now = Date.now()): StatsSummary {
  const startToday = startOfLocalDay(now);
  const startWeek = startToday - 6 * 86_400_000;
  const date = new Date(now);
  const startMonth = new Date(date.getFullYear(), date.getMonth(), 1).getTime();

  const categoryCounts = { ...EMPTY_CATEGORIES };
  let completedDownloads = 0;
  let failedDownloads = 0;
  let pausedDownloads = 0;
  let queuedDownloads = 0;
  let activeDownloads = 0;
  let totalDownloadedBytes = 0;
  let speedBps = 0;
  let completedDurationMs = 0;
  let completedBytesForSpeed = 0;
  let largestFile: StatsSummary['largestFile'] = null;

  for (const record of records) {
    categoryCounts[record.category] += 1;
    if (record.status === 'downloading' || record.status === 'probing' || record.status === 'delivering') {
      activeDownloads += 1;
      speedBps += Math.max(0, record.speedBps);
    } else if (record.status === 'completed') {
      completedDownloads += 1;
      totalDownloadedBytes += record.totalBytes > 0 ? record.totalBytes : record.downloadedBytes;
      if (!largestFile || record.totalBytes > largestFile.size) {
        largestFile = { name: record.filename, size: record.totalBytes > 0 ? record.totalBytes : record.downloadedBytes };
      }
      if (record.startedAt && record.completedAt && record.completedAt > record.startedAt) {
        completedDurationMs += record.completedAt - record.startedAt;
        completedBytesForSpeed += record.totalBytes > 0 ? record.totalBytes : record.downloadedBytes;
      }
    } else if (record.status === 'failed' || record.status === 'cancelled') {
      failedDownloads += 1;
    } else if (record.status === 'paused') {
      pausedDownloads += 1;
    } else if (record.status === 'queued') {
      queuedDownloads += 1;
    }
  }

  const averageSpeedBps =
    completedDurationMs > 0
      ? (completedBytesForSpeed * 1000) / completedDurationMs
      : (() => {
          const samples = records.filter((r) => r.status === 'completed' && r.speedBps > 0);
          return samples.length ? samples.reduce((sum, r) => sum + r.speedBps, 0) / samples.length : 0;
        })();

  let mostCommonType: StatsSummary['mostCommonType'] = null;
  for (const [category, count] of Object.entries(categoryCounts) as Array<[FileCategory, number]>) {
    if (count > 0 && (!mostCommonType || count > mostCommonType.count)) {
      mostCommonType = { category, count };
    }
  }

  const last7Days = Array.from({ length: 7 }, (_, index) => {
    const dayStart = startToday - (6 - index) * 86_400_000;
    return { day: localDayKey(dayStart), count: 0, bytes: 0 };
  });
  const dayMap = new Map(last7Days.map((day) => [day.day, day]));
  for (const record of records) {
    const day = dayMap.get(localDayKey(record.createdAt));
    if (day) {
      day.count += 1;
      day.bytes += record.downloadedBytes;
    }
  }

  return {
    totalDownloads: records.length,
    activeDownloads,
    completedDownloads,
    failedDownloads,
    pausedDownloads,
    queuedDownloads,
    totalDownloadedBytes,
    speedBps,
    downloadsToday: records.filter((record) => record.createdAt >= startToday).length,
    downloadsThisWeek: records.filter((record) => record.createdAt >= startWeek).length,
    downloadsThisMonth: records.filter((record) => record.createdAt >= startMonth).length,
    averageSpeedBps,
    largestFile,
    mostCommonType,
    categoryCounts,
    last7Days,
  };
}
