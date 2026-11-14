import { afterEach, describe, expect, it } from 'vitest';
import {
  parseContentRange,
  parseRetryAfter,
  probeRangeSupport,
  validateSegmentResponse,
} from '../src/engine/range-validator';
import { AuthorizationError, DownFlowEngineError, RangeUnsupportedError } from '../src/engine/engine-errors';
import { startRangeServer, startServer, type MockServer } from './helpers/server';

const servers: MockServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function rangeResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

describe('Content-Range parsing', () => {
  it('parses complete and open-ended ranges', () => {
    expect(parseContentRange('bytes 0-0/100')).toEqual({ start: 0, end: 0, total: 100 });
    expect(parseContentRange('bytes 100-199/*')).toEqual({ start: 100, end: 199, total: null });
    expect(parseContentRange('bytes */500')).toEqual({ start: 0, end: 0, total: 500 });
  });

  it('rejects malformed, inverted and out-of-bounds ranges', () => {
    expect(parseContentRange(null)).toBeNull();
    expect(parseContentRange('bytes 10-5/100')).toBeNull();
    expect(parseContentRange('bytes 0-100/100')).toBeNull();
    expect(parseContentRange('items 0-1/10')).toBeNull();
    expect(parseContentRange('bytes 0-1/0')).toBeNull();
  });

  it('parses Retry-After seconds and HTTP dates', () => {
    expect(parseRetryAfter('5')).toBe(5000);
    expect(parseRetryAfter(null)).toBeUndefined();
    const date = new Date(Date.now() + 5000).toUTCString();
    expect(parseRetryAfter(date)).toBeGreaterThan(3000);
    expect(parseRetryAfter('nonsense')).toBeUndefined();
  });
});

describe('segment response validation', () => {
  const expected = { start: 0, end: 9, total: 100 };

  it('accepts matching 206 responses', () => {
    const range = validateSegmentResponse(
      rangeResponse(206, { 'content-range': 'bytes 0-9/100' }),
      expected,
    );
    expect(range).toEqual({ start: 0, end: 9, total: 100 });
  });

  it('classifies authentication and range failures', () => {
    expect(() => validateSegmentResponse(rangeResponse(403), expected)).toThrow(AuthorizationError);
    expect(() => validateSegmentResponse(rangeResponse(416), expected)).toThrow(/rejected the requested byte range/);
    expect(() => validateSegmentResponse(rangeResponse(200), expected)).toThrow(RangeUnsupportedError);
  });

  it('marks rate limits and server errors as retryable', () => {
    try {
      validateSegmentResponse(rangeResponse(429, { 'retry-after': '2' }), expected);
      throw new Error('expected a rate-limit error');
    } catch (error) {
      expect(error).toBeInstanceOf(DownFlowEngineError);
      expect((error as DownFlowEngineError).code).toBe('RATE_LIMITED');
      expect((error as DownFlowEngineError).retryable).toBe(true);
      expect((error as DownFlowEngineError).retryAfterMs).toBe(2000);
    }

    try {
      validateSegmentResponse(rangeResponse(503), expected);
      throw new Error('expected an HTTP error');
    } catch (error) {
      expect((error as DownFlowEngineError).code).toBe('HTTP_503');
      expect((error as DownFlowEngineError).retryable).toBe(true);
    }
  });

  it('detects missing, mismatched and changed ranges', () => {
    expect(() => validateSegmentResponse(rangeResponse(206), expected)).toThrow(/malformed Content-Range/);
    expect(() =>
      validateSegmentResponse(rangeResponse(206, { 'content-range': 'bytes 1-10/100' }), expected),
    ).toThrow(/bytes 1-10/);
    expect(() =>
      validateSegmentResponse(rangeResponse(206, { 'content-range': 'bytes 0-9/101' }), expected),
    ).toThrow(/size changed/);
  });
});

describe('Range probing over real HTTP', () => {
  it('accepts a correctly supported range and reads metadata', async () => {
    const payload = Buffer.from('hello world');
    const server = await startRangeServer(payload, {
      contentType: 'application/pdf',
      headers: {
        'Content-Disposition': 'attachment; filename="report.pdf"',
        ETag: '"abc123"',
        'Last-Modified': 'Wed, 21 Oct 2026 07:28:00 GMT',
      },
    });
    servers.push(server);

    const probe = await probeRangeSupport(`${server.url}/download.bin`);
    expect(probe.supported).toBe(true);
    expect(probe.status).toBe(206);
    expect(probe.totalBytes).toBe(payload.length);
    expect(probe.acceptRanges).toBe(true);
    expect(probe.filename).toBe('report.pdf');
    expect(probe.mime).toBe('application/pdf');
    expect(probe.etag).toBe('"abc123"');
    expect(probe.lastModified).toContain('21 Oct 2026');
  });

  it('reports honest fallback details when Range is ignored', async () => {
    const server = await startRangeServer(Buffer.from('0123456789'), { supportRanges: false });
    servers.push(server);

    const probe = await probeRangeSupport(`${server.url}/plain.bin`);
    expect(probe.supported).toBe(false);
    expect(probe.status).toBe(200);
    expect(probe.totalBytes).toBe(10);
    expect(probe.acceptRanges).toBe(false);
    expect(probe.reason).toMatch(/does not support HTTP Range/);
  });

  it('reports a fallback when the server advertises but ignores Range', async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(200, { 'Content-Length': '10', 'Accept-Ranges': 'bytes' });
      response.end('0123456789');
    });
    servers.push(server);

    const probe = await probeRangeSupport(`${server.url}/mixed.bin`);
    expect(probe.supported).toBe(false);
    expect(probe.acceptRanges).toBe(true);
    expect(probe.reason).toMatch(/advertises Range support/);
  });

  it('rejects untrustworthy Content-Range totals', async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(206, { 'Content-Range': 'bytes 0-0/*', 'Content-Length': '1' });
      response.end('x');
    });
    servers.push(server);

    const probe = await probeRangeSupport(`${server.url}/unknown.bin`);
    expect(probe.supported).toBe(false);
    expect(probe.reason).toMatch(/trustworthy total size/);
  });

  it('surfaces authentication failures', async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(403);
      response.end();
    });
    servers.push(server);
    await expect(probeRangeSupport(`${server.url}/private.bin`)).rejects.toBeInstanceOf(AuthorizationError);
  });
});
