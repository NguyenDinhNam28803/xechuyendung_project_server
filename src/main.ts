import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureHttp } from './http-setup.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  app.useBodyParser('json', { limit: '64kb' });
  const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
  if (trustProxy !== false) {
    app.getHttpAdapter().getInstance().set('trust proxy', trustProxy);
  }
  configureHttp(app);
  app.enableShutdownHooks();
  // HOST=127.0.0.1 trên VPS: API chỉ nhận kết nối từ Next cùng máy, không mở ra Internet.
  const host = process.env.HOST?.trim();
  if (host) await app.listen(process.env.PORT ?? 4000, host);
  else await app.listen(process.env.PORT ?? 4000);

  const bootstrapLogger = new Logger('Bootstrap');
  bootstrapLogger.log('Xe Chuyên Dụng API is running.');
  bootstrapLogger.log(`URL: ${await app.getUrl()}`);
  bootstrapLogger.log(`Environment: ${process.env.NODE_ENV ?? 'not set'}`);
  bootstrapLogger.log(
    'API: /api/v1 (public), /api/v1/admin (authenticated), /health/live, /health/ready',
  );
}

function parseTrustProxy(value: string | undefined): boolean | number | string {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  if (/^\d+$/.test(normalized)) return Number(normalized);
  return value.trim();
}

await bootstrap();
