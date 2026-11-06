import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { RateLimitService } from './rate-limit.service.js';

const rateLimitMetadataKey = 'request-rate-limit';

export function RateLimit(limit: number, windowMs: number) {
  return SetMetadata(rateLimitMetadataKey, { limit, windowMs });
}

type RateLimitOptions = {
  limit: number;
  windowMs: number;
};

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimit: RateLimitService,
  ) {}

  canActivate(context: ExecutionContext) {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(
      rateLimitMetadataKey,
      [context.getHandler(), context.getClass()],
    );
    if (!options) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const clientAddress =
      request.ip || request.socket.remoteAddress || 'unknown';
    const key = `${request.method}:${request.route?.path ?? request.path}:${clientAddress}`;
    const result = this.rateLimit.consume(key, options.limit, options.windowMs);

    if (!result.allowed) {
      response.setHeader('Retry-After', String(result.retryAfterSeconds));
      throw new HttpException(
        'Bạn gửi yêu cầu quá thường xuyên. Vui lòng thử lại sau.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    response.setHeader('RateLimit-Limit', String(options.limit));
    response.setHeader('RateLimit-Remaining', String(result.remaining));
    response.setHeader(
      'RateLimit-Reset',
      String(Math.ceil(result.resetAt / 1000)),
    );
    return true;
  }
}
