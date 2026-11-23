import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { CassandraModule } from '../../src/cassandra/cassandra.module';
import { CassandraService } from '../../src/cassandra/cassandra.service';
import { ConfigModule } from '../../src/config/config.module';
import { HealthModule } from '../../src/health/health.module';
import { RedisModule } from '../../src/redis/redis.module';
import { RedisService } from '../../src/redis/redis.service';

/** zahteva pokrenute Redis i Cassandru (vidi README, odeljak "Razvoj") */
describe('infra (integration)', () => {
  let app: INestApplication;
  let redis: RedisService;
  let cassandra: CassandraService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, RedisModule, CassandraModule, HealthModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    redis = app.get(RedisService);
    cassandra = app.get(CassandraService);
  });

  afterAll(() => app.close());

  it('redis radi nad test bazom (db 1), ne nad razvojnom', async () => {
    expect(redis.client.options.db).toBe(1);
    const key = `test:${randomUUID()}`;
    await redis.client.set(key, 'v', 'EX', 30);
    expect(await redis.client.get(key)).toBe('v');
    await redis.client.del(key);
  });

  it('cassandra koristi test keyspace sa svih 9 tabela iz šeme', async () => {
    expect(cassandra.client.keyspace).toBe('pixelboard_test');
    const result = await cassandra.execute(
      'SELECT table_name FROM system_schema.tables WHERE keyspace_name = ?',
      ['pixelboard_test'],
    );
    expect(result.rows.map((r) => r['table_name'] as string).sort()).toEqual([
      'activity_by_hour',
      'canvas_snapshots',
      'color_usage_daily',
      'heatmap_total',
      'moves_by_time',
      'pixel_history',
      'users_by_username',
      'zone_locks_active',
      'zone_locks_by_month',
    ]);
  });

  it('GET /api/health vraća 200 kad su obe baze dostupne', async () => {
    const res = await request(app.getHttpServer() as App).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      redis: 'up',
      cassandra: 'up',
    });
  });
});
