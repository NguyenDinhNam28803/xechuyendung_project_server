import { Injectable, OnModuleDestroy } from '@nestjs/common';

type RateLimitWindow = {
  count: number;
  resetAt: number;
};

@Injectable()
export class RateLimitService implements OnModuleDestroy {
  private readonly windows = new Map<string, RateLimitWindow>();
  private readonly maximumTrackedWindows = 20_000;
  private callsSinceCleanup = 0;
  private readonly cleanupTimer = setInterval(
    () => this.removeExpiredWindows(),
    60_000,
  );

  constructor() {
    this.cleanupTimer.unref();
  }

  consume(key: string, limit: number, windowMs: number) {
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

    if (window.count >= limit) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: window.resetAt,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((window.resetAt - now) / 1000),
        ),
      };
    }

    window.count += 1;
    return {
      allowed: true,
      remaining: limit - window.count,
      resetAt: window.resetAt,
      retryAfterSeconds: 0,
    };
  }

  onModuleDestroy() {
    clearInterval(this.cleanupTimer);
  }

  private removeExpiredWindows() {
    const now = Date.now();
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}
