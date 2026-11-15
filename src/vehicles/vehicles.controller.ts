import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import {
  parseOptionalPublicPage,
  parsePaginationQuery,
  parsePublishedFilter,
} from '../common/pagination.js';
import { parseVehicleInput } from '../content/content-validation.js';
import { parseBulkRequest } from '../common/bulk-content.js';
import { parseSort } from '../common/sorting.js';
import {
  VehiclesService,
  vehicleSortColumns,
  vehicleDefaultOrder,
} from './vehicles.service.js';

@Controller('api/v1/vehicles')
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  findPublic(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('q') search?: string,
  ) {
    const query = parseOptionalPublicPage(page, limit, search);
    return query
      ? this.vehicles.findPublicPage(query)
      : this.vehicles.findPublic();
  }

  @Get(':slug')
  findPublicBySlug(@Param('slug') slug: string) {
    return this.vehicles.findPublicBySlug(slug);
  }
}

@Controller('api/v1/admin/vehicles')
@UseGuards(AdminAuthGuard)
export class AdminVehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('q') search?: string,
    @Query('published') published?: string,
    @Query('sort') sort?: string,
  ) {
    return this.vehicles.findAll(
      parsePaginationQuery(page, limit, search),
      parsePublishedFilter(published),
      parseSort(sort, vehicleSortColumns, vehicleDefaultOrder),
    );
  }

  /** Xuất bản / chuyển nháp / xóa nhiều mục: { ids, action }. */
  @Post('bulk')
  @HttpCode(200)
  bulk(@Body() body: unknown, @CurrentActor() actor: Actor) {
    return this.vehicles.bulk(parseBulkRequest(body), actor);
  }

  @Post()
  create(@Body() body: unknown, @CurrentActor() actor: Actor) {
    return this.vehicles.create(parseVehicleInput(body), actor);
  }

  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @CurrentActor() actor: Actor,
  ) {
    return this.vehicles.update(id, parseVehicleInput(body, true), actor);
  }

  @Delete(':id')
  async remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentActor() actor: Actor,
  ) {
    await this.vehicles.remove(id, actor);
    return { ok: true };
  }
}
