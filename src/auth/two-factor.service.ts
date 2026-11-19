import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  UnauthorizedException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { insertActivity } from '../activity/activity.service.js';
import { TooManyAttemptsException } from '../common/too-many-attempts.exception.js';
import { DatabaseService } from '../database/database.service.js';
import { RateLimitService } from '../security/rate-limit.service.js';
import type { AdminPrincipal, AdminRole } from './admin-principal.js';
import { verifyPassword } from './password.js';
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
  pendingSecretLifetimeSeconds,
  readRequiredRoles,
  totpUri,
  verifyTotp,
} from './two-factor.js';

/** Sai mã 2FA ở các thao tác trong tài khoản: tối đa 10 lần / 15 phút. */
const codeFailureLimit = { limit: 10, windowMs: 15 * 60 * 1000 };
const invalidCodeMessage = 'Mã xác thực không đúng hoặc đã được dùng.';

type TwoFactorRow = {
  id: string;
  username: string;
  role: AdminRole;
  passwordHash: string;
  secretEnc: string | null;
  pendingSecretEnc: string | null;
  pendingFresh: boolean;
  lastStep: string | null;
};

export type SecondFactor =
  { kind: 'totp'; code: string } | { kind: 'recovery'; code: string };

/** Đọc mã người dùng gửi: `code` (TOTP 6 số) hoặc `recoveryCode`. */
export function readSecondFactor(body: Record<string, unknown>): SecondFactor {
  if (body.code !== undefined && body.recoveryCode !== undefined) {
    throw new BadRequestException(
      'Chỉ gửi một trong hai: mã xác thực hoặc mã khôi phục.',
    );
  }
  if (body.recoveryCode !== undefined) {
    const code = normalizeRecoveryCode(body.recoveryCode);
    if (!code) throw new BadRequestException('Mã khôi phục không hợp lệ.');
    return { kind: 'recovery', code };
  }
  const code = normalizeTotpCode(body.code);
  if (!code) {
    throw new BadRequestException('Mã xác thực gồm 6 chữ số.');
  }
  return { kind: 'totp', code };
}

@Injectable()
export class TwoFactorService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TwoFactorService.name);
  private readonly key = readEncryptionKey();
  readonly requiredRoles = readRequiredRoles();

  constructor(
    private readonly database: DatabaseService,
    private readonly rateLimit: RateLimitService,
  ) {}

  onApplicationBootstrap() {
    if (!this.key && this.requiredRoles.size > 0) {
      this.logger.error(
        'Two-factor authentication is required but TOTP_ENCRYPTION_KEY is not set: nobody can enroll, so every admin session stays restricted. Set TOTP_ENCRYPTION_KEY (32 bytes, base64).',
      );
    }
  }

  isRequiredFor(role: AdminRole) {
    return this.requiredRoles.has(role);
  }

  async status(admin: AdminPrincipal) {
    const result = await this.database.query<{
      enabledAt: Date | null;
      remaining: string;
    }>(
      `SELECT u.totp_enabled_at AS "enabledAt",
              (SELECT COUNT(*) FROM admin_recovery_codes r
               WHERE r.user_id = u.id AND r.used_at IS NULL)::text AS remaining
       FROM admin_users u WHERE u.id = $1`,
      [admin.id],
    );
    const row = result.rows[0];
    return {
      enabled: Boolean(row?.enabledAt),
      enabledAt: row?.enabledAt ?? null,
      required: this.isRequiredFor(admin.role),
      recoveryCodesRemaining: Number(row?.remaining ?? 0),
    };
  }

  /**
   * Bước 1 đăng ký: tạo secret chờ xác nhận (15 phút). Trả về secret (để nhập
   * tay) và URI otpauth:// (client tự vẽ QR, server không tạo ảnh).
   */
  async startEnrollment(admin: AdminPrincipal) {
    const user = await this.loadUser(admin.id);
    if (user.secretEnc) {
      throw new ConflictException('Xác thực hai lớp đã được bật.');
    }
    const secret = createTotpSecret();
    await this.database.query(
      `UPDATE admin_users
       SET totp_pending_secret_enc = $1, totp_pending_created_at = NOW()
       WHERE id = $2`,
      [encryptSecret(secret, this.key), admin.id],
    );
    return {
      secret,
      otpauthUri: totpUri(secret, user.username),
      expiresIn: pendingSecretLifetimeSeconds,
    };
  }

  /**
   * Bước 2 đăng ký: mã đúng thì bật 2FA, cấp 10 mã khôi phục (chỉ trả về đúng
   * lần này) và thu hồi mọi phiên khác; phiên hiện tại được giữ vì người dùng
   * vừa chứng minh có thiết bị.
   */
  async confirmEnrollment(
    admin: AdminPrincipal,
    body: Record<string, unknown>,
  ) {
    const code = normalizeTotpCode(body.code);
    if (!code) throw new BadRequestException('Mã xác thực gồm 6 chữ số.');
    await this.assertCodeAttemptsAllowed(admin.id);

    const user = await this.loadUser(admin.id);
    if (user.secretEnc) {
      throw new ConflictException('Xác thực hai lớp đã được bật.');
    }
    if (!user.pendingSecretEnc || !user.pendingFresh) {
      throw new BadRequestException(
        'Phiên thiết lập đã hết hạn. Vui lòng bắt đầu lại.',
      );
    }
    const step = await verifyTotp(
      decryptSecret(user.pendingSecretEnc, this.key),
      code,
    );
    if (step === null) {
      await this.recordCodeFailure(admin.id);
      throw new BadRequestException(invalidCodeMessage);
    }

    const recoveryCodes = generateRecoveryCodes();
    await this.database.withTransaction(async (client) => {
      const updated = await client.query(
        `UPDATE admin_users
         SET totp_secret_enc = totp_pending_secret_enc,
             totp_pending_secret_enc = NULL,
             totp_pending_created_at = NULL,
             totp_enabled_at = NOW(),
             totp_last_step = $2
         WHERE id = $1 AND totp_secret_enc IS NULL
           AND totp_pending_secret_enc = $3`,
        [admin.id, step, user.pendingSecretEnc],
      );
      if (!updated.rowCount) {
        throw new ConflictException(
          'Thiết lập đã thay đổi ở nơi khác. Vui lòng bắt đầu lại.',
        );
      }
      await replaceRecoveryCodes(client, admin.id, recoveryCodes);
      await client.query(
        `UPDATE admin_sessions SET revoked_at = NOW()
         WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL`,
        [admin.id, admin.sessionId],
      );
      await insertActivity(client, {
        actor: { id: admin.id, username: admin.username },
        action: 'UPDATE',
        entityType: 'admin_user',
        entityId: admin.id,
        entityLabel: `Bật xác thực hai lớp: ${admin.username}`,
      });
    });
    return { enabled: true, recoveryCodes };
  }

  /** Tắt 2FA: cần mật khẩu và mã TOTP; không cho tắt khi vai trò bắt buộc. */
  async disable(admin: AdminPrincipal, body: Record<string, unknown>) {
    if (this.isRequiredFor(admin.role)) {
      throw new ForbiddenException(
        'Vai trò của bạn bắt buộc dùng xác thực hai lớp nên không thể tắt.',
      );
    }
    if (typeof body.password !== 'string' || !body.password) {
      throw new BadRequestException('Vui lòng nhập mật khẩu hiện tại.');
    }
    const factor = readSecondFactor({ code: body.code });
    await this.assertCodeAttemptsAllowed(admin.id);
    const user = await this.loadUser(admin.id);
    if (!user.secretEnc) {
      throw new BadRequestException('Xác thực hai lớp chưa được bật.');
    }
    if (!(await verifyPassword(body.password, user.passwordHash))) {
      await this.recordCodeFailure(admin.id);
      throw new BadRequestException('Mật khẩu hiện tại không đúng.');
    }
    await this.database.withTransaction(async (client) => {
      if (!(await this.consumeFactor(client, user, factor))) {
        await this.recordCodeFailure(admin.id);
        throw new BadRequestException(invalidCodeMessage);
      }
      await clearTwoFactor(client, admin.id);
      await insertActivity(client, {
        actor: { id: admin.id, username: admin.username },
        action: 'UPDATE',
        entityType: 'admin_user',
        entityId: admin.id,
        entityLabel: `Tắt xác thực hai lớp: ${admin.username}`,
      });
    });
    return { enabled: false };
  }

  /** Tạo bộ mã khôi phục mới (cần mã TOTP); bộ cũ mất hiệu lực ngay. */
  async regenerateRecoveryCodes(
    admin: AdminPrincipal,
    body: Record<string, unknown>,
  ) {
    const factor = readSecondFactor({ code: body.code });
    await this.assertCodeAttemptsAllowed(admin.id);
    const user = await this.loadUser(admin.id);
    if (!user.secretEnc) {
      throw new BadRequestException('Xác thực hai lớp chưa được bật.');
    }
    const recoveryCodes = generateRecoveryCodes();
    await this.database.withTransaction(async (client) => {
      if (!(await this.consumeFactor(client, user, factor))) {
        await this.recordCodeFailure(admin.id);
        throw new BadRequestException(invalidCodeMessage);
      }
      await replaceRecoveryCodes(client, admin.id, recoveryCodes);
      await insertActivity(client, {
        actor: { id: admin.id, username: admin.username },
        action: 'UPDATE',
        entityType: 'admin_user',
        entityId: admin.id,
        entityLabel: `Tạo lại mã khôi phục 2FA: ${admin.username}`,
      });
    });
    return { recoveryCodes };
  }

  /**
   * Admin đặt lại 2FA cho người khác (mất điện thoại). Người thực hiện phải
   * đã bật 2FA; không áp dụng cho chính mình (dùng luồng tắt/tạo lại mã).
   * Mọi phiên của tài khoản đích bị thu hồi; lần đăng nhập sau phải đăng ký lại.
   */
  async resetForUser(userId: string, admin: AdminPrincipal) {
    if (!admin.twoFactorEnabled) {
      throw new ForbiddenException(
        'Bạn cần bật xác thực hai lớp trước khi đặt lại cho tài khoản khác.',
      );
    }
    if (userId === admin.id) {
      throw new BadRequestException(
        'Không thể tự đặt lại. Hãy tạo lại mã khôi phục trong trang tài khoản.',
      );
    }
    return this.database.withTransaction(async (client) => {
      const target = await client.query<{ username: string }>(
        'SELECT username FROM admin_users WHERE id = $1 FOR UPDATE',
        [userId],
      );
      if (!target.rows[0]) {
        throw new NotFoundException('Không tìm thấy tài khoản.');
      }
      await clearTwoFactor(client, userId);
      const revoked = await client.query(
        `UPDATE admin_sessions SET revoked_at = NOW()
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId],
      );
      await insertActivity(client, {
        actor: { id: admin.id, username: admin.username },
        action: 'UPDATE',
        entityType: 'admin_user',
        entityId: userId,
        entityLabel: `Đặt lại xác thực hai lớp: ${target.rows[0].username}`,
      });
      return { reset: true, sessionsRevoked: revoked.rowCount ?? 0 };
    });
  }

  /**
   * Kiểm tra và TIÊU THỤ yếu tố thứ hai trong transaction:
   *  - TOTP: cập nhật totp_last_step có điều kiện (< bước mới) nên hai request
   *    song song dùng cùng một mã chỉ một request thành công.
   *  - Mã khôi phục: đánh dấu used_at có điều kiện (IS NULL).
   */
  async consumeFactor(
    client: PoolClient,
    user: Pick<TwoFactorRow, 'id' | 'secretEnc' | 'lastStep'>,
    factor: SecondFactor,
  ): Promise<boolean> {
    if (!user.secretEnc) return false;
    if (factor.kind === 'recovery') {
      const used = await client.query(
        `UPDATE admin_recovery_codes SET used_at = NOW()
         WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL`,
        [user.id, hashRecoveryCode(factor.code)],
      );
      return Boolean(used.rowCount);
    }
    const step = await verifyTotp(
      decryptSecret(user.secretEnc, this.key),
      factor.code,
      { afterTimeStep: user.lastStep === null ? null : Number(user.lastStep) },
    );
    if (step === null) return false;
    const stored = await client.query(
      `UPDATE admin_users SET totp_last_step = $2
       WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2)`,
      [user.id, step],
    );
    return Boolean(stored.rowCount);
  }

  async loadUser(userId: string): Promise<TwoFactorRow> {
    const result = await this.database.query<TwoFactorRow>(
      `SELECT id, username, role, password_hash AS "passwordHash",
              totp_secret_enc AS "secretEnc",
              totp_pending_secret_enc AS "pendingSecretEnc",
              (totp_pending_created_at > NOW() - ($2 * INTERVAL '1 second')) IS TRUE
                AS "pendingFresh",
              totp_last_step::text AS "lastStep"
       FROM admin_users WHERE id = $1`,
      [userId, pendingSecretLifetimeSeconds],
    );
    const user = result.rows[0];
    if (!user) throw new UnauthorizedException('Vui lòng đăng nhập lại.');
    return user;
  }

  private async assertCodeAttemptsAllowed(userId: string) {
    const window = await this.rateLimit.peek(`2fa-code:${userId}`);
    if (window && window.hits >= codeFailureLimit.limit) {
      throw new TooManyAttemptsException(
        'Nhập sai mã quá nhiều lần. Vui lòng thử lại sau ít phút.',
        Math.max(1, Math.ceil((window.resetAt - Date.now()) / 1000)),
      );
    }
  }

  private async recordCodeFailure(userId: string) {
    await this.rateLimit.consume(
      `2fa-code:${userId}`,
      codeFailureLimit.limit,
      codeFailureLimit.windowMs,
    );
  }
}

async function replaceRecoveryCodes(
  client: PoolClient,
  userId: string,
  codes: string[],
) {
  await client.query('DELETE FROM admin_recovery_codes WHERE user_id = $1', [
    userId,
  ]);
  await client.query(
    `INSERT INTO admin_recovery_codes (user_id, code_hash)
     SELECT $1, unnest($2::bytea[])`,
    [
      userId,
      codes.map((code) => hashRecoveryCode(normalizeRecoveryCode(code)!)),
    ],
  );
}

/** Xóa toàn bộ trạng thái 2FA của tài khoản (secret, mã khôi phục, thử thách). */
export async function clearTwoFactor(client: PoolClient, userId: string) {
  await client.query(
    `UPDATE admin_users
     SET totp_secret_enc = NULL, totp_pending_secret_enc = NULL,
         totp_pending_created_at = NULL, totp_enabled_at = NULL,
         totp_last_step = NULL
     WHERE id = $1`,
    [userId],
  );
  await client.query('DELETE FROM admin_recovery_codes WHERE user_id = $1', [
    userId,
  ]);
  await client.query(
    `UPDATE admin_login_challenges SET consumed_at = NOW()
     WHERE user_id = $1 AND consumed_at IS NULL`,
    [userId],
  );
}
