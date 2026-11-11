import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SecurityModule } from '../security/security.module.js';
import {
  AdminContactSubmissionsController,
  PublicContactSubmissionsController,
} from './contact-submissions.controller.js';
import { ContactSubmissionsService } from './contact-submissions.service.js';

@Module({
  imports: [AuthModule, SecurityModule],
  controllers: [
    PublicContactSubmissionsController,
    AdminContactSubmissionsController,
  ],
  providers: [ContactSubmissionsService],
  exports: [ContactSubmissionsService],
})
export class ContactSubmissionsModule {}
