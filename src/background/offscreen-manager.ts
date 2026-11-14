import type { ApiResponse } from '../shared/types';

let creating: Promise<void> | null = null;

async function hasDocument(): Promise<boolean> {
  try {
    return await chrome.offscreen.hasDocument();
  } catch {
    return false;
  }
}

export async function ensureOffscreenDocument(): Promise<void> {
  if (await hasDocument()) return;
  if (creating) {
    await creating;
    return;
  }
  creating = (async () => {
    try {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: [chrome.offscreen.Reason.BLOBS, chrome.offscreen.Reason.WORKERS, chrome.offscreen.Reason.CLIPBOARD],
        justification:
          'Assemble segmented downloads with OPFS/Blob URLs and coordinate long-running media transfers outside the MV3 service worker.',
      });
    } catch (error) {
      if (!(error instanceof Error) || !/single offscreen|already exists/i.test(error.message)) throw error;
    }
  })();
  try {
    await creating;
  } finally {
    creating = null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendToOffscreen<T = unknown>(type: string, payload?: unknown): Promise<T> {
  await ensureOffscreenDocument();
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = (await chrome.runtime.sendMessage({ type, payload })) as ApiResponse<T> | undefined;
      if (!response) throw new Error('The transfer engine did not respond.');
      if (!response.ok) throw new Error(response.error);
      return response.data;
    } catch (error) {
      lastError = error;
      if (attempt === 0) await delay(150);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('The transfer engine is unavailable.');
}

export async function releaseOffscreenDelivery(downloadId: string): Promise<void> {
  try {
    await sendToOffscreen('offscreen:release-delivery', { downloadId });
  } catch {
    // Cleanup is best-effort and must not block the download state transition.
  }
}

/**
 * Pushes changed settings into an already-running transfer engine. This is
 * skipped when no offscreen document exists so that saving settings never
 * creates a document as a side effect.
 */
export async function syncOffscreenSettings(): Promise<void> {
  try {
    if (!(await hasDocument())) return;
    await sendToOffscreen('offscreen:sync-settings');
  } catch {
    // The engine also refreshes settings at the start of every transfer.
  }
}

export async function copyTextWithOffscreen(text: string): Promise<void> {
  await sendToOffscreen('offscreen:copy-text', { text });
}
