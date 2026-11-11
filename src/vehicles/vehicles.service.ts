import { Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import { type Actor, insertActivity } from '../activity/activity.service.js';
import { rethrowUniqueViolation } from '../common/database-errors.js';
import { queryPage } from '../common/paged-query.js';
import type { PageResult, PaginationQuery } from '../common/pagination.js';
import { searchExpressions } from '../common/search.js';
import { buildUpdateAssignments } from '../common/update-builder.js';
import type { VehicleInput } from '../content/content-validation.js';
import { DatabaseService } from '../database/database.service.js';

type VehicleRow = QueryResultRow & {
  id: string;
  slug: string;
  name: string;
  make: string;
  category: string;
  description: string;
  artwork: VehicleInput['artwork'];
  images: string[];
  badge: string;
  useCase: string;
  highlights: string[];
  knownDetails: { label: string; value: string }[];
  sourceUrl: string | null;
  isPublished: boolean;
};

const columns: Record<keyof VehicleInput, string> = {
  slug: 'slug',
  name: 'name',
  make: 'make',
  category: 'category',
  description: 'description',
  artwork: 'artwork',
  images: 'images',
  badge: 'badge',
  useCase: 'use_case',
  highlights: 'highlights',
  knownDetails: 'known_details',
  sourceUrl: 'source_url',
  isPublished: 'is_published',
};

const jsonFields = ['images', 'highlights', 'knownDetails'] as const;

const selectedColumns = `
  id, slug, name, make, category, description, artwork, images, badge,
  use_case AS "useCase", highlights, known_details AS "knownDetails",
  source_url AS "sourceUrl", is_published AS "isPublished"
`;

const conflictMessage = 'Slug xe đã tồn tại.';

@Injectable()
export class VehiclesService {
  constructor(private readonly database: DatabaseService) {}

  async findPublic() {
    const result = await this.database.query<VehicleRow>(
      `SELECT ${selectedColumns} FROM vehicles
       WHERE is_published = TRUE ORDER BY created_at DESC, id`,
    );
    return result.rows.map(toPublicVehicle);
  }

  async findPublicPage(query: PaginationQuery) {
    const page = await queryPage<VehicleRow>(
      this.database,
      {
        columns: selectedColumns,
        table: 'vehicles',
        conditions: ['is_published = TRUE'],
        searchExpression: searchExpressions.vehicles,
        orderBy: 'created_at DESC, id',
      },
      query,
    );
    return { ...page, items: page.items.map(toPublicVehicle) };
  }

  async findPublicBySlug(slug: string) {
    const result = await this.database.query<VehicleRow>(
      `SELECT ${selectedColumns} FROM vehicles
       WHERE slug = $1 AND is_published = TRUE`,
      [slug],
    );
    if (!result.rows[0]) throw new NotFoundException('Không tìm thấy xe.');
    return toPublicVehicle(result.rows[0]);
  }

  findAll(
    query: PaginationQuery,
    isPublished?: boolean,
  ): Promise<PageResult<VehicleRow>> {
    return queryPage<VehicleRow>(
      this.database,
      {
        columns: selectedColumns,
        table: 'vehicles',
        filters: [{ column: 'is_published', value: isPublished }],
        searchExpression: searchExpressions.vehicles,
        orderBy: 'created_at DESC, id',
      },
      query,
    );
  }

  async create(input: VehicleInput, actor: Actor) {
    try {
      return await this.database.withTransaction(async (client) => {
        const result = await client.query<VehicleRow>(
          `INSERT INTO vehicles (
            slug, name, make, category, description, artwork, images, badge,
            use_case, highlights, known_details, source_url, is_published
          ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10::jsonb, $11::jsonb, $12, $13)
          RETURNING ${selectedColumns}`,
          valuesForInsert(input),
        );
        const vehicle = result.rows[0];
        await insertActivity(client, {
          actor,
          action: 'CREATE',
          entityType: 'vehicle',
          entityId: vehicle.id,
          entityLabel: vehicle.name,
        });
        return vehicle;
      });
    } catch (error) {
      rethrowUniqueViolation(error, conflictMessage);
    }
  }

  async update(id: string, input: Partial<VehicleInput>, actor: Actor) {
    const { assignments, values } = buildUpdateAssignments(
      input,
      columns,
      jsonFields,
    );
    values.push(id);
    try {
      return await this.database.withTransaction(async (client) => {
        const result = await client.query<VehicleRow>(
          `UPDATE vehicles SET ${assignments}
           WHERE id = $${values.length} RETURNING ${selectedColumns}`,
          values,
        );
        const vehicle = result.rows[0];
        if (!vehicle) throw new NotFoundException('Không tìm thấy xe.');
        await insertActivity(client, {
          actor,
          action: 'UPDATE',
          entityType: 'vehicle',
          entityId: vehicle.id,
          entityLabel: vehicle.name,
        });
        return vehicle;
      });
    } catch (error) {
      rethrowUniqueViolation(error, conflictMessage);
    }
  }

  async remove(id: string, actor: Actor) {
    await this.database.withTransaction(async (client) => {
      const result = await client.query<{ id: string; name: string }>(
        'DELETE FROM vehicles WHERE id = $1 RETURNING id, name',
        [id],
      );
      const vehicle = result.rows[0];
      if (!vehicle) throw new NotFoundException('Không tìm thấy xe.');
      await insertActivity(client, {
        actor,
        action: 'DELETE',
        entityType: 'vehicle',
        entityId: vehicle.id,
        entityLabel: vehicle.name,
      });
    });
  }
}

/** Dùng cho import nội dung mẫu: bỏ qua slug đã tồn tại, không ghi đè. */
export async function insertVehicleIfMissing(
  client: PoolClient,
  input: VehicleInput,
) {
  return client.query(
    `INSERT INTO vehicles (
      slug, name, make, category, description, artwork, images, badge,
      use_case, highlights, known_details, source_url, is_published
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10::jsonb, $11::jsonb, $12, $13)
    ON CONFLICT (slug) DO NOTHING`,
    valuesForInsert(input),
  );
}

function valuesForInsert(input: VehicleInput) {
  return [
    input.slug,
    input.name,
    input.make,
    input.category,
    input.description,
    input.artwork,
    JSON.stringify(input.images),
    input.badge,
    input.useCase,
    JSON.stringify(input.highlights),
    JSON.stringify(input.knownDetails),
    input.sourceUrl,
    input.isPublished,
  ];
}

function toPublicVehicle(row: VehicleRow) {
  const { id, isPublished, ...vehicle } = row;
  void id;
  void isPublished;
  return vehicle;
}
