import { BadRequestException } from '@nestjs/common';
import {
  assertPasswordPolicy,
  hashPassword,
  verifyPassword,
} from './password.js';

describe('password hashing', () => {
  it('hashes with a random salt and verifies only the original password', async () => {
    const first = await hashPassword('correct horse battery');
    const second = await hashPassword('correct horse battery');

    expect(first).toMatch(/^scrypt\$15\$8\$1\$[\w-]+\$[\w-]+$/);
    expect(first).not.toBe(second);
    await expect(verifyPassword('correct horse battery', first)).resolves.toBe(
      true,
    );
    await expect(verifyPassword('correct horse batterx', first)).resolves.toBe(
      false,
    );
  });

  it('rejects malformed or unsafe stored hashes', async () => {
    await expect(verifyPassword('x', 'plain-text')).resolves.toBe(false);
    await expect(
      verifyPassword('x', 'scrypt$40$8$1$c2FsdA$aGFzaA'),
    ).resolves.toBe(false);
  });

  it('enforces the password policy', () => {
    expect(() => assertPasswordPolicy('short')).toThrow(BadRequestException);
    expect(() => assertPasswordPolicy(' leading-space-pass')).toThrow(
      BadRequestException,
    );
    expect(assertPasswordPolicy('a-sufficiently-long-password')).toBe(
      'a-sufficiently-long-password',
    );
  });
});
