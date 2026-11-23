import { createHash, randomInt } from 'node:crypto';
import { generateSecret, generateURI, verify } from 'otplib';
import type { AdminRole } from './admin-principal.js';
import { adminRoles } from './admin-principal.js';

/** Tên hiển thị trong ứng dụng xác thực (Google Authenticator, Authy…). */
export const totpIssuer = 'Xe Chuyên Dụng';

/**
 * Chấp nhận mã của bước thời gian liền trước/liền sau (±30 giây) để bù lệch
 * đồng hồ giữa điện thoại và máy chủ. Máy chủ phải đồng bộ giờ NTP.
 */
const epochToleranceSeconds = 30;

/** Mã thử thách đăng nhập bước 2: hạn dùng và số lần nhập mã tối đa. */
export const loginChallengeLifetimeSeconds = 5 * 60;
export const loginChallengeMaxAttempts = 5;
/** Secret chờ xác nhận khi đăng ký hết hạn sau 15 phút. */
export const pendingSecretLifetimeSeconds = 15 * 60;
export const recoveryCodeCount = 10;

/**
 * Vai trò bắt buộc 2FA, đọc từ TWO_FACTOR_REQUIRED_ROLES:
 *  - không đặt: mặc định bắt buộc cho mọi vai trò (admin, editor);
 *  - "none": tắt bắt buộc (chỉ dùng tạm khi chuyển đổi, xem README);
 *  - danh sách cách nhau bởi dấu phẩy, ví dụ "admin".
 */
export function readRequiredRoles(
  env: NodeJS.ProcessEnv = process.env,
): ReadonlySet<AdminRole> {
  const raw = env.TWO_FACTOR_REQUIRED_ROLES;
  if (raw === undefined) return new Set(adminRoles);
  const value = raw.trim().toLowerCase();
  if (value === 'none') return new Set();
  const roles = value
    .split(',')
    .map((role) => role.trim())
    .filter(Boolean);
  for (const role of roles) {
    if (!adminRoles.includes(role as AdminRole)) {
      throw new Error(
        `TWO_FACTOR_REQUIRED_ROLES contains an unknown role "${role}". Use "admin", "editor", a comma-separated list or "none".`,
      );
    }
  }
  if (roles.length === 0) {
    throw new Error(
      'TWO_FACTOR_REQUIRED_ROLES is empty. Use "none" to disable enforcement explicitly.',
    );
  }
  return new Set(roles as AdminRole[]);
}

export function createTotpSecret() {
  // 20 byte (160 bit), mã hóa base32: định dạng mọi ứng dụng xác thực hỗ trợ.
  return generateSecret();
}

export function totpUri(secret: string, username: string) {
  return generateURI({ issuer: totpIssuer, label: username, secret });
}

/** Mã TOTP người dùng nhập: 6 chữ số, cho phép có khoảng trắng ở giữa. */
export function normalizeTotpCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.replace(/\s+/g, '');
  return /^\d{6}$/.test(code) ? code : null;
}

/**
 * Kiểm tra mã TOTP. Trả về bước thời gian của mã khi hợp lệ để lưu lại làm
 * `afterTimeStep` lần sau (mã đã dùng không dùng lại được); null khi sai.
 */
export async function verifyTotp(
  secret: string,
  code: string,
  options: { afterTimeStep?: number | null; epoch?: number } = {},
): Promise<number | null> {
  const result = await verify({
    secret,
    token: code,
    epochTolerance: epochToleranceSeconds,
    ...(options.afterTimeStep != null
      ? { afterTimeStep: options.afterTimeStep }
      : {}),
    ...(options.epoch !== undefined ? { epoch: options.epoch } : {}),
  });
  // verify() trả kiểu chung cho HOTP/TOTP; chỉ kết quả TOTP có timeStep.
  if (!result.valid || !('timeStep' in result)) return null;
  return result.timeStep;
}

const recoveryAlphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * Mã khôi phục dạng XXXX-XXXX-XXXX-XXXX (16 ký tự từ bảng 31 ký tự, bỏ các
 * ký tự dễ nhầm 0/O, 1/I/L): khoảng 79 bit ngẫu nhiên mỗi mã.
 */
export function generateRecoveryCodes(count = recoveryCodeCount): string[] {
  return Array.from({ length: count }, () => {
    // randomInt lấy mẫu đều (không lệch như byte % 31).
    const characters = Array.from(
      { length: 16 },
      () => recoveryAlphabet[randomInt(recoveryAlphabet.length)],
    ).join('');
    return characters.match(/.{4}/g)!.join('-');
  });
}

/** Chuẩn hóa mã khôi phục người dùng nhập: bỏ khoảng trắng/gạch, viết hoa. */
export function normalizeRecoveryCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code.length === 16 ? code : null;
}

export function hashRecoveryCode(normalized: string) {
  return createHash('sha256').update(normalized).digest();
}
