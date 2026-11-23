import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { CassandraModule } from '../../src/cassandra/cassandra.module';
import { CassandraService } from '../../src/cassandra/cassandra.service';
import { ConfigModule } from '../../src/config/config.module';
import { configureApp } from '../../src/configure-app';
import { HistoryModule } from '../../src/history/history.module';
import { factStatements } from '../../src/worker/persister/move-writer';
import { parseMove } from '../../src/worker/persister/move-record';
import { makeSeed, toFields } from './persister.helpers';

interface HistoryBody {
  items: { username: string; color: number; placedAt: string }[];
  nextPageState: string | null;
}

/** zahteva Cassandru (keyspace pixelboard_test) */
describe('GET /api/pixels/:x/:y/history (integration)', () => {
  let app: INestApplication;
  let cassandra: CassandraService;
  const seed = makeSeed(5, { pixel: () => [10, 20] });
  const limits = { width: 64, height: 32, colors: 32 };
  const moves = seed.map((m) => parseMove(m.id, toFields(m), limits));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, CassandraModule, HistoryModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    cassandra = app.get(CassandraService);
    for (const st of factStatements(moves)) {
      await cassandra.execute(st.query, st.params);
    }
  });

  afterAll(() => app.close());

  const get = (url: string) => request(app.getHttpServer() as App).get(url);

  it('paging: limit 2 daje 3 stranice, najnovije prvo', async () => {
    const times = moves.map((m) => m.placedAt.toISOString()).reverse();

    const p1 = (await get('/api/pixels/10/20/history?limit=2').expect(200))
      .body as HistoryBody;
    expect(p1.items.map((i) => i.placedAt)).toEqual(times.slice(0, 2));
    expect(p1.nextPageState).toEqual(expect.any(String));
    expect(p1.items[0]).toMatchObject({ username: 'u0' });

    const p2 = (
      await get(
        `/api/pixels/10/20/history?limit=2&pageState=${p1.nextPageState}`,
      ).expect(200)
    ).body as HistoryBody;
    expect(p2.items.map((i) => i.placedAt)).toEqual(times.slice(2, 4));

    const p3 = (
      await get(
        `/api/pixels/10/20/history?limit=2&pageState=${p2.nextPageState}`,
      ).expect(200)
    ).body as HistoryBody;
    expect(p3.items.map((i) => i.placedAt)).toEqual(times.slice(4));
  });

  it('piksel bez istorije vraća praznu listu', async () => {
    const res = (await get('/api/pixels/0/31/history').expect(200))
      .body as HistoryBody;
    expect(res).toEqual({ items: [], nextPageState: null });
  });

  it('validacija: van platna, nevalidan limit i pageState daju 400', async () => {
    await get('/api/pixels/9999/0/history').expect(400);
    await get('/api/pixels/-1/0/history').expect(400);
    await get('/api/pixels/abc/0/history').expect(400);
    await get('/api/pixels/1/1/history?limit=0').expect(400);
    await get('/api/pixels/1/1/history?limit=101').expect(400);
    await get('/api/pixels/1/1/history?pageState=zzz').expect(400);
    await get('/api/pixels/1/1/history?pageState=abcdef').expect(400);
  });
});
