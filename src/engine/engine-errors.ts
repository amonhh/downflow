export class DownFlowEngineError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly fallback: boolean;
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    options: { code?: string; retryable?: boolean; fallback?: boolean; retryAfterMs?: number } = {},
  ) {
    super(message);
    this.name = 'DownFlowEngineError';
    this.code = options.code ?? 'ENGINE_ERROR';
    this.retryable = options.retryable ?? false;
    this.fallback = options.fallback ?? false;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export class RangeUnsupportedError extends DownFlowEngineError {
  constructor(message = 'The server did not honor an HTTP Range request.') {
    super(message, { code: 'RANGE_UNSUPPORTED', retryable: false, fallback: true });
    this.name = 'RangeUnsupportedError';
  }
}

export class RemoteChangedError extends DownFlowEngineError {
  constructor(message = 'The remote file changed while it was downloading.') {
    super(message, { code: 'REMOTE_FILE_CHANGED', retryable: false });
    this.name = 'RemoteChangedError';
  }
}

export class AuthorizationError extends DownFlowEngineError {
  constructor(message = 'The server rejected access. Open the source site, sign in, and try again.') {
    super(message, { code: 'AUTH_REQUIRED', retryable: false });
    this.name = 'AuthorizationError';
  }
}

export class DiskError extends DownFlowEngineError {
  constructor(message: string) {
    super(message, { code: 'LOCAL_STORAGE_ERROR', retryable: false });
    this.name = 'DiskError';
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

export function toEngineError(error: unknown): DownFlowEngineError {
  if (error instanceof DownFlowEngineError) return error;
  if (isAbortError(error)) {
    return new DownFlowEngineError('Download paused.', { code: 'ABORTED' });
  }
  return new DownFlowEngineError(error instanceof Error ? error.message : 'Transfer failed.');
}
