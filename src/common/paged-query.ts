import type { QueryResultRow } from 'pg';
import type { DatabaseService } from '../database/database.service.js';
import {
  type PageResult,
  type PaginationQuery,
  toPageResult,
} from './pagination.js';
import { containsPattern } from './search.js';

export type PagedQueryOptions = {
  /** Danh sách cột trong SELECT (đã có alias camelCase). */
  columns: string;
  /** Tên bảng; luôn là hằng số trong mã nguồn, không lấy từ request. */
  table: string;
  /** Điều kiện bổ sung dùng tham số $1..$n tương ứng với `values`. */
  conditions?: string[];
  values?: unknown[];
  /**
   * Lọc bằng so sánh bằng; mục có `value` undefined bị bỏ qua. `column` luôn
   * là hằng số trong mã nguồn, giá trị luôn đi qua tham số.
   */
  filters?: { column: string; value: unknown }[];
  /** Biểu thức tìm kiếm trong common/search.ts; bỏ qua khi query.search rỗng. */
  searchExpression?: string;
  orderBy: string;
};

/**
 * Truy vấn một trang dữ liệu kèm tổng số bản ghi. Hai truy vấn chạy song song
 * trên hai kết nối nên tổng số có thể lệch rất nhỏ so với danh sách khi dữ
 * liệu đang thay đổi; chấp nhận được với màn hình quản trị.
 */
export async function queryPage<Row extends QueryResultRow>(
  database: DatabaseService,
  options: PagedQueryOptions,
  query: PaginationQuery,
): Promise<PageResult<Row>> {
  const conditions = [...(options.conditions ?? [])];
  const values = [...(options.values ?? [])];
  for (const filter of options.filters ?? []) {
    if (filter.value === undefined) continue;
    values.push(filter.value);
    conditions.push(`${filter.column} = $${values.length}`);
  }
  if (query.search && options.searchExpression) {
    values.push(containsPattern(query.search));
    conditions.push(`${options.searchExpression} ILIKE $${values.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [result, count] = await Promise.all([
    database.query<Row>(
      `SELECT ${options.columns} FROM ${options.table} ${where}
       ORDER BY ${options.orderBy}
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, query.limit, query.offset],
    ),
    database.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM ${options.table} ${where}`,
      values,
    ),
  ]);
  return toPageResult(result.rows, Number(count.rows[0].total), query);
}
