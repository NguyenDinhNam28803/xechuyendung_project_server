import { RateLimitService } from './rate-limit.service.js';

describe('RateLimitService', () => {
  const service = new RateLimitService();

  afterAll(() => service.onModuleDestroy());

  it('allows up to the configured count and reports retry delay', () => {
    const first = service.consume('login:test', 2, 60_000);
    const second = service.consume('login:test', 2, 60_000);
    const blocked = service.consume('login:test', 2, 60_000);

    expect(first.allowed).toBe(true);
    expect(second.remaining).toBe(0);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('keeps rate-limit buckets separate by key', () => {
    expect(service.consume('contact:test', 1, 60_000).allowed).toBe(true);
  });
});
