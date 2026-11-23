import { Module } from '@nestjs/common';
import { SecurityModule } from '../security/security.module.js';
import { AuthController } from './auth.controller.js';
import { AdminAuthGuard } from './admin-auth.guard.js';
import { AdminAuthService } from './admin-auth.service.js';
import { LoginThrottle } from './login-throttle.js';

@Module({
  imports: [SecurityModule],
  controllers: [AuthController],
  providers: [AdminAuthGuard, AdminAuthService, LoginThrottle],
  exports: [AdminAuthGuard, AdminAuthService],
})
export class AuthModule {}
