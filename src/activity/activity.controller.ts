import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { parsePaginationQuery } from '../common/pagination.js';
import { parseDateParam, readOptionalEnum } from '../common/validation.js';
import { AdminAuthGuard } from '../auth/admin-auth.guard.js';
import {
  activityActionValues,
  activityEntityValues,
  ActivityService,
} from './activity.service.js';

@Controller('api/v1/admin/activity')
@UseGuards(AdminAuthGuard)
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  /**
   * Lịch sử thao tác, lọc tùy chọn theo `action`, `entityType` và khoảng ngày
   * `from`..`to` (YYYY-MM-DD, tính theo giờ Việt Nam, bao gồm hai đầu).
   */
  @Get()
  findRecent(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('q') search?: string,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const filters = {
      action: readOptionalEnum(action, activityActionValues, 'action'),
      entityType: readOptionalEnum(
        entityType,
        activityEntityValues,
        'entityType',
      ),
      from: parseDateParam(from, 'from'),
      to: parseDateParam(to, 'to'),
    };
    if (filters.from && filters.to && filters.from > filters.to) {
      throw new BadRequestException('"from" phải trước hoặc bằng "to".');
    }
    return this.activity.findRecent(
      parsePaginationQuery(page, limit, search, 100),
      filters,
    );
  }
}
