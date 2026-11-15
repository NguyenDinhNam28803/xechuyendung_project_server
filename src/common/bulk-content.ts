import { type Actor, insertActivity } from '../activity/activity.service.js';
import type { ActivityEntity } from '../activity/activity.service.js';
import type { DatabaseService } from '../database/database.service.js';
import { readBody, readEnum, readUuidList } from './validation.js';

export const bulkActions = ['publish', 'unpublish', 'delete'] as const;
export type BulkAction = (typeof bulkActions)[number];

export type BulkRequest = { ids: string[]; action: BulkAction };

/** Tối đa số mục mỗi lần thao tác hàng loạt (bằng giới hạn một trang). */
export const maximumBulkItems = 100;

export function parseBulkRequest(body: unknown): BulkRequest {
  const record = readBody(body, ['ids', 'action']);
  return {
    ids: readUuidList(record.ids, 'ids', maximumBulkItems),
    action: readEnum(record.action, bulkActions, 'action'),
  };
}

export type BulkTarget = {
  /** Tên bảng, luôn là hằng số trong mã nguồn. */
  table: 'vehicles' | 'articles' | 'legal_resources';
  /** Cột dùng làm nhãn trong nhật ký. */
  labelColumn: 'name' | 'title';
  /** Biểu thức SQL trả về loại đối tượng cho nhật ký. */
  entityTypeSql: string;
};

/**
 * Xuất bản / ẩn / xóa nhiều mục trong MỘT transaction. Chỉ mục thực sự thay
 * đổi mới được ghi nhật ký (mỗi mục một dòng để lịch sử tra cứu được theo đối
 * tượng). Mã không tồn tại được bỏ qua và phản ánh qua `affected`.
 */
export async function runBulkContentAction(
  database: DatabaseService,
  target: BulkTarget,
  request: BulkRequest,
  actor: Actor,
) {
  return database.withTransaction(async (client) => {
    const returning = `RETURNING id, ${target.labelColumn} AS label, ${target.entityTypeSql} AS "entityType"`;
    const result =
      request.action === 'delete'
        ? await client.query<BulkRow>(
            `DELETE FROM ${target.table} WHERE id = ANY($1::uuid[]) ${returning}`,
            [request.ids],
          )
        : await client.query<BulkRow>(
            `UPDATE ${target.table} SET is_published = $1
             WHERE id = ANY($2::uuid[]) AND is_published <> $1 ${returning}`,
            [request.action === 'publish', request.ids],
          );

    const verb = request.action === 'delete' ? 'DELETE' : 'UPDATE';
    const prefix =
      request.action === 'publish'
        ? 'Xuất bản: '
        : request.action === 'unpublish'
          ? 'Chuyển về nháp: '
          : '';
    for (const row of result.rows) {
      await insertActivity(client, {
        actor,
        action: verb,
        entityType: row.entityType,
        entityId: row.id,
        entityLabel: `${prefix}${row.label}`,
      });
    }
    return {
      action: request.action,
      requested: request.ids.length,
      affected: result.rows.length,
    };
  });
}

type BulkRow = { id: string; label: string; entityType: ActivityEntity };
