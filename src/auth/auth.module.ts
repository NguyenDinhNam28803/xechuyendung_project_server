import { Module } from '@nestjs/common';
import { SecurityModule } from '../security/security.module.js';
import { AuthController } from './auth.controller.js';
import { AdminAuthGuard } from './admin-auth.guard.js';
import { AdminAuthService } from './admin-auth.service.js';
import { LoginThrottle } from './login-throttle.js';
import {
  TwoFactorAdminController,
  TwoFactorController,
} from './two-factor.controller.js';
import { TwoFactorService } from './two-factor.service.js';

@Module({
  imports: [SecurityModule],
  controllers: [AuthController, TwoFactorController, TwoFactorAdminController],
  providers: [
    AdminAuthGuard,
    AdminAuthService,
    LoginThrottle,
    TwoFactorService,
  ],
  exports: [AdminAuthGuard, AdminAuthService, TwoFactorService],
})
export class AuthModule {}
