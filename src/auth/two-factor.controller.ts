import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { isRecord } from '../common/records.js';
import { AdminAuthGuard } from './admin-auth.guard.js';
import {
  type AdminPrincipal,
  AllowWithoutTwoFactor,
  CurrentAdmin,
  Roles,
} from './admin-principal.js';
import { TwoFactorService } from './two-factor.service.js';

function readBody(body: unknown) {
  if (!isRecord(body)) {
    throw new BadRequestException('Dữ liệu gửi lên không hợp lệ.');
  }
  return body;
}

/**
 * 2FA của chính tài khoản đang đăng nhập. Xem trạng thái và đăng ký dùng được
 * cả khi phiên đang bị hạn chế (vai trò bắt buộc 2FA nhưng chưa đăng ký).
 */
@Controller('api/v1/admin/account/2fa')
@UseGuards(AdminAuthGuard)
export class TwoFactorController {
  constructor(private readonly twoFactor: TwoFactorService) {}

  @Get()
  @AllowWithoutTwoFactor()
  status(@CurrentAdmin() admin: AdminPrincipal) {
    return this.twoFactor.status(admin);
  }

  @Post('setup')
  @HttpCode(200)
  @AllowWithoutTwoFactor()
  setup(@CurrentAdmin() admin: AdminPrincipal) {
    return this.twoFactor.startEnrollment(admin);
  }

  @Post('confirm')
  @HttpCode(200)
  @AllowWithoutTwoFactor()
  confirm(@Body() body: unknown, @CurrentAdmin() admin: AdminPrincipal) {
    return this.twoFactor.confirmEnrollment(admin, readBody(body));
  }

  @Post('disable')
  @HttpCode(200)
  disable(@Body() body: unknown, @CurrentAdmin() admin: AdminPrincipal) {
    return this.twoFactor.disable(admin, readBody(body));
  }

  @Post('recovery-codes')
  @HttpCode(200)
  regenerate(@Body() body: unknown, @CurrentAdmin() admin: AdminPrincipal) {
    return this.twoFactor.regenerateRecoveryCodes(admin, readBody(body));
  }
}

/** Admin đặt lại 2FA cho tài khoản khác khi người đó mất thiết bị. */
@Controller('api/v1/admin/users')
@UseGuards(AdminAuthGuard)
@Roles('admin')
export class TwoFactorAdminController {
  constructor(private readonly twoFactor: TwoFactorService) {}

  @Post(':id/2fa/reset')
  @HttpCode(200)
  reset(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ) {
    return this.twoFactor.resetForUser(id, admin);
  }
}
