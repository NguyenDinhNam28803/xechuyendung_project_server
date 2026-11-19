import type { DatabaseService } from '../database/database.service.js';
import { TooManyAttemptsException } from '../common/too-many-attempts.exception.js';
import { RateLimitService } from '../security/rate-limit.service.js';
import { LoginThrottle, loginFailureLimits } from './login-throttle.js';

function createThrottle() {
  const rateLimit = new RateLimitService({
    isConfigured: false,
  } as DatabaseService);
  return { throttle: new LoginThrottle(rateLimit), rateLimit };
}

async function fail(
  throttle: LoginThrottle,
  ip: string,
  user: string,
  times: number,
) {
  for (let i = 0; i < times; i += 1) await throttle.recordFailure(ip, user);
}

describe('LoginThrottle', () => {
  it('blocks an IP/account pair after 5 failures with a Retry-After delay', async () => {
    const { throttle, rateLimit } = createThrottle();
    await fail(
      throttle,
      '203.0.113.1',
      'admin',
      loginFailureLimits.pair.limit - 1,
    );
    await expect(
      throttle.assertAllowed('203.0.113.1', 'admin'),
    ).resolves.toBeUndefined();

    await throttle.recordFailure('203.0.113.1', 'admin');
    const error = await throttle
      .assertAllowed('203.0.113.1', 'ADMIN ')
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TooManyAttemptsException);
    expect(
      (error as TooManyAttemptsException).retryAfterSeconds,
    ).toBeGreaterThan(0);
    rateLimit.onModuleDestroy();
  });

  it('does not lock out the real owner signing in from another IP', async () => {
    const { throttle, rateLimit } = createThrottle();
    await fail(throttle, '203.0.113.66', 'admin', 20);

    await expect(
      throttle.assertAllowed('203.0.113.66', 'admin'),
    ).rejects.toBeInstanceOf(TooManyAttemptsException);
    await expect(
      throttle.assertAllowed('198.51.100.7', 'admin'),
    ).resolves.toBeUndefined();
    rateLimit.onModuleDestroy();
  });

  it('blocks distributed guessing of one account across many IPs', async () => {
    const { throttle, rateLimit } = createThrottle();
    for (let i = 0; i < loginFailureLimits.account.limit; i += 1) {
      await throttle.recordFailure(
        `10.0.${Math.floor(i / 4)}.${i % 4}`,
        'admin',
      );
    }
    await expect(
      throttle.assertAllowed('192.0.2.200', 'admin'),
    ).rejects.toBeInstanceOf(TooManyAttemptsException);
    await expect(
      throttle.assertAllowed('192.0.2.200', 'editor'),
    ).resolves.toBeUndefined();
    rateLimit.onModuleDestroy();
  });

  it('clears only the pair counter after a successful login', async () => {
    const { throttle, rateLimit } = createThrottle();
    await fail(throttle, '203.0.113.1', 'admin', loginFailureLimits.pair.limit);
    await throttle.recordSuccess('203.0.113.1', 'admin');
    await expect(
      throttle.assertAllowed('203.0.113.1', 'admin'),
    ).resolves.toBeUndefined();

    const accountWindow = await rateLimit.peek('login-fail:account:admin');
    expect(accountWindow?.hits).toBe(loginFailureLimits.pair.limit);
    rateLimit.onModuleDestroy();
  });
});
