import { BadRequestException } from '@nestjs/common';
import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';

/**
 * Băm mật khẩu bằng scrypt (có sẵn trong Node.js, không cần native module như
 * bcrypt/argon2). Tham số N=2^15, r=8, p=1 dùng khoảng 32 MiB RAM và mất
 * khoảng vài chục ms mỗi lần — đủ chậm để chống dò mật khẩu offline nhưng
 * không làm nghẽn server. Tham số được lưu trong chuỗi băm nên có thể tăng
 * dần trong tương lai mà mật khẩu cũ vẫn kiểm tra được.
 *
 * Định dạng: scrypt$<log2N>$<r>$<p>$<salt base64url>$<hash base64url>
 */
const defaultCost = { log2N: 15, r: 8, p: 1 };
const keyLength = 64;
export const minimumPasswordLength = 12;
export const maximumPasswordLength = 200;

function scrypt(
  password: string,
  salt: Buffer,
  length: number,
  options: ScryptOptions,
) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, length, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

function scryptOptions(log2N: number, r: number, p: number): ScryptOptions {
  const N = 2 ** log2N;
  // maxmem phải lớn hơn 128 * N * r byte, nếu không Node.js báo lỗi.
  return { N, r, p, maxmem: 256 * N * r };
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const { log2N, r, p } = defaultCost;
  const key = await scrypt(
    password,
    salt,
    keyLength,
    scryptOptions(log2N, r, p),
  );
  return [
    'scrypt',
    log2N,
    r,
    p,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string) {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [log2N, r, p] = parts.slice(1, 4).map(Number);
  if (![log2N, r, p].every((value) => Number.isInteger(value) && value > 0)) {
    return false;
  }
  if (log2N > 20 || r > 32 || p > 16) return false;
  const salt = Buffer.from(parts[4], 'base64url');
  const expected = Buffer.from(parts[5], 'base64url');
  if (expected.length === 0) return false;
  const actual = await scrypt(
    password,
    salt,
    expected.length,
    scryptOptions(log2N, r, p),
  );
  return timingSafeEqual(actual, expected);
}

/**
 * Băm giả với cùng chi phí khi tên đăng nhập không tồn tại, để thời gian phản
 * hồi không tiết lộ tài khoản nào có thật (chống user enumeration).
 */
let dummyHash: Promise<string> | undefined;
export async function burnPasswordCheck(password: string) {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(password, await dummyHash);
}

export function assertPasswordPolicy(password: unknown): string {
  if (typeof password !== 'string') {
    throw new BadRequestException('Mật khẩu không hợp lệ.');
  }
  if (
    password.length < minimumPasswordLength ||
    password.length > maximumPasswordLength
  ) {
    throw new BadRequestException(
      `Mật khẩu cần từ ${minimumPasswordLength} đến ${maximumPasswordLength} ký tự.`,
    );
  }
  if (password.trim() !== password) {
    throw new BadRequestException(
      'Mật khẩu không được bắt đầu hoặc kết thúc bằng khoảng trắng.',
    );
  }
  return password;
}
