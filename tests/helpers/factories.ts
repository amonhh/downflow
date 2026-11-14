import type { DownloadRecord, MediaResource, Schedule } from '../../src/shared/types';

export function makeDownload(overrides: Partial<DownloadRecord> = {}): DownloadRecord {
  const now = Date.now();
  return {
    id: `test-${Math.random().toString(36).slice(2)}`,
    url: 'https://example.com/files/report.pdf',
    filename: 'report.pdf',
    mime: 'application/pdf',
    category: 'documents',
    sourceDomain: 'example.com',
    status: 'completed',
    kind: 'standard',
    source: 'dashboard',
    totalBytes: 1024,
    downloadedBytes: 1024,
    speedBps: 0,
    etaSeconds: null,
    createdAt: now,
    updatedAt: now,
    canResume: false,
    segments: [],
    segmentCount: 1,
    priority: 0,
    queueOrder: 0,
    attempts: 0,
    maxAttempts: 3,
    bandwidthLimitBps: 0,
    ...overrides,
  };
}

export function makeMedia(overrides: Partial<MediaResource> = {}): MediaResource {
  const now = Date.now();
  return {
    id: `media-${Math.random().toString(36).slice(2)}`,
    url: 'https://example.com/video.mp4',
    pageUrl: 'https://example.com/watch',
    sourceDomain: 'example.com',
    kind: 'video',
    mime: 'video/mp4',
    title: 'Example video',
    size: 1024,
    discoveredAt: now,
    updatedAt: now,
    protected: false,
    ...overrides,
  };
}

export function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: `schedule-${Math.random().toString(36).slice(2)}`,
    name: 'Nightly queue',
    action: 'start-queue',
    mode: 'daily',
    time: '02:00',
    maxDownloads: 3,
    enabled: true,
    createdAt: Date.now(),
    ...overrides,
  };
}
