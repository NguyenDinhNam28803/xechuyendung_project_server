import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../database/database.service.js';

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

/**
 * Bộ đếm fixed-window trong bộ nhớ của process. Dùng khi chưa cấu hình
 * PostgreSQL (môi trường test/dev) hoặc khi PostgreSQL tạm lỗi.
 */
export class MemoryRateLimitStore {
  private readonly windows = new Map<
    string,
    { count: number; resetAt: number }
  >();
  private readonly maximumTrackedWindows = 20_000;
  private callsSinceCleanup = 0;

  consume(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      if (window) this.windows.delete(key);
      this.callsSinceCleanup += 1;
      if (
        this.callsSinceCleanup >= 256 ||
        this.windows.size >= this.maximumTrackedWindows
      ) {
        this.removeExpiredWindows();
        this.callsSinceCleanup = 0;
      }
      // Bảo vệ bộ nhớ: khi bảng đầy (ví dụ bị spam từ rất nhiều IP), từ chối
      // thay vì cấp phát không giới hạn.
      if (this.windows.size >= this.maximumTrackedWindows) {
        return {
          allowed: false,
          remaining: 0,
          resetAt: now + 60_000,
          retryAfterSeconds: 60,
        };
      }
      window = { count: 0, resetAt: now + windowMs };
      this.windows.set(key, window);
    }
    window.count += 1;
    return toResult(window.count, window.resetAt, limit, now);
  }

  removeExpiredWindows() {
    const now = Date.now();
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}

function toResult(
  hits: number,
  resetAt: number,
  limit: number,
  now: number,
): RateLimitResult {
  const allowed = hits <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - hits),
    resetAt,
    retryAfterSeconds: allowed
      ? 0
      : Math.max(1, Math.ceil((resetAt - now) / 1000)),
  };
}

/**
 * Rate limiter dùng chung giữa mọi instance thông qua bảng UNLOGGED
 * `rate_limits` (migration 005). Mỗi lần kiểm tra là MỘT câu upsert nguyên tử
 * nên không có race condition giữa các instance.
 *
 * Đánh đổi so với Redis: thêm một lệnh ghi PostgreSQL cho mỗi request được
 * giới hạn (chỉ login và form liên hệ — lưu lượng thấp), đổi lại không cần
 * thêm hạ tầng. Khóa được băm SHA-256 nên bảng không lưu địa chỉ IP thô.
 */
@Injectable()
export class RateLimitService implements OnModuleDestroy {
  private readonly logger = new Logger(RateLimitService.name);
  private readonly memory = new MemoryRateLimitStore();
  private lastFallbackWarningAt = 0;
  private readonly cleanupTimer = setInterval(
    () => this.memory.removeExpiredWindows(),
    60_000,
  );

  constructor(private readonly database: DatabaseService) {
    this.cleanupTimer.unref();
  }

  async consume(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<RateLimitResult> {
    if (!this.database.isConfigured) {
      return this.memory.consume(key, limit, windowMs);
    }
    try {
      const result = await this.database.query<{
        hits: number;
        resetAtMs: number;
      }>(
        `INSERT INTO rate_limits AS r (key_hash, hits, reset_at)
         VALUES ($1, 1, NOW() + ($2::int * INTERVAL '1 millisecond'))
         ON CONFLICT (key_hash) DO UPDATE SET
           hits = CASE WHEN r.reset_at <= NOW() THEN 1 ELSE r.hits + 1 END,
           reset_at = CASE WHEN r.reset_at <= NOW() THEN EXCLUDED.reset_at ELSE r.reset_at END
         RETURNING hits, (EXTRACT(EPOCH FROM reset_at) * 1000)::float8 AS "resetAtMs"`,
        [createHash('sha256').update(key).digest(), windowMs],
      );
      const row = result.rows[0];
      return toResult(row.hits, row.resetAtMs, limit, Date.now());
    } catch (error) {
      // Ưu tiên tính sẵn sàng: PostgreSQL lỗi thì vẫn giới hạn theo từng process.
      if (Date.now() - this.lastFallbackWarningAt > 60_000) {
        this.lastFallbackWarningAt = Date.now();
        this.logger.warn(
          `Shared rate limiter unavailable, using in-memory fallback: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
      return this.memory.consume(key, limit, windowMs);
    }
  }

  onModuleDestroy() {
    clearInterval(this.cleanupTimer);
  }
}
