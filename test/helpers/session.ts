/** login() trả phiên, hoặc yêu cầu bước 2FA; test cần chắc chắn là phiên. */
export function asSession<T>(result: T) {
  if (!result || typeof result !== 'object' || !('accessToken' in result)) {
    throw new Error('Expected a session, got a 2FA challenge.');
  }
  return result as Extract<T, { accessToken: string }>;
}
