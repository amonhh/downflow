import type { SiteHelperStatus, SiteJobState, SiteRawProbe } from '../shared/types';

export const NATIVE_HOST_NAME = 'com.downflow.helper';

const DEFAULT_TIMEOUT_MS = 15_000;
const UNAVAILABLE_COOLDOWN_MS = 8_000;

interface Envelope<T> {
  requestId?: number;
  ok?: boolean;
  data?: T;
  error?: string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let port: chrome.runtime.Port | null = null;
let sequence = 0;
let unavailableReason: string | null = null;
let unavailableUntil = 0;
const pending = new Map<number, PendingRequest>();

function unavailable(message: string): Error {
  unavailableReason = message;
  unavailableUntil = Date.now() + UNAVAILABLE_COOLDOWN_MS;
  return new Error(message);
}

function rejectPending(message: string): void {
  const entries = [...pending.values()];
  pending.clear();
  for (const request of entries) {
    clearTimeout(request.timer);
    request.reject(new Error(message));
  }
}

function disconnectPort(message?: string): void {
  const active = port;
  port = null;
  if (active) {
    try {
      active.disconnect();
    } catch {
      // The port may already be closed.
    }
  }
  rejectPending(message ?? 'The optional DownFlow helper connection was reset.');
}

function ensurePort(force: boolean): chrome.runtime.Port {
  if (port) return port;
  if (!force && unavailableReason && Date.now() < unavailableUntil) {
    throw new Error(unavailableReason);
  }
  if (!chrome.runtime?.connectNative) {
    throw new Error('This browser does not expose native messaging to extensions.');
  }
  let created: chrome.runtime.Port;
  try {
    created = chrome.runtime.connectNative(NATIVE_HOST_NAME);
  } catch (error) {
    throw unavailable(
      `DownFlow could not start its optional helper: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  port = created;
  unavailableReason = null;
  unavailableUntil = 0;

  created.onMessage.addListener((message: Envelope<unknown>) => {
    if (!message || typeof message !== 'object') return;
    const id = message.requestId;
    if (typeof id !== 'number') return;
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    clearTimeout(request.timer);
    if (message.ok) request.resolve(message.data);
    else request.reject(new Error(message.error || 'The DownFlow helper returned an error.'));
  });

  created.onDisconnect.addListener(() => {
    const lastError = chrome.runtime.lastError?.message;
    if (port !== created) return;
    port = null;
    rejectPending(
      lastError
        ? `The optional DownFlow helper is not connected: ${lastError}. Install it from Settings → Video sites.`
        : 'The optional DownFlow helper disconnected. Install or reinstall it from Settings → Video sites.',
    );
    unavailable(
      lastError ||
        'The optional DownFlow helper is not installed. Run npm run native:install and reload the extension.',
    );
  });

  return created;
}

function request<T>(message: Record<string, unknown>, timeoutMs = DEFAULT_TIMEOUT_MS, force = false): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let active: chrome.runtime.Port;
    try {
      active = ensurePort(force);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    const requestId = ++sequence;
    const timer = setTimeout(() => {
      if (!pending.delete(requestId)) return;
      reject(new Error('The DownFlow helper did not respond in time. Try again or restart the browser.'));
      if (port === active) disconnectPort('The DownFlow helper timed out.');
    }, timeoutMs);

    pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject, timer });
    try {
      active.postMessage({ ...message, requestId });
    } catch (error) {
      pending.delete(requestId);
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function helperUnavailableStatus(error?: unknown): SiteHelperStatus {
  return {
    available: false,
    ytDlp: { available: false },
    ffmpeg: { available: false },
    error:
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'The optional DownFlow helper is not installed.',
  };
}

export async function getHelperStatus(force = false): Promise<SiteHelperStatus> {
  try {
    return await request<SiteHelperStatus>({ type: 'status' }, 12_000, force);
  } catch (error) {
    return helperUnavailableStatus(error);
  }
}

export async function probeSiteUrl(url: string): Promise<SiteRawProbe> {
  return request<SiteRawProbe>({ type: 'probe', url, timeoutMs: 120_000 }, 130_000, true);
}

export interface NativeSiteJobInput {
  id: string;
  url: string;
  format: string;
  title?: string;
  filename?: string;
  filenameStem?: string;
  customFilename?: boolean;
  ext?: string;
  merge?: boolean;
  totalBytes?: number;
  outputDir?: string;
}

export async function startNativeSiteJob(job: NativeSiteJobInput): Promise<SiteJobState> {
  return request<SiteJobState>({ type: 'start', job }, 30_000, true);
}

export async function getNativeSiteJobs(ids: string[]): Promise<Record<string, SiteJobState | null>> {
  return request<Record<string, SiteJobState | null>>({ type: 'jobs', ids }, 15_000);
}

export async function cancelNativeSiteJob(id: string): Promise<SiteJobState> {
  return request<SiteJobState>({ type: 'cancel', id }, 15_000, true);
}

export async function openNativeSitePath(path: string): Promise<void> {
  await request<boolean>({ type: 'open', path }, 12_000);
}

export async function revealNativeSitePath(path: string): Promise<void> {
  await request<boolean>({ type: 'reveal', path }, 12_000);
}

export function resetHelperConnection(): void {
  unavailableReason = null;
  unavailableUntil = 0;
  disconnectPort();
}
