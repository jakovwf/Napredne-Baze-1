import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { PublicUser } from '@pixelboard/shared';
import { randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { CanvasService } from '../../src/canvas/canvas.service';
import { RecoveryService } from '../../src/canvas/recovery.service';
import { CassandraService } from '../../src/cassandra/cassandra.service';
import { APP_CONFIG, type AppConfig } from '../../src/config/config';
import { configureApp } from '../../src/configure-app';
import { LuaScriptsService } from '../../src/redis/lua-scripts.service';
import { RedisService } from '../../src/redis/redis.service';
import { SnapshotsService } from '../../src/snapshot/snapshots.service';
import { MoveWriter } from '../../src/worker/persister/move-writer';
import { PersisterService } from '../../src/worker/persister/persister.service';
import { parseXinfoGroups } from '../../src/worker/persister/stream-info';
import {
  SnapshotterService,
  lastGeneratedId,
} from '../../src/worker/snapshotter.service';
import { flushTestDb } from './helpers';
import { waitFor } from './persister.helpers';

const W = Number(process.env.CANVAS_WIDTH);
const H = Number(process.env.CANVAS_HEIGHT);
const admin = (): PublicUser => ({
  id: randomUUID(),
  username: 'adm',
  role: 'admin',
});
const bucketOf = (ms: number) =>
  new Date(ms).toISOString().slice(0, 13).replace(/[-T]/g, '');

/** zahteva Redis (db 1) i Cassandru (keyspace pixelboard_test) */
describe('oporavak platna (integration)', () => {
  let app: INestApplication;
  let appB: INestApplication | undefined;
  let redis: RedisService;
  let cassandra: CassandraService;
  let canvas: CanvasService;
  let recovery: RecoveryService;
  let snapshots: SnapshotsService;
  let lua: LuaScriptsService;
  let config: AppConfig;
  const cleanups: (() => Promise<void> | void)[] = [];

  async function boot(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const a = moduleRef.createNestApplication();
    configureApp(a);
    await a.init();
    await a.get(RecoveryService).settled();
    return a;
  }

  const resetAll = async () => {
    await cassandra.execute('TRUNCATE canvas_snapshots');
    await cassandra.execute('TRUNCATE moves_by_time');
    await flushTestDb(redis.client);
  };

  const redisCanvas = () => redis.client.getBuffer('canvas:main');
  const version = async () => Number(await redis.client.get('canvas:version'));

  const insertMove = (
    ms: number,
    seq: number,
    x: number,
    y: number,
    color: number,
  ) =>
    cassandra.execute(
      'INSERT INTO moves_by_time (bucket, placed_at, seq, x, y, color, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [bucketOf(ms), new Date(ms), seq, x, y, color, randomUUID()],
    );

  beforeAll(async () => {
    app = await boot();
    redis = app.get(RedisService);
    cassandra = app.get(CassandraService);
    canvas = app.get(CanvasService);
    recovery = app.get(RecoveryService);
    snapshots = app.get(SnapshotsService);
    lua = app.get(LuaScriptsService);
    config = app.get<AppConfig>(APP_CONFIG);
  });

  beforeEach(async () => {
    await recovery.settled();
    await resetAll();
    await recovery.ensureReady(); // prazno platno + snapshot #0
  });

  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
  });

  afterAll(async () => {
    await resetAll();
    await appB?.close();
    await app.close();
  });

  const waitDrained = () =>
    waitFor(async () => {
      const raw = await redis.client.call('XINFO', 'STREAM', 'stream:moves');
      const group = parseXinfoGroups(
        await redis.client.call('XINFO', 'GROUPS', 'stream:moves'),
      )[0];
      return (
        group?.pending === 0 && group.lastDeliveredId === lastGeneratedId(raw)
      );
    }, 30_000);

  it('potezi, persister, snapshot usred toka, još potezi, FLUSHDB: isto platno', async () => {
    const model = Buffer.alloc(W * H);
    const place = async (n: number) => {
      for (let i = 0; i < n; i++) {
        const [x, y, c] = [randomInt(0, W), randomInt(0, H), randomInt(1, 32)];
        expect((await canvas.placePixel(admin(), x, y, c)).ok).toBe(true);
        model[y * W + x] = c;
      }
    };
    const persister = new PersisterService(
      redis,
      new MoveWriter(cassandra),
      config,
    );
    persister.consumer = `rec-${randomUUID().slice(0, 6)}`;
    await persister.start();
    cleanups.push(() => persister.stop());
    const snapshotter = new SnapshotterService(redis, snapshots, lua, config);

    await place(40);
    await waitDrained();
    const mid = await snapshotter.takeSnapshot(); // snapshot usred toka
    expect(mid!.canvasVersion).toBe(40);
    await place(40);
    await waitDrained();
    expect(await version()).toBe(80);
    expect((await redisCanvas())!.equals(model)).toBe(true);
    await persister.stop();

    await flushTestDb(redis.client); // pad Redisa
    expect(await redis.client.exists('canvas:main')).toBe(0);
    await recovery.ensureReady();

    expect((await redisCanvas())!.equals(model)).toBe(true);
    expect(await version()).toBe(80); // 40 iz snapshot-a + 40 iz replay-a
    expect(await redis.client.get('canvas:status')).toBe('ready');

    const res = await request(app.getHttpServer() as App)
      .get('/api/canvas')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect((res.body as Buffer).equals(model)).toBe(true);
    expect(res.headers['x-canvas-version']).toBe('80');
  });

  it('bez snapshot-a osim #0: replay poteza iz Cassandre', async () => {
    const t = Date.now();
    await insertMove(t, 0, 3, 3, 9);
    await insertMove(t, 1, 4, 4, 8);
    await insertMove(t, 2, 3, 3, 7); // prepisuje (3,3)
    await flushTestDb(redis.client);
    await recovery.ensureReady();

    const buf = (await redisCanvas())!;
    expect(buf[3 * W + 3]).toBe(7);
    expect(buf[4 * W + 4]).toBe(8);
    expect(await version()).toBe(3);
  });

  it('nema nijednog snapshot-a: prazno platno i snapshot #0', async () => {
    await cassandra.execute('TRUNCATE canvas_snapshots');
    await flushTestDb(redis.client);
    await recovery.ensureReady();

    expect((await redisCanvas())!.equals(Buffer.alloc(W * H))).toBe(true);
    expect(await version()).toBe(0);
    const list = await snapshots.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      canvasVersion: 0,
      lastStreamId: '0-0',
      width: W,
      height: H,
    });
  });

  it('granica snapshot-a: isti ms i različit seq, ništa izgubljeno ni duplirano', async () => {
    const ms = Date.now() - 5000;
    await insertMove(ms, 0, 10, 10, 11); // već u snapshot-u
    await insertMove(ms, 1, 11, 11, 12); // granica (last_stream_id), već u snapshot-u
    await insertMove(ms, 2, 12, 12, 5); // treba primeniti
    await insertMove(ms, 3, 13, 13, 7); // treba primeniti
    // snapshot kaže: obuhvaćeno je sve do (ms, 1), a njegovi podaci ne sadrže (10,10) i (11,11)
    await snapshots.save({
      data: Buffer.alloc(W * H),
      version: 100,
      lastStreamId: `${ms}-1`,
      width: W,
      height: H,
    });
    await flushTestDb(redis.client);
    await recovery.ensureReady();

    const buf = (await redisCanvas())!;
    expect(buf[10 * W + 10]).toBe(0);
    expect(buf[11 * W + 11]).toBe(0);
    expect(buf[12 * W + 12]).toBe(5);
    expect(buf[13 * W + 13]).toBe(7);
    expect(await version()).toBe(102); // 100 + tačno 2 primenjena
  });

  it('snapshot sa drugačijim dimenzijama se preskače, koristi se stariji', async () => {
    const good = Buffer.alloc(W * H, 3);
    await snapshots.save({
      data: good,
      version: 50,
      lastStreamId: '0-0',
      width: W,
      height: H,
    });
    await new Promise((r) => setTimeout(r, 5));
    await snapshots.save({
      data: Buffer.alloc(100, 9),
      version: 60,
      lastStreamId: '0-0',
      width: 10,
      height: 10,
    });
    await flushTestDb(redis.client);
    await recovery.ensureReady();

    expect((await redisCanvas())!.equals(good)).toBe(true);
    expect(await version()).toBe(50);
  });

  it('dve instance posle FLUSHDB: tačno jedan oporavak', async () => {
    appB = await boot();
    const other = appB.get(RecoveryService);
    await snapshots.save({
      data: Buffer.alloc(W * H, 2),
      version: 5,
      lastStreamId: '0-0',
      width: W,
      height: H,
    });
    const before = recovery.recoveries + other.recoveries;

    await flushTestDb(redis.client);
    await Promise.all([recovery.ensureReady(), other.ensureReady()]);
    // ko nije dobio lock ne radi ništa; sledeća provera bi svejedno videla spremno platno
    await Promise.all([recovery.ensureReady(), other.ensureReady()]);

    expect(recovery.recoveries + other.recoveries - before).toBe(1);
    expect(await redis.client.get('canvas:status')).toBe('ready');
    expect(await version()).toBe(5);
  });

  it('tokom oporavka: potez se odbija (NOT_READY) i GET /api/canvas vraća 503', async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const original = (recovery as unknown as { moves: unknown }).moves;
    // usporava replay da bi se oporavak mogao posmatrati
    Object.assign(recovery, {
      moves: {
        // eslint-disable-next-line require-yield
        async *read() {
          await gate;
        },
      },
    });
    cleanups.push(() => {
      Object.assign(recovery, { moves: original });
      open();
    });

    await flushTestDb(redis.client);
    const running = recovery.ensureReady();
    await waitFor(
      async () => (await redis.client.get('canvas:status')) === 'recovering',
      5000,
      10,
    );

    expect(await canvas.placePixel(admin(), 1, 1, 1)).toMatchObject({
      ok: false,
      error: 'NOT_READY',
    });
    const res = await request(app.getHttpServer() as App)
      .get('/api/canvas')
      .expect(503);
    expect(res.headers['retry-after']).toBeDefined();

    open();
    await running;
    expect(await canvas.placePixel(admin(), 1, 1, 1)).toMatchObject({
      ok: true,
    });
  });
});
