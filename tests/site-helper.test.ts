import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Message = { requestId?: number; type?: string; [key: string]: unknown };

class FakePort {
  posted: Message[] = [];
  disconnected = false;
  messageListeners: Array<(message: Message) => void> = [];
  disconnectListeners: Array<() => void> = [];
  onMessage = {
    addListener: (listener: (message: Message) => void) => {
      this.messageListeners.push(listener);
    },
  };
  onDisconnect = {
    addListener: (listener: () => void) => {
      this.disconnectListeners.push(listener);
    },
  };
  postMessage(message: Message): void {
    this.posted.push(message);
  }
  disconnect(): void {
    this.disconnected = true;
  }
  reply(requestId: number | undefined, data: unknown): void {
    for (const listener of this.messageListeners) listener({ requestId, ok: true, data });
  }
  fireDisconnect(): void {
    for (const listener of this.disconnectListeners) listener();
  }
}

function installNativeMock(): FakePort[] {
  const ports: FakePort[] = [];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      lastError: undefined,
      connectNative: () => {
        const port = new FakePort();
        ports.push(port);
        return port;
      },
    },
  };
  return ports;
}

describe('site helper connection lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects requests when the connection is reset so their timers cannot kill a newer port', async () => {
    const ports = installNativeMock();
    const helper = await import('../src/background/site-helper');

    const first = helper.getNativeSiteJobs(['a']);
    expect(ports).toHaveLength(1);
    expect(ports[0].posted).toHaveLength(1);

    helper.resetHelperConnection();
    await expect(first).rejects.toThrow(/connection was reset/i);
    expect(ports[0].disconnected).toBe(true);

    const probe = helper.probeSiteUrl('https://example.com/watch');
    expect(ports).toHaveLength(2);
    const active = ports[1];
    const request = active.posted[0];
    expect(request.type).toBe('probe');

    // If the reset request's timer were still alive it would fire here and
    // disconnect the probe's port, which is exactly the bug this guards.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(active.disconnected).toBe(false);

    active.reply(request.requestId, { title: 'Example' });
    await expect(probe).resolves.toEqual({ title: 'Example' });
  });

  it('ignores a late disconnect from a replaced port', async () => {
    const ports = installNativeMock();
    const helper = await import('../src/background/site-helper');

    const first = helper.getNativeSiteJobs(['a']);
    helper.resetHelperConnection();
    await expect(first).rejects.toThrow(/connection was reset/i);

    const second = helper.getNativeSiteJobs(['b']);
    expect(ports).toHaveLength(2);
    const active = ports[1];

    // Simulate the browser delivering the old port's onDisconnect after the
    // replacement port already exists.
    ports[0].fireDisconnect();
    expect(active.disconnected).toBe(false);

    const request = active.posted[0];
    active.reply(request.requestId, { b: 'ok' });
    await expect(second).resolves.toEqual({ b: 'ok' });
  });
});
