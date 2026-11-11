import { Injectable, NotFoundException } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { type Actor, insertActivity } from '../activity/activity.service.js';
import { rethrowUniqueViolation } from '../common/database-errors.js';
import { queryPage } from '../common/paged-query.js';
import type { PageResult, PaginationQuery } from '../common/pagination.js';
import { searchExpressions } from '../common/search.js';
import { buildUpdateAssignments } from '../common/update-builder.js';
import type {
  LegalResourceInput,
  LegalResourceType,
} from '../content/content-validation.js';
import { DatabaseService } from '../database/database.service.js';

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

const conflictMessage = 'Slug tài liệu đã tồn tại.';

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

  findAll(
    query: PaginationQuery,
    resourceType?: LegalResourceType,
  ): Promise<PageResult<LegalResourceRow>> {
    return queryPage<LegalResourceRow>(
      this.database,
      {
        columns: selectedColumns,
        table: 'legal_resources',
        conditions: resourceType ? ['resource_type = $1'] : [],
        values: resourceType ? [resourceType] : [],
        searchExpression: searchExpressions.legalResources,
        orderBy: 'updated_at DESC, id',
      },
      query,
    );
  }

  async create(input: LegalResourceInput, actor: Actor) {
    try {
      return await this.database.withTransaction(async (client) => {
        const result = await client.query<LegalResourceRow>(
          `INSERT INTO legal_resources (
            slug, resource_type, title, summary, content, source_url, is_published
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING ${selectedColumns}`,
          [
            input.slug,
            input.resourceType,
            input.title,
            input.summary,
            input.content,
            input.sourceUrl,
            input.isPublished,
          ],
        );
        const resource = result.rows[0];
        await insertActivity(client, {
          actor,
          action: 'CREATE',
          entityType: resource.resourceType,
          entityId: resource.id,
          entityLabel: resource.title,
        });
        return resource;
      });
    } catch (error) {
      rethrowUniqueViolation(error, conflictMessage);
    }
  }

  async update(id: string, input: Partial<LegalResourceInput>, actor: Actor) {
    const { assignments, values } = buildUpdateAssignments(input, columns);
    values.push(id);
    try {
      return await this.database.withTransaction(async (client) => {
        const result = await client.query<LegalResourceRow>(
          `UPDATE legal_resources SET ${assignments}
           WHERE id = $${values.length} RETURNING ${selectedColumns}`,
          values,
        );
        const resource = result.rows[0];
        if (!resource) {
          throw new NotFoundException('Không tìm thấy tài liệu pháp lý.');
        }
        await insertActivity(client, {
          actor,
          action: 'UPDATE',
          entityType: resource.resourceType,
          entityId: resource.id,
          entityLabel: resource.title,
        });
        return resource;
      });
    } catch (error) {
      rethrowUniqueViolation(error, conflictMessage);
    }
  }

  async remove(id: string, actor: Actor) {
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
        actor,
        action: 'DELETE',
        entityType: resource.resourceType,
        entityId: resource.id,
        entityLabel: resource.title,
      });
    });
  }
}
