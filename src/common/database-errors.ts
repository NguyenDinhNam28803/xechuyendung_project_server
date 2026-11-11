import { ConflictException } from '@nestjs/common';

/** SQLSTATE 23505: unique_violation. */
export function isUniqueViolation(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  );
}

export function rethrowUniqueViolation(error: unknown, message: string): never {
  if (isUniqueViolation(error)) throw new ConflictException(message);
  throw error;
}
