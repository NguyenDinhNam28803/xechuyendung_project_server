import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import { type Actor, insertActivity } from '../activity/activity.service.js';
import { rethrowUniqueViolation } from '../common/database-errors.js';
import { queryPage } from '../common/paged-query.js';
import type { PageResult, PaginationQuery } from '../common/pagination.js';
import { readBody, readInteger, readText } from '../common/validation.js';
import { DatabaseService } from '../database/database.service.js';

export type VehicleCategoryInput = {
  name: string;
  description: string;
  sortOrder: number;
};

type CategoryRow = QueryResultRow & {
  id: string;
  name: string;
  description: string;
  sortOrder: number;
  vehicleCount: number;
  createdAt: Date;
  updatedAt: Date;
};

const fields = ['name', 'description', 'sortOrder'] as const;

export function parseVehicleCategoryInput(
  body: unknown,
  partial = false,
): Partial<VehicleCategoryInput> {
  const record = readBody(body, fields);
  if (partial && Object.keys(record).length === 0) {
    throw new BadRequestException('Không có thay đổi nào để lưu.');
  }
  const input: Partial<VehicleCategoryInput> = {};
  if (!partial || record.name !== undefined) {
    input.name = readText(record.name, 'name', 100);
  }
  if (record.description !== undefined) {
    input.description = readText(record.description, 'description', 500, {
      allowEmpty: true,
    });
  } else if (!partial) {
    input.description = '';
  }
  if (record.sortOrder !== undefined) {
    input.sortOrder = readInteger(record.sortOrder, 'sortOrder', 0, 10_000);
  } else if (!partial) {
    input.sortOrder = 0;
  }
  return input;
}

const selectedColumns = `
  c.id, c.name, c.description, c.sort_order AS "sortOrder",
  (SELECT COUNT(*) FROM vehicles v WHERE v.category = c.name)::int AS "vehicleCount",
  c.created_at AS "createdAt", c.updated_at AS "updatedAt"
`;
const conflictMessage = 'Danh mục này đã tồn tại.';

/**
 * Danh mục xe. vehicles.category lưu TÊN danh mục (giữ tương thích API công
 * khai), vì vậy đổi tên danh mục cập nhật luôn các xe đang dùng tên cũ, và
 * không cho xóa danh mục còn xe.
 */
@Injectable()
export class VehicleCategoriesService {
  constructor(private readonly database: DatabaseService) {}

  async findPublic() {
    const result = await this.database.query<{
      name: string;
      description: string;
    }>(
      `SELECT name, description FROM vehicle_categories
       ORDER BY sort_order, name`,
    );
    return result.rows;
  }

  findAll(query: PaginationQuery): Promise<PageResult<CategoryRow>> {
    return queryPage<CategoryRow>(
      this.database,
      {
        columns: selectedColumns,
        table: 'vehicle_categories c',
        searchExpression: "(c.name || ' ' || c.description)",
        orderBy: 'c.sort_order, c.name, c.id',
      },
      query,
    );
  }

  async create(input: VehicleCategoryInput, actor: Actor) {
    try {
      return await this.database.withTransaction(async (client) => {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO vehicle_categories (name, description, sort_order)
           VALUES ($1, $2, $3) RETURNING id`,
          [input.name, input.description, input.sortOrder],
        );
        const id = inserted.rows[0].id;
        await insertActivity(client, {
          actor,
          action: 'CREATE',
          entityType: 'vehicle_category',
          entityId: id,
          entityLabel: input.name,
        });
        return this.findOne(client, id);
      });
    } catch (error) {
      rethrowUniqueViolation(error, conflictMessage);
    }
  }

  async update(id: string, input: Partial<VehicleCategoryInput>, actor: Actor) {
    try {
      return await this.database.withTransaction(async (client) => {
        const current = await client.query<{ name: string }>(
          'SELECT name FROM vehicle_categories WHERE id = $1 FOR UPDATE',
          [id],
        );
        const previous = current.rows[0];
        if (!previous) throw new NotFoundException('Không tìm thấy danh mục.');

        await client.query(
          `UPDATE vehicle_categories SET
             name = COALESCE($2, name),
             description = COALESCE($3, description),
             sort_order = COALESCE($4, sort_order)
           WHERE id = $1`,
          [
            id,
            input.name ?? null,
            input.description ?? null,
            input.sortOrder ?? null,
          ],
        );
        let label = previous.name;
        if (input.name !== undefined && input.name !== previous.name) {
          const moved = await client.query(
            'UPDATE vehicles SET category = $1 WHERE category = $2',
            [input.name, previous.name],
          );
          label = `${previous.name} → ${input.name} (${moved.rowCount ?? 0} xe)`;
        }
        await insertActivity(client, {
          actor,
          action: 'UPDATE',
          entityType: 'vehicle_category',
          entityId: id,
          entityLabel: label,
        });
        return this.findOne(client, id);
      });
    } catch (error) {
      rethrowUniqueViolation(error, conflictMessage);
    }
  }

  async remove(id: string, actor: Actor) {
    await this.database.withTransaction(async (client) => {
      const current = await client.query<{ name: string }>(
        'SELECT name FROM vehicle_categories WHERE id = $1 FOR UPDATE',
        [id],
      );
      const category = current.rows[0];
      if (!category) throw new NotFoundException('Không tìm thấy danh mục.');
      const usage = await client.query<{ total: number }>(
        'SELECT COUNT(*)::int AS total FROM vehicles WHERE category = $1',
        [category.name],
      );
      if (usage.rows[0].total > 0) {
        throw new ConflictException(
          `Danh mục đang được ${usage.rows[0].total} xe sử dụng. Hãy chuyển các xe sang danh mục khác trước khi xóa.`,
        );
      }
      await client.query('DELETE FROM vehicle_categories WHERE id = $1', [id]);
      await insertActivity(client, {
        actor,
        action: 'DELETE',
        entityType: 'vehicle_category',
        entityId: id,
        entityLabel: category.name,
      });
    });
  }

  private async findOne(client: PoolClient, id: string) {
    const result = await client.query<CategoryRow>(
      `SELECT ${selectedColumns} FROM vehicle_categories c WHERE c.id = $1`,
      [id],
    );
    return result.rows[0];
  }
}
