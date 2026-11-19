import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

/**
 * Pool PostgreSQL cho các script dòng lệnh (migrate, reset-2fa). Cấu hình TLS
 * giống src/database/ssl-options.ts: DATABASE_SSL=true bật kiểm tra chứng chỉ,
 * DATABASE_SSL_CA cho CA riêng (Supabase). Không bao giờ tắt kiểm tra.
 */
export function createScriptPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL must be configured before running this script.',
    );
  }
  return new Pool({
    connectionString,
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
}
