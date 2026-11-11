import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
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

  it('rejects malformed bearer tokens before touching the database', () => {
    return request(app.getHttpServer())
      .get('/api/v1/admin/vehicles')
      .set('Authorization', 'Bearer not a token')
      .expect(401);
  });

  it('rate limits repeated admin login attempts', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
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
