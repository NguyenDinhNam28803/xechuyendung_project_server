import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { databaseSslOptions } from './ssl-options.js';

describe('databaseSslOptions', () => {
  it('tắt TLS khi DATABASE_SSL khác "true"', () => {
    expect(databaseSslOptions({})).toBeUndefined();
    expect(databaseSslOptions({ DATABASE_SSL: 'false' })).toBeUndefined();
  });

  it('bật TLS và luôn kiểm tra chứng chỉ', () => {
    expect(databaseSslOptions({ DATABASE_SSL: 'true' })).toEqual({
      rejectUnauthorized: true,
    });
  });

  it('nạp CA riêng từ DATABASE_SSL_CA (Supabase)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ssl-ca-'));
    const caPath = join(dir, 'ca.crt');
    writeFileSync(caPath, '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n');
    expect(
      databaseSslOptions({ DATABASE_SSL: 'true', DATABASE_SSL_CA: caPath }),
    ).toEqual({
      rejectUnauthorized: true,
      ca: '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n',
    });
  });
});
