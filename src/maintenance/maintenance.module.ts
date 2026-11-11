import { Module } from '@nestjs/common';
import { ContactSubmissionsModule } from '../contact-submissions/contact-submissions.module.js';
import { MaintenanceService } from './maintenance.service.js';

@Module({
  imports: [ContactSubmissionsModule],
  providers: [MaintenanceService],
})
export class MaintenanceModule {}
