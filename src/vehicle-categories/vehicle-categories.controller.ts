import {
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
import {
  parseVehicleCategoryInput,
  type VehicleCategoryInput,
  VehicleCategoriesService,
} from './vehicle-categories.service.js';

@Controller('api/v1/vehicle-categories')
export class PublicVehicleCategoriesController {
  constructor(private readonly categories: VehicleCategoriesService) {}

  @Get()
  findPublic() {
    return this.categories.findPublic();
  }
}

@Controller('api/v1/admin/vehicle-categories')
@UseGuards(AdminAuthGuard)
export class AdminVehicleCategoriesController {
  constructor(private readonly categories: VehicleCategoriesService) {}

  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('q') search?: string,
  ) {
    return this.categories.findAll(
      parsePaginationQuery(page, limit, search, 100),
    );
  }

  @Post()
  create(@Body() body: unknown, @CurrentActor() actor: Actor) {
    return this.categories.create(
      parseVehicleCategoryInput(body) as VehicleCategoryInput,
      actor,
    );
  }

  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @CurrentActor() actor: Actor,
  ) {
    return this.categories.update(
      id,
      parseVehicleCategoryInput(body, true),
      actor,
    );
  }

  @Delete(':id')
  async remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentActor() actor: Actor,
  ) {
    await this.categories.remove(id, actor);
    return { ok: true };
  }
}
