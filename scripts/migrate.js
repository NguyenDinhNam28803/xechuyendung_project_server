import 'dotenv/config';
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
  ssl:
    process.env.DATABASE_SSL === 'true'
      ? { rejectUnauthorized: true }
      : undefined,
});

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();

  for (const file of files) {
    const alreadyApplied = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE name = $1',
      [file],
    );
    if (alreadyApplied.rowCount) continue;

    const client = await pool.connect();
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
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
