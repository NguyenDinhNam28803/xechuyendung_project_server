import {
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool | undefined;

  get isConfigured() {
    return this.pool !== undefined;
  }

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (connectionString) {
      this.pool = new Pool({
        connectionString,
        max: 10,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 30_000,
        query_timeout: 10_000,
        ssl:
          process.env.DATABASE_SSL === 'true'
            ? { rejectUnauthorized: true }
            : undefined,
      });
      this.pool.on('error', (error: Error) => {
        console.error('Unexpected PostgreSQL pool error.', error);
      });
    }
  }

  async query<Row extends QueryResultRow>(text: string, values?: unknown[]) {
    if (!this.pool) {
      throw new ServiceUnavailableException('DATABASE_URL is not configured.');
    }
    return this.pool.query<Row>(text, values);
  }

  async checkHealth() {
    await this.query<{ ok: number }>('SELECT 1 AS ok');
    return true;
  }

  async withTransaction<Result>(
    operation: (client: PoolClient) => Promise<Result>,
  ): Promise<Result> {
    if (!this.pool) {
      throw new ServiceUnavailableException('DATABASE_URL is not configured.');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error(
          'Unable to roll back PostgreSQL transaction.',
          rollbackError,
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Chạy `operation` trong transaction chỉ khi giành được advisory lock
   * `lockKey`. Khi nhiều instance cùng chạy job định kỳ, chỉ một instance thực
   * hiện; các instance còn lại bỏ qua ngay (không chờ). Lock tự nhả khi
   * transaction kết thúc.
   */
  async runExclusive<Result>(
    lockKey: number,
    operation: (client: PoolClient) => Promise<Result>,
  ): Promise<{ acquired: false } | { acquired: true; result: Result }> {
    return this.withTransaction(async (client) => {
      const lock = await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_xact_lock($1) AS acquired',
        [lockKey],
      );
      if (!lock.rows[0]?.acquired) return { acquired: false as const };
      return { acquired: true as const, result: await operation(client) };
    });
  }

  async onModuleDestroy() {
    await this.pool?.end();
  }
}
