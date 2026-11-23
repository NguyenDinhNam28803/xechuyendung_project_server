import { randomBytes } from 'node:crypto';
import { generate } from 'otplib';
import {
  decryptSecret,
  encryptSecret,
  readEncryptionKey,
} from './secret-box.js';
import {
  createTotpSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
  normalizeTotpCode,
  readRequiredRoles,
  totpUri,
  verifyTotp,
} from './two-factor.js';
import { readSecondFactor } from './two-factor.service.js';

describe('secret box (AES-256-GCM)', () => {
  const key = randomBytes(32);

  it('round-trips and never stores the plaintext', () => {
    const stored = encryptSecret('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', key);
    expect(stored).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(stored).not.toContain('JBSWY3DP');
    expect(decryptSecret(stored, key)).toBe('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP');
    // IV ngẫu nhiên: cùng plaintext cho hai bản mã khác nhau.
    expect(encryptSecret('same', key)).not.toBe(encryptSecret('same', key));
  });

  it('rejects a wrong key and tampered ciphertext', () => {
    const stored = encryptSecret('secret', key);
    expect(() => decryptSecret(stored, randomBytes(32))).toThrow();
    const parts = stored.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decryptSecret(parts.join('.'), key)).toThrow();
  });

  it('refuses to encrypt without a configured key', () => {
    expect(() => encryptSecret('secret', undefined)).toThrow(
      /TOTP_ENCRYPTION_KEY/,
    );
  });

  it('validates the key length', () => {
    expect(readEncryptionKey({})).toBeUndefined();
    expect(() =>
      readEncryptionKey({
        TOTP_ENCRYPTION_KEY: randomBytes(16).toString('base64'),
      }),
    ).toThrow(/32 bytes/);
    expect(
      readEncryptionKey({ TOTP_ENCRYPTION_KEY: key.toString('base64') }),
    ).toHaveLength(32);
  });
});

describe('TOTP helpers', () => {
  it('accepts the adjacent 30-second step and rejects replays', async () => {
    const secret = createTotpSecret();
    const epoch = 1_800_000_000;
    const code = await generate({ secret, epoch });

    const step = await verifyTotp(secret, code, { epoch: epoch + 30 });
    expect(step).not.toBeNull();
    await expect(
      verifyTotp(secret, code, { epoch: epoch + 30, afterTimeStep: step }),
    ).resolves.toBeNull();
    await expect(
      verifyTotp(secret, code, { epoch: epoch + 120 }),
    ).resolves.toBeNull();
  });

  it('builds an otpauth URI with the issuer and username', () => {
    const uri = totpUri(createTotpSecret(), 'bientap01');
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(decodeURIComponent(uri)).toContain('Xe Chuyên Dụng:bientap01');
  });

  it('normalizes user input', () => {
    expect(normalizeTotpCode('123 456')).toBe('123456');
    expect(normalizeTotpCode('12345')).toBeNull();
    expect(normalizeTotpCode(123456)).toBeNull();
  });
});

describe('recovery codes', () => {
  it('generates 10 unique, readable codes that normalize and hash consistently', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[A-HJKMNP-Z2-9]{4}(-[A-HJKMNP-Z2-9]{4}){3}$/);
    }
    const normalized = normalizeRecoveryCode(
      codes[0].toLowerCase().replace(/-/g, ' '),
    );
    expect(normalized).toBe(codes[0].replace(/-/g, ''));
    expect(hashRecoveryCode(normalized!)).toEqual(
      hashRecoveryCode(normalizeRecoveryCode(codes[0])!),
    );
    expect(normalizeRecoveryCode('short')).toBeNull();
  });
});

describe('second factor input and policy', () => {
  it('reads exactly one of code or recoveryCode', () => {
    expect(readSecondFactor({ code: '123456' })).toEqual({
      kind: 'totp',
      code: '123456',
    });
    expect(readSecondFactor({ recoveryCode: 'abcd-efgh-jkmn-pqrs' })).toEqual({
      kind: 'recovery',
      code: 'ABCDEFGHJKMNPQRS',
    });
    expect(() =>
      readSecondFactor({ code: '123456', recoveryCode: 'x' }),
    ).toThrow();
    expect(() => readSecondFactor({})).toThrow();
  });

  it('requires 2FA for every role unless configured otherwise', () => {
    expect([...readRequiredRoles({})]).toEqual(['admin', 'editor']);
    expect([
      ...readRequiredRoles({ TWO_FACTOR_REQUIRED_ROLES: 'admin' }),
    ]).toEqual(['admin']);
    expect(readRequiredRoles({ TWO_FACTOR_REQUIRED_ROLES: 'none' }).size).toBe(
      0,
    );
    expect(() =>
      readRequiredRoles({ TWO_FACTOR_REQUIRED_ROLES: 'owner' }),
    ).toThrow();
    expect(() =>
      readRequiredRoles({ TWO_FACTOR_REQUIRED_ROLES: ' ' }),
    ).toThrow();
  });
});
