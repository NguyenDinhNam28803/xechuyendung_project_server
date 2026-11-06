import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import {
  type PageResult,
  type PaginationQuery,
  toPageResult,
} from '../common/pagination.js';
import { DatabaseService } from '../database/database.service.js';

export type ActivityAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'IMPORT';
export type ActivityEntity =
  | 'vehicle'
  | 'article'
  | 'policy'
  | 'regulation'
  | 'legal_guide'
  | 'contact_submission'
  | 'system';

export type ActivityEntry = {
  actor?: string;
  action: ActivityAction;
  entityType: ActivityEntity;
  entityId: string | null;
  entityLabel: string;
};

type ActivityRow = QueryResultRow & {
  id: string;
  actor: string;
  action: ActivityAction;
  entityType: ActivityEntity;
  entityId: string | null;
  entityLabel: string;
  createdAt: Date;
};

@Injectable()
export class ActivityService {
  constructor(private readonly database: DatabaseService) {}

  async findRecent(query: PaginationQuery): Promise<PageResult<ActivityRow>> {
    const filter = query.search
      ? 'WHERE actor ILIKE $1 OR action ILIKE $1 OR entity_type ILIKE $1 OR entity_label ILIKE $1'
      : '';
    const filterValues = query.search ? [`%${query.search}%`] : [];
    const [result, count] = await Promise.all([
      this.database.query<ActivityRow>(
        `SELECT id, actor, action, entity_type AS "entityType",
                entity_id AS "entityId", entity_label AS "entityLabel",
                created_at AS "createdAt"
         FROM activity_logs ${filter}
         ORDER BY created_at DESC, id DESC
         LIMIT $${filterValues.length + 1} OFFSET $${filterValues.length + 2}`,
        [...filterValues, query.limit, query.offset],
      ),
      this.database.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total FROM activity_logs ${filter}`,
        filterValues,
      ),
    ]);
    return toPageResult(result.rows, Number(count.rows[0].total), query);
  }
}

export async function insertActivity(client: PoolClient, entry: ActivityEntry) {
  await client.query(
    `INSERT INTO activity_logs (
      actor, action, entity_type, entity_id, entity_label
    ) VALUES ($1, $2, $3, $4, $5)`,
    [
      entry.actor ?? process.env.ADMIN_USERNAME ?? 'admin',
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.entityLabel.slice(0, 250),
    ],
  );
}
