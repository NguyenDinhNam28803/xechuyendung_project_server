import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../auth/admin-auth.guard.js';
import { ActivityService } from './activity.service.js';

@Controller('api/v1/admin/activity')
@UseGuards(AdminAuthGuard)
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  findRecent() {
    return this.activity.findRecent();
  }
}
