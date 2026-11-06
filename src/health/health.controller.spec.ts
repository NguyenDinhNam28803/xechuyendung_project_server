import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DatabaseService } from '../database/database.service.js';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('reports liveness without requiring database access', async () => {
    const controller = await createController({
      checkHealth: vi.fn(),
    });
    expect(controller.live()).toEqual({ status: 'ok' });
  });

  it('reports readiness when PostgreSQL is available', async () => {
    const controller = await createController({
      checkHealth: vi.fn().mockResolvedValue(true),
    });
    await expect(controller.ready()).resolves.toEqual({
      status: 'ready',
      checks: { database: 'ok' },
    });
  });

  it('returns service unavailable when PostgreSQL is not ready', async () => {
    const controller = await createController({
      checkHealth: vi.fn().mockRejectedValue(new Error('connection failed')),
    });
    await expect(controller.ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

async function createController(database: {
  checkHealth: ReturnType<typeof vi.fn>;
}) {
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [{ provide: DatabaseService, useValue: database }],
  }).compile();
  return moduleRef.get(HealthController);
}
