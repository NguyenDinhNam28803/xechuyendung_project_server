import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import { queryPage } from '../common/paged-query.js';
import type { PageResult, PaginationQuery } from '../common/pagination.js';
import { searchExpressions } from '../common/search.js';
import { businessTimeZone } from '../common/time.js';
import { DatabaseService } from '../database/database.service.js';

export const activityActionValues = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'IMPORT',
  'LOGIN',
  'LOGOUT',
] as const;
export type ActivityAction = (typeof activityActionValues)[number];

/** Phải khớp CHECK activity_logs_entity_type_check (migration 007). */
export const activityEntityValues = [
  'vehicle',
  'vehicle_category',
  'article',
  'policy',
  'regulation',
  'legal_guide',
  'contact_submission',
  'admin_user',
  'system',
] as const;
export type ActivityEntity = (typeof activityEntityValues)[number];

export type ActivityFilters = {
  action?: ActivityAction;
  entityType?: ActivityEntity;
  /** YYYY-MM-DD theo giờ Việt Nam, bao gồm. */
  from?: string;
  to?: string;
};

/** Người thực hiện thao tác: tài khoản quản trị hoặc tác vụ hệ thống. */
export type Actor = {
  id: string | null;
  username: string;
};

export const systemActor: Actor = { id: null, username: 'system' };

export type ActivityEntry = {
  actor: Actor;
  action: ActivityAction;
  entityType: ActivityEntity;
  entityId: string | null;
  entityLabel: string;
};

type ActivityRow = QueryResultRow & {
  id: string;
  actor: string;
  actorId: string | null;
  action: ActivityAction;
  entityType: ActivityEntity;
  entityId: string | null;
  entityLabel: string;
  createdAt: Date;
};

@Injectable()
export class ActivityService {
  constructor(private readonly database: DatabaseService) {}

  findRecent(
    query: PaginationQuery,
    filters: ActivityFilters = {},
  ): Promise<PageResult<ActivityRow>> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    // Múi giờ là hằng số trong mã nguồn; ngày luôn đi qua tham số.
    const zone = `'${businessTimeZone}'`;
    if (filters.from) {
      values.push(filters.from);
      conditions.push(
        `created_at >= ($${values.length}::date::timestamp AT TIME ZONE ${zone})`,
      );
    }
    if (filters.to) {
      values.push(filters.to);
      conditions.push(
        `created_at < (($${values.length}::date + 1)::timestamp AT TIME ZONE ${zone})`,
      );
    }
    return queryPage<ActivityRow>(
      this.database,
      {
        conditions,
        values,
        filters: [
          { column: 'action', value: filters.action },
          { column: 'entity_type', value: filters.entityType },
        ],
        columns: `id, actor, actor_id AS "actorId", action,
                  entity_type AS "entityType", entity_id AS "entityId",
                  entity_label AS "entityLabel", created_at AS "createdAt"`,
        table: 'activity_logs',
        searchExpression: searchExpressions.activityLogs,
        orderBy: 'created_at DESC, id DESC',
      },
      query,
    );
  }
}

/**
 * Ghi audit trong CÙNG transaction với thay đổi dữ liệu để hai thao tác cùng
 * commit hoặc cùng rollback. Không đưa dữ liệu cá nhân vào entityLabel.
 */
export async function insertActivity(client: PoolClient, entry: ActivityEntry) {
  await client.query(
    `INSERT INTO activity_logs (
      actor, actor_id, action, entity_type, entity_id, entity_label
    ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      entry.actor.username.slice(0, 120),
      entry.actor.id,
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.entityLabel.slice(0, 250),
    ],
  );
}
