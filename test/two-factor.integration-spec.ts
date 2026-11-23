import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { generate } from 'otplib';
import { Pool } from 'pg';
import { AdminAuthService } from '../src/auth/admin-auth.service.js';
import type { AdminPrincipal } from '../src/auth/admin-principal.js';
import { LoginThrottle } from '../src/auth/login-throttle.js';
import { hashPassword } from '../src/auth/password.js';
import { TwoFactorService } from '../src/auth/two-factor.service.js';
import { DatabaseService } from '../src/database/database.service.js';
import { RateLimitService } from '../src/security/rate-limit.service.js';
import { asSession } from './helpers/session.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationEnabled = process.env.RUN_POSTGRES_INTEGRATION === 'true';
const describeIntegration =
  integrationEnabled && testDatabaseUrl ? describe : describe.skip;

const password = 'two-factor-password-123';

/**
 * Luồng 2FA đầy đủ trên PostgreSQL thật: đăng ký, đăng nhập hai bước, chống
 * dùng lại mã, mã khôi phục, giới hạn số lần nhập, phiên bị hạn chế, admin đặt
 * lại và script khẩn cấp.
 */
describeIntegration('PostgreSQL integration: two-factor authentication', () => {
  let database: DatabaseService;
  let pool: Pool;
  let rateLimit: RateLimitService;
  let auth: AdminAuthService;
  let twoFactor: TwoFactorService;
  const createdUsers: string[] = [];

  beforeAll(async () => {
    const name = decodeURIComponent(
      new URL(testDatabaseUrl!).pathname.slice(1),
    );
    if (!/(^|[_-])test([_-]|$)/i.test(name)) {
      throw new Error('Integration tests require a database named *test*.');
    }
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.TOTP_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    delete process.env.TWO_FACTOR_REQUIRED_ROLES; // mặc định: bắt buộc mọi vai trò
    await import('../scripts/migrate.js');
    database = new DatabaseService();
    pool = new Pool({ connectionString: testDatabaseUrl });
    rateLimit = new RateLimitService(database);
    twoFactor = new TwoFactorService(database, rateLimit);
    auth = new AdminAuthService(
      database,
      new LoginThrottle(rateLimit),
      twoFactor,
    );
  }, 30_000);

  afterAll(async () => {
    if (createdUsers.length) {
      await pool.query('DELETE FROM admin_users WHERE id = ANY($1::uuid[])', [
        createdUsers,
      ]);
    }
    rateLimit?.onModuleDestroy();
    await database?.onModuleDestroy();
    await pool?.end();
  });

  async function createUser(role: 'admin' | 'editor') {
    const username = `tfa_${role}_${randomUUID().slice(0, 8)}`;
    const result = await pool.query<{ id: string }>(
      `INSERT INTO admin_users (username, display_name, password_hash, role)
       VALUES ($1, $1, $2, $3) RETURNING id`,
      [username, await hashPassword(password), role],
    );
    createdUsers.push(result.rows[0].id);
    return { id: result.rows[0].id, username };
  }

  /** Đăng nhập khi chưa bật 2FA và lấy principal của phiên. */
  async function signInWithoutTwoFactor(username: string, ip: string) {
    const session = asSession(await auth.login(username, password, { ip }));
    const principal = (await auth.authenticate(
      session.accessToken,
    )) as AdminPrincipal;
    return { session, principal };
  }

  /** Đăng ký 2FA hoàn chỉnh; trả secret, mã khôi phục và principal. */
  async function enroll(username: string, ip: string) {
    const { session, principal } = await signInWithoutTwoFactor(username, ip);
    const setup = await twoFactor.startEnrollment(principal);
    const confirmed = await twoFactor.confirmEnrollment(principal, {
      code: await generate({ secret: setup.secret }),
    });
    return {
      secret: setup.secret,
      recoveryCodes: confirmed.recoveryCodes,
      session,
      principal,
    };
  }

  /** Mã TOTP của bước thời gian sau (mã hiện tại đã bị tiêu thụ khi đăng ký). */
  async function nextCode(secret: string) {
    return generate({ secret, epoch: Math.floor(Date.now() / 1000) + 30 });
  }

  it('restricts sessions until enrollment, then requires the second factor at login', async () => {
    const user = await createUser('editor');
    const first = await signInWithoutTwoFactor(user.username, '198.51.100.10');
    expect(first.session.twoFactorSetupRequired).toBe(true);
    expect(first.principal.twoFactorSetupRequired).toBe(true);

    const setup = await twoFactor.startEnrollment(first.principal);
    expect(setup.otpauthUri).toContain('otpauth://totp/');
    const stored = await pool.query<{ pending: string }>(
      'SELECT totp_pending_secret_enc AS pending FROM admin_users WHERE id = $1',
      [user.id],
    );
    // Secret không bao giờ được lưu dạng thô.
    expect(stored.rows[0].pending).not.toContain(setup.secret);

    await expect(
      twoFactor.confirmEnrollment(first.principal, { code: '000000' }),
    ).rejects.toMatchObject({ status: 400 });
    const confirmed = await twoFactor.confirmEnrollment(first.principal, {
      code: await generate({ secret: setup.secret }),
    });
    expect(confirmed.recoveryCodes).toHaveLength(10);

    // Phiên hiện tại được giữ và hết bị hạn chế.
    const refreshed = (await auth.authenticate(
      first.session.accessToken,
    )) as AdminPrincipal;
    expect(refreshed).toMatchObject({
      twoFactorEnabled: true,
      twoFactorSetupRequired: false,
    });

    const challenge = await auth.login(user.username, password, {
      ip: '198.51.100.10',
    });
    expect(challenge).toMatchObject({ mfaRequired: true });
    if (!('challengeToken' in challenge)) throw new Error('expected challenge');

    const code = await nextCode(setup.secret);
    const session = asSession(
      await auth.completeLogin(
        challenge.challengeToken,
        { kind: 'totp', code },
        { ip: '198.51.100.10' },
      ),
    );
    expect(session.user.twoFactorEnabled).toBe(true);

    // Mã thử thách chỉ dùng được một lần, và mã TOTP vừa dùng không dùng lại được.
    await expect(
      auth.completeLogin(
        challenge.challengeToken,
        { kind: 'totp', code },
        { ip: '198.51.100.10' },
      ),
    ).rejects.toMatchObject({ status: 401 });
    const again = await auth.login(user.username, password, {
      ip: '198.51.100.10',
    });
    if (!('challengeToken' in again)) throw new Error('expected challenge');
    await expect(
      auth.completeLogin(
        again.challengeToken,
        { kind: 'totp', code },
        { ip: '198.51.100.10' },
      ),
    ).rejects.toMatchObject({ status: 401 });
  }, 30_000);

  it('accepts each recovery code once and burns a challenge after 5 wrong codes', async () => {
    const user = await createUser('admin');
    const { recoveryCodes } = await enroll(user.username, '198.51.100.20');

    const challenge = await auth.login(user.username, password, {
      ip: '198.51.100.20',
    });
    if (!('challengeToken' in challenge)) throw new Error('expected challenge');
    const recovered = await auth.completeLogin(
      challenge.challengeToken,
      { kind: 'recovery', code: recoveryCodes[0].replace(/-/g, '') },
      { ip: '198.51.100.20' },
    );
    expect(recovered).toMatchObject({ recoveryCodesRemaining: 9 });

    const reuse = await auth.login(user.username, password, {
      ip: '198.51.100.21',
    });
    if (!('challengeToken' in reuse)) throw new Error('expected challenge');
    await expect(
      auth.completeLogin(
        reuse.challengeToken,
        { kind: 'recovery', code: recoveryCodes[0].replace(/-/g, '') },
        { ip: '198.51.100.21' },
      ),
    ).rejects.toMatchObject({ status: 401 });

    // Thêm 4 lần sai trên cùng mã thử thách (tổng 5) → thử thách bị hủy.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(
        auth.completeLogin(
          reuse.challengeToken,
          { kind: 'totp', code: '000000' },
          { ip: `198.51.100.${30 + attempt}` },
        ),
      ).rejects.toMatchObject({ status: 401 });
    }
    await expect(
      auth.completeLogin(
        reuse.challengeToken,
        { kind: 'recovery', code: recoveryCodes[1].replace(/-/g, '') },
        { ip: '198.51.100.40' },
      ),
    ).rejects.toMatchObject({ status: 401 });
    const unused = await pool.query(
      `SELECT 1 FROM admin_recovery_codes WHERE user_id = $1 AND used_at IS NULL`,
      [user.id],
    );
    expect(unused.rowCount).toBe(9);
  }, 30_000);

  it('blocks disabling 2FA when the role requires it', async () => {
    const user = await createUser('editor');
    const { principal, secret } = await enroll(user.username, '198.51.100.50');
    await expect(
      twoFactor.disable(principal, { password, code: await nextCode(secret) }),
    ).rejects.toMatchObject({ status: 403 });
  }, 30_000);

  it('lets an enrolled admin reset another account and revokes its sessions', async () => {
    const admin = await createUser('admin');
    const { session: adminSession } = await enroll(
      admin.username,
      '198.51.100.60',
    );
    const adminPrincipal = (await auth.authenticate(
      adminSession.accessToken,
    )) as AdminPrincipal;
    const editor = await createUser('editor');
    const { session: editorSession } = await enroll(
      editor.username,
      '198.51.100.61',
    );

    await expect(
      twoFactor.resetForUser(adminPrincipal.id, adminPrincipal),
    ).rejects.toMatchObject({ status: 400 });
    const result = await twoFactor.resetForUser(editor.id, adminPrincipal);
    expect(result.reset).toBe(true);
    expect(await auth.authenticate(editorSession.accessToken)).toBeNull();

    // Đăng nhập lại: không còn bước 2FA, phiên bị hạn chế cho tới khi đăng ký lại.
    const again = asSession(
      await auth.login(editor.username, password, { ip: '198.51.100.61' }),
    );
    expect(again.twoFactorSetupRequired).toBe(true);
  }, 30_000);

  it('emergency CLI reset clears 2FA without the encryption key', async () => {
    const user = await createUser('admin');
    const { session } = await enroll(user.username, '198.51.100.70');

    const { stdout } = await promisify(execFile)(
      process.execPath,
      ['scripts/reset-2fa.js', user.username.toUpperCase()],
      {
        env: {
          PATH: process.env.PATH,
          DATABASE_URL: testDatabaseUrl,
          DATABASE_SSL: process.env.DATABASE_SSL ?? 'false',
        },
      },
    );
    expect(stdout).toContain(user.username);

    const row = await pool.query<{ enabled: boolean; codes: string }>(
      `SELECT (totp_secret_enc IS NOT NULL) AS enabled,
              (SELECT COUNT(*) FROM admin_recovery_codes WHERE user_id = $1)::text AS codes
       FROM admin_users WHERE id = $1`,
      [user.id],
    );
    expect(row.rows[0]).toEqual({ enabled: false, codes: '0' });
    expect(await auth.authenticate(session.accessToken)).toBeNull();
    const audit = await pool.query(
      `SELECT 1 FROM activity_logs
       WHERE entity_id = $1 AND actor = 'system' AND entity_label LIKE '%khẩn cấp%'`,
      [user.id],
    );
    expect(audit.rowCount).toBe(1);
  }, 30_000);
});
