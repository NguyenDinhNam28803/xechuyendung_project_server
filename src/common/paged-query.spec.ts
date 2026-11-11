import type { DatabaseService } from '../database/database.service.js';
import { queryPage } from './paged-query.js';
import { parsePaginationQuery } from './pagination.js';

function fakeDatabase() {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: [{ id: 'a' }] })
    .mockResolvedValueOnce({ rows: [{ total: '1' }] });
  return { database: { query } as unknown as DatabaseService, query };
}

describe('queryPage filters', () => {
  it('adds equality filters as numbered parameters and skips undefined ones', async () => {
    const { database, query } = fakeDatabase();

    const page = await queryPage(
      database,
      {
        columns: 'id',
        table: 'legal_resources',
        filters: [
          { column: 'resource_type', value: 'policy' },
          { column: 'is_published', value: undefined },
          { column: 'status', value: false },
        ],
        searchExpression: 'title',
        orderBy: 'id',
      },
      parsePaginationQuery('2', '10', 'xe'),
    );

    const [listSql, listValues] = query.mock.calls[0] as [string, unknown[]];
    expect(listSql).toContain(
      'WHERE resource_type = $1 AND status = $2 AND title ILIKE $3',
    );
    expect(listSql).toContain('LIMIT $4 OFFSET $5');
    expect(listValues).toEqual(['policy', false, '%xe%', 10, 10]);
    expect(query.mock.calls[1][1]).toEqual(['policy', false, '%xe%']);
    expect(page.pagination).toEqual({
      page: 2,
      limit: 10,
      total: 1,
      totalPages: 1,
    });
  });

  it('omits WHERE when no filter or search applies', async () => {
    const { database, query } = fakeDatabase();
    await queryPage(
      database,
      {
        columns: 'id',
        table: 'vehicles',
        filters: [{ column: 'is_published', value: undefined }],
        orderBy: 'id',
      },
      parsePaginationQuery(),
    );
    expect(query.mock.calls[0][0]).not.toContain('WHERE');
  });
});
