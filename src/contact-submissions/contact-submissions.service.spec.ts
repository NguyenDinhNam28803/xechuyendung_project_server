import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service.js';
import { ContactSubmissionsService } from './contact-submissions.service.js';

describe('ContactSubmissionsService retention', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deletes submissions older than 90 days and audits only an aggregate', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ id: 'one' }, { id: 'two' }],
        rowCount: 2,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const client = { query } as unknown as PoolClient;
    const database = {
      isConfigured: true,
      withTransaction: vi.fn(
        async (operation: (transaction: PoolClient) => Promise<number>) =>
          operation(client),
      ),
    } as unknown as DatabaseService;
    const service = new ContactSubmissionsService(database);

    await expect(service.purgeExpired()).resolves.toBe(2);

    expect(query.mock.calls[0][0]).toContain(
      'created_at < NOW() - ($1 * INTERVAL',
    );
    expect(query.mock.calls[0][1]).toEqual([90]);
    expect(query.mock.calls[1][1]).toEqual([
      'system',
      'DELETE',
      'contact_submission',
      null,
      'Tự động xóa 2 yêu cầu liên hệ quá 90 ngày',
    ]);
    expect(JSON.stringify(query.mock.calls[1][1])).not.toMatch(
      /one|two|phone|name|message/i,
    );
    service.onModuleDestroy();
  });

  it('does not write an audit event when no submissions have expired', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const client = { query } as unknown as PoolClient;
    const database = {
      isConfigured: true,
      withTransaction: vi.fn(
        async (operation: (transaction: PoolClient) => Promise<number>) =>
          operation(client),
      ),
    } as unknown as DatabaseService;
    const service = new ContactSubmissionsService(database);

    await expect(service.purgeExpired()).resolves.toBe(0);

    expect(query).toHaveBeenCalledTimes(1);
    service.onModuleDestroy();
  });
});
