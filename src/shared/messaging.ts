import type { ApiResponse, AppRequest } from './types';

export async function sendRequest<T>(request: AppRequest): Promise<T> {
  let response: ApiResponse<T> | undefined;
  try {
    response = (await chrome.runtime.sendMessage(request)) as ApiResponse<T> | undefined;
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message.includes('Receiving end does not exist')
        ? 'DownFlow’s background service is starting. Wait a moment and try again.'
        : error instanceof Error
          ? error.message
          : 'Could not contact the DownFlow background service.',
    );
  }
  if (!response) {
    throw new Error('DownFlow’s background service did not respond. Reload the extension and try again.');
  }
  if (!response.ok) {
    throw new Error(response.error || 'The operation failed.');
  }
  return response.data;
}

export function isApiFailure(response: ApiResponse<unknown>): response is Extract<ApiResponse<unknown>, { ok: false }> {
  return !response.ok;
}
