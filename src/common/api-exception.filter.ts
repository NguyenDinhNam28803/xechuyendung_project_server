import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

export const internalErrorMessage =
  'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.';

/**
 * Chuẩn hóa mọi phản hồi lỗi thành
 * `{ statusCode, error, message, requestId }`:
 *  - HttpException giữ nguyên status và thông điệp (tiếng Việt) như trước;
 *  - lỗi không lường trước (lỗi SQL, bug) trả 500 với thông điệp chung, KHÔNG
 *    lộ chi tiết nội bộ, và được ghi log kèm stack + requestId để tra cứu.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiException');

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const header = response.getHeader('X-Request-ID');
    const requestId = typeof header === 'string' ? header : undefined;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload =
        typeof body === 'string'
          ? { statusCode: status, message: body }
          : { statusCode: status, ...(body as Record<string, unknown>) };
      response.status(status).json({ ...payload, requestId });
      return;
    }

    this.logger.error(
      JSON.stringify({
        event: 'unhandled_exception',
        requestId,
        method: request.method,
        path: request.route?.path ?? 'unmatched',
        message: exception instanceof Error ? exception.message : 'unknown',
      }),
      exception instanceof Error ? exception.stack : undefined,
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: internalErrorMessage,
      requestId,
    });
  }
}
