import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { CassandraModule } from '../../src/cassandra/cassandra.module';
import { CassandraService } from '../../src/cassandra/cassandra.service';
import { APP_CONFIG, type AppConfig } from '../../src/config/config';
import { ConfigModule } from '../../src/config/config.module';
import { RedisModule } from '../../src/redis/redis.module';
import { RedisService } from '../../src/redis/redis.service';
import { MoveWriter } from '../../src/worker/persister/move-writer';
import {
  PERSISTER_GROUP,
  PersisterService,
} from '../../src/worker/persister/persister.service';
import {
  parsePendingSummary,
  parseXinfoGroups,
} from '../../src/worker/persister/stream-info';
import { flushTestDb } from './helpers';
import {
  bucketOf,
  makeSeed,
  toEntries,
  toFields,
  waitFor,
} from './persister.helpers';

const STREAM = 'stream:moves';

/** zahteva Redis i Cassandru (worker ne sme da radi); Redis db 1 */
describe('persister (integration)', () => {
  let app: INestApplication;
  let redis: RedisService;
  let cassandra: CassandraService;
  let config: AppConfig;
  const services: PersisterService[] = [];

  function makeService(db: CassandraService = cassandra, name?: string) {
    const svc = new PersisterService(redis, new MoveWriter(db), config);
    svc.consumer = name ?? `t-${randomUUID().slice(0, 6)}`;
    services.push(svc);
    return svc;
  }

  const pendingCount = async () =>
    parsePendingSummary(
      await redis.client.call('XPENDING', STREAM, PERSISTER_GROUP),
    ).count;

  const groupInfo = async () =>
    parseXinfoGroups(await redis.client.call('XINFO', 'GROUPS', STREAM)).find(
      (g) => g.name === PERSISTER_GROUP,
    );

  /** sve do `lastId` isporučeno i potvrđeno (pending i last-delivered-id iz istog trenutka) */
  const drained = async (lastId: string) => {
    const g = await groupInfo();
    return g?.pending === 0 && g.lastDeliveredId === lastId;
  };

  const countRows = async (q: string, p: unknown[]) =>
    Number((await cassandra.execute(q, p)).first()['count']);

  const movesInBucket = (bucket: string) =>
    countRows('SELECT count(*) FROM moves_by_time WHERE bucket = ?', [bucket]);

  const xadd = (id: string, fields: string[]) =>
    redis.client.xadd(STREAM, id, ...fields);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, RedisModule, CassandraModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    redis = app.get(RedisService);
    cassandra = app.get(CassandraService);
    config = app.get<AppConfig>(APP_CONFIG);
  });

  beforeEach(async () => {
    await flushTestDb(redis.client);
  });

  afterEach(async () => {
    for (const svc of services.splice(0)) await svc.stop();
  });

  afterAll(async () => {
    await flushTestDb(redis.client);
    await app.close();
  });

  const heatmapCell = async (cellX: number, cellY: number) => {
    const r = await cassandra.execute(
      "SELECT moves FROM heatmap_total WHERE grid = '10x10' AND cell_x = ? AND cell_y = ?",
      [cellX, cellY],
    );
    return r.first() ? Number(r.first()['moves']) : 0;
  };

  it('puni činjenice i brojače, a pending ostaje prazan', async () => {
    const [u1, u2] = [randomUUID(), randomUUID()];
    // 12 poteza naizmenično u ćelijama (0,0) i (1,0) heatmape
    const seed = makeSeed(12, {
      users: [u1, u2],
      pixel: (i) => [i % 2 === 0 ? 3 : 14, 2],
    });
    const bucket = bucketOf(seed);
    const day = new Date(Number(seed[0].id.split('-')[0]))
      .toISOString()
      .slice(0, 10);
    const [cell0, cell1] = [await heatmapCell(0, 0), await heatmapCell(1, 0)];

    const svc = makeService();
    await svc.start();
    for (const m of seed) await xadd(m.id, toFields(m));
    await waitFor(
      async () =>
        (await drained(seed[11].id)) && (await movesInBucket(bucket)) === 12,
    );

    // činjenice
    const history = await cassandra.execute(
      'SELECT username, color FROM pixel_history WHERE x = 3 AND y = 2',
    );
    const mine = history.rows.filter((r) =>
      ['u0', 'u1'].includes(r['username'] as string),
    );
    expect(mine.length).toBeGreaterThanOrEqual(6);
    expect(await movesInBucket(bucket)).toBe(12);

    // brojači
    expect(await heatmapCell(0, 0)).toBe(cell0 + 6);
    expect(await heatmapCell(1, 0)).toBe(cell1 + 6);
    const hours = await cassandra.execute(
      'SELECT moves FROM activity_by_hour WHERE day = ?',
      [day],
    );
    expect(hours.rows.map((r) => Number(r['moves']))).toEqual([12]);
    const colors = await cassandra.execute(
      'SELECT uses FROM color_usage_daily WHERE day = ?',
      [day],
    );
    expect(colors.rows.map((r) => Number(r['uses']))).toEqual(
      Array(12).fill(1),
    );

    expect(await pendingCount()).toBe(0);
  });

  it('idempotentnost: ista poruka dvaput je jedan red', async () => {
    const seed = makeSeed(3, { pixel: () => [5, 5] });
    const svc = makeService();
    await svc.ensureGroup();
    await svc.processEntries(toEntries(seed));
    await svc.processEntries(toEntries(seed)); // ponovljena isporuka

    expect(await movesInBucket(bucketOf(seed))).toBe(3);
    const times = new Set(seed.map((m) => Number(m.id.split('-')[0])));
    const history = await cassandra.execute(
      'SELECT placed_at FROM pixel_history WHERE x = 5 AND y = 5',
    );
    const mine = history.rows.filter((r) =>
      times.has((r['placed_at'] as Date).getTime()),
    );
    expect(mine).toHaveLength(3);
  });

  it('pad consumer-a: poruke koje je A pročitao bez potvrde preuzima B preko XAUTOCLAIM', async () => {
    const seed = makeSeed(5, { pixel: () => [6, 6] });
    const svc = makeService(cassandra, 'consumer-B');
    await svc.ensureGroup();
    for (const m of seed) await xadd(m.id, toFields(m));

    // consumer A čita batch i pada pre potvrde
    await redis.client.call(
      'XREADGROUP',
      'GROUP',
      PERSISTER_GROUP,
      'consumer-A',
      'COUNT',
      10,
      'STREAMS',
      STREAM,
      '>',
    );
    expect(await pendingCount()).toBe(5);

    expect(await svc.claimOnce()).toBe(5);
    expect(await pendingCount()).toBe(0);
    expect(await movesInBucket(bucketOf(seed))).toBe(5);
  });

  it('neispravna poruka se potvrđuje i ne blokira ostale', async () => {
    const seed = makeSeed(3, { pixel: () => [7, 7] });
    const base = Number(seed[0].id.split('-')[0]);
    const svc = makeService();
    await svc.start();

    await xadd(seed[0].id, toFields(seed[0]));
    // loš uid
    await xadd(`${base + 100}-0`, [
      'uid',
      'nije-uuid',
      'u',
      'x',
      'x',
      '1',
      'y',
      '1',
      'c',
      '1',
    ]);
    // nedostaje boja
    await xadd(`${base + 200}-0`, [
      'uid',
      seed[1].uid,
      'u',
      'a',
      'x',
      '1',
      'y',
      '1',
    ]);
    await xadd(`${base + 300}-0`, toFields(seed[2]));

    await waitFor(() => drained(`${base + 300}-0`));
    expect(await movesInBucket(bucketOf(seed))).toBe(2);
    expect(await pendingCount()).toBe(0);
  });

  it('NOGROUP posle brisanja Redisa: ponovo pravi grupu i nastavlja', async () => {
    const seed = makeSeed(4, { pixel: () => [8, 8] });
    const svc = makeService();
    await svc.start();
    await xadd(seed[0].id, toFields(seed[0]));
    await waitFor(() => drained(seed[0].id));

    // Redis izgubi sve, pa nestanu i stream i grupa
    await flushTestDb(redis.client);
    for (const m of seed.slice(1)) await xadd(m.id, toFields(m));

    await waitFor(() => drained(seed[3].id), 20_000);
    expect(await movesInBucket(bucketOf(seed))).toBe(4);
  });

  it('trimovanje ne briše pending ni nepročitane poruke', async () => {
    const seed = makeSeed(6, { pixel: () => [9, 9] });
    const svc = makeService(cassandra, 'trimmer');
    await svc.ensureGroup();
    for (const m of seed.slice(0, 5)) await xadd(m.id, toFields(m));

    // consumer pročita prve 3 bez potvrde: 3 pending, 2 nepročitane
    await redis.client.call(
      'XREADGROUP',
      'GROUP',
      PERSISTER_GROUP,
      'ghost',
      'COUNT',
      3,
      'STREAMS',
      STREAM,
      '>',
    );
    await svc.trim(true);
    expect(await redis.client.xlen(STREAM)).toBe(5); // najstariji pending je prva poruka

    // obradi sve pending, pa pročitaj i obradi preostale 2
    await svc.claimOnce();
    const rest = (await redis.client.call(
      'XREADGROUP',
      'GROUP',
      PERSISTER_GROUP,
      'trimmer',
      'COUNT',
      10,
      'STREAMS',
      STREAM,
      '>',
    )) as [string, [string, string[]][]][];
    await svc.processEntries(rest[0][1]);
    expect(await pendingCount()).toBe(0);

    // nova nepročitana poruka mora da preživi trimovanje
    await xadd(seed[5].id, toFields(seed[5]));
    expect(await svc.trim(true)).toBe(4);
    const ids = (await redis.client.xrange(STREAM, '-', '+')).map((e) => e[0]);
    expect(ids).toEqual([seed[4].id, seed[5].id]);
  });

  it('greška upisa u Cassandru: bez potvrde, pa ponavljanje dok ne uspe', async () => {
    const seed = makeSeed(5, { pixel: () => [10, 10] });
    let calls = 0;
    let failures = 0;
    const flaky = {
      client: {
        execute: (q: string, p?: unknown[], o?: object) => {
          if (calls++ < 10) {
            failures++;
            return Promise.reject(new Error('simulirana greška Cassandre'));
          }
          return cassandra.client.execute(q, p, o);
        },
      },
    } as unknown as CassandraService;

    const svc = makeService(flaky);
    await svc.start();
    for (const m of seed) await xadd(m.id, toFields(m));

    await waitFor(() => Promise.resolve(failures > 0));
    expect(await pendingCount()).toBeGreaterThan(0); // nije potvrđeno dok upis ne uspe

    await waitFor(() => drained(seed[4].id), 30_000);
    expect(await movesInBucket(bucketOf(seed))).toBe(5);
  });
});
