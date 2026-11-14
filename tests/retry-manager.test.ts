import { describe, expect, it, vi } from 'vitest';
import { DownFlowEngineError } from '../src/engine/engine-errors';
import { shouldRetryError, withRetry } from '../src/engine/retry-manager';

describe('retry policy', () => {
  it('retries retryable engine errors and normal failures', () => {
    expect(shouldRetryError(new DownFlowEngineError('busy', { retryable: true }))).toBe(true);
    expect(shouldRetryError(new DownFlowEngineError('no', { retryable: false }))).toBe(false);
    expect(shouldRetryError(new Error('network'))).toBe(true);
  });

  it('never retries aborts', () => {
    expect(shouldRetryError(new DOMException('Aborted', 'AbortError'))).toBe(false);
  });
});

describe('withRetry', () => {
  it('returns after a transient failure and reports the retry', async () => {
    let calls = 0;
    const onRetry = vi.fn();
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error('temporary');
        return 'ok';
      },
      { attempts: 3, baseDelayMs: 1, onRetry },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry.mock.calls[0][0]).toBe(1);
  });

  it('throws the last error after exhausting retries', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error('still failing');
        },
        { attempts: 2, baseDelayMs: 1 },
      ),
    ).rejects.toThrow('still failing');
    expect(calls).toBe(2);
  });

  it('does not retry non-retryable engine errors', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new DownFlowEngineError('forbidden', { retryable: false });
        },
        { attempts: 5, baseDelayMs: 1 },
      ),
    ).rejects.toThrow('forbidden');
    expect(calls).toBe(1);
  });

  it('honors server-provided retry delays', async () => {
    vi.useFakeTimers();
    try {
      const retries: number[] = [];
      const promise = withRetry(
        async () => {
          throw new DownFlowEngineError('slow down', { retryable: true, retryAfterMs: 5000 });
        },
        {
          attempts: 2,
          baseDelayMs: 1,
          onRetry: (_attempt, delay) => retries.push(delay),
        },
      );
      const assertion = expect(promise).rejects.toThrow('slow down');
      await vi.advanceTimersByTimeAsync(5000);
      await assertion;
      expect(retries).toEqual([5000]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts before the first attempt when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      withRetry(async () => 'never', { attempts: 2, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('stops retrying when a signal aborts during the delay', async () => {
    const controller = new AbortController();
    const promise = withRetry(
      async () => {
        throw new Error('temporary');
      },
      { attempts: 3, baseDelayMs: 60_000, signal: controller.signal },
    );
    // Let the retry loop enter its backoff sleep, then abort it.
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });
});
