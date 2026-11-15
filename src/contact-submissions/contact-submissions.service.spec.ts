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
      // 1. Lưu số đếm tổng hợp vào contact_daily_stats.
      .mockResolvedValueOnce({ rows: [], rowCount: 2 })
      // 2. Xóa bản ghi chi tiết.
      .mockResolvedValueOnce({
        rows: [{ id: 'one' }, { id: 'two' }],
        rowCount: 2,
      })
      // 3. Ghi nhật ký.
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const client = { query } as unknown as PoolClient;
    const service = new ContactSubmissionsService(databaseWithLock(client));

    await expect(service.purgeExpired()).resolves.toBe(2);

    // Số liệu được lưu TRƯỚC khi xóa, cùng điều kiện thời hạn, và chỉ gồm
    // ngày / danh mục / trạng thái / số đếm.
    expect(query.mock.calls[0][0]).toContain('INSERT INTO contact_daily_stats');
    expect(query.mock.calls[0][0]).toContain(
      'created_at < NOW() - ($1 * INTERVAL',
    );
    expect(query.mock.calls[0][1]).toEqual([90, 'Asia/Ho_Chi_Minh']);
    expect(query.mock.calls[1][0]).toContain('DELETE FROM contact_submissions');
    expect(query.mock.calls[1][0]).toContain(
      'created_at < NOW() - ($1 * INTERVAL',
    );
    expect(query.mock.calls[1][1]).toEqual([90]);
    expect(query.mock.calls[2][1]).toEqual([
      'system',
      null,
      'DELETE',
      'contact_submission',
      null,
      'Tự động xóa 2 yêu cầu liên hệ quá 90 ngày',
    ]);
    expect(JSON.stringify(query.mock.calls[2][1])).not.toMatch(
      /one|two|phone|name|message/i,
    );
  });

  it('does not write an audit event when no submissions have expired', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const client = { query } as unknown as PoolClient;
    const service = new ContactSubmissionsService(databaseWithLock(client));

    await expect(service.purgeExpired()).resolves.toBe(0);

    // Chỉ chạy câu lưu số liệu (không có gì) và câu xóa; không ghi nhật ký.
    expect(query).toHaveBeenCalledTimes(2);
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
