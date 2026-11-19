import 'dotenv/config';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { ActivityService } from '../src/activity/activity.service.js';
import { AdminSessionsService } from '../src/admin-users/admin-users.service.js';
import { ArticlesService } from '../src/articles/articles.service.js';
import { AdminAuthService } from '../src/auth/admin-auth.service.js';
import type { AdminPrincipal } from '../src/auth/admin-principal.js';
import { parsePaginationQuery } from '../src/common/pagination.js';
import { parseSort } from '../src/common/sorting.js';
import { addDays, todayInBusinessZone } from '../src/common/time.js';
import { ContactSubmissionsService } from '../src/contact-submissions/contact-submissions.service.js';
import { DatabaseService } from '../src/database/database.service.js';
import { LoginThrottle } from '../src/auth/login-throttle.js';
import { TwoFactorService } from '../src/auth/two-factor.service.js';
import { asSession } from './helpers/session.js';
import { RateLimitService } from '../src/security/rate-limit.service.js';
import { StatsService } from '../src/stats/stats.service.js';
import { VehicleCategoriesService } from '../src/vehicle-categories/vehicle-categories.service.js';
import {
  vehicleDefaultOrder,
  vehicleSortColumns,
  VehiclesService,
} from '../src/vehicles/vehicles.service.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationEnabled = process.env.RUN_POSTGRES_INTEGRATION === 'true';
const describeIntegration =
  integrationEnabled && testDatabaseUrl ? describe : describe.skip;

/**
 * Chạy các câu SQL mới (thống kê, bulk, lọc, danh mục, phiên) trên PostgreSQL
 * thật. Dùng chung điều kiện an toàn với postgres.integration-spec.ts: chỉ
 * chạy khi RUN_POSTGRES_INTEGRATION=true và database tên chứa "test".
 */
describeIntegration('PostgreSQL integration: dashboard v2', () => {
  let database: DatabaseService;
  let pool: Pool;
  let rateLimit: RateLimitService;
  let principal: AdminPrincipal;
  let ownerId: string;
  const suffix = randomUUID().slice(0, 8);

  beforeAll(async () => {
    const name = decodeURIComponent(
      new URL(testDatabaseUrl!).pathname.slice(1),
    );
    if (!/(^|[_-])test([_-]|$)/i.test(name)) {
      throw new Error('Integration tests require a database named *test*.');
    }
    process.env.DATABASE_URL = testDatabaseUrl;
    await import('../scripts/migrate.js');
    database = new DatabaseService();
    pool = new Pool({ connectionString: testDatabaseUrl });
    rateLimit = new RateLimitService(database);

    const hash = await import('../src/auth/password.js').then((module) =>
      module.hashPassword('dashboard-password-123'),
    );
    const owner = await pool.query<{ id: string }>(
      `INSERT INTO admin_users (username, display_name, password_hash, role)
       VALUES ($1, 'Dashboard', $2, 'admin') RETURNING id`,
      [`dash_${suffix}`, hash],
    );
    ownerId = owner.rows[0].id;
    const auth = new AdminAuthService(
      database,
      new LoginThrottle(rateLimit),
      new TwoFactorService(database, rateLimit),
    );
    const login = asSession(
      await auth.login(`dash_${suffix}`, 'dashboard-password-123', {
        userAgent: 'integration-a',
      }),
    );
    principal = (await auth.authenticate(login.accessToken)) as AdminPrincipal;
  }, 30_000);

  afterAll(async () => {
    await pool?.query('DELETE FROM admin_users WHERE id = $1', [ownerId]);
    rateLimit?.onModuleDestroy();
    await database?.onModuleDestroy();
    await pool?.end();
  });

  const actor = () => ({ id: principal.id, username: principal.username });

  it('computes overview and contact trends, including archived counts', async () => {
    const stats = new StatsService(database);
    const submissions = new ContactSubmissionsService(database);
    const before = await stats.contacts(7);

    // Hai yêu cầu hôm nay (một được xử lý), một yêu cầu quá hạn 2 ngày tuổi
    // chưa xử lý, và một yêu cầu đã lưu trữ vào contact_daily_stats.
    const vehicleSlug = `dash-vehicle-${suffix}`;
    const today = await pool.query<{ id: string }>(
      `INSERT INTO contact_submissions
         (name, phone, category, vehicle_slug, consent_text, consent_at)
       VALUES ('A', '0900000001', 'Xe cứu hộ', $1, 'c', NOW()),
              ('B', '0900000002', 'Xe cứu hộ', $1, 'c', NOW())
       RETURNING id`,
      [vehicleSlug],
    );
    await pool.query(
      `INSERT INTO contact_submissions
         (name, phone, category, consent_text, consent_at, created_at)
       VALUES ('C', '0900000003', 'Xe tải', 'c', NOW(), NOW() - INTERVAL '2 days')`,
    );
    await submissions.updateStatus(today.rows[0].id, 'contacted', actor());
    // Đọc dạng text để giữ độ chính xác micro-giây của PostgreSQL.
    const firstHandled = () =>
      pool.query<{ value: string | null }>(
        'SELECT first_handled_at::text AS value FROM contact_submissions WHERE id = $1',
        [today.rows[0].id],
      );
    const handled = (await firstHandled()).rows[0].value;
    expect(handled).not.toBeNull();
    // Quay lại "new" rồi xử lý lại không làm đổi mốc xử lý đầu tiên.
    await submissions.updateStatus(today.rows[0].id, 'new', actor());
    await submissions.updateStatus(today.rows[0].id, 'contacted', actor());
    expect((await firstHandled()).rows[0].value).toBe(handled);

    const archivedDay = addDays(todayInBusinessZone(), -3);
    await pool.query(
      `INSERT INTO contact_daily_stats (day, category, status, total)
       VALUES ($1, 'Xe cứu hộ', 'closed', 5)
       ON CONFLICT (day, category, status)
       DO UPDATE SET total = contact_daily_stats.total + 5`,
      [archivedDay],
    );

    const after = await stats.contacts(7);
    expect(after.total - before.total).toBe(8);
    expect(after.series).toHaveLength(7);
    const archivedPoint = after.series.find(
      (point) => point.day === archivedDay,
    );
    const archivedBefore = before.series.find(
      (point) => point.day === archivedDay,
    );
    expect(
      archivedPoint!.byStatus.closed - archivedBefore!.byStatus.closed,
    ).toBe(5);
    expect(after.topVehicles).toContainEqual({
      slug: vehicleSlug,
      name: null,
      total: 2,
    });
    expect(after.avgResponseHours).not.toBeNull();

    const overview = await stats.overview();
    expect(overview.contacts.overdueNew).toBeGreaterThanOrEqual(1);
    expect(overview.users.activeSessions).toBeGreaterThanOrEqual(1);
    expect(overview.content.legal.policy.total).toBeGreaterThanOrEqual(4);

    await pool.query(
      `DELETE FROM contact_submissions WHERE name IN ('A', 'B', 'C')
         AND phone LIKE '090000000%'`,
    );
    await pool.query(
      `UPDATE contact_daily_stats SET total = total - 5
       WHERE day = $1 AND category = 'Xe cứu hộ' AND status = 'closed'`,
      [archivedDay],
    );
  }, 30_000);

  it('archives daily counts before the retention purge deletes requests', async () => {
    const submissions = new ContactSubmissionsService(database);
    await pool.query(
      `INSERT INTO contact_submissions
         (name, phone, category, status, consent_text, consent_at, created_at)
       VALUES ('Old', '0900000009', 'Xe bồn / xe môi trường', 'spam', 'c',
               NOW(), NOW() - INTERVAL '120 days')`,
    );
    const day = await pool.query<{ day: string }>(
      `SELECT to_char(((NOW() - INTERVAL '120 days') AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
                      'YYYY-MM-DD') AS day`,
    );
    const archived = () =>
      pool.query<{ total: number }>(
        `SELECT COALESCE(SUM(total), 0)::int AS total FROM contact_daily_stats
         WHERE day = $1 AND category = 'Xe bồn / xe môi trường' AND status = 'spam'`,
        [day.rows[0].day],
      );
    const before = (await archived()).rows[0].total;
    await submissions.purgeExpired();
    expect((await archived()).rows[0].total).toBe(before + 1);

    // Biểu đồ 365 ngày vẫn thấy yêu cầu đã bị xóa chi tiết.
    const stats = await new StatsService(database).contacts(365);
    const point = stats.series.find((entry) => entry.day === day.rows[0].day);
    expect(point?.byStatus.spam).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it('bulk-publishes, sorts, filters activity and bulk-deletes', async () => {
    const vehicles = new VehiclesService(database);
    const created = [];
    for (const name of ['Bravo', 'Alpha']) {
      created.push(
        await vehicles.create(
          {
            slug: `bulk-${name.toLowerCase()}-${suffix}`,
            name: `${name} ${suffix}`,
            make: 'Test',
            category: 'Xe tải',
            description: 'd',
            artwork: 'cargo',
            images: [],
            badge: 'b',
            useCase: 'u',
            highlights: ['h'],
            knownDetails: [],
            sourceUrl: null,
            isPublished: false,
          },
          actor(),
        ),
      );
    }
    expect(created[0]!.createdAt).toBeInstanceOf(Date);
    const ids = created.map((vehicle) => vehicle!.id);

    const published = await vehicles.bulk({ ids, action: 'publish' }, actor());
    expect(published).toEqual({ action: 'publish', requested: 2, affected: 2 });
    // Lặp lại không đổi gì → không ghi nhật ký thừa.
    const again = await vehicles.bulk({ ids, action: 'publish' }, actor());
    expect(again.affected).toBe(0);

    const sorted = await vehicles.findAll(
      parsePaginationQuery('1', '10', suffix),
      true,
      parseSort('name:asc', vehicleSortColumns, vehicleDefaultOrder),
    );
    expect(sorted.items.map((vehicle) => vehicle.name)).toEqual([
      `Alpha ${suffix}`,
      `Bravo ${suffix}`,
    ]);

    const activity = new ActivityService(database);
    const today = todayInBusinessZone();
    const updates = await activity.findRecent(
      parsePaginationQuery('1', '50', suffix, 100),
      { action: 'UPDATE', entityType: 'vehicle', from: today, to: today },
    );
    expect(updates.items).toHaveLength(2);
    expect(
      updates.items.every((item) => item.entityLabel.startsWith('Xuất bản: ')),
    ).toBe(true);
    const tomorrow = await activity.findRecent(
      parsePaginationQuery('1', '50', suffix, 100),
      { from: addDays(today, 1) },
    );
    expect(tomorrow.items).toHaveLength(0);

    const deleted = await vehicles.bulk({ ids, action: 'delete' }, actor());
    expect(deleted.affected).toBe(2);

    const articles = new ArticlesService(database);
    const missing = await articles.bulk(
      { ids: [randomUUID()], action: 'delete' },
      actor(),
    );
    expect(missing.affected).toBe(0);

    const activityStats = await new StatsService(database).activity(7);
    expect(activityStats.byAction.DELETE).toBeGreaterThanOrEqual(2);
  }, 30_000);

  it('manages vehicle categories and keeps vehicles in sync on rename', async () => {
    const categories = new VehicleCategoriesService(database);
    const vehicles = new VehiclesService(database);
    const seeded = await categories.findPublic();
    expect(seeded.map((category) => category.name)).toEqual(
      expect.arrayContaining(['Xe tải', 'Xe chữa cháy']),
    );

    const category = await categories.create(
      { name: `Xe thử ${suffix}`, description: '', sortOrder: 5 },
      actor(),
    );
    await expect(
      categories.create(
        { name: `XE THỬ ${suffix}`, description: '', sortOrder: 0 },
        actor(),
      ),
    ).rejects.toThrow('Danh mục này đã tồn tại.');

    const vehicle = await vehicles.create(
      {
        slug: `cat-${suffix}`,
        name: `Cat ${suffix}`,
        make: 'Test',
        category: `Xe thử ${suffix}`,
        description: 'd',
        artwork: 'cargo',
        images: [],
        badge: 'b',
        useCase: 'u',
        highlights: ['h'],
        knownDetails: [],
        sourceUrl: null,
        isPublished: false,
      },
      actor(),
    );

    const renamed = await categories.update(
      category!.id,
      { name: `Xe đổi tên ${suffix}` },
      actor(),
    );
    expect(renamed).toMatchObject({ vehicleCount: 1, sortOrder: 5 });
    const moved = await pool.query<{ category: string }>(
      'SELECT category FROM vehicles WHERE id = $1',
      [vehicle!.id],
    );
    expect(moved.rows[0].category).toBe(`Xe đổi tên ${suffix}`);

    await expect(categories.remove(category!.id, actor())).rejects.toThrow(
      /đang được 1 xe sử dụng/,
    );
    await vehicles.remove(vehicle!.id, actor());
    await categories.remove(category!.id, actor());

    const audit = await pool.query(
      `SELECT 1 FROM activity_logs
       WHERE entity_type = 'vehicle_category' AND entity_id = $1`,
      [category!.id],
    );
    expect(audit.rowCount).toBe(3);
  }, 30_000);

  it('lists and revokes admin sessions', async () => {
    const auth = new AdminAuthService(
      database,
      new LoginThrottle(rateLimit),
      new TwoFactorService(database, rateLimit),
    );
    const sessions = new AdminSessionsService(database);
    const second = asSession(
      await auth.login(`dash_${suffix}`, 'dashboard-password-123', {
        userAgent: 'integration-b',
      }),
    );
    const own = await sessions.listOwn(principal);
    expect(own.length).toBeGreaterThanOrEqual(2);
    expect(own.filter((session) => session.current)).toHaveLength(1);
    const other = own.find((session) => !session.current)!;

    await expect(
      sessions.revokeOwn(principal, principal.sessionId),
    ).rejects.toThrow();
    await sessions.revokeOwn(principal, other.id);
    expect(await auth.authenticate(second.accessToken)).toBeNull();

    await auth.login(`dash_${suffix}`, 'dashboard-password-123', {});
    const result = await sessions.revokeAllForUser(ownerId, principal);
    expect(result.revoked).toBeGreaterThanOrEqual(1);
    // Phiên hiện tại được giữ lại khi tự thu hồi.
    expect(await sessions.listOwn(principal)).toHaveLength(1);
  }, 30_000);
});
