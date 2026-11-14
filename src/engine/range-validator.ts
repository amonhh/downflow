import type { ProbeResult } from '../shared/types';
import { filenameFromUrl, parseContentDisposition } from '../shared/utilities';
import { AuthorizationError, DownFlowEngineError, RangeUnsupportedError } from './engine-errors';

export interface ContentRange {
  start: number;
  end: number;
  total: number | null;
}

export function parseContentRange(header: string | null): ContentRange | null {
  if (!header) return null;
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(header.trim());
  if (!match) {
    const unsatisfied = /^bytes\s+\*\/(\d+)$/i.exec(header.trim());
    if (unsatisfied) return { start: 0, end: 0, total: Number(unsatisfied[1]) };
    return null;
  }
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = match[3] === '*' ? null : Number(match[3]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) return null;
  if (total !== null && (!Number.isSafeInteger(total) || total <= 0 || end >= total)) return null;
  return { start, end, total };
}

export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}

export function validateSegmentResponse(
  response: Response,
  expected: { start: number; end: number; total: number },
): ContentRange {
  if (response.status === 401 || response.status === 403) {
    throw new AuthorizationError();
  }
  if (response.status === 429) {
    throw new DownFlowEngineError('The server is rate-limiting requests. DownFlow will wait and retry.', {
      code: 'RATE_LIMITED',
      retryable: true,
      retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
    });
  }
  if (response.status === 416) {
    throw new DownFlowEngineError('The server rejected the requested byte range. The file may have changed.', {
      code: 'RANGE_NOT_SATISFIABLE',
      retryable: false,
    });
  }
  if (response.status === 200) {
    throw new RangeUnsupportedError('The server returned HTTP 200 instead of partial content (HTTP 206).');
  }
  if (response.status < 200 || response.status >= 300) {
    throw new DownFlowEngineError(`The server returned HTTP ${response.status}.`, {
      code: `HTTP_${response.status}`,
      retryable: response.status >= 500,
    });
  }
  const range = parseContentRange(response.headers.get('content-range'));
  if (!range) {
    throw new DownFlowEngineError('The server returned a missing or malformed Content-Range header.', {
      code: 'INVALID_CONTENT_RANGE',
      retryable: false,
    });
  }
  if (range.start !== expected.start || range.end !== expected.end) {
    throw new DownFlowEngineError(
      `The server returned bytes ${range.start}-${range.end}, but ${expected.start}-${expected.end} was requested.`,
      { code: 'CONTENT_RANGE_MISMATCH', retryable: false },
    );
  }
  if (range.total !== null && range.total !== expected.total) {
    throw new DownFlowEngineError(
      `The remote file size changed (expected ${expected.total} bytes, server reports ${range.total}).`,
      { code: 'REMOTE_SIZE_CHANGED', retryable: false },
    );
  }
  return range;
}

export async function probeRangeSupport(
  url: string,
  options: { pageUrl?: string; referer?: string } = {},
): Promise<ProbeResult> {
  const headers: Record<string, string> = {
    Range: 'bytes=0-0',
    Accept: '*/*',
  };
  if (options.referer) headers.Referer = options.referer;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers,
      credentials: 'include',
      redirect: 'follow',
      cache: 'no-store',
    });
  } catch (error) {
    throw new DownFlowEngineError(
      `Could not reach the server. ${error instanceof Error ? error.message : ''}`.trim(),
      { code: 'NETWORK_ERROR', retryable: true },
    );
  }

  const finalUrl = response.url || url;
  const mime = response.headers.get('content-type')?.split(';')[0]?.trim() || '';
  const disposition = parseContentDisposition(response.headers.get('content-disposition'));
  const fallbackFilename = filenameFromUrl(finalUrl);
  const acceptRangesHeader = response.headers.get('accept-ranges')?.toLowerCase() ?? '';

  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel().catch(() => undefined);
    throw new AuthorizationError();
  }

  if (response.status === 206) {
    const range = parseContentRange(response.headers.get('content-range'));
    await response.body?.cancel().catch(() => undefined);
    if (!range || range.total === null || range.total <= 0) {
      return {
        supported: false,
        status: 206,
        totalBytes: 0,
        acceptRanges: true,
        finalUrl,
        mime,
        filename: disposition ?? fallbackFilename,
        contentDispositionFilename: disposition,
        reason: 'The server did not provide a trustworthy total size in Content-Range.',
      };
    }
    if (range.start !== 0 || range.end !== 0) {
      return {
        supported: false,
        status: 206,
        totalBytes: range.total,
        acceptRanges: true,
        finalUrl,
        mime,
        filename: disposition ?? fallbackFilename,
        contentDispositionFilename: disposition,
        reason: 'The server returned an unexpected initial byte range.',
      };
    }
    return {
      supported: true,
      status: 206,
      totalBytes: range.total,
      acceptRanges: true,
      finalUrl,
      mime,
      filename: disposition ?? fallbackFilename,
      contentDispositionFilename: disposition,
      etag: response.headers.get('etag') ?? undefined,
      lastModified: response.headers.get('last-modified') ?? undefined,
    };
  }

  const contentLength = Number(response.headers.get('content-length') ?? 0);
  await response.body?.cancel().catch(() => undefined);
  return {
    supported: false,
    status: response.status,
    totalBytes: Number.isFinite(contentLength) && contentLength > 0 ? contentLength : 0,
    acceptRanges: acceptRangesHeader.includes('bytes'),
    finalUrl,
    mime,
    filename: disposition ?? fallbackFilename,
    contentDispositionFilename: disposition,
    etag: response.headers.get('etag') ?? undefined,
    lastModified: response.headers.get('last-modified') ?? undefined,
    reason:
      response.status === 200
        ? acceptRangesHeader.includes('bytes')
          ? 'The server advertises Range support but ignored the Range request.'
          : 'The server does not support HTTP Range requests.'
        : `The server returned HTTP ${response.status}.`,
  };
}
