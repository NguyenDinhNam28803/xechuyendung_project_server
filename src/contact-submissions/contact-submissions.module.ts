import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { SecurityModule } from '../security/security.module.js';
import {
  AdminContactSubmissionsController,
  PublicContactSubmissionsController,
} from './contact-submissions.controller.js';
import { ContactSubmissionsService } from './contact-submissions.service.js';

@Module({
  imports: [ActivityModule, AuthModule, SecurityModule],
  controllers: [
    PublicContactSubmissionsController,
    AdminContactSubmissionsController,
  ],
  providers: [ContactSubmissionsService],
})
export class ContactSubmissionsModule {}
