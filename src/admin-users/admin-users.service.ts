import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import { type Actor, insertActivity } from '../activity/activity.service.js';
import { revokeUserSessions } from '../auth/admin-auth.service.js';
import type { AdminPrincipal, AdminRole } from '../auth/admin-principal.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { rethrowUniqueViolation } from '../common/database-errors.js';
import { queryPage } from '../common/paged-query.js';
import type { PageResult, PaginationQuery } from '../common/pagination.js';
import { searchExpressions } from '../common/search.js';
import { DatabaseService } from '../database/database.service.js';
import type {
  ChangePasswordInput,
  CreateAdminUserInput,
  UpdateAdminUserInput,
} from './admin-users.validation.js';

type AdminUserRow = QueryResultRow & {
  id: string;
  username: string;
  displayName: string;
  role: AdminRole;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Không bao giờ trả password_hash ra ngoài. */
const selectedColumns = `
  id, username, display_name AS "displayName", role,
  is_active AS "isActive", last_login_at AS "lastLoginAt",
  created_at AS "createdAt", updated_at AS "updatedAt"
`;

export const adminUserSortColumns = {
  username: 'username',
  displayName: 'display_name',
  role: 'role',
  isActive: 'is_active',
  lastLoginAt: 'last_login_at',
  createdAt: 'created_at',
};
export const adminUserDefaultOrder = 'created_at ASC, id';

/** Khóa advisory tuần tự hóa các thay đổi có thể làm mất quản trị viên cuối. */
const adminRosterLockKey = 7_804_202_031;

@Injectable()
export class AdminUsersService {
  constructor(private readonly database: DatabaseService) {}

  findAll(
    query: PaginationQuery,
    orderBy = adminUserDefaultOrder,
  ): Promise<PageResult<AdminUserRow>> {
    return queryPage<AdminUserRow>(
      this.database,
      {
        columns: selectedColumns,
        table: 'admin_users',
        searchExpression: searchExpressions.adminUsers,
        orderBy,
      },
      query,
    );
  }

  async create(input: CreateAdminUserInput, actor: Actor) {
    const passwordHash = await hashPassword(input.password);
    try {
      return await this.database.withTransaction(async (client) => {
        const result = await client.query<AdminUserRow>(
          `INSERT INTO admin_users (username, display_name, password_hash, role)
           VALUES ($1, $2, $3, $4)
           RETURNING ${selectedColumns}`,
          [input.username, input.displayName, passwordHash, input.role],
        );
        const user = result.rows[0];
        await insertActivity(client, {
          actor,
          action: 'CREATE',
          entityType: 'admin_user',
          entityId: user.id,
          entityLabel: `Tạo tài khoản ${user.username} (${user.role})`,
        });
        return user;
      });
    } catch (error) {
      rethrowUniqueViolation(error, 'Tên đăng nhập đã tồn tại.');
    }
  }

  async update(id: string, input: UpdateAdminUserInput, admin: AdminPrincipal) {
    if (
      id === admin.id &&
      (input.role !== undefined || input.isActive === false)
    ) {
      throw new BadRequestException(
        'Không thể tự đổi vai trò hoặc tự khóa tài khoản đang đăng nhập.',
      );
    }
    const passwordHash =
      input.password !== undefined
        ? await hashPassword(input.password)
        : undefined;

    return this.database.withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock($1)', [
        adminRosterLockKey,
      ]);

      const assignments: string[] = [];
      const values: unknown[] = [];
      const set = (column: string, value: unknown) => {
        values.push(value);
        assignments.push(`${column} = $${values.length}`);
      };
      if (input.displayName !== undefined)
        set('display_name', input.displayName);
      if (input.role !== undefined) set('role', input.role);
      if (input.isActive !== undefined) set('is_active', input.isActive);
      if (passwordHash !== undefined) {
        set('password_hash', passwordHash);
        assignments.push('password_changed_at = NOW()');
      }
      values.push(id);

      const result = await client.query<AdminUserRow>(
        `UPDATE admin_users SET ${assignments.join(', ')}
         WHERE id = $${values.length}
         RETURNING ${selectedColumns}`,
        values,
      );
      const user = result.rows[0];
      if (!user) throw new NotFoundException('Không tìm thấy tài khoản.');

      await assertActiveAdministratorRemains(client);

      // Đổi quyền, khóa tài khoản hay đặt lại mật khẩu đều có hiệu lực ngay:
      // mọi phiên đang mở của tài khoản đó bị thu hồi.
      if (
        input.role !== undefined ||
        input.isActive === false ||
        passwordHash !== undefined
      ) {
        await revokeUserSessions(client, user.id);
      }

      await insertActivity(client, {
        actor: { id: admin.id, username: admin.username },
        action: 'UPDATE',
        entityType: 'admin_user',
        entityId: user.id,
        entityLabel: describeUpdate(user.username, input),
      });
      return user;
    });
  }

  async changeOwnPassword(admin: AdminPrincipal, input: ChangePasswordInput) {
    const current = await this.database.query<{ passwordHash: string }>(
      'SELECT password_hash AS "passwordHash" FROM admin_users WHERE id = $1',
      [admin.id],
    );
    const stored = current.rows[0]?.passwordHash;
    if (!stored || !(await verifyPassword(input.currentPassword, stored))) {
      throw new BadRequestException('Mật khẩu hiện tại không đúng.');
    }
    const passwordHash = await hashPassword(input.newPassword);
    await this.database.withTransaction(async (client) => {
      await client.query(
        `UPDATE admin_users
         SET password_hash = $1, password_changed_at = NOW()
         WHERE id = $2`,
        [passwordHash, admin.id],
      );
      // Giữ phiên hiện tại, đăng xuất mọi thiết bị khác.
      await revokeUserSessions(client, admin.id, admin.sessionId);
      await insertActivity(client, {
        actor: { id: admin.id, username: admin.username },
        action: 'UPDATE',
        entityType: 'admin_user',
        entityId: admin.id,
        entityLabel: `Đổi mật khẩu: ${admin.username}`,
      });
    });
    return { ok: true };
  }
}

type SessionRow = QueryResultRow & {
  id: string;
  userAgent: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
};

/** Phiên còn hiệu lực (chưa thu hồi, chưa hết hạn), mới nhất trước. */
async function listActiveSessions(
  database: DatabaseService,
  userId: string,
  currentSessionId?: string,
) {
  const result = await database.query<SessionRow>(
    `SELECT id, user_agent AS "userAgent", created_at AS "createdAt",
            last_seen_at AS "lastSeenAt", expires_at AS "expiresAt"
     FROM admin_sessions
     WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
     ORDER BY last_seen_at DESC, id`,
    [userId],
  );
  return result.rows.map((row) => ({
    ...row,
    current: row.id === currentSessionId,
  }));
}

/** Quản lý phiên đăng nhập (thiết bị) của chính mình và của người khác. */
@Injectable()
export class AdminSessionsService {
  constructor(private readonly database: DatabaseService) {}

  listOwn(admin: AdminPrincipal) {
    return listActiveSessions(this.database, admin.id, admin.sessionId);
  }

  /** Đăng xuất một thiết bị khác. Phiên hiện tại dùng /auth/logout. */
  async revokeOwn(admin: AdminPrincipal, sessionId: string) {
    if (sessionId === admin.sessionId) {
      throw new BadRequestException(
        'Đây là phiên hiện tại. Hãy dùng nút Đăng xuất.',
      );
    }
    await this.database.withTransaction(async (client) => {
      const result = await client.query<{ userAgent: string | null }>(
        `UPDATE admin_sessions SET revoked_at = NOW()
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
         RETURNING user_agent AS "userAgent"`,
        [sessionId, admin.id],
      );
      if (!result.rows[0]) {
        throw new NotFoundException('Không tìm thấy phiên đăng nhập.');
      }
      await insertActivity(client, {
        actor: { id: admin.id, username: admin.username },
        action: 'LOGOUT',
        entityType: 'admin_user',
        entityId: admin.id,
        entityLabel: `Đăng xuất thiết bị khác: ${admin.username}`,
      });
    });
    return { ok: true };
  }

  async listForUser(userId: string) {
    await this.assertUserExists(userId);
    return listActiveSessions(this.database, userId);
  }

  /**
   * Thu hồi mọi phiên của một tài khoản (ví dụ nghi lộ mật khẩu). Khi áp
   * dụng cho chính mình, phiên hiện tại được giữ lại.
   */
  async revokeAllForUser(userId: string, admin: AdminPrincipal) {
    return this.database.withTransaction(async (client) => {
      const user = await client.query<{ username: string }>(
        'SELECT username FROM admin_users WHERE id = $1',
        [userId],
      );
      if (!user.rows[0]) {
        throw new NotFoundException('Không tìm thấy tài khoản.');
      }
      const result = await client.query(
        `UPDATE admin_sessions SET revoked_at = NOW()
         WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
           AND ($2::uuid IS NULL OR id <> $2::uuid)`,
        [userId, userId === admin.id ? admin.sessionId : null],
      );
      const revoked = result.rowCount ?? 0;
      await insertActivity(client, {
        actor: { id: admin.id, username: admin.username },
        action: 'UPDATE',
        entityType: 'admin_user',
        entityId: userId,
        entityLabel: `Thu hồi ${revoked} phiên đăng nhập của ${user.rows[0].username}`,
      });
      return { revoked };
    });
  }

  private async assertUserExists(userId: string) {
    const result = await this.database.query(
      'SELECT 1 FROM admin_users WHERE id = $1',
      [userId],
    );
    if (!result.rowCount) {
      throw new NotFoundException('Không tìm thấy tài khoản.');
    }
  }
}

async function assertActiveAdministratorRemains(client: PoolClient) {
  const result = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM admin_users
     WHERE role = 'admin' AND is_active = TRUE`,
  );
  if (Number(result.rows[0].count) === 0) {
    throw new ConflictException(
      'Hệ thống cần ít nhất một quản trị viên đang hoạt động.',
    );
  }
}

function describeUpdate(username: string, input: UpdateAdminUserInput) {
  const changes: string[] = [];
  if (input.displayName !== undefined) changes.push('tên hiển thị');
  if (input.role !== undefined) changes.push(`vai trò → ${input.role}`);
  if (input.isActive !== undefined)
    changes.push(input.isActive ? 'mở khóa' : 'khóa');
  if (input.password !== undefined) changes.push('đặt lại mật khẩu');
  return `Cập nhật tài khoản ${username}: ${changes.join(', ')}`;
}
