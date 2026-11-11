import { UnauthorizedException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { DatabaseService } from '../database/database.service.js';
import type { RateLimitService } from '../security/rate-limit.service.js';
import { AdminAuthService, hashSessionToken } from './admin-auth.service.js';
import { hashPassword } from './password.js';

const allowAll = {
  consume: vi.fn().mockResolvedValue({ allowed: true }),
} as unknown as RateLimitService;

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

  it('throttles repeated attempts against one account', async () => {
    const blocked = {
      consume: vi.fn().mockResolvedValue({ allowed: false }),
    } as unknown as RateLimitService;
    const { database, query } = createDatabase(await userRow());
    const auth = new AdminAuthService(database, blocked);

    await expect(
      auth.login('editor01', 'editor-password-123', {}),
    ).rejects.toMatchObject({
      status: 429,
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects malformed tokens without querying the database', async () => {
    const { database, query } = createDatabase(undefined);
    const auth = new AdminAuthService(database, allowAll);

    await expect(auth.authenticate('bad token!')).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});
