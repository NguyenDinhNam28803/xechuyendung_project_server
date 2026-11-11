import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { Actor } from '../activity/activity.service.js';
import { AdminAuthGuard } from '../auth/admin-auth.guard.js';
import { CurrentActor } from '../auth/admin-principal.js';
import { parsePaginationQuery } from '../common/pagination.js';
import { RateLimit, RateLimitGuard } from '../security/rate-limit.guard.js';
import {
  ContactSubmissionsService,
  type ContactStatus,
} from './contact-submissions.service.js';
import { parseContactSubmission } from './contact-submissions.validation.js';

const allowedStatuses = new Set<ContactStatus>([
  'new',
  'in_progress',
  'contacted',
  'closed',
  'spam',
]);

@Controller('api/v1/contact-submissions')
export class PublicContactSubmissionsController {
  constructor(private readonly submissions: ContactSubmissionsService) {}

  @Post()
  @RateLimit(10, 60 * 60 * 1000)
  @UseGuards(RateLimitGuard)
  create(@Body() body: unknown) {
    if (
      typeof body === 'object' &&
      body !== null &&
      !Array.isArray(body) &&
      'companyWebsite' in body &&
      typeof body.companyWebsite === 'string' &&
      body.companyWebsite.trim()
    ) {
      throw new BadRequestException('Không thể tiếp nhận yêu cầu này.');
    }
    return this.submissions.create(parseContactSubmission(body));
  }
}

@Controller('api/v1/admin/contact-submissions')
@UseGuards(AdminAuthGuard)
export class AdminContactSubmissionsController {
  constructor(private readonly submissions: ContactSubmissionsService) {}

  @Get()
  findRecent(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.submissions.findRecent(
      parsePaginationQuery(page, limit, undefined, 25),
    );
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @CurrentActor() actor: Actor,
  ) {
    if (
      typeof body !== 'object' ||
      body === null ||
      Array.isArray(body) ||
      !('status' in body) ||
      typeof body.status !== 'string' ||
      !allowedStatuses.has(body.status as ContactStatus)
    ) {
      throw new BadRequestException('Trạng thái yêu cầu không hợp lệ.');
    }
    return this.submissions.updateStatus(
      id,
      body.status as ContactStatus,
      actor,
    );
  }

  @Post('search')
  search(@Body() body: unknown) {
    if (
      typeof body !== 'object' ||
      body === null ||
      Array.isArray(body) ||
      Object.keys(body).some(
        (key) => !['page', 'limit', 'search'].includes(key),
      )
    ) {
      throw new BadRequestException('Bộ lọc yêu cầu liên hệ không hợp lệ.');
    }
    const record = body as Record<string, unknown>;
    if (
      (record.page !== undefined && typeof record.page !== 'number') ||
      (record.limit !== undefined && typeof record.limit !== 'number') ||
      (record.search !== undefined && typeof record.search !== 'string')
    ) {
      throw new BadRequestException('Bộ lọc yêu cầu liên hệ không hợp lệ.');
    }
    const page = record.page;
    const limit = record.limit;
    const search = record.search;
    return this.submissions.findRecent(
      parsePaginationQuery(
        typeof page === 'number' ? String(page) : undefined,
        typeof limit === 'number' ? String(limit) : undefined,
        typeof search === 'string' ? search : undefined,
        25,
      ),
    );
  }

  @Delete(':id')
  async remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentActor() actor: Actor,
  ) {
    await this.submissions.remove(id, actor);
    return { ok: true };
  }
}
