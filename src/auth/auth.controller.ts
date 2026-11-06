import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RateLimit, RateLimitGuard } from '../security/rate-limit.guard.js';
import { AdminAuthService } from './admin-auth.service.js';

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post('login')
  @RateLimit(5, 15 * 60 * 1000)
  @UseGuards(RateLimitGuard)
  login(@Body() body: unknown) {
    if (!isRecord(body)) {
      throw new BadRequestException('Dữ liệu đăng nhập không hợp lệ.');
    }
    return this.auth.login(body.username, body.password);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
