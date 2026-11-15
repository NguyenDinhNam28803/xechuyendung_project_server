import type { NextFunction, Request, Response } from 'express';

/**
 * Header bảo mật cho API JSON (thay cho helmet, không thêm dependency). API
 * chỉ trả JSON nên CSP chặn mọi thứ; trình duyệt không được nhúng, đoán kiểu
 * nội dung hay lưu cache phản hồi quản trị.
 */
export const securityHeaders: Record<string, string> = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Cross-Origin-Resource-Policy': 'same-site',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

export function securityHeadersMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  for (const [name, value] of Object.entries(securityHeaders)) {
    response.setHeader(name, value);
  }
  // Dữ liệu quản trị (kể cả thông tin liên hệ khách hàng) không được cache.
  if (
    request.path.startsWith('/api/v1/admin') ||
    request.path.startsWith('/api/v1/auth')
  ) {
    response.setHeader('Cache-Control', 'no-store');
  }
  next();
}
