import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/constants';
import type { DownloadRecord } from '../src/shared/types';
import {
  applyChromeItem,
  chromeStateToStatus,
  recordFromChromeItem,
  startStandardDownload,
} from '../src/engine/standard-engine';
import { installChromeMock, uninstallChromeMock, type ChromeMock } from './helpers/chrome-mock';
import { makeDownload } from './helpers/factories';

let mock: ChromeMock;

beforeEach(() => {
  mock = installChromeMock();
});

afterEach(() => {
  uninstallChromeMock();
});

function chromeItem(overrides: Partial<chrome.downloads.DownloadItem>): chrome.downloads.DownloadItem {
  return {
    id: 7,
    url: 'https://example.com/report.pdf',
    finalUrl: 'https://example.com/report.pdf',
    filename: 'C:\\Users\\Test\\Downloads\\report.pdf',
    mime: 'application/pdf',
    state: 'in_progress',
    paused: false,
    canResume: true,
    error: undefined,
    bytesReceived: 500,
    totalBytes: 1000,
    fileSize: 0,
    startTime: new Date(Date.now() - 1000).toISOString(),
    ...overrides,
  } as chrome.downloads.DownloadItem;
}

describe('Chrome download state mapping', () => {
  it('maps complete, paused, active and interrupted items honestly', () => {
    expect(chromeStateToStatus({ state: 'complete', paused: false, canResume: false })).toBe('completed');
    expect(chromeStateToStatus({ state: 'in_progress', paused: true, canResume: true })).toBe('paused');
    expect(chromeStateToStatus({ state: 'in_progress', paused: false, canResume: true })).toBe('downloading');
    expect(chromeStateToStatus({ state: 'interrupted', paused: false, canResume: true })).toBe('paused');
    expect(chromeStateToStatus({ state: 'interrupted', paused: false, canResume: false })).toBe('failed');
  });

  it('applies Chrome progress to a record', () => {
    const record = makeDownload({ status: 'downloading', downloadedBytes: 100, totalBytes: 1000 });
    const next = applyChromeItem(record, chromeItem({}));
    expect(next.status).toBe('downloading');
    expect(next.downloadedBytes).toBe(500);
    expect(next.totalBytes).toBe(1000);
    expect(next.chromeDownloadId).toBe(7);
    expect(next.filename).toBe('report.pdf');
    expect(next.outputPath).toContain('report.pdf');
  });

  it('marks completed items with the final file size', () => {
    const record = makeDownload({ status: 'downloading' });
    const next = applyChromeItem(
      record,
      chromeItem({
        state: 'complete',
        bytesReceived: 900,
        totalBytes: 0,
        fileSize: 900,
        endTime: new Date().toISOString(),
      }),
    );
    expect(next.status).toBe('completed');
    expect(next.downloadedBytes).toBe(900);
    expect(next.totalBytes).toBe(900);
    expect(next.canResume).toBe(false);
    expect(next.completedAt).toBeTypeOf('number');
  });

  it('records Chrome errors for failed items', () => {
    const next = applyChromeItem(
      makeDownload({ status: 'downloading' }),
      chromeItem({ state: 'interrupted', canResume: false, error: 'NETWORK_FAILED' }),
    );
    expect(next.status).toBe('failed');
    expect(next.error).toBe('NETWORK_FAILED');
    expect(next.errorCode).toBe('NETWORK_FAILED');
  });

  it('imports non-DownFlow Chrome history as a native record', () => {
    const record = recordFromChromeItem(
      chromeItem({
        state: 'complete',
        totalBytes: 1000,
        fileSize: 1000,
        bytesReceived: 1000,
        endTime: new Date().toISOString(),
        referrer: 'https://example.com/page',
      }),
    );
    expect(record).toMatchObject({
      source: 'chrome',
      kind: 'standard',
      status: 'completed',
      filename: 'report.pdf',
      sourceDomain: 'unknown',
      chromeDownloadId: 7,
      pageUrl: 'https://example.com/page',
    });
  });
});

describe('startStandardDownload', () => {
  it('sends a categorised path and conflict policy to the Downloads API', async () => {
    const id = await startStandardDownload(
      {
        url: 'https://example.com/report.pdf',
        filename: 'report.pdf',
        category: 'documents',
        duplicatePolicy: 'overwrite',
      },
      DEFAULT_SETTINGS,
    );
    expect(id).toBe(1);
    expect(mock.downloadRequests[0]).toMatchObject({
      url: 'https://example.com/report.pdf',
      filename: 'DownFlow/Documents/report.pdf',
      conflictAction: 'overwrite',
      saveAs: false,
    });
  });

  it('uses uniquify by default and supports ask-where-to-save', async () => {
    await startStandardDownload(
      {
        url: 'https://example.com/a.pdf',
        filename: 'a.pdf',
        category: 'documents',
        saveAs: true,
      },
      DEFAULT_SETTINGS,
    );
    expect(mock.downloadRequests[0]).toMatchObject({
      conflictAction: 'uniquify',
      saveAs: true,
    });
  });

  it('wraps Chrome failures in a useful message', async () => {
    (mock.chrome.downloads as unknown as { download: () => Promise<number> }).download = async () => {
      throw new Error('disk full');
    };
    await expect(
      startStandardDownload(
        { url: 'https://example.com/a.pdf', filename: 'a.pdf', category: 'documents' },
        DEFAULT_SETTINGS,
      ),
    ).rejects.toThrow(/Chrome could not start this download\. disk full/);
  });

  it('rejects a response without a numeric download id', async () => {
    (mock.chrome.downloads as unknown as { download: () => Promise<unknown> }).download = async () => undefined;
    await expect(
      startStandardDownload(
        { url: 'https://example.com/a.pdf', filename: 'a.pdf', category: 'documents' },
        DEFAULT_SETTINGS,
      ),
    ).rejects.toThrow(/did not return a download identifier/);
  });
});

describe('record helpers', () => {
  it('preserves existing progress when Chrome reports fewer bytes', () => {
    const record: DownloadRecord = makeDownload({ status: 'downloading', downloadedBytes: 700, totalBytes: 1000 });
    const next = applyChromeItem(record, chromeItem({ bytesReceived: 400 }));
    expect(next.downloadedBytes).toBe(700);
  });
});
