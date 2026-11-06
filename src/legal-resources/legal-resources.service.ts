import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import {
  insertActivity,
  type ActivityEntity,
} from '../activity/activity.service.js';
import {
  type PageResult,
  type PaginationQuery,
  toPageResult,
} from '../common/pagination.js';
import { DatabaseService } from '../database/database.service.js';
import type {
  LegalResourceInput,
  LegalResourceType,
} from '../content/content-validation.js';

type LegalResourceRow = QueryResultRow & {
  id: string;
  slug: string;
  resourceType: LegalResourceType;
  title: string;
  summary: string;
  content: string;
  sourceUrl: string | null;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const columns: Record<keyof LegalResourceInput, string> = {
  slug: 'slug',
  resourceType: 'resource_type',
  title: 'title',
  summary: 'summary',
  content: 'content',
  sourceUrl: 'source_url',
  isPublished: 'is_published',
};

const selectedColumns = `
  id, slug, resource_type AS "resourceType", title, summary, content,
  source_url AS "sourceUrl", is_published AS "isPublished",
  created_at AS "createdAt", updated_at AS "updatedAt"
`;

@Injectable()
export class LegalResourcesService {
  constructor(private readonly database: DatabaseService) {}

  async findPublic(resourceType?: LegalResourceType) {
    const values: string[] = [];
    let typeFilter = '';
    if (resourceType) {
      values.push(resourceType);
      typeFilter = ' AND resource_type = $1';
    }
    const result = await this.database.query<LegalResourceRow>(
      `SELECT slug, resource_type AS "resourceType", title, summary, content,
              source_url AS "sourceUrl", updated_at AS "updatedAt"
       FROM legal_resources
       WHERE is_published = TRUE${typeFilter}
       ORDER BY updated_at DESC, id`,
      values,
    );
    return result.rows;
  }

  async findAll(
    query: PaginationQuery,
    resourceType?: LegalResourceType,
  ): Promise<PageResult<LegalResourceRow>> {
    const conditions: string[] = [];
    const filterValues: string[] = [];
    if (resourceType) {
      filterValues.push(resourceType);
      conditions.push(`resource_type = $${filterValues.length}`);
    }
    if (query.search) {
      filterValues.push(`%${query.search}%`);
      const parameter = `$${filterValues.length}`;
      conditions.push(
        `(title ILIKE ${parameter} OR slug ILIKE ${parameter} OR summary ILIKE ${parameter} OR content ILIKE ${parameter})`,
      );
    }
    const filter = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [result, count] = await Promise.all([
      this.database.query<LegalResourceRow>(
        `SELECT ${selectedColumns} FROM legal_resources ${filter}
         ORDER BY updated_at DESC, id
         LIMIT $${filterValues.length + 1} OFFSET $${filterValues.length + 2}`,
        [...filterValues, query.limit, query.offset],
      ),
      this.database.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total FROM legal_resources ${filter}`,
        filterValues,
      ),
    ]);
    return toPageResult(result.rows, Number(count.rows[0].total), query);
  }

  async create(input: LegalResourceInput) {
    try {
      return await this.database.withTransaction(async (client) => {
        const result = await client.query<LegalResourceRow>(
          `INSERT INTO legal_resources (
            slug, resource_type, title, summary, content, source_url, is_published
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING ${selectedColumns}`,
          valuesForInsert(input),
        );
        const resource = result.rows[0];
        await insertActivity(client, {
          action: 'CREATE',
          entityType: input.resourceType as ActivityEntity,
          entityId: resource.id,
          entityLabel: resource.title,
        });
        return resource;
      });
    } catch (error) {
      throwIfConflict(error);
      throw error;
    }
  }

  async update(id: string, input: Partial<LegalResourceInput>) {
    const entries = Object.entries(input) as [
      keyof LegalResourceInput,
      unknown,
    ][];
    const values = entries.map(([, value]) => value);
    const assignments = entries.map(
      ([key], index) => `${columns[key]} = $${index + 1}`,
    );
    values.push(id);
    try {
      return await this.database.withTransaction(async (client) => {
        const result = await client.query<LegalResourceRow>(
          `UPDATE legal_resources
           SET ${assignments.join(', ')}, updated_at = NOW()
           WHERE id = $${values.length} RETURNING ${selectedColumns}`,
          values,
        );
        const resource = result.rows[0];
        if (!resource) {
          throw new NotFoundException('Không tìm thấy tài liệu pháp lý.');
        }
        await insertActivity(client, {
          action: 'UPDATE',
          entityType: resource.resourceType as ActivityEntity,
          entityId: resource.id,
          entityLabel: resource.title,
        });
        return resource;
      });
    } catch (error) {
      throwIfConflict(error);
      throw error;
    }
  }

  async remove(id: string) {
    await this.database.withTransaction(async (client) => {
      const result = await client.query<LegalResourceRow>(
        `DELETE FROM legal_resources WHERE id = $1
         RETURNING id, resource_type AS "resourceType", title`,
        [id],
      );
      const resource = result.rows[0];
      if (!resource) {
        throw new NotFoundException('Không tìm thấy tài liệu pháp lý.');
      }
      await insertActivity(client, {
        action: 'DELETE',
        entityType: resource.resourceType as ActivityEntity,
        entityId: resource.id,
        entityLabel: resource.title,
      });
    });
  }
}

function valuesForInsert(input: LegalResourceInput) {
  return [
    input.slug,
    input.resourceType,
    input.title,
    input.summary,
    input.content,
    input.sourceUrl,
    input.isPublished,
  ];
}

function throwIfConflict(error: unknown) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  ) {
    throw new ConflictException('Slug tài liệu đã tồn tại.');
  }
}
