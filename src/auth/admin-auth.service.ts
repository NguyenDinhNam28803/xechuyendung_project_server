import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { insertActivity } from '../activity/activity.service.js';
import { DatabaseService } from '../database/database.service.js';
import type { AdminPrincipal, AdminRole } from './admin-principal.js';
import { LoginThrottle } from './login-throttle.js';
import {
  loginChallengeLifetimeSeconds,
  loginChallengeMaxAttempts,
} from './two-factor.js';
import { type SecondFactor, TwoFactorService } from './two-factor.service.js';
import {
  assertPasswordPolicy,
  burnPasswordCheck,
  hashPassword,
  verifyPassword,
} from './password.js';

export const sessionLifetimeSeconds = 8 * 60 * 60;
const lastSeenRefreshSeconds = 5 * 60;
const invalidCredentialsMessage = 'Tên đăng nhập hoặc mật khẩu không đúng.';
const invalidChallengeMessage =
  'Phiên đăng nhập đã hết hạn hoặc nhập sai mã quá nhiều lần. Vui lòng đăng nhập lại.';
const invalidSecondFactorMessage = 'Mã xác thực không đúng hoặc đã được dùng.';

type UserRow = {
  id: string;
  username: string;
  displayName: string;
  role: AdminRole;
  passwordHash: string;
  isActive: boolean;
  twoFactorEnabled: boolean;
};

type SessionUser = Pick<
  UserRow,
  'id' | 'username' | 'displayName' | 'role' | 'twoFactorEnabled'
>;

type ChallengeRow = SessionUser & {
  challengeId: string;
  secretEnc: string | null;
  lastStep: string | null;
  userAgent: string | null;
};

type SessionRow = {
  sessionId: string;
  id: string;
  username: string;
  displayName: string;
  role: AdminRole;
  lastSeenAt: Date;
  twoFactorEnabled: boolean;
};

export type LoginMetadata = {
  /** IP của người dùng (request.ip, đã xét TRUST_PROXY). */
  ip?: string;
  userAgent?: string;
};

export function hashSessionToken(token: string) {
  return createHash('sha256').update(token).digest();
}

@Injectable()
export class AdminAuthService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly throttle: LoginThrottle,
    private readonly twoFactor: TwoFactorService,
  ) {}

  /**
   * Khởi tạo tài khoản quản trị đầu tiên từ ADMIN_USERNAME/ADMIN_PASSWORD khi
   * bảng admin_users còn trống. Sau khi đã có tài khoản, hai biến này không
   * còn tác dụng; đổi mật khẩu thực hiện trong trang quản trị.
   */
  async onApplicationBootstrap() {
    if (!this.database.isConfigured) return;
    const username = process.env.ADMIN_USERNAME?.trim();
    const password = process.env.ADMIN_PASSWORD;
    try {
      const existing = await this.database.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM admin_users',
      );
      if (Number(existing.rows[0].count) > 0) return;
      if (!username || !password) {
        this.logger.warn(
          'No admin account exists. Set ADMIN_USERNAME and ADMIN_PASSWORD to create the first administrator.',
        );
        return;
      }
      assertPasswordPolicy(password);
      const passwordHash = await hashPassword(password);
      // INSERT ... WHERE NOT EXISTS để nhiều instance khởi động cùng lúc vẫn
      // chỉ tạo một tài khoản.
      const created = await this.database.query(
        `INSERT INTO admin_users (username, display_name, password_hash, role)
         SELECT $1, $1, $2, 'admin'
         WHERE NOT EXISTS (SELECT 1 FROM admin_users)
         ON CONFLICT DO NOTHING`,
        [username, passwordHash],
      );
      if (created.rowCount) {
        this.logger.log(`Created the initial administrator "${username}".`);
      }
    } catch (error) {
      this.logger.error(
        'Unable to bootstrap the initial administrator. Run "npm run db:migrate" and check ADMIN_PASSWORD (at least 12 characters).',
        error instanceof Error ? error.message : undefined,
      );
    }
  }

  /**
   * Bước 1: kiểm tra mật khẩu.
   *  - Tài khoản chưa bật 2FA: tạo phiên ngay (nếu vai trò bắt buộc 2FA, phiên
   *    bị hạn chế cho tới khi đăng ký xong, xem AdminAuthGuard).
   *  - Tài khoản đã bật 2FA: chưa tạo phiên; trả mã thử thách 5 phút để gửi
   *    kèm mã TOTP/mã khôi phục ở completeLogin(). Bộ đếm sai của cặp (IP, tài
   *    khoản) chỉ được xóa khi cả hai bước thành công.
   */
  async login(username: unknown, password: unknown, metadata: LoginMetadata) {
    if (
      typeof username !== 'string' ||
      typeof password !== 'string' ||
      username.length === 0 ||
      username.length > 60 ||
      password.length === 0 ||
      password.length > 200
    ) {
      throw new UnauthorizedException(invalidCredentialsMessage);
    }

    const ip = metadata.ip || 'unknown';
    await this.throttle.assertAllowed(ip, username);

    const result = await this.database.query<UserRow>(
      `SELECT id, username, display_name AS "displayName", role,
              password_hash AS "passwordHash", is_active AS "isActive",
              (totp_secret_enc IS NOT NULL) AS "twoFactorEnabled"
       FROM admin_users WHERE lower(username) = lower($1)`,
      [username.trim()],
    );
    const user = result.rows[0];
    if (!user) {
      // Đếm cả tên đăng nhập không tồn tại để phản hồi giống hệt tài khoản
      // có thật (không lộ tài khoản nào tồn tại qua việc bị chặn hay không).
      await burnPasswordCheck(password);
      await this.throttle.recordFailure(ip, username);
      throw new UnauthorizedException(invalidCredentialsMessage);
    }
    const valid = await verifyPassword(password, user.passwordHash);
    // Tài khoản bị khóa trả cùng thông báo để không lộ trạng thái tài khoản.
    if (!valid || !user.isActive) {
      await this.throttle.recordFailure(ip, username);
      throw new UnauthorizedException(invalidCredentialsMessage);
    }

    if (user.twoFactorEnabled) {
      const challengeToken = randomBytes(32).toString('base64url');
      await this.database.query(
        `INSERT INTO admin_login_challenges (user_id, token_hash, user_agent, expires_at)
         VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 second'))`,
        [
          user.id,
          hashSessionToken(challengeToken),
          metadata.userAgent?.slice(0, 200) ?? null,
          loginChallengeLifetimeSeconds,
        ],
      );
      return {
        mfaRequired: true as const,
        challengeToken,
        expiresIn: loginChallengeLifetimeSeconds,
      };
    }

    await this.throttle.recordSuccess(ip, username);
    return this.createSession(user, metadata, `Đăng nhập: ${user.username}`);
  }

  /**
   * Bước 2: mã thử thách + mã TOTP hoặc mã khôi phục. Mỗi mã thử thách cho
   * tối đa 5 lần nhập; sai cũng được tính vào giới hạn đăng nhập sai của cặp
   * (IP, tài khoản), nên người biết mật khẩu cũng không dò mã TOTP được.
   */
  async completeLogin(
    challengeToken: unknown,
    factor: SecondFactor,
    metadata: LoginMetadata,
  ) {
    if (
      typeof challengeToken !== 'string' ||
      !/^[A-Za-z0-9_-]{20,100}$/.test(challengeToken)
    ) {
      throw new UnauthorizedException(invalidChallengeMessage);
    }
    const ip = metadata.ip || 'unknown';
    const found = await this.database.query<ChallengeRow>(
      `SELECT c.id AS "challengeId", c.user_agent AS "userAgent",
              u.id, u.username, u.display_name AS "displayName", u.role,
              TRUE AS "twoFactorEnabled",
              u.totp_secret_enc AS "secretEnc",
              u.totp_last_step::text AS "lastStep"
       FROM admin_login_challenges c
       JOIN admin_users u ON u.id = c.user_id
       WHERE c.token_hash = $1
         AND c.consumed_at IS NULL
         AND c.expires_at > NOW()
         AND c.attempts < $2
         AND u.is_active = TRUE
         AND u.totp_secret_enc IS NOT NULL`,
      [hashSessionToken(challengeToken), loginChallengeMaxAttempts],
    );
    const challenge = found.rows[0];
    if (!challenge) throw new UnauthorizedException(invalidChallengeMessage);
    await this.throttle.assertAllowed(ip, challenge.username);

    const session = await this.database.withTransaction(async (client) => {
      const accepted = await this.twoFactor.consumeFactor(
        client,
        {
          id: challenge.id,
          secretEnc: challenge.secretEnc,
          lastStep: challenge.lastStep,
        },
        factor,
      );
      if (!accepted) return null;
      const consumed = await client.query(
        `UPDATE admin_login_challenges SET consumed_at = NOW()
         WHERE id = $1 AND consumed_at IS NULL`,
        [challenge.challengeId],
      );
      if (!consumed.rowCount) return null;
      return this.createSession(
        challenge,
        {
          ...metadata,
          userAgent: metadata.userAgent ?? challenge.userAgent ?? undefined,
        },
        factor.kind === 'recovery'
          ? `Đăng nhập (mã khôi phục 2FA): ${challenge.username}`
          : `Đăng nhập (2FA): ${challenge.username}`,
        client,
      );
    });

    if (!session) {
      await this.database.query(
        `UPDATE admin_login_challenges SET attempts = attempts + 1
         WHERE id = $1 AND consumed_at IS NULL`,
        [challenge.challengeId],
      );
      await this.throttle.recordFailure(ip, challenge.username);
      throw new UnauthorizedException(invalidSecondFactorMessage);
    }
    await this.throttle.recordSuccess(ip, challenge.username);

    if (factor.kind === 'recovery') {
      const remaining = await this.database.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total FROM admin_recovery_codes
         WHERE user_id = $1 AND used_at IS NULL`,
        [challenge.id],
      );
      return {
        ...session,
        recoveryCodesRemaining: Number(remaining.rows[0].total),
      };
    }
    return session;
  }

  /** Tạo phiên đăng nhập; dùng client có sẵn khi đang trong transaction. */
  private async createSession(
    user: SessionUser,
    metadata: LoginMetadata,
    auditLabel: string,
    existingClient?: PoolClient,
  ) {
    const token = randomBytes(32).toString('base64url');
    const write = async (client: PoolClient) => {
      await client.query(
        `INSERT INTO admin_sessions (user_id, token_hash, user_agent, expires_at)
         VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 second'))`,
        [
          user.id,
          hashSessionToken(token),
          metadata.userAgent?.slice(0, 200) ?? null,
          sessionLifetimeSeconds,
        ],
      );
      await client.query(
        'UPDATE admin_users SET last_login_at = NOW() WHERE id = $1',
        [user.id],
      );
      await insertActivity(client, {
        actor: { id: user.id, username: user.username },
        action: 'LOGIN',
        entityType: 'admin_user',
        entityId: user.id,
        entityLabel: auditLabel,
      });
    };
    if (existingClient) await write(existingClient);
    else await this.database.withTransaction(write);

    return {
      accessToken: token,
      expiresIn: sessionLifetimeSeconds,
      twoFactorSetupRequired:
        !user.twoFactorEnabled && this.twoFactor.isRequiredFor(user.role),
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        twoFactorEnabled: user.twoFactorEnabled,
      },
    };
  }

  /**
   * Xác thực token: phiên phải tồn tại, chưa bị thu hồi, chưa hết hạn và tài
   * khoản còn hoạt động. Mỗi request quản trị tốn một truy vấn theo khóa
   * UNIQUE (token_hash) — đổi lại có thể thu hồi phiên ngay lập tức.
   */
  async authenticate(token: string): Promise<AdminPrincipal | null> {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
    const result = await this.database.query<SessionRow>(
      `SELECT s.id AS "sessionId", u.id, u.username,
              u.display_name AS "displayName", u.role,
              s.last_seen_at AS "lastSeenAt",
              (u.totp_secret_enc IS NOT NULL) AS "twoFactorEnabled"
       FROM admin_sessions s
       JOIN admin_users u ON u.id = s.user_id
       WHERE s.token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > NOW()
         AND u.is_active = TRUE`,
      [hashSessionToken(token)],
    );
    const session = result.rows[0];
    if (!session) return null;

    // Chỉ ghi last_seen_at tối đa 5 phút/lần để không biến mọi request đọc
    // thành một lệnh ghi.
    if (
      Date.now() - session.lastSeenAt.getTime() >
      lastSeenRefreshSeconds * 1000
    ) {
      await this.database
        .query('UPDATE admin_sessions SET last_seen_at = NOW() WHERE id = $1', [
          session.sessionId,
        ])
        .catch((error: unknown) =>
          this.logger.warn(
            `Unable to refresh session activity: ${error instanceof Error ? error.message : 'unknown error'}`,
          ),
        );
    }

    return {
      id: session.id,
      username: session.username,
      displayName: session.displayName,
      role: session.role,
      sessionId: session.sessionId,
      twoFactorEnabled: session.twoFactorEnabled,
      twoFactorSetupRequired:
        !session.twoFactorEnabled && this.twoFactor.isRequiredFor(session.role),
    };
  }

  async logout(principal: AdminPrincipal) {
    await this.database.withTransaction(async (client) => {
      await client.query(
        `UPDATE admin_sessions SET revoked_at = NOW()
         WHERE id = $1 AND revoked_at IS NULL`,
        [principal.sessionId],
      );
      await insertActivity(client, {
        actor: { id: principal.id, username: principal.username },
        action: 'LOGOUT',
        entityType: 'admin_user',
        entityId: principal.id,
        entityLabel: `Đăng xuất: ${principal.username}`,
      });
    });
  }
}

/**
 * Thu hồi toàn bộ phiên của một tài khoản (khi khóa tài khoản, đổi vai trò
 * hoặc đặt lại mật khẩu). `exceptSessionId` giữ lại phiên hiện tại khi người
 * dùng tự đổi mật khẩu.
 */
export async function revokeUserSessions(
  client: PoolClient,
  userId: string,
  exceptSessionId?: string,
) {
  await client.query(
    `UPDATE admin_sessions SET revoked_at = NOW()
     WHERE user_id = $1 AND revoked_at IS NULL
       AND ($2::uuid IS NULL OR id <> $2::uuid)`,
    [userId, exceptSessionId ?? null],
  );
}
