import { Injectable } from '@nestjs/common';
import { TooManyAttemptsException } from '../common/too-many-attempts.exception.js';
import { RateLimitService } from '../security/rate-limit.service.js';

/**
 * Giới hạn đăng nhập sai. Chỉ đếm lần SAI, không đếm lần đúng:
 *
 * 1. Theo cặp (IP, tài khoản): 5 lần sai / 15 phút. Kẻ tấn công thử sai từ IP
 *    của họ chỉ khóa chính cặp đó; chủ tài khoản đăng nhập từ IP khác không
 *    bị ảnh hưởng. Đăng nhập đúng thì xóa bộ đếm của cặp.
 * 2. Theo tài khoản, mọi IP cộng lại: 50 lần sai / 60 phút. Chặn dò mật khẩu
 *    phân tán qua nhiều IP (botnet). Ngưỡng cao để một người khó tự khóa
 *    người khác; 2FA (bước tiếp theo) làm việc đoán đúng mật khẩu vô dụng.
 *
 * Đánh đổi: kẻ tấn công có trên 50 IP vẫn khóa được một tài khoản trong tối
 * đa 1 giờ. Bộ đếm tổng KHÔNG bị xóa khi chủ tài khoản đăng nhập đúng: nếu
 * xóa, mỗi lần chủ tài khoản đăng nhập lại mở thêm 50 lượt dò cho kẻ tấn công.
 *
 * Các bộ đếm được kiểm tra trước khi xác minh mật khẩu (peek, không tăng) và
 * chỉ tăng khi sai. Nhiều request song song có thể vượt ngưỡng vài lần; chấp
 * nhận được vì mỗi lần thử đều tốn một lần băm scrypt.
 */
export const loginFailureLimits = {
  pair: { limit: 5, windowMs: 15 * 60 * 1000 },
  account: { limit: 50, windowMs: 60 * 60 * 1000 },
} as const;

const blockedMessage =
  'Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ít phút.';

export function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

function pairKey(ip: string, username: string) {
  return `login-fail:pair:${ip}:${normalizeUsername(username)}`;
}

function accountKey(username: string) {
  return `login-fail:account:${normalizeUsername(username)}`;
}

@Injectable()
export class LoginThrottle {
  constructor(private readonly rateLimit: RateLimitService) {}

  /** Ném 429 (kèm Retry-After) nếu cặp (IP, tài khoản) hoặc tài khoản đã vượt ngưỡng. */
  async assertAllowed(ip: string, username: string) {
    const [pair, account] = await Promise.all([
      this.rateLimit.peek(pairKey(ip, username)),
      this.rateLimit.peek(accountKey(username)),
    ]);
    const blockedUntil = Math.max(
      pair && pair.hits >= loginFailureLimits.pair.limit ? pair.resetAt : 0,
      account && account.hits >= loginFailureLimits.account.limit
        ? account.resetAt
        : 0,
    );
    if (blockedUntil > 0) {
      throw new TooManyAttemptsException(
        blockedMessage,
        Math.max(1, Math.ceil((blockedUntil - Date.now()) / 1000)),
      );
    }
  }

  async recordFailure(ip: string, username: string) {
    await Promise.all([
      this.rateLimit.consume(
        pairKey(ip, username),
        loginFailureLimits.pair.limit,
        loginFailureLimits.pair.windowMs,
      ),
      this.rateLimit.consume(
        accountKey(username),
        loginFailureLimits.account.limit,
        loginFailureLimits.account.windowMs,
      ),
    ]);
  }

  /** Đăng nhập đúng: xóa bộ đếm của cặp (IP, tài khoản), giữ bộ đếm tổng. */
  async recordSuccess(ip: string, username: string) {
    await this.rateLimit.reset(pairKey(ip, username));
  }
}
