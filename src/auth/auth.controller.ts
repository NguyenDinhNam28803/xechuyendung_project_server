import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { isRecord } from '../common/records.js';
import { RateLimit, RateLimitGuard } from '../security/rate-limit.guard.js';
import { AdminAuthGuard } from './admin-auth.guard.js';
import { AdminAuthService } from './admin-auth.service.js';
import { type AdminPrincipal, CurrentAdmin } from './admin-principal.js';

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post('login')
  @HttpCode(200)
  @RateLimit(5, 15 * 60 * 1000)
  @UseGuards(RateLimitGuard)
  login(@Body() body: unknown, @Headers('user-agent') userAgent?: string) {
    if (!isRecord(body)) {
      throw new BadRequestException('Dữ liệu đăng nhập không hợp lệ.');
    }
    return this.auth.login(body.username, body.password, { userAgent });
  }

  /** Thu hồi phiên hiện tại; token không còn dùng được kể cả khi bị lộ. */
  @Post('logout')
  @HttpCode(200)
  @UseGuards(AdminAuthGuard)
  async logout(@CurrentAdmin() admin: AdminPrincipal) {
    await this.auth.logout(admin);
    return { ok: true };
  }

  @Get('me')
  @UseGuards(AdminAuthGuard)
  me(@CurrentAdmin() admin: AdminPrincipal) {
    return {
      id: admin.id,
      username: admin.username,
      displayName: admin.displayName,
      role: admin.role,
    };
  }
}
