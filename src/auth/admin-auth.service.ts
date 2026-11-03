import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

const tokenLifetimeSeconds = 8 * 60 * 60;

@Injectable()
export class AdminAuthService {
  login(username: unknown, password: unknown) {
    const configuredUsername = process.env.ADMIN_USERNAME;
    const configuredPassword = process.env.ADMIN_PASSWORD;
    const secret = this.getSecret();

    if (!configuredUsername || !configuredPassword) {
      throw new ServiceUnavailableException(
        'ADMIN_USERNAME and ADMIN_PASSWORD must be configured.',
      );
    }

    if (
      typeof username !== 'string' ||
      typeof password !== 'string' ||
      !constantTimeEqual(username, configuredUsername) ||
      !constantTimeEqual(password, configuredPassword)
    ) {
      throw new UnauthorizedException(
        'Tên đăng nhập hoặc mật khẩu không đúng.',
      );
    }

    const expiresAt = Math.floor(Date.now() / 1000) + tokenLifetimeSeconds;
    const payload = Buffer.from(
      JSON.stringify({ sub: configuredUsername, exp: expiresAt }),
    ).toString('base64url');
    const signature = sign(payload, secret);
    return {
      accessToken: `${payload}.${signature}`,
      expiresIn: tokenLifetimeSeconds,
    };
  }

  verify(token: string): boolean {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra !== undefined) return false;

    const expectedSignature = sign(payload, this.getSecret());
    if (!constantTimeEqual(signature, expectedSignature)) return false;

    try {
      const decoded: unknown = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      );
      if (!isTokenPayload(decoded)) return false;
      return decoded.exp > Math.floor(Date.now() / 1000);
    } catch {
      return false;
    }
  }

  private getSecret() {
    const secret = process.env.ADMIN_AUTH_SECRET;
    if (!secret || secret.length < 32) {
      throw new ServiceUnavailableException(
        'ADMIN_AUTH_SECRET must contain at least 32 characters.',
      );
    }
    return secret;
  }
}

function sign(payload: string, secret: string) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function constantTimeEqual(left: string, right: string) {
  const leftDigest = createHmac('sha256', 'comparison').update(left).digest();
  const rightDigest = createHmac('sha256', 'comparison').update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function isTokenPayload(value: unknown): value is { sub: string; exp: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'sub' in value &&
    typeof value.sub === 'string' &&
    'exp' in value &&
    typeof value.exp === 'number'
  );
}
