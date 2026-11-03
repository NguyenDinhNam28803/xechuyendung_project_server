import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service.js';

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post('login')
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
