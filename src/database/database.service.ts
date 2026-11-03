import {
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool | undefined;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (connectionString) {
      this.pool = new Pool({
        connectionString,
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
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy() {
    await this.pool?.end();
  }
}
