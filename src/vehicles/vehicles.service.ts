import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { insertActivity } from '../activity/activity.service.js';
import {
  type PageResult,
  type PaginationQuery,
  toPageResult,
} from '../common/pagination.js';
import { DatabaseService } from '../database/database.service.js';
import type { VehicleInput } from '../content/content-validation.js';

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

const selectedColumns = `
  id, slug, name, make, category, description, artwork, images, badge,
  use_case AS "useCase", highlights, known_details AS "knownDetails",
  source_url AS "sourceUrl", is_published AS "isPublished"
`;

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

  async findPublicBySlug(slug: string) {
    const result = await this.database.query<VehicleRow>(
      `SELECT ${selectedColumns} FROM vehicles
       WHERE slug = $1 AND is_published = TRUE`,
      [slug],
    );
    if (!result.rows[0]) throw new NotFoundException('Không tìm thấy xe.');
    return toPublicVehicle(result.rows[0]);
  }

  async findAll(query: PaginationQuery): Promise<PageResult<VehicleRow>> {
    const filter = query.search
      ? 'WHERE name ILIKE $1 OR make ILIKE $1 OR category ILIKE $1 OR slug ILIKE $1'
      : '';
    const filterValues = query.search ? [`%${query.search}%`] : [];
    const [result, count] = await Promise.all([
      this.database.query<VehicleRow>(
        `SELECT ${selectedColumns} FROM vehicles ${filter}
         ORDER BY created_at DESC, id
         LIMIT $${filterValues.length + 1} OFFSET $${filterValues.length + 2}`,
        [...filterValues, query.limit, query.offset],
      ),
      this.database.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total FROM vehicles ${filter}`,
        filterValues,
      ),
    ]);
    return toPageResult(result.rows, Number(count.rows[0].total), query);
  }

  async create(input: VehicleInput) {
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
          action: 'CREATE',
          entityType: 'vehicle',
          entityId: vehicle.id,
          entityLabel: vehicle.name,
        });
        return vehicle;
      });
    } catch (error) {
      throwIfConflict(error);
      throw error;
    }
  }

  async update(id: string, input: Partial<VehicleInput>) {
    const entries = Object.entries(input) as [keyof VehicleInput, unknown][];
    const values = entries.map(([key, value]) => jsonValue(key, value));
    const assignments = entries.map(
      ([key], index) =>
        `${columns[key]} = $${index + 1}${isJsonField(key) ? '::jsonb' : ''}`,
    );
    values.push(id);
    try {
      return await this.database.withTransaction(async (client) => {
        const result = await client.query<VehicleRow>(
          `UPDATE vehicles SET ${assignments.join(', ')}, updated_at = NOW()
           WHERE id = $${values.length} RETURNING ${selectedColumns}`,
          values,
        );
        const vehicle = result.rows[0];
        if (!vehicle) throw new NotFoundException('Không tìm thấy xe.');
        await insertActivity(client, {
          action: 'UPDATE',
          entityType: 'vehicle',
          entityId: vehicle.id,
          entityLabel: vehicle.name,
        });
        return vehicle;
      });
    } catch (error) {
      throwIfConflict(error);
      throw error;
    }
  }

  async remove(id: string) {
    await this.database.withTransaction(async (client) => {
      const result = await client.query<{ id: string; name: string }>(
        'DELETE FROM vehicles WHERE id = $1 RETURNING id, name',
        [id],
      );
      const vehicle = result.rows[0];
      if (!vehicle) throw new NotFoundException('Không tìm thấy xe.');
      await insertActivity(client, {
        action: 'DELETE',
        entityType: 'vehicle',
        entityId: vehicle.id,
        entityLabel: vehicle.name,
      });
    });
  }
}

export async function insertVehicle(
  client: import('pg').PoolClient,
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

function jsonValue(key: keyof VehicleInput, value: unknown) {
  return isJsonField(key) ? JSON.stringify(value) : value;
}

function isJsonField(key: keyof VehicleInput) {
  return ['images', 'highlights', 'knownDetails'].includes(key);
}

function throwIfConflict(error: unknown) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  ) {
    throw new ConflictException('Slug xe đã tồn tại.');
  }
}

function toPublicVehicle(row: VehicleRow) {
  const { id, isPublished, ...vehicle } = row;
  void id;
  void isPublished;
  return vehicle;
}
