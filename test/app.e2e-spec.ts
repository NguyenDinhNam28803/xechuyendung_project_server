import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { configureHttp } from './../src/http-setup.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureHttp(app);
    await app.init();
  });

  it('does not expose the scaffold root route', () => {
    return request(app.getHttpServer()).get('/').expect(404);
  });

  it('exposes an independent liveness check', () => {
    return request(app.getHttpServer())
      .get('/health/live')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('/api/v1/admin/vehicles (GET) requires admin authentication', () => {
    return request(app.getHttpServer())
      .get('/api/v1/admin/vehicles')
      .expect(401);
  });

  it('admin legal resources and activity require authentication', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/legal-resources')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/admin/activity')
      .expect(401);
  });

  it('contact submissions validate input and protect the admin inbox', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/contact-submissions')
      .send({})
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/admin/contact-submissions')
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/admin/contact-submissions/search')
      .send({ search: 'phone' })
      .expect(401);
  });

  it('account, user management and logout require authentication', async () => {
    await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    await request(app.getHttpServer()).post('/api/v1/auth/logout').expect(401);
    await request(app.getHttpServer()).get('/api/v1/admin/users').expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/admin/account/password')
      .send({})
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/admin/import-defaults')
      .send({ vehicles: [], articles: [] })
      .expect(401);
  });

  it('dashboard, bulk, session and category endpoints require authentication', async () => {
    const server = app.getHttpServer();
    const id = '11111111-1111-4111-8111-111111111111';
    await request(server).get('/api/v1/admin/stats/overview').expect(401);
    await request(server).get('/api/v1/admin/stats/contacts').expect(401);
    await request(server).get('/api/v1/admin/stats/activity').expect(401);
    for (const collection of ['vehicles', 'articles', 'legal-resources']) {
      await request(server)
        .post(`/api/v1/admin/${collection}/bulk`)
        .send({ ids: [id], action: 'publish' })
        .expect(401);
    }
    await request(server).get('/api/v1/admin/account/sessions').expect(401);
    await request(server)
      .delete(`/api/v1/admin/account/sessions/${id}`)
      .expect(401);
    await request(server).get(`/api/v1/admin/users/${id}/sessions`).expect(401);
    await request(server)
      .post(`/api/v1/admin/users/${id}/sessions/revoke`)
      .expect(401);
    await request(server).get('/api/v1/admin/vehicle-categories').expect(401);
    await request(server)
      .post('/api/v1/admin/vehicle-categories')
      .send({ name: 'Xe mới' })
      .expect(401);
  });

  it('returns errors in a stable shape with the request id', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/stats/overview')
      .set('X-Request-ID', 'e2e-trace-1')
      .expect(401);
    expect(response.body).toEqual({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Vui lòng đăng nhập quản trị.',
      requestId: 'e2e-trace-1',
    });
    expect(response.headers['x-request-id']).toBe('e2e-trace-1');
  });

  it('sends security headers and never caches admin responses', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/vehicles')
      .expect(401);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['content-security-policy']).toContain(
      "default-src 'none'",
    );
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('validates new query parameters before authentication-free work', async () => {
    // Endpoint công khai: danh mục xe cần database → 503 khi chưa cấu hình,
    // không phải 500 với chi tiết nội bộ.
    const response = await request(app.getHttpServer()).get(
      '/api/v1/vehicle-categories',
    );
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toMatch(/stack|pg|sql/i);
  });

  it('rejects malformed bearer tokens before touching the database', () => {
    return request(app.getHttpServer())
      .get('/api/v1/admin/vehicles')
      .set('Authorization', 'Bearer not a token')
      .expect(401);
  });

  it('two-factor endpoints require authentication and valid input', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/account/2fa')
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/admin/account/2fa/setup')
      .expect(401);
    await request(app.getHttpServer())
      .post(
        '/api/v1/admin/users/40f050b4-73d1-47f4-b832-c14246d039d4/2fa/reset',
      )
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login/verify')
      .send({ challengeToken: 'x'.repeat(43) })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login/verify')
      .send({ challengeToken: 'not valid', code: '123456' })
      .expect(401);
  });

  it('rate limits repeated admin login requests from one IP', async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: 'invalid', password: 'invalid' });
      expect(response.status).not.toBe(429);
    }
    const limited = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: 'invalid', password: 'invalid' });
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });

  afterEach(async () => {
    await app.close();
  });
});
