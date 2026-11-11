import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { Actor } from '../activity/activity.service.js';
import { AdminAuthGuard } from '../auth/admin-auth.guard.js';
import { CurrentActor } from '../auth/admin-principal.js';
import { parsePaginationQuery } from '../common/pagination.js';
import {
  parseLegalResourceInput,
  type LegalResourceType,
} from '../content/content-validation.js';
import { LegalResourcesService } from './legal-resources.service.js';

const resourceTypes = new Set<LegalResourceType>([
  'policy',
  'regulation',
  'legal_guide',
]);

@Controller('api/v1/legal-resources')
export class PublicLegalResourcesController {
  constructor(private readonly legalResources: LegalResourcesService) {}

  @Get()
  findPublic(@Query('type') type?: string) {
    if (type !== undefined && !resourceTypes.has(type as LegalResourceType)) {
      throw new BadRequestException('Loại tài liệu không hợp lệ.');
    }
    return this.legalResources.findPublic(
      type as LegalResourceType | undefined,
    );
  }
}

@Controller('api/v1/admin/legal-resources')
@UseGuards(AdminAuthGuard)
export class AdminLegalResourcesController {
  constructor(private readonly legalResources: LegalResourcesService) {}

  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('q') search?: string,
    @Query('type') type?: string,
  ) {
    if (type !== undefined && !resourceTypes.has(type as LegalResourceType)) {
      throw new BadRequestException('Loại tài liệu không hợp lệ.');
    }
    return this.legalResources.findAll(
      parsePaginationQuery(page, limit, search),
      type as LegalResourceType | undefined,
    );
  }

  @Post()
  create(@Body() body: unknown, @CurrentActor() actor: Actor) {
    return this.legalResources.create(parseLegalResourceInput(body), actor);
  }

  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @CurrentActor() actor: Actor,
  ) {
    return this.legalResources.update(
      id,
      parseLegalResourceInput(body, true),
      actor,
    );
  }

  @Delete(':id')
  async remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentActor() actor: Actor,
  ) {
    await this.legalResources.remove(id, actor);
    return { ok: true };
  }
}
