import type { DatabaseService } from '../database/database.service.js';
import { addDays, todayInBusinessZone } from '../common/time.js';
import { StatsService } from './stats.service.js';

/** DatabaseService giả: trả lần lượt các kết quả theo thứ tự truy vấn. */
function fakeDatabase(results: unknown[][]) {
  const query = vi.fn();
  for (const rows of results) query.mockResolvedValueOnce({ rows });
  return { database: { query } as unknown as DatabaseService, query };
}

describe('StatsService.overview', () => {
  it('folds grouped rows into publish counts and status totals', async () => {
    const { database, query } = fakeDatabase([
      [
        { kind: 'vehicle', isPublished: true, total: 7 },
        { kind: 'vehicle', isPublished: false, total: 2 },
        { kind: 'article', isPublished: false, total: 3 },
        { kind: 'regulation', isPublished: true, total: 4 },
      ],
      [
        { status: 'new', total: 5 },
        { status: 'closed', total: 10 },
      ],
      [{ overdueNew: 2, avgResponseHours: 3.456, handledLast30Days: 9 }],
      [{ activeUsers: 2, totalUsers: 3, activeSessions: 1 }],
    ]);

    const overview = await new StatsService(database).overview();

    expect(query).toHaveBeenCalledTimes(4);
    expect(overview.content.vehicles).toEqual({
      total: 9,
      published: 7,
      draft: 2,
    });
    expect(overview.content.articles).toEqual({
      total: 3,
      published: 0,
      draft: 3,
    });
    expect(overview.content.legal.regulation.published).toBe(4);
    expect(overview.content.legal.policy.total).toBe(0);
    expect(overview.contacts).toMatchObject({
      total: 15,
      byStatus: { new: 5, in_progress: 0, closed: 10 },
      overdueNew: 2,
      avgResponseHours: 3.5,
    });
    expect(overview.users.activeSessions).toBe(1);
  });
});

describe('StatsService.contacts', () => {
  it('builds a gap-free daily series and compares with the previous period', async () => {
    const today = todayInBusinessZone();
    const yesterday = addDays(today, -1);
    const previousPeriodDay = addDays(today, -10);
    const { database, query } = fakeDatabase([
      [
        { day: today, category: 'Xe tải', status: 'new', total: 2 },
        { day: today, category: 'Xe cứu hộ', status: 'spam', total: 1 },
        { day: yesterday, category: 'Xe tải', status: 'contacted', total: 3 },
        {
          day: previousPeriodDay,
          category: 'Xe tải',
          status: 'closed',
          total: 4,
        },
      ],
      [{ slug: 'xe-a', name: 'Xe A', total: 3 }],
      [{ avgResponseHours: 1.25, handled: 3 }],
    ]);

    const stats = await new StatsService(database).contacts(7);

    // Tham số khoảng ngày: lấy cả kỳ trước (2 × 7 ngày).
    expect(query.mock.calls[0][1]).toEqual([
      'Asia/Ho_Chi_Minh',
      addDays(today, -13),
    ]);
    expect(stats.series).toHaveLength(7);
    expect(stats.series[0].day).toBe(addDays(today, -6));
    expect(stats.series.at(-1)).toMatchObject({ day: today, total: 3 });
    expect(stats.total).toBe(6);
    expect(stats.previousTotal).toBe(4);
    expect(stats.changePercent).toBe(50);
    // 3 đã liên hệ / (6 - 1 spam) = 60%.
    expect(stats.handledRate).toBe(60);
    expect(stats.byCategory[0]).toEqual({ category: 'Xe tải', total: 5 });
    expect(stats.topVehicles).toEqual([
      { slug: 'xe-a', name: 'Xe A', total: 3 },
    ]);
    expect(stats.avgResponseHours).toBe(1.3);
  });

  it('reports no percentage change when the previous period is empty', async () => {
    const today = todayInBusinessZone();
    const { database } = fakeDatabase([
      [{ day: today, category: 'Xe tải', status: 'new', total: 1 }],
      [],
      [{ avgResponseHours: null, handled: 0 }],
    ]);
    const stats = await new StatsService(database).contacts(30);
    expect(stats.changePercent).toBeNull();
    expect(stats.avgResponseHours).toBeNull();
  });
});

describe('StatsService.activity', () => {
  it('aggregates actions per day', async () => {
    const today = todayInBusinessZone();
    const { database } = fakeDatabase([
      [
        { day: today, action: 'UPDATE', total: 4 },
        { day: today, action: 'LOGIN', total: 1 },
      ],
      [{ entityType: 'vehicle', total: 4 }],
      [{ actor: 'admin', total: 4 }],
    ]);
    const stats = await new StatsService(database).activity(7);
    expect(stats.total).toBe(5);
    expect(stats.byAction.UPDATE).toBe(4);
    expect(stats.series.at(-1)?.byAction.LOGIN).toBe(1);
    expect(stats.topActors[0].actor).toBe('admin');
  });
});
