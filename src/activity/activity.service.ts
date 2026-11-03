import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
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

  async findRecent(limit = 100) {
    const result = await this.database.query<ActivityRow>(
      `SELECT id, actor, action, entity_type AS "entityType",
              entity_id AS "entityId", entity_label AS "entityLabel",
              created_at AS "createdAt"
       FROM activity_logs ORDER BY created_at DESC, id DESC LIMIT $1`,
      [Math.min(Math.max(limit, 1), 200)],
    );
    return result.rows;
  }
}

export async function insertActivity(client: PoolClient, entry: ActivityEntry) {
  await client.query(
    `INSERT INTO activity_logs (
      actor, action, entity_type, entity_id, entity_label
    ) VALUES ($1, $2, $3, $4, $5)`,
    [
      process.env.ADMIN_USERNAME ?? 'admin',
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.entityLabel.slice(0, 250),
    ],
  );
}
