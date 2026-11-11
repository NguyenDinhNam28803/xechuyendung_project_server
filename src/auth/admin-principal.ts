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
};

export type AuthenticatedRequest = Request & { admin?: AdminPrincipal };

export function toActor(principal: AdminPrincipal): Actor {
  return { id: principal.id, username: principal.username };
}

export const rolesMetadataKey = 'admin-roles';

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
