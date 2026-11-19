import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('GET /api/scenario', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());

  it('returns 24 fresh markers per call', async () => {
    const a = await request(app.getHttpServer()).get('/api/scenario').expect(200);
    const b = await request(app.getHttpServer()).get('/api/scenario').expect(200);
    expect(a.body).toHaveLength(24);
    expect(b.body).toHaveLength(24);
    expect(a.body[0].latitude).not.toBe(b.body[0].latitude);
  });
});
