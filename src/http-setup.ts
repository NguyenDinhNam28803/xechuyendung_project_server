import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { securityHeadersMiddleware } from './common/security-headers.js';

/**
 * Middleware HTTP dùng chung cho main.ts và test e2e: header bảo mật,
 * X-Request-ID (nhận từ proxy nếu hợp lệ, ngược lại tự sinh) và log JSON mỗi
 * request. Đặt ở một chỗ để test kiểm chứng đúng cấu hình chạy production.
 */
export function configureHttp(app: INestApplication) {
  const express = app.getHttpAdapter().getInstance() as {
    disable(setting: string): void;
  };
  express.disable('x-powered-by');
  app.use(securityHeadersMiddleware);

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
}
