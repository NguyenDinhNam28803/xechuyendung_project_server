import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import { queryPage } from '../common/paged-query.js';
import type { PageResult, PaginationQuery } from '../common/pagination.js';
import { searchExpressions } from '../common/search.js';
import { DatabaseService } from '../database/database.service.js';

export type ActivityAction =
  'CREATE' | 'UPDATE' | 'DELETE' | 'IMPORT' | 'LOGIN' | 'LOGOUT';

export type ActivityEntity =
  | 'vehicle'
  | 'article'
  | 'policy'
  | 'regulation'
  | 'legal_guide'
  | 'contact_submission'
  | 'admin_user'
  | 'system';

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

  findRecent(query: PaginationQuery): Promise<PageResult<ActivityRow>> {
    return queryPage<ActivityRow>(
      this.database,
      {
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
