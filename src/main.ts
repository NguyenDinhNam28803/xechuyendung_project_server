import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  app.useBodyParser('json', { limit: '64kb' });
  const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
  if (trustProxy !== false) {
    app.getHttpAdapter().getInstance().set('trust proxy', trustProxy);
  }
  const logger = new Logger('HttpRequest');
  app.use((request: Request, response: Response, next: NextFunction) => {
    const suppliedId = request.headers['x-request-id'];
    const requestId =
      typeof suppliedId === 'string' &&
      /^[a-zA-Z0-9._-]{1,100}$/.test(suppliedId)
        ? suppliedId
        : randomUUID();
    const startedAt = Date.now();
    response.setHeader('X-Request-ID', requestId);
    response.on('finish', () => {
      const route = request.route?.path
        ? `${request.baseUrl}${request.route.path}`
        : 'unmatched';
      const entry = JSON.stringify({
        event: 'http_request',
        requestId,
        method: request.method,
        route,
        statusCode: response.statusCode,
        durationMs: Date.now() - startedAt,
      });
      if (response.statusCode >= 500) logger.error(entry);
      else logger.log(entry);
    });
    next();
  });
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 4000);

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
