import {
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Actor } from '../activity/activity.service.js';

export type AdminRole = 'admin' | 'editor';

export const adminRoles: readonly AdminRole[] = ['admin', 'editor'];

/** Người dùng quản trị đã xác thực của request hiện tại. */
export type AdminPrincipal = {
  id: string;
  username: string;
  displayName: string;
  role: AdminRole;
  sessionId: string;
  twoFactorEnabled: boolean;
  /**
   * Vai trò bắt buộc 2FA nhưng tài khoản chưa đăng ký: phiên bị hạn chế, chỉ
   * dùng được các route gắn @AllowWithoutTwoFactor() (thiết lập 2FA, me,
   * đăng xuất) cho tới khi đăng ký xong.
   */
  twoFactorSetupRequired: boolean;
};

export type AuthenticatedRequest = Request & { admin?: AdminPrincipal };

export function toActor(principal: AdminPrincipal): Actor {
  return { id: principal.id, username: principal.username };
}

export const rolesMetadataKey = 'admin-roles';
export const allowWithoutTwoFactorKey = 'admin-allow-without-two-factor';

/** Route dùng được cả khi phiên đang bị hạn chế vì chưa đăng ký 2FA bắt buộc. */
export const AllowWithoutTwoFactor = () =>
  SetMetadata(allowWithoutTwoFactorKey, true);

/** Mã lỗi máy đọc được để client chuyển tới trang thiết lập 2FA. */
export const twoFactorSetupRequiredCode = 'TWO_FACTOR_SETUP_REQUIRED';

/**
 * Giới hạn route cho các vai trò được liệt kê. Route không gắn @Roles chỉ cần
 * đăng nhập (mọi vai trò).
 *  - admin: toàn quyền, gồm quản lý tài khoản.
 *  - editor: quản lý nội dung và hộp thư liên hệ.
 */
export const Roles = (...roles: AdminRole[]) =>
  SetMetadata(rolesMetadataKey, roles);

/** Lấy người dùng đã được AdminAuthGuard gắn vào request. */
export const CurrentAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AdminPrincipal => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.admin) {
      throw new Error('CurrentAdmin used on a route without AdminAuthGuard.');
    }
    return request.admin;
  },
);

/** Actor của request hiện tại, dùng trực tiếp cho audit log. */
export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Actor => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.admin) {
      throw new Error('CurrentActor used on a route without AdminAuthGuard.');
    }
    return toActor(request.admin);
  },
);
