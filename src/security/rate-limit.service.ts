import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../database/database.service.js';

/** Trạng thái một cửa sổ đếm: số lần đã đếm và thời điểm hết hạn (epoch ms). */
export type RateLimitWindow = { hits: number; resetAt: number };

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

  /** Số lần đã đếm trong cửa sổ hiện tại, không tăng bộ đếm. */
  peek(key: string): RateLimitWindow | null {
    const window = this.windows.get(key);
    if (!window || window.resetAt <= Date.now()) return null;
    return { hits: window.count, resetAt: window.resetAt };
  }

  reset(key: string) {
    this.windows.delete(key);
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
    return this.withFallback(
      async () => {
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
          [hashKey(key), windowMs],
        );
        const row = result.rows[0];
        return toResult(row.hits, row.resetAtMs, limit, Date.now());
      },
      () => this.memory.consume(key, limit, windowMs),
    );
  }

  /**
   * Đọc bộ đếm mà KHÔNG tăng: dùng cho giới hạn chỉ đếm lần thất bại (kiểm
   * tra trước, chỉ ghi khi thực sự sai). Trả null khi chưa có hoặc đã hết hạn.
   */
  async peek(key: string): Promise<RateLimitWindow | null> {
    return this.withFallback(
      async () => {
        const result = await this.database.query<{
          hits: number;
          resetAtMs: number;
        }>(
          `SELECT hits, (EXTRACT(EPOCH FROM reset_at) * 1000)::float8 AS "resetAtMs"
           FROM rate_limits WHERE key_hash = $1 AND reset_at > NOW()`,
          [hashKey(key)],
        );
        const row = result.rows[0];
        return row ? { hits: row.hits, resetAt: row.resetAtMs } : null;
      },
      () => this.memory.peek(key),
    );
  }

  /** Xóa bộ đếm, ví dụ sau khi đăng nhập thành công. */
  async reset(key: string): Promise<void> {
    await this.withFallback(
      async () => {
        await this.database.query(
          'DELETE FROM rate_limits WHERE key_hash = $1',
          [hashKey(key)],
        );
        // Xóa cả bộ đếm dự phòng nếu trước đó PostgreSQL từng lỗi.
        this.memory.reset(key);
      },
      () => this.memory.reset(key),
    );
  }

  /**
   * Chạy thao tác trên PostgreSQL; chưa cấu hình hoặc lỗi thì dùng bộ đếm
   * trong RAM của process (ưu tiên tính sẵn sàng).
   */
  private async withFallback<Result>(
    shared: () => Promise<Result>,
    local: () => Result,
  ): Promise<Result> {
    if (!this.database.isConfigured) return local();
    try {
      return await shared();
    } catch (error) {
      if (Date.now() - this.lastFallbackWarningAt > 60_000) {
        this.lastFallbackWarningAt = Date.now();
        this.logger.warn(
          `Shared rate limiter unavailable, using in-memory fallback: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
      return local();
    }
  }

  onModuleDestroy() {
    clearInterval(this.cleanupTimer);
  }
}

/** Khóa được băm SHA-256 nên bảng không lưu IP hay tên đăng nhập dạng thô. */
function hashKey(key: string) {
  return createHash('sha256').update(key).digest();
}
