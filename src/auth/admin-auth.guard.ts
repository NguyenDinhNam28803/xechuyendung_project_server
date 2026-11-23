import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminAuthService } from './admin-auth.service.js';
import {
  type AdminRole,
  allowWithoutTwoFactorKey,
  type AuthenticatedRequest,
  rolesMetadataKey,
  twoFactorSetupRequiredCode,
} from './admin-principal.js';

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const match = request.headers.authorization?.match(/^Bearer ([^\s]+)$/);
    if (!match) {
      throw new UnauthorizedException('Vui lòng đăng nhập quản trị.');
    }
    const principal = await this.auth.authenticate(match[1]);
    if (!principal) {
      throw new UnauthorizedException(
        'Phiên đăng nhập đã hết hạn hoặc bị thu hồi. Vui lòng đăng nhập lại.',
      );
    }

    if (principal.twoFactorSetupRequired) {
      const allowed = this.reflector.getAllAndOverride<boolean | undefined>(
        allowWithoutTwoFactorKey,
        [context.getHandler(), context.getClass()],
      );
      if (!allowed) {
        throw new ForbiddenException({
          statusCode: 403,
          error: 'Forbidden',
          code: twoFactorSetupRequiredCode,
          message:
            'Tài khoản cần bật xác thực hai lớp trước khi tiếp tục sử dụng trang quản trị.',
        });
      }
    }

    const roles = this.reflector.getAllAndOverride<AdminRole[] | undefined>(
      rolesMetadataKey,
      [context.getHandler(), context.getClass()],
    );
    if (roles && !roles.includes(principal.role)) {
      throw new ForbiddenException(
        'Tài khoản không có quyền thực hiện thao tác này.',
      );
    }

    request.admin = principal;
    return true;
  }
}
