import { describe, expect, it } from 'vitest';
import { effectiveRate, rateDelayMs, RateLimiter } from '../src/engine/bandwidth-limiter';

describe('bandwidth math', () => {
  it('computes delay from byte count and rate', () => {
    expect(rateDelayMs(1000, 1000)).toBe(1000);
    expect(rateDelayMs(0, 1000)).toBe(0);
    expect(rateDelayMs(1000, 0)).toBe(0);
    expect(rateDelayMs(1000, -1)).toBe(0);
  });

  it('uses the stricter of global and per-download limits', () => {
    expect(effectiveRate(0, 0)).toBe(0);
    expect(effectiveRate(0, 500)).toBe(500);
    expect(effectiveRate(1000, 0)).toBe(1000);
    expect(effectiveRate(1000, 500)).toBe(500);
    expect(effectiveRate(500, 1000)).toBe(500);
    expect(effectiveRate(-1, -1)).toBe(0);
  });
});

describe('token-bucket rate limiter', () => {
  it('allows small transfers from the initial burst without waiting', async () => {
    const limiter = new RateLimiter(10_000);
    const started = Date.now();
    await limiter.consume(100);
    expect(Date.now() - started).toBeLessThan(100);
  });

  it('delays transfers that exceed the available tokens', async () => {
    const limiter = new RateLimiter(1000);
    await limiter.consume(250);
    const started = Date.now();
    await limiter.consume(350);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(60);
    expect(elapsed).toBeLessThan(1500);
  });

  it('is a no-op when unlimited and can be updated at runtime', async () => {
    const limiter = new RateLimiter(0);
    await limiter.consume(10_000_000);
    expect(limiter.rate).toBe(0);
    limiter.setRate(2048);
    expect(limiter.rate).toBe(2048);
    limiter.setRate(0);
    await limiter.consume(10_000_000);
    expect(limiter.rate).toBe(0);
  });

  it('stops waiting when the transfer is aborted', async () => {
    const limiter = new RateLimiter(1000);
    const controller = new AbortController();
    const transfer = limiter.consume(10_000, controller.signal);
    controller.abort();
    await expect(transfer).rejects.toMatchObject({ name: 'AbortError' });
  });
});
