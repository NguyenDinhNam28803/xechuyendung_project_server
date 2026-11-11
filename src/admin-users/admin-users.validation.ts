import { BadRequestException } from '@nestjs/common';
import { adminRoles, type AdminRole } from '../auth/admin-principal.js';
import { assertPasswordPolicy } from '../auth/password.js';
import { isRecord } from '../common/records.js';

export type CreateAdminUserInput = {
  username: string;
  displayName: string;
  password: string;
  role: AdminRole;
};

export type UpdateAdminUserInput = Partial<{
  displayName: string;
  role: AdminRole;
  isActive: boolean;
  password: string;
}>;

export type ChangePasswordInput = {
  currentPassword: string;
  newPassword: string;
};

const usernamePattern = /^[a-zA-Z0-9._-]{3,60}$/;

function assertKnownFields(record: Record<string, unknown>, fields: string[]) {
  for (const key of Object.keys(record)) {
    if (!fields.includes(key)) {
      throw new BadRequestException(`Trường "${key}" không được hỗ trợ.`);
    }
  }
}

function readDisplayName(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120) {
    throw new BadRequestException('Tên hiển thị cần từ 1 đến 120 ký tự.');
  }
  return value.trim();
}

function readRole(value: unknown): AdminRole {
  if (!adminRoles.includes(value as AdminRole)) {
    throw new BadRequestException('Vai trò không hợp lệ.');
  }
  return value as AdminRole;
}

export function parseCreateAdminUser(value: unknown): CreateAdminUserInput {
  if (!isRecord(value)) {
    throw new BadRequestException('Dữ liệu tài khoản không hợp lệ.');
  }
  assertKnownFields(value, ['username', 'displayName', 'password', 'role']);
  if (
    typeof value.username !== 'string' ||
    !usernamePattern.test(value.username)
  ) {
    throw new BadRequestException(
      'Tên đăng nhập gồm 3–60 ký tự chữ, số, dấu chấm, gạch dưới hoặc gạch ngang.',
    );
  }
  return {
    username: value.username,
    displayName: readDisplayName(value.displayName),
    password: assertPasswordPolicy(value.password),
    role: readRole(value.role),
  };
}

export function parseUpdateAdminUser(value: unknown): UpdateAdminUserInput {
  if (!isRecord(value)) {
    throw new BadRequestException('Dữ liệu tài khoản không hợp lệ.');
  }
  assertKnownFields(value, ['displayName', 'role', 'isActive', 'password']);
  if (Object.keys(value).length === 0) {
    throw new BadRequestException(
      'Cần cung cấp ít nhất một trường để cập nhật.',
    );
  }
  const result: UpdateAdminUserInput = {};
  if ('displayName' in value)
    result.displayName = readDisplayName(value.displayName);
  if ('role' in value) result.role = readRole(value.role);
  if ('isActive' in value) {
    if (typeof value.isActive !== 'boolean') {
      throw new BadRequestException('Trạng thái tài khoản không hợp lệ.');
    }
    result.isActive = value.isActive;
  }
  if ('password' in value)
    result.password = assertPasswordPolicy(value.password);
  return result;
}

export function parseChangePassword(value: unknown): ChangePasswordInput {
  if (!isRecord(value)) {
    throw new BadRequestException('Dữ liệu đổi mật khẩu không hợp lệ.');
  }
  assertKnownFields(value, ['currentPassword', 'newPassword']);
  if (typeof value.currentPassword !== 'string' || !value.currentPassword) {
    throw new BadRequestException('Vui lòng nhập mật khẩu hiện tại.');
  }
  const newPassword = assertPasswordPolicy(value.newPassword);
  if (newPassword === value.currentPassword) {
    throw new BadRequestException('Mật khẩu mới cần khác mật khẩu hiện tại.');
  }
  return { currentPassword: value.currentPassword, newPassword };
}
