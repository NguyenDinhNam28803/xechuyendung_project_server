import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AdminAuthGuard } from './admin-auth.guard.js';
import { AdminAuthService } from './admin-auth.service.js';

@Module({
  controllers: [AuthController],
  providers: [AdminAuthGuard, AdminAuthService],
  exports: [AdminAuthGuard, AdminAuthService],
})
export class AuthModule {}
