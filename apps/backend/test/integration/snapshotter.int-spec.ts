import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CassandraModule } from '../../src/cassandra/cassandra.module';
import { CassandraService } from '../../src/cassandra/cassandra.service';
import { APP_CONFIG, type AppConfig } from '../../src/config/config';
import { ConfigModule } from '../../src/config/config.module';
import { LuaScriptsService } from '../../src/redis/lua-scripts.service';
import { RedisModule } from '../../src/redis/redis.module';
import { RedisService } from '../../src/redis/redis.service';
import { SnapshotModule } from '../../src/snapshot/snapshot.module';
import { SnapshotsService } from '../../src/snapshot/snapshots.service';
import { SnapshotterService } from '../../src/worker/snapshotter.service';
import { flushTestDb, placeViaLua, seedCanvas } from './helpers';

/** zahteva Redis (db 1) i Cassandru (keyspace pixelboard_test) */
describe('snapshotter (integration)', () => {
  let app: INestApplication;
  let redis: RedisService;
  let cassandra: CassandraService;
  let lua: LuaScriptsService;
  let snapshots: SnapshotsService;
  let config: AppConfig;

  const make = (snapshot: Partial<AppConfig['snapshot']> = {}) =>
    new SnapshotterService(redis, snapshots, lua, {
      ...config,
      snapshot: {
        minMoves: 3,
        intervalMs: 3_600_000,
        keep: 3,
        ...snapshot,
      },
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, RedisModule, CassandraModule, SnapshotModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    redis = app.get(RedisService);
    cassandra = app.get(CassandraService);
    lua = app.get(LuaScriptsService);
    snapshots = app.get(SnapshotsService);
    config = app.get<AppConfig>(APP_CONFIG);
  });

  beforeEach(async () => {
    await flushTestDb(redis.client);
    await seedCanvas(redis.client);
    await cassandra.execute('TRUNCATE canvas_snapshots');
  });

  afterAll(async () => {
    await flushTestDb(redis.client);
    await cassandra.execute('TRUNCATE canvas_snapshots');
    await app.close();
  });

  const place = async (n: number) => {
    for (let i = 0; i < n; i++) await placeViaLua(lua, i % 60, 1, 1 + (i % 9));
  };

  it('snapshot posle dovoljno poteza: platno, verzija i poslednji ID u streamu su tačni', async () => {
    const svc = make();
    await place(3);

    const meta = await svc.tick();
    expect(meta).toMatchObject({ canvasVersion: 3, width: 64, height: 32 });

    const info = (await redis.client.call(
      'XINFO',
      'STREAM',
      'stream:moves',
    )) as string[];
    expect(meta!.lastStreamId).toBe(
      info[info.indexOf('last-generated-id') + 1],
    );

    const data = await snapshots.loadData(meta!);
    const canvas = await redis.client.getBuffer('canvas:main');
    expect(data!.equals(canvas!)).toBe(true);
    expect(await snapshots.list()).toHaveLength(1);
  });

  it('bez izmena nema novog snapshot-a, a manje poteza od praga čeka', async () => {
    const svc = make();
    await place(3);
    expect(await svc.tick()).not.toBeNull();

    expect(await svc.tick()).toBeNull(); // verzija ista

    await place(1);
    expect(await svc.tick()).toBeNull(); // 1 < 3 poteza, a interval nije prošao

    await place(2);
    expect(await svc.tick()).toMatchObject({ canvasVersion: 6 });
    expect(await snapshots.list()).toHaveLength(2);
  });

  it('prošao je interval, a verzija je različita: snapshot i sa malo poteza', async () => {
    const svc = make({ minMoves: 1_000_000, intervalMs: 0 });
    await place(1);
    expect(await svc.tick()).toMatchObject({ canvasVersion: 1 });
    expect(await svc.tick()).toBeNull(); // verzija ista
  });

  it('prazno platno bez streama daje last_stream_id 0-0', async () => {
    const meta = await make().takeSnapshot();
    expect(meta).toMatchObject({ canvasVersion: 0, lastStreamId: '0-0' });
  });

  it('retencija: ostaje poslednjih SNAPSHOT_KEEP snapshot-ova', async () => {
    const svc = make();
    for (let i = 1; i <= 5; i++) {
      await place(1);
      await svc.takeSnapshot();
    }
    const list = await snapshots.list();
    expect(list.map((s) => s.canvasVersion)).toEqual([5, 4, 3]);
  });

  it('ne radi ništa dok status nije ready', async () => {
    const svc = make();
    await place(3);
    await redis.client.set('canvas:status', 'recovering');
    expect(await svc.tick()).toBeNull();
    expect(await svc.takeSnapshot()).toBeNull();
    expect(await snapshots.list()).toHaveLength(0);
  });

  it('lock: dok ga drži neko drugi snapshot se ne pravi, a paralelni pozivi daju jedan snapshot', async () => {
    const svc = make();
    await place(2);
    await redis.client.set('lock:snapshot', 'tudji', 'PX', 30_000);
    expect(await svc.takeSnapshot()).toBeNull();
    expect(await snapshots.list()).toHaveLength(0);
    await redis.client.del('lock:snapshot');

    const results = await Promise.all([
      make().takeSnapshot(),
      make().takeSnapshot(),
      make().takeSnapshot(),
    ]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(await snapshots.list()).toHaveLength(1);
  });
});
