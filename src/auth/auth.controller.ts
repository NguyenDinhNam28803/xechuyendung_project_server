import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Ip,
  Post,
  UseGuards,
} from '@nestjs/common';
import { isRecord } from '../common/records.js';
import { RateLimit, RateLimitGuard } from '../security/rate-limit.guard.js';
import { AdminAuthGuard } from './admin-auth.guard.js';
import { AdminAuthService } from './admin-auth.service.js';
import {
  type AdminPrincipal,
  AllowWithoutTwoFactor,
  CurrentAdmin,
} from './admin-principal.js';
import { readSecondFactor } from './two-factor.service.js';

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly auth: AdminAuthService) {}

  /**
   * Hai lớp giới hạn:
   *  - Guard: 20 request/IP/15 phút, đếm mọi request, chống spam lưu lượng.
   *    Đủ rộng để nhiều người dùng chung một IP văn phòng không chặn nhau.
   *  - LoginThrottle (trong service): chỉ đếm lần SAI, theo cặp (IP, tài
   *    khoản) và theo tài khoản; xem login-throttle.ts.
   */
  @Post('login')
  @HttpCode(200)
  @RateLimit(20, 15 * 60 * 1000)
  @UseGuards(RateLimitGuard)
  login(
    @Body() body: unknown,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    if (!isRecord(body)) {
      throw new BadRequestException('Dữ liệu đăng nhập không hợp lệ.');
    }
    return this.auth.login(body.username, body.password, { ip, userAgent });
  }

  /**
   * Bước 2 khi tài khoản đã bật 2FA: `{ challengeToken, code }` hoặc
   * `{ challengeToken, recoveryCode }`. Cùng guard theo IP với bước 1.
   */
  @Post('login/verify')
  @HttpCode(200)
  @RateLimit(20, 15 * 60 * 1000)
  @UseGuards(RateLimitGuard)
  verifyLogin(
    @Body() body: unknown,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    if (!isRecord(body)) {
      throw new BadRequestException('Dữ liệu xác thực không hợp lệ.');
    }
    const { challengeToken, ...factor } = body;
    return this.auth.completeLogin(challengeToken, readSecondFactor(factor), {
      ip,
      userAgent,
    });
  }

  /** Thu hồi phiên hiện tại; token không còn dùng được kể cả khi bị lộ. */
  @Post('logout')
  @HttpCode(200)
  @UseGuards(AdminAuthGuard)
  @AllowWithoutTwoFactor()
  async logout(@CurrentAdmin() admin: AdminPrincipal) {
    await this.auth.logout(admin);
    return { ok: true };
  }

  @Get('me')
  @UseGuards(AdminAuthGuard)
  @AllowWithoutTwoFactor()
  me(@CurrentAdmin() admin: AdminPrincipal) {
    return {
      id: admin.id,
      username: admin.username,
      displayName: admin.displayName,
      role: admin.role,
      twoFactorEnabled: admin.twoFactorEnabled,
      twoFactorSetupRequired: admin.twoFactorSetupRequired,
    };
  }
}
