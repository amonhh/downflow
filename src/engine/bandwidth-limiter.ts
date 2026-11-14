import { sleep } from '../shared/utilities';

export function rateDelayMs(bytes: number, bytesPerSecond: number): number {
  if (bytesPerSecond <= 0 || bytes <= 0) return 0;
  return (bytes / bytesPerSecond) * 1000;
}

export class RateLimiter {
  private rateBps: number;
  private tokens: number;
  private lastRefill: number;

  constructor(rateBps = 0) {
    this.rateBps = Math.max(0, rateBps);
    this.tokens = Math.max(0, this.rateBps / 4);
    this.lastRefill = Date.now();
  }

  setRate(rateBps: number): void {
    this.rateBps = Math.max(0, rateBps);
    this.tokens = Math.min(this.tokens, this.rateBps || 0);
    this.lastRefill = Date.now();
  }

  get rate(): number {
    return this.rateBps;
  }

  async consume(bytes: number, signal?: AbortSignal): Promise<void> {
    if (this.rateBps <= 0 || bytes <= 0) return;
    const capacity = Math.max(this.rateBps / 4, 64 * 1024);
    const now = Date.now();
    this.tokens = Math.min(capacity, this.tokens + ((now - this.lastRefill) / 1000) * this.rateBps);
    this.lastRefill = now;
    if (this.tokens >= bytes) {
      this.tokens -= bytes;
      return;
    }
    const deficit = bytes - this.tokens;
    this.tokens = 0;
    const delay = (deficit / this.rateBps) * 1000;
    await sleep(delay, signal);
    this.lastRefill = Date.now();
  }
}

export function effectiveRate(globalBps: number, perDownloadBps: number): number {
  if (globalBps > 0 && perDownloadBps > 0) return Math.min(globalBps, perDownloadBps);
  return Math.max(0, globalBps || perDownloadBps);
}
