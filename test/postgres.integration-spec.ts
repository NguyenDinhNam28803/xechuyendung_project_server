import 'dotenv/config';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { parsePaginationQuery } from '../src/common/pagination.js';
import { DatabaseService } from '../src/database/database.service.js';
import { systemActor } from '../src/activity/activity.service.js';
import { AdminUsersService } from '../src/admin-users/admin-users.service.js';
import { AdminAuthService } from '../src/auth/admin-auth.service.js';
import type { AdminPrincipal } from '../src/auth/admin-principal.js';
import { ContactSubmissionsService } from '../src/contact-submissions/contact-submissions.service.js';
import { RateLimitService } from '../src/security/rate-limit.service.js';
import { VehiclesService } from '../src/vehicles/vehicles.service.js';
import { parseContactSubmission } from '../src/contact-submissions/contact-submissions.validation.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationEnabled = process.env.RUN_POSTGRES_INTEGRATION === 'true';
const describeIntegration =
  integrationEnabled && testDatabaseUrl ? describe : describe.skip;

describeIntegration('PostgreSQL integration', () => {
  let database: DatabaseService;
  let pool: Pool;
  let submissions: ContactSubmissionsService;
  let rateLimit: RateLimitService;
  let auth: AdminAuthService;
  let users: AdminUsersService;

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error(
        'TEST_DATABASE_URL is required for PostgreSQL integration tests.',
      );
    }

    const applicationDatabaseUrl = process.env.DATABASE_URL;
    const testDatabase = new URL(testDatabaseUrl);
    const applicationDatabase = applicationDatabaseUrl
      ? new URL(applicationDatabaseUrl)
      : undefined;
    const databaseName = decodeURIComponent(testDatabase.pathname.slice(1));
    const applicationDatabaseName = applicationDatabase
      ? decodeURIComponent(applicationDatabase.pathname.slice(1))
      : undefined;
    const sameDatabase =
      applicationDatabase !== undefined &&
      testDatabase.hostname === applicationDatabase.hostname &&
      testDatabase.port === applicationDatabase.port &&
      databaseName === applicationDatabaseName;
    if (
      !applicationDatabaseUrl ||
      sameDatabase ||
      databaseName === applicationDatabaseName ||
      !/(^|[_-])test([_-]|$)/i.test(databaseName)
    ) {
      throw new Error(
        'Integration tests require a separate database whose name includes "test".',
      );
    }

    process.env.DATABASE_URL = testDatabaseUrl;
    await import('../scripts/migrate.js');
    database = new DatabaseService();
    pool = new Pool({
      connectionString: testDatabaseUrl,
      ssl:
        process.env.DATABASE_SSL === 'true'
          ? { rejectUnauthorized: true }
          : undefined,
    });
    submissions = new ContactSubmissionsService(database);
    rateLimit = new RateLimitService(database);
    auth = new AdminAuthService(database, rateLimit);
    users = new AdminUsersService(database);
    await database.checkHealth();
  }, 30_000);

  afterAll(async () => {
    rateLimit?.onModuleDestroy();
    await database?.onModuleDestroy();
    await pool?.end();
  });

  it('migrates schema and exercises contact create, search, update, delete and retention', async () => {
    const marker = `integration-${randomUUID()}`;
    const input = parseContactSubmission({
      name: 'Integration Test',
      phone: '09012345678',
      category: 'Xe tải',
      message: marker,
      consent: true,
    });

    const created = await submissions.create(input);
    const page = await submissions.findRecent(
      parsePaginationQuery('1', '10', marker),
    );
    expect(page.items.map((item) => item.id)).toContain(created.id);

    await expect(
      submissions.updateStatus(created.id, 'in_progress', systemActor),
    ).resolves.toMatchObject({ id: created.id, status: 'in_progress' });
    const touched = await pool.query<{ changed: boolean }>(
      'SELECT updated_at > created_at AS changed FROM contact_submissions WHERE id = $1',
      [created.id],
    );
    expect(touched.rows[0].changed).toBe(true);
    await submissions.remove(created.id, systemActor);

    const auditRows = await database.query<{
      entityLabel: string;
      entityType: string;
    }>(
      `SELECT entity_label AS "entityLabel", entity_type AS "entityType"
       FROM activity_logs WHERE entity_id = $1`,
      [created.id],
    );
    expect(auditRows.rows).toHaveLength(2);
    expect(
      auditRows.rows.every((row) => row.entityType === 'contact_submission'),
    ).toBe(true);
    expect(JSON.stringify(auditRows.rows)).not.toContain(marker);
    expect(JSON.stringify(auditRows.rows)).not.toContain(input.phone);

    const expired = await pool.query<{ id: string }>(
      `INSERT INTO contact_submissions (
         name, phone, category, consent_text, consent_at, created_at
       ) VALUES ('Integration Test', '09012345678', 'Xe tải', 'test consent',
                 NOW(), NOW() - INTERVAL '91 days')
       RETURNING id`,
    );
    await expect(submissions.purgeExpired()).resolves.toBeGreaterThanOrEqual(1);
    const expiredRow = await pool.query(
      'SELECT 1 FROM contact_submissions WHERE id = $1',
      [expired.rows[0].id],
    );
    expect(expiredRow.rowCount).toBe(0);

    const systemAudit = await pool.query<{
      actor: string;
      entityLabel: string;
    }>(
      `SELECT actor, entity_label AS "entityLabel"
       FROM activity_logs
       WHERE actor = 'system' AND entity_type = 'contact_submission'
       ORDER BY created_at DESC LIMIT 1`,
    );
    expect(systemAudit.rows[0]?.actor).toBe('system');
    expect(systemAudit.rows[0]?.entityLabel).toContain('quá 90 ngày');
  }, 30_000);

  it('authenticates admin users with revocable sessions and audits the real actor', async () => {
    const suffix = randomUUID().slice(0, 8);
    const ownerName = `owner_${suffix}`;
    const ownerHash = await import('../src/auth/password.js').then((module) =>
      module.hashPassword('owner-password-123'),
    );
    const owner = await pool.query<{ id: string }>(
      `INSERT INTO admin_users (username, display_name, password_hash, role)
       VALUES ($1, 'Owner', $2, 'admin') RETURNING id`,
      [ownerName, ownerHash],
    );

    const login = await auth.login(
      ownerName.toUpperCase(),
      'owner-password-123',
      {
        userAgent: 'integration',
      },
    );
    const principal = (await auth.authenticate(
      login.accessToken,
    )) as AdminPrincipal;
    expect(principal).toMatchObject({ id: owner.rows[0].id, role: 'admin' });

    const editor = await users.create(
      {
        username: `editor_${suffix}`,
        displayName: 'Editor',
        password: 'editor-password-123',
        role: 'editor',
      },
      { id: principal.id, username: principal.username },
    );
    const editorLogin = await auth.login(
      `editor_${suffix}`,
      'editor-password-123',
      {},
    );
    expect(await auth.authenticate(editorLogin.accessToken)).not.toBeNull();

    // Khóa tài khoản phải thu hồi phiên ngay lập tức.
    await users.update(editor.id, { isActive: false }, principal);
    expect(await auth.authenticate(editorLogin.accessToken)).toBeNull();

    // Không thể tự khóa mình hoặc làm hệ thống mất quản trị viên cuối.
    await expect(
      users.update(principal.id, { isActive: false }, principal),
    ).rejects.toThrow();

    const vehicles = new VehiclesService(database);
    const vehicle = await vehicles.create(
      {
        slug: `integration-${suffix}`,
        name: `Integration 50%_off ${suffix}`,
        make: 'Test',
        category: 'Xe tải',
        description: 'Integration vehicle',
        artwork: 'cargo',
        images: [],
        badge: 'Test',
        useCase: 'Test',
        highlights: [],
        knownDetails: [],
        sourceUrl: null,
        isPublished: false,
      },
      { id: principal.id, username: principal.username },
    );
    const audit = await pool.query<{ actor: string; actorId: string }>(
      `SELECT actor, actor_id AS "actorId" FROM activity_logs
       WHERE entity_id = $1 AND action = 'CREATE'`,
      [vehicle.id],
    );
    expect(audit.rows[0]).toEqual({ actor: ownerName, actorId: principal.id });

    // "_" và "%" được so khớp theo nghĩa đen.
    const literal = await vehicles.findAll(
      parsePaginationQuery('1', '10', '50%_off'),
    );
    expect(literal.items.map((item) => item.id)).toContain(vehicle.id);
    const wildcard = await vehicles.findAll(
      parsePaginationQuery('1', '10', `Integration_50`),
    );
    expect(wildcard.items.map((item) => item.id)).not.toContain(vehicle.id);
    await vehicles.remove(vehicle.id, {
      id: principal.id,
      username: principal.username,
    });

    await auth.logout(principal);
    expect(await auth.authenticate(login.accessToken)).toBeNull();

    await pool.query('DELETE FROM admin_users WHERE id = ANY($1::uuid[])', [
      [owner.rows[0].id, editor.id],
    ]);
  }, 30_000);

  it('shares rate-limit counters through PostgreSQL', async () => {
    const key = `integration:${randomUUID()}`;
    const other = new RateLimitService(database);
    expect((await rateLimit.consume(key, 2, 60_000)).allowed).toBe(true);
    expect((await other.consume(key, 2, 60_000)).allowed).toBe(true);
    const blocked = await rateLimit.consume(key, 2, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    other.onModuleDestroy();
  });

  it('creates trigram search indexes when pg_trgm is available', async () => {
    const indexes = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE indexname LIKE '%_search_trgm_idx'`,
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        'vehicles_search_trgm_idx',
        'contact_submissions_search_trgm_idx',
        'activity_logs_search_trgm_idx',
      ]),
    );
  });
});
