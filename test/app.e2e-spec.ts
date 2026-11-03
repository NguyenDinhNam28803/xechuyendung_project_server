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

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
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
  });

  afterEach(async () => {
    await app.close();
  });
});
