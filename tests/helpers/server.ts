import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Socket } from 'node:net';

export interface MockServer {
  url: string;
  close: () => Promise<void>;
}

export async function startServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<MockServer> {
  const server = createServer(handler);
  const sockets = new Set<Socket>();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        // Test clients may keep connections alive; destroy them so hook cleanup
        // never dominates or times out the suite.
        server.closeAllConnections();
        for (const socket of sockets) socket.destroy();
      }),
  };
}

export interface RangeServerOptions {
  supportRanges?: boolean;
  contentType?: string;
  headers?: Record<string, string>;
  onRequest?: (request: IncomingMessage) => void;
}

/**
 * Serves an in-memory payload with real HTTP Range semantics (206 +
 * Content-Range) or deliberately ignores Range when supportRanges is false.
 */
export async function startRangeServer(payload: Buffer, options: RangeServerOptions = {}): Promise<MockServer> {
  return startServer((request, response) => {
    options.onRequest?.(request);
    const rangeHeader = request.headers.range;
    const baseHeaders: Record<string, string> = {
      'Content-Type': options.contentType ?? 'application/octet-stream',
      'Accept-Ranges': options.supportRanges === false ? 'none' : 'bytes',
      ...options.headers,
    };

    if (options.supportRanges !== false && rangeHeader) {
      const match = /^bytes=(\d+)-(\d+)$/i.exec(rangeHeader);
      if (match) {
        const start = Number(match[1]);
        const end = Math.min(Number(match[2]), payload.length - 1);
        if (start > end || start >= payload.length) {
          response.writeHead(416, { 'Content-Range': `bytes */${payload.length}` });
          response.end();
          return;
        }
        const chunk = payload.subarray(start, end + 1);
        response.writeHead(206, {
          ...baseHeaders,
          'Content-Range': `bytes ${start}-${end}/${payload.length}`,
          'Content-Length': String(chunk.length),
        });
        response.end(chunk);
        return;
      }
    }

    response.writeHead(200, {
      ...baseHeaders,
      'Content-Length': String(payload.length),
    });
    response.end(payload);
  });
}
