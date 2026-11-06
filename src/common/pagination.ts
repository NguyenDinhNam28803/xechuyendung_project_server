import { BadRequestException } from '@nestjs/common';

export type PaginationQuery = {
  page: number;
  limit: number;
  offset: number;
  search: string;
};

export type PageResult<T> = {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export function parsePaginationQuery(
  pageValue?: string,
  limitValue?: string,
  searchValue?: string,
  defaultLimit = 25,
): PaginationQuery {
  const page = parsePositiveInteger(pageValue, 1, 'page');
  const limit = parsePositiveInteger(limitValue, defaultLimit, 'limit');
  if (limit > 100) {
    throw new BadRequestException('Giới hạn mỗi trang tối đa là 100.');
  }
  const search = searchValue?.trim() ?? '';
  if (search.length > 100) {
    throw new BadRequestException('Từ khóa tìm kiếm quá dài.');
  }
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset)) {
    throw new BadRequestException('Phạm vi trang yêu cầu quá lớn.');
  }
  return {
    page,
    limit,
    offset,
    search,
  };
}

export function toPageResult<T>(
  items: T[],
  total: number,
  query: PaginationQuery,
): PageResult<T> {
  return {
    items,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  field: string,
) {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new BadRequestException(`Tham số "${field}" không hợp lệ.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new BadRequestException(`Tham số "${field}" không hợp lệ.`);
  }
  return parsed;
}
