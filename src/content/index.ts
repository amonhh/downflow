import { initDetector } from './detector';
import { initMediaDetector } from './media-detector';

async function boot(): Promise<void> {
  if (window.top !== window) {
    await initMediaDetector();
    return;
  }
  await initDetector();
  await initMediaDetector();
}

void boot().catch(() => {
  // Content scripts must never break the host page.
});
