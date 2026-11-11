import { BadRequestException } from '@nestjs/common';
import {
  parsePaginationQuery,
  parsePublishedFilter,
  toPageResult,
} from './pagination.js';

describe('published filter', () => {
  it('maps true/false and treats missing or empty as no filter', () => {
    expect(parsePublishedFilter('true')).toBe(true);
    expect(parsePublishedFilter('false')).toBe(false);
    expect(parsePublishedFilter(undefined)).toBeUndefined();
    expect(parsePublishedFilter('')).toBeUndefined();
  });

  it.each(['1', 'yes', 'TRUE'])('rejects %s', (value) => {
    expect(() => parsePublishedFilter(value)).toThrow(BadRequestException);
  });
});

describe('pagination query', () => {
  it('uses bounded defaults and normalizes search text', () => {
    expect(parsePaginationQuery(undefined, undefined, '  truck  ')).toEqual({
      page: 1,
      limit: 25,
      offset: 0,
      search: 'truck',
    });
  });

  it('calculates page offset and metadata', () => {
    const query = parsePaginationQuery('3', '10');
    expect(query.offset).toBe(20);
    expect(toPageResult([{ id: 1 }], 25, query)).toEqual({
      items: [{ id: 1 }],
      pagination: { page: 3, limit: 10, total: 25, totalPages: 3 },
    });
  });

  it.each([
    ['0', undefined, undefined],
    ['1.5', undefined, undefined],
    [undefined, '101', undefined],
    [undefined, '0', undefined],
    [undefined, undefined, 'x'.repeat(101)],
    ['9007199254740991', '100', undefined],
  ])('rejects invalid or excessive pagination input', (page, limit, search) => {
    expect(() => parsePaginationQuery(page, limit, search)).toThrow(
      BadRequestException,
    );
  });
});
