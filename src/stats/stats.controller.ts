import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../auth/admin-auth.guard.js';
import { parseIntegerParam } from '../common/validation.js';
import { StatsService } from './stats.service.js';

/** Khoảng thời gian tối đa của biểu đồ (ngày). */
const maximumRangeDays = 365;

@Controller('api/v1/admin/stats')
@UseGuards(AdminAuthGuard)
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  /** Toàn bộ chỉ số của trang tổng quan trong MỘT request. */
  @Get('overview')
  overview() {
    return this.stats.overview();
  }

  @Get('contacts')
  contacts(@Query('days') days?: string) {
    return this.stats.contacts(
      parseIntegerParam(days, 'days', 7, maximumRangeDays, 30),
    );
  }

  @Get('activity')
  activity(@Query('days') days?: string) {
    return this.stats.activity(
      parseIntegerParam(days, 'days', 7, maximumRangeDays, 30),
    );
  }
}
