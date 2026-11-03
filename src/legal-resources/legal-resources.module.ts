import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module.js';
import { AuthModule } from '../auth/auth.module.js';
import {
  AdminLegalResourcesController,
  PublicLegalResourcesController,
} from './legal-resources.controller.js';
import { LegalResourcesService } from './legal-resources.service.js';

@Module({
  imports: [AuthModule, ActivityModule],
  controllers: [PublicLegalResourcesController, AdminLegalResourcesController],
  providers: [LegalResourcesService],
  exports: [LegalResourcesService],
})
export class LegalResourcesModule {}
