import { UnauthorizedException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { DatabaseService } from '../database/database.service.js';
import { TooManyAttemptsException } from '../common/too-many-attempts.exception.js';
import { AdminAuthService, hashSessionToken } from './admin-auth.service.js';
import type { LoginThrottle } from './login-throttle.js';
import { hashPassword } from './password.js';

function throttleMock(blocked = false) {
  return {
    assertAllowed: blocked
      ? vi.fn().mockRejectedValue(new TooManyAttemptsException('blocked', 60))
      : vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue(undefined),
    recordSuccess: vi.fn().mockResolvedValue(undefined),
  };
}
const allowAll = throttleMock() as unknown as LoginThrottle;

async function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    username: 'editor01',
    displayName: 'Biên tập viên',
    role: 'editor',
    passwordHash: await hashPassword('editor-password-123'),
    isActive: true,
    ...overrides,
  };
}

function createDatabase(row: unknown) {
  const transactionQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
  const query = vi.fn().mockResolvedValue({ rows: row ? [row] : [] });
  const database = {
    isConfigured: true,
    query,
    withTransaction: vi.fn(
      async (operation: (client: PoolClient) => Promise<unknown>) =>
        operation({ query: transactionQuery } as unknown as PoolClient),
    ),
  } as unknown as DatabaseService;
  return { database, query, transactionQuery };
}

describe('AdminAuthService', () => {
  it('issues an opaque token and stores only its SHA-256 hash', async () => {
    const { database, transactionQuery } = createDatabase(await userRow());
    const auth = new AdminAuthService(database, allowAll);

    const result = await auth.login('Editor01', 'editor-password-123', {
      userAgent: 'vitest',
    });

    expect(result.expiresIn).toBe(8 * 60 * 60);
    expect(result.user).toMatchObject({ username: 'editor01', role: 'editor' });
    expect(result.accessToken).toMatch(/^[\w-]{43}$/);
    const sessionInsert = transactionQuery.mock.calls[0];
    expect(sessionInsert[0]).toContain('INSERT INTO admin_sessions');
    expect(sessionInsert[1][1]).toEqual(hashSessionToken(result.accessToken));
    expect(JSON.stringify(transactionQuery.mock.calls)).not.toContain(
      result.accessToken,
    );
  });

  it('rejects wrong passwords, unknown users and inactive accounts with one message', async () => {
    const wrong = new AdminAuthService(
      createDatabase(await userRow()).database,
      allowAll,
    );
    const unknown = new AdminAuthService(
      createDatabase(undefined).database,
      allowAll,
    );
    const inactive = new AdminAuthService(
      createDatabase(await userRow({ isActive: false })).database,
      allowAll,
    );

    const attempts = [
      () => wrong.login('editor01', 'not-the-password', {}),
      () => unknown.login('ghost', 'editor-password-123', {}),
      () => inactive.login('editor01', 'editor-password-123', {}),
    ];
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toThrow(
        new UnauthorizedException('Tên đăng nhập hoặc mật khẩu không đúng.'),
      );
    }
  });

  it('blocks before checking the password when the throttle is exceeded', async () => {
    const throttle = throttleMock(true);
    const { database, query } = createDatabase(await userRow());
    const auth = new AdminAuthService(
      database,
      throttle as unknown as LoginThrottle,
    );

    await expect(
      auth.login('editor01', 'editor-password-123', { ip: '203.0.113.9' }),
    ).rejects.toMatchObject({ status: 429, retryAfterSeconds: 60 });
    expect(throttle.assertAllowed).toHaveBeenCalledWith(
      '203.0.113.9',
      'editor01',
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('counts only failed attempts and clears the IP/account pair on success', async () => {
    const failing = throttleMock();
    const wrong = new AdminAuthService(
      createDatabase(await userRow()).database,
      failing as unknown as LoginThrottle,
    );
    await expect(
      wrong.login('editor01', 'not-the-password', { ip: '198.51.100.1' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(failing.recordFailure).toHaveBeenCalledWith(
      '198.51.100.1',
      'editor01',
    );
    expect(failing.recordSuccess).not.toHaveBeenCalled();

    const unknownUser = throttleMock();
    await expect(
      new AdminAuthService(
        createDatabase(undefined).database,
        unknownUser as unknown as LoginThrottle,
      ).login('ghost', 'whatever-password', { ip: '198.51.100.1' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(unknownUser.recordFailure).toHaveBeenCalledTimes(1);

    const succeeding = throttleMock();
    await new AdminAuthService(
      createDatabase(await userRow()).database,
      succeeding as unknown as LoginThrottle,
    ).login('editor01', 'editor-password-123', { ip: '198.51.100.1' });
    expect(succeeding.recordSuccess).toHaveBeenCalledWith(
      '198.51.100.1',
      'editor01',
    );
    expect(succeeding.recordFailure).not.toHaveBeenCalled();
  });

  it('rejects malformed tokens without querying the database', async () => {
    const { database, query } = createDatabase(undefined);
    const auth = new AdminAuthService(database, allowAll);

    await expect(auth.authenticate('bad token!')).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});
