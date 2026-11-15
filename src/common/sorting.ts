import { BadRequestException } from '@nestjs/common';

/**
 * Ánh xạ tên trường công khai trên API (camelCase) → biểu thức SQL. Chỉ các
 * khóa trong bảng này được dùng để sắp xếp, nên giá trị từ request không bao
 * giờ đi thẳng vào câu SQL.
 */
export type SortableColumns = Record<string, string>;

/**
 * Đọc tham số `sort=field:asc|desc` và trả về mệnh đề ORDER BY. Không truyền
 * thì dùng `fallback`. Luôn thêm `id` để thứ tự ổn định khi phân trang.
 */
export function parseSort(
  value: string | undefined,
  sortable: SortableColumns,
  fallback: string,
): string {
  if (value === undefined || value.trim() === '') return fallback;
  const match = /^([A-Za-z]+)(?::(asc|desc))?$/.exec(value.trim());
  const column = match ? sortable[match[1]] : undefined;
  if (!match || column === undefined || !Object.hasOwn(sortable, match[1])) {
    throw new BadRequestException(
      `Tham số "sort" không hợp lệ. Cho phép: ${Object.keys(sortable).join(', ')}.`,
    );
  }
  const direction = (match[2] ?? 'asc').toUpperCase();
  return `${column} ${direction} NULLS LAST, id ${direction}`;
}
