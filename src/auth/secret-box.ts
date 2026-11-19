import { ServiceUnavailableException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Mã hóa đối xứng AES-256-GCM cho secret TOTP lưu trong database.
 *
 * Khóa: TOTP_ENCRYPTION_KEY = 32 byte mã hóa base64. Tạo bằng
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *
 * Định dạng: v1.<iv base64url>.<auth tag base64url>.<ciphertext base64url>
 * Tiền tố phiên bản cho phép đổi khóa/thuật toán sau này mà dữ liệu cũ vẫn
 * nhận diện được.
 *
 * Đánh đổi: MẤT KHÓA = mọi người phải đăng ký lại 2FA (secret cũ không giải mã
 * được). Khóa phải được sao lưu tách biệt với database.
 */
const version = 'v1';

export function readEncryptionKey(
  env: NodeJS.ProcessEnv = process.env,
): Buffer | undefined {
  const raw = env.TOTP_ENCRYPTION_KEY?.trim();
  if (!raw) return undefined;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('TOTP_ENCRYPTION_KEY must be 32 bytes encoded as base64.');
  }
  return key;
}

function requireKey(key: Buffer | undefined): Buffer {
  if (!key) {
    throw new ServiceUnavailableException(
      'Máy chủ chưa cấu hình khóa mã hóa cho xác thực hai lớp (TOTP_ENCRYPTION_KEY).',
    );
  }
  return key;
}

export function encryptSecret(plaintext: string, key: Buffer | undefined) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', requireKey(key), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  return [
    version,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptSecret(stored: string, key: Buffer | undefined) {
  const [storedVersion, iv, tag, ciphertext] = stored.split('.');
  if (storedVersion !== version || !iv || !tag || !ciphertext) {
    throw new Error('Unsupported encrypted secret format.');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    requireKey(key),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
