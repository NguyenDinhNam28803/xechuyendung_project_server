import type { DatabaseService } from '../database/database.service.js';
import {
  MemoryRateLimitStore,
  RateLimitService,
} from './rate-limit.service.js';

describe('MemoryRateLimitStore', () => {
  const store = new MemoryRateLimitStore();

  it('allows up to the configured count and reports retry delay', () => {
    const first = store.consume('login:test', 2, 60_000);
    const second = store.consume('login:test', 2, 60_000);
    const blocked = store.consume('login:test', 2, 60_000);

    expect(first.allowed).toBe(true);
    expect(second.remaining).toBe(0);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('keeps rate-limit buckets separate by key', () => {
    expect(store.consume('contact:test', 1, 60_000).allowed).toBe(true);
  });
});

describe('RateLimitService', () => {
  it('uses the in-memory store when PostgreSQL is not configured', async () => {
    const database = { isConfigured: false } as DatabaseService;
    const service = new RateLimitService(database);
    expect((await service.consume('k', 1, 60_000)).allowed).toBe(true);
    expect((await service.consume('k', 1, 60_000)).allowed).toBe(false);
    service.onModuleDestroy();
  });

  it('uses a single atomic upsert with a hashed key when PostgreSQL is configured', async () => {
    const resetAtMs = Date.now() + 30_000;
    const query = vi.fn().mockResolvedValue({ rows: [{ hits: 3, resetAtMs }] });
    const database = {
      isConfigured: true,
      query,
    } as unknown as DatabaseService;
    const service = new RateLimitService(database);

    const result = await service.consume('POST:/login:203.0.113.5', 2, 60_000);

    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain(
      'ON CONFLICT (key_hash) DO UPDATE',
    );
    const [keyHash, windowMs] = query.mock.calls[0][1] as [Buffer, number];
    expect(keyHash).toHaveLength(32);
    expect(keyHash.toString('utf8')).not.toContain('203.0.113.5');
    expect(windowMs).toBe(60_000);
    service.onModuleDestroy();
  });

  it('falls back to the in-memory store when PostgreSQL fails', async () => {
    const query = vi.fn().mockRejectedValue(new Error('connection refused'));
    const database = {
      isConfigured: true,
      query,
    } as unknown as DatabaseService;
    const service = new RateLimitService(database);

    await expect(service.consume('k', 1, 60_000)).resolves.toMatchObject({
      allowed: true,
    });
    await expect(service.consume('k', 1, 60_000)).resolves.toMatchObject({
      allowed: false,
    });
    service.onModuleDestroy();
  });
});
