import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ParseUUIDPipe } from '@nestjs/common';
import { insertActivity } from '../activity/activity.service.js';
import { AdminAuthGuard } from '../auth/admin-auth.guard.js';
import { insertArticle } from '../articles/articles.service.js';
import {
  parseArticleInput,
  parseVehicleInput,
} from '../content/content-validation.js';
import { DatabaseService } from '../database/database.service.js';
import { insertVehicle, VehiclesService } from './vehicles.service.js';

@Controller('api/v1/vehicles')
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  findPublic() {
    return this.vehicles.findPublic();
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
  findAll() {
    return this.vehicles.findAll();
  }

  @Post()
  create(@Body() body: unknown) {
    return this.vehicles.create(parseVehicleInput(body));
  }

  @Patch(':id')
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.vehicles.update(id, parseVehicleInput(body, true));
  }

  @Delete(':id')
  async remove(@Param('id', new ParseUUIDPipe()) id: string) {
    await this.vehicles.remove(id);
    return { ok: true };
  }
}

@Controller('api/v1/admin/import-defaults')
@UseGuards(AdminAuthGuard)
export class ImportDefaultsController {
  constructor(private readonly database: DatabaseService) {}

  @Post()
  async importDefaults(@Body() body: unknown) {
    if (
      typeof body !== 'object' ||
      body === null ||
      Array.isArray(body) ||
      !('vehicles' in body) ||
      !Array.isArray(body.vehicles) ||
      !('articles' in body) ||
      !Array.isArray(body.articles)
    ) {
      throw new BadRequestException('Dữ liệu mẫu không hợp lệ.');
    }
    const vehicleInputs = body.vehicles.map((value: unknown) =>
      parseVehicleInput(value),
    );
    const articleInputs = body.articles.map((value: unknown) =>
      parseArticleInput(value),
    );
    return this.database.withTransaction(async (client) => {
      let vehiclesImported = 0;
      let articlesImported = 0;
      for (const vehicle of vehicleInputs) {
        const result = await insertVehicle(client, vehicle);
        vehiclesImported += result.rowCount ?? 0;
      }
      for (const article of articleInputs) {
        const result = await insertArticle(client, article);
        articlesImported += result.rowCount ?? 0;
      }
      if (vehiclesImported + articlesImported > 0) {
        await insertActivity(client, {
          action: 'IMPORT',
          entityType: 'system',
          entityId: null,
          entityLabel: `Nhập ${vehiclesImported} xe và ${articlesImported} bài viết mẫu`,
        });
      }
      return { vehiclesImported, articlesImported };
    });
  }
}
