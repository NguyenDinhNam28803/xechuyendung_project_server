import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 429 kèm số giây phải chờ. ApiExceptionFilter đặt header `Retry-After` từ
 * `retryAfterSeconds`, nên nơi ném lỗi (service) không cần truy cập response.
 */
export class TooManyAttemptsException extends HttpException {
  constructor(
    message: string,
    readonly retryAfterSeconds: number,
  ) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: 'Too Many Requests',
        message,
        retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
