import { readFileSync } from 'node:fs';
import type { ConnectionOptions } from 'node:tls';

/**
 * TLS tới PostgreSQL:
 * - DATABASE_SSL=true: bật TLS và kiểm tra chứng chỉ (verify-full).
 * - DATABASE_SSL_CA=/đường/dẫn/ca.crt: tin thêm CA này. Cần cho Supabase, vì Supabase ký
 *   chứng chỉ bằng CA riêng (không nằm trong kho CA của Node) nên chỉ DATABASE_SSL=true sẽ lỗi
 *   SELF_SIGNED_CERT_IN_CHAIN. Tải file ở Supabase Dashboard > Project Settings > Database >
 *   SSL Configuration > Download certificate.
 * Không bao giờ tắt kiểm tra chứng chỉ (rejectUnauthorized: false).
 */
export function databaseSslOptions(
  env: NodeJS.ProcessEnv = process.env,
): ConnectionOptions | undefined {
  if (env.DATABASE_SSL !== 'true') return undefined;
  const caPath = env.DATABASE_SSL_CA?.trim();
  return caPath
    ? { rejectUnauthorized: true, ca: readFileSync(caPath, 'utf8') }
    : { rejectUnauthorized: true };
}
