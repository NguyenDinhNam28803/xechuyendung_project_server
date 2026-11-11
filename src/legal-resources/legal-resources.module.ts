import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import {
  AdminLegalResourcesController,
  PublicLegalResourcesController,
} from './legal-resources.controller.js';
import { LegalResourcesService } from './legal-resources.service.js';

@Module({
  imports: [AuthModule],
  controllers: [PublicLegalResourcesController, AdminLegalResourcesController],
  providers: [LegalResourcesService],
})
export class LegalResourcesModule {}
