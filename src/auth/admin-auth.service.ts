import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { insertActivity } from '../activity/activity.service.js';
import { DatabaseService } from '../database/database.service.js';
import { RateLimitService } from '../security/rate-limit.service.js';
import type { AdminPrincipal, AdminRole } from './admin-principal.js';
import {
  assertPasswordPolicy,
  burnPasswordCheck,
  hashPassword,
  verifyPassword,
} from './password.js';

export const sessionLifetimeSeconds = 8 * 60 * 60;
const lastSeenRefreshSeconds = 5 * 60;
const invalidCredentialsMessage = 'Tên đăng nhập hoặc mật khẩu không đúng.';

/** Giới hạn theo tài khoản, bổ sung cho giới hạn theo IP ở controller. */
const perUsernameLimit = { limit: 10, windowMs: 15 * 60 * 1000 };

type UserRow = {
  id: string;
  username: string;
  displayName: string;
  role: AdminRole;
  passwordHash: string;
  isActive: boolean;
};

type SessionRow = {
  sessionId: string;
  id: string;
  username: string;
  displayName: string;
  role: AdminRole;
  lastSeenAt: Date;
};

export type LoginMetadata = { userAgent?: string };

export function hashSessionToken(token: string) {
  return createHash('sha256').update(token).digest();
}

@Injectable()
export class AdminAuthService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly rateLimit: RateLimitService,
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

    const throttle = await this.rateLimit.consume(
      `login-user:${username.trim().toLowerCase()}`,
      perUsernameLimit.limit,
      perUsernameLimit.windowMs,
    );
    if (!throttle.allowed) {
      throw new HttpException(
        'Tài khoản tạm khóa đăng nhập do thử sai nhiều lần. Vui lòng thử lại sau.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const result = await this.database.query<UserRow>(
      `SELECT id, username, display_name AS "displayName", role,
              password_hash AS "passwordHash", is_active AS "isActive"
       FROM admin_users WHERE lower(username) = lower($1)`,
      [username.trim()],
    );
    const user = result.rows[0];
    if (!user) {
      await burnPasswordCheck(password);
      throw new UnauthorizedException(invalidCredentialsMessage);
    }
    const valid = await verifyPassword(password, user.passwordHash);
    // Tài khoản bị khóa trả cùng thông báo để không lộ trạng thái tài khoản.
    if (!valid || !user.isActive) {
      throw new UnauthorizedException(invalidCredentialsMessage);
    }

    const token = randomBytes(32).toString('base64url');
    await this.database.withTransaction(async (client) => {
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
        entityLabel: `Đăng nhập: ${user.username}`,
      });
    });

    return {
      accessToken: token,
      expiresIn: sessionLifetimeSeconds,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
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
              s.last_seen_at AS "lastSeenAt"
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
