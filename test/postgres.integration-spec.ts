import 'dotenv/config';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { parsePaginationQuery } from '../src/common/pagination.js';
import { DatabaseService } from '../src/database/database.service.js';
import { ContactSubmissionsService } from '../src/contact-submissions/contact-submissions.service.js';
import { parseContactSubmission } from '../src/contact-submissions/contact-submissions.validation.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationEnabled = process.env.RUN_POSTGRES_INTEGRATION === 'true';
const describeIntegration =
  integrationEnabled && testDatabaseUrl ? describe : describe.skip;

describeIntegration('PostgreSQL integration', () => {
  let database: DatabaseService;
  let pool: Pool;
  let submissions: ContactSubmissionsService;

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
    await database.checkHealth();
  }, 30_000);

  afterAll(async () => {
    submissions?.onModuleDestroy();
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
      submissions.updateStatus(created.id, 'in_progress'),
    ).resolves.toMatchObject({ id: created.id, status: 'in_progress' });
    await submissions.remove(created.id);

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
});
