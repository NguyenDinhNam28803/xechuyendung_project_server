import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service.js';
import { ContactSubmissionsService } from './contact-submissions.service.js';

function databaseWithLock(client: PoolClient, acquired = true) {
  return {
    isConfigured: true,
    runExclusive: vi.fn(
      async (
        _key: number,
        operation: (transaction: PoolClient) => Promise<number>,
      ) =>
        acquired
          ? { acquired: true, result: await operation(client) }
          : { acquired: false },
    ),
  } as unknown as DatabaseService;
}

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
    const service = new ContactSubmissionsService(databaseWithLock(client));

    await expect(service.purgeExpired()).resolves.toBe(2);

    expect(query.mock.calls[0][0]).toContain(
      'created_at < NOW() - ($1 * INTERVAL',
    );
    expect(query.mock.calls[0][1]).toEqual([90]);
    expect(query.mock.calls[1][1]).toEqual([
      'system',
      null,
      'DELETE',
      'contact_submission',
      null,
      'Tự động xóa 2 yêu cầu liên hệ quá 90 ngày',
    ]);
    expect(JSON.stringify(query.mock.calls[1][1])).not.toMatch(
      /one|two|phone|name|message/i,
    );
  });

  it('does not write an audit event when no submissions have expired', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const client = { query } as unknown as PoolClient;
    const service = new ContactSubmissionsService(databaseWithLock(client));

    await expect(service.purgeExpired()).resolves.toBe(0);

    expect(query).toHaveBeenCalledTimes(1);
  });

  it('skips the purge when another instance holds the lock', async () => {
    const query = vi.fn();
    const client = { query } as unknown as PoolClient;
    const service = new ContactSubmissionsService(
      databaseWithLock(client, false),
    );

    await expect(service.purgeExpired()).resolves.toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});
