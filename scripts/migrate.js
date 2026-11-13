import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const directory = dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = join(directory, '..', 'migrations');
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL must be configured before running migrations.');
}

const pool = new Pool({
  connectionString,
  // Giống src/database/ssl-options.ts: DATABASE_SSL_CA cho CA riêng (Supabase).
  ssl:
    process.env.DATABASE_SSL === 'true'
      ? {
          rejectUnauthorized: true,
          ...(process.env.DATABASE_SSL_CA?.trim()
            ? { ca: readFileSync(process.env.DATABASE_SSL_CA.trim(), 'utf8') }
            : {}),
        }
      : undefined,
});

const migrationLockId = 7_804_202_026;
const client = await pool.connect();
try {
  await client.query('SELECT pg_advisory_lock($1)', [migrationLockId]);
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();

  for (const file of files) {
    const alreadyApplied = await client.query(
      'SELECT 1 FROM schema_migrations WHERE name = $1',
      [file],
    );
    if (alreadyApplied.rowCount) continue;

    try {
      await client.query('BEGIN');
      await client.query(
        await readFile(join(migrationsDirectory, file), 'utf8'),
      );
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [
        file,
      ]);
      await client.query('COMMIT');
      console.info(`Applied migration ${file}.`);
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Unable to roll back failed migration.', rollbackError);
      }
      throw error;
    }
  }
} finally {
  try {
    await client.query('SELECT pg_advisory_unlock($1)', [migrationLockId]);
  } finally {
    client.release();
    await pool.end();
  }
}
