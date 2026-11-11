import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import { type Actor, insertActivity } from '../activity/activity.service.js';
import { insertArticleIfMissing } from '../articles/articles.service.js';
import { AdminAuthGuard } from '../auth/admin-auth.guard.js';
import { CurrentActor } from '../auth/admin-principal.js';
import { isRecord } from '../common/records.js';
import {
  parseArticleInput,
  parseVehicleInput,
} from '../content/content-validation.js';
import { DatabaseService } from '../database/database.service.js';
import { insertVehicleIfMissing } from '../vehicles/vehicles.service.js';

const maximumImportItems = 200;

/**
 * Nhập nội dung mẫu còn thiếu (theo slug). Nội dung nhập luôn ở trạng thái
 * NHÁP bất kể payload: nội dung mẫu cần được người quản trị duyệt trước khi
 * hiển thị cho khách hàng.
 */
@Controller('api/v1/admin/import-defaults')
@UseGuards(AdminAuthGuard)
export class ContentImportController {
  constructor(private readonly database: DatabaseService) {}

  @Post()
  async importDefaults(@Body() body: unknown, @CurrentActor() actor: Actor) {
    if (
      !isRecord(body) ||
      !Array.isArray(body.vehicles) ||
      !Array.isArray(body.articles) ||
      body.vehicles.length + body.articles.length > maximumImportItems
    ) {
      throw new BadRequestException('Dữ liệu mẫu không hợp lệ.');
    }
    const vehicleInputs = body.vehicles.map((value: unknown) => ({
      ...parseVehicleInput(value),
      isPublished: false,
    }));
    const articleInputs = body.articles.map((value: unknown) => ({
      ...parseArticleInput(value),
      isPublished: false,
    }));

    return this.database.withTransaction(async (client) => {
      let vehiclesImported = 0;
      let articlesImported = 0;
      for (const vehicle of vehicleInputs) {
        const result = await insertVehicleIfMissing(client, vehicle);
        vehiclesImported += result.rowCount ?? 0;
      }
      for (const article of articleInputs) {
        const result = await insertArticleIfMissing(client, article);
        articlesImported += result.rowCount ?? 0;
      }
      if (vehiclesImported + articlesImported > 0) {
        await insertActivity(client, {
          actor,
          action: 'IMPORT',
          entityType: 'system',
          entityId: null,
          entityLabel: `Nhập ${vehiclesImported} xe và ${articlesImported} bài viết mẫu (bản nháp)`,
        });
      }
      return { vehiclesImported, articlesImported };
    });
  }
}
