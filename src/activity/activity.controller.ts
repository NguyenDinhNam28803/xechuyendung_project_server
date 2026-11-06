import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { parsePaginationQuery } from '../common/pagination.js';
import { AdminAuthGuard } from '../auth/admin-auth.guard.js';
import { ActivityService } from './activity.service.js';

@Controller('api/v1/admin/activity')
@UseGuards(AdminAuthGuard)
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  findRecent(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('q') search?: string,
  ) {
    return this.activity.findRecent(
      parsePaginationQuery(page, limit, search, 100),
    );
  }
}
