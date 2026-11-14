import { sleep } from '../shared/utilities';
import { isAbortError, DownFlowEngineError } from './engine-errors';

export interface RetryOptions {
  attempts: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
}

export function shouldRetryError(error: unknown): boolean {
  if (error instanceof DownFlowEngineError) return error.retryable;
  if (isAbortError(error)) return false;
  return true;
}

export async function withRetry<T>(operation: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  const attempts = Math.max(1, Math.round(options.attempts));
  const baseDelay = options.baseDelayMs ?? 600;
  const maxDelay = options.maxDelayMs ?? 12_000;
  const shouldRetry = options.shouldRetry ?? shouldRetryError;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !shouldRetry(error) || options.signal?.aborted) throw error;
      const engineDelay = error instanceof DownFlowEngineError ? error.retryAfterMs : undefined;
      const exponential = Math.min(maxDelay, baseDelay * 2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * Math.min(250, exponential / 2));
      const delay = Math.min(maxDelay, engineDelay ?? exponential + jitter);
      options.onRetry?.(attempt, delay, error);
      await sleep(delay, options.signal);
    }
  }
  throw lastError;
}
