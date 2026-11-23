import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminAuthGuard } from './admin-auth.guard.js';
import type { AdminAuthService } from './admin-auth.service.js';
import {
  type AdminPrincipal,
  allowWithoutTwoFactorKey,
  twoFactorSetupRequiredCode,
} from './admin-principal.js';

const principal: AdminPrincipal = {
  id: '11111111-1111-4111-8111-111111111111',
  username: 'bientap01',
  displayName: 'Biên tập',
  role: 'editor',
  sessionId: '22222222-2222-4222-8222-222222222222',
  twoFactorEnabled: false,
  twoFactorSetupRequired: true,
};

function contextFor(handler: () => void) {
  const request = { headers: { authorization: `Bearer ${'a'.repeat(43)}` } };
  return {
    request,
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => handler,
      getClass: () => class Controller {},
    } as unknown as ExecutionContext,
  };
}

function guardFor(current: AdminPrincipal) {
  const auth = {
    authenticate: vi.fn().mockResolvedValue(current),
  } as unknown as AdminAuthService;
  return new AdminAuthGuard(auth, new Reflector());
}

describe('AdminAuthGuard with mandatory 2FA', () => {
  it('blocks restricted sessions on ordinary admin routes with a machine-readable code', async () => {
    const { context } = contextFor(function listVehicles() {});
    const error = await guardFor(principal)
      .canActivate(context)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({
      code: twoFactorSetupRequiredCode,
    });
  });

  it('allows restricted sessions on routes marked for enrollment', async () => {
    function setup() {}
    Reflect.defineMetadata(allowWithoutTwoFactorKey, true, setup);
    const { context, request } = contextFor(setup);
    await expect(guardFor(principal).canActivate(context)).resolves.toBe(true);
    expect(request).toMatchObject({ admin: principal });
  });

  it('lets enrolled sessions through every route', async () => {
    const { context } = contextFor(function listVehicles() {});
    await expect(
      guardFor({
        ...principal,
        twoFactorEnabled: true,
        twoFactorSetupRequired: false,
      }).canActivate(context),
    ).resolves.toBe(true);
  });
});
