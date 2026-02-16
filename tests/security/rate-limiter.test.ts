import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SlidingWindowRateLimiter, ScopedRateLimiter } from '../../src/security/rate-limiter.js';

describe('SlidingWindowRateLimiter', () => {
  it('allows actions within limit', () => {
    const limiter = new SlidingWindowRateLimiter(3);
    expect(limiter.record()).toBe(true);
    expect(limiter.record()).toBe(true);
    expect(limiter.record()).toBe(true);
    expect(limiter.count()).toBe(3);
  });

  it('rejects actions beyond limit', () => {
    const limiter = new SlidingWindowRateLimiter(2);
    expect(limiter.record()).toBe(true);
    expect(limiter.record()).toBe(true);
    expect(limiter.record()).toBe(false);
    expect(limiter.isLimited()).toBe(true);
  });

  it('prunes old actions after window expires', () => {
    vi.useFakeTimers();
    const limiter = new SlidingWindowRateLimiter(2, 1000); // 1s window

    limiter.record();
    limiter.record();
    expect(limiter.isLimited()).toBe(true);

    vi.advanceTimersByTime(1001);
    expect(limiter.isLimited()).toBe(false);
    expect(limiter.count()).toBe(0);
    expect(limiter.record()).toBe(true);

    vi.useRealTimers();
  });
});

describe('ScopedRateLimiter', () => {
  it('respects global limit', () => {
    const limiter = new ScopedRateLimiter({ global: 2 });
    expect(limiter.record()).toBe(true);
    expect(limiter.record()).toBe(true);
    expect(limiter.record()).toBe(false);
    expect(limiter.isLimited()).toBe(true);
  });

  it('respects per-agent limit independently', () => {
    const limiter = new ScopedRateLimiter({ global: 10, perAgent: 2 });

    expect(limiter.record(undefined, 'agent1')).toBe(true);
    expect(limiter.record(undefined, 'agent1')).toBe(true);
    expect(limiter.record(undefined, 'agent1')).toBe(false);

    // agent2 should still work
    expect(limiter.record(undefined, 'agent2')).toBe(true);
    expect(limiter.isLimited(undefined, 'agent1')).toBe(true);
    expect(limiter.isLimited(undefined, 'agent2')).toBe(false);
  });

  it('respects per-tool-class limit independently', () => {
    const limiter = new ScopedRateLimiter({
      global: 10,
      perToolClass: { exec: 2, web: 1 },
    });

    expect(limiter.record('exec')).toBe(true);
    expect(limiter.record('exec')).toBe(true);
    expect(limiter.record('exec')).toBe(false);

    // web should still work
    expect(limiter.record('web')).toBe(true);
    expect(limiter.record('web')).toBe(false);

    // unknown tool class has no per-tool limit
    expect(limiter.record('read')).toBe(true);
  });

  it('global limit takes precedence', () => {
    const limiter = new ScopedRateLimiter({ global: 3, perAgent: 10 });

    expect(limiter.record(undefined, 'a')).toBe(true);
    expect(limiter.record(undefined, 'b')).toBe(true);
    expect(limiter.record(undefined, 'c')).toBe(true);
    expect(limiter.record(undefined, 'd')).toBe(false); // global exhausted
  });
});
