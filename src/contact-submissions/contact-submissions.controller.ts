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
import { AdminAuthGuard } from '../auth/admin-auth.guard.js';
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
  findRecent(@Query('limit') limit?: string) {
    const parsedLimit = limit === undefined ? 200 : Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
      throw new BadRequestException('Giới hạn danh sách không hợp lệ.');
    }
    return this.submissions.findRecent(parsedLimit);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
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
    return this.submissions.updateStatus(id, body.status as ContactStatus);
  }

  @Delete(':id')
  async remove(@Param('id', new ParseUUIDPipe()) id: string) {
    await this.submissions.remove(id);
    return { ok: true };
  }
}
