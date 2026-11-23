import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { ConfigModule } from '../../src/config/config.module';
import { LuaScriptsService } from '../../src/redis/lua-scripts.service';
import { RedisKeys } from '../../src/redis/keys';
import { RedisModule } from '../../src/redis/redis.module';
import { RedisService } from '../../src/redis/redis.service';
import { flushTestDb, seedCanvas, sleep } from './helpers';

const W = Number(process.env.CANVAS_WIDTH);
const H = Number(process.env.CANVAS_HEIGHT);
const COOLDOWN_MS = Number(process.env.COOLDOWN_MS);

interface TestUser {
  id: string;
  username: string;
  role: 'user' | 'admin';
}
const mkUser = (role: 'user' | 'admin' = 'user'): TestUser => ({
  id: randomUUID(),
  username: `u_${randomUUID().slice(0, 8)}`,
  role,
});

/** zahteva pokrenut Redis; koristi db 1 (vidi setup-int-env.ts) */
describe('lua skripte (integration)', () => {
  let app: INestApplication;
  let redis: RedisService;
  let lua: LuaScriptsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, RedisModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    redis = app.get(RedisService);
    lua = app.get(LuaScriptsService);
  });

  beforeEach(async () => {
    await flushTestDb(redis.client);
    await seedCanvas(redis.client);
  });

  afterAll(async () => {
    await flushTestDb(redis.client);
    await app.close();
  });

  const place = (
    user: TestUser,
    x: number,
    y: number,
    color: number,
    nowMs = Date.now(),
  ) =>
    lua.run(
      'place_pixel',
      [
        RedisKeys.canvasMain(),
        RedisKeys.canvasStatus(),
        RedisKeys.cooldown(user.id),
        RedisKeys.zonesActive(),
        RedisKeys.streamMoves(),
        RedisKeys.canvasVersion(),
        RedisKeys.configCanvas(),
        RedisKeys.canvasUpdates(),
      ],
      [user.id, user.username, x, y, color, nowMs, user.role],
    ) as Promise<(string | number)[]>;

  const pixelAt = async (x: number, y: number) => {
    const buf = await redis.client.getBuffer(RedisKeys.canvasMain());
    return buf![y * W + x];
  };

  describe('place_pixel', () => {
    it('upis menja bajt, diže verziju, piše u stream, postavlja cooldown i objavljuje poruku', async () => {
      const sub = redis.duplicate('test-sub', { maxRetriesPerRequest: null });
      const messages: string[] = [];
      sub.on('message', (_c: string, m: string) => messages.push(m));
      await sub.subscribe(RedisKeys.canvasUpdates());

      const user = mkUser();
      const res = await place(user, 3, 2, 5);
      expect(res[0]).toBe('OK');
      expect(res[2]).toBe(1);
      expect(res[3]).toBe(COOLDOWN_MS);

      expect(await pixelAt(3, 2)).toBe(5);
      expect(await redis.client.get(RedisKeys.canvasVersion())).toBe('1');

      const stream = await redis.client.xrange(
        RedisKeys.streamMoves(),
        '-',
        '+',
      );
      expect(stream).toHaveLength(1);
      expect(stream[0][0]).toBe(res[1]);
      expect(stream[0][1]).toEqual([
        'uid',
        user.id,
        'u',
        user.username,
        'x',
        '3',
        'y',
        '2',
        'c',
        '5',
      ]);

      const ttl = await redis.client.pttl(RedisKeys.cooldown(user.id));
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(COOLDOWN_MS);

      await sleep(100);
      expect(messages).toEqual(['1,3,2,5']);
    });

    it('verzija raste za svaki uspešan potez', async () => {
      for (let i = 1; i <= 3; i++) {
        const res = await place(mkUser(), i, 0, i);
        expect(res[2]).toBe(i);
      }
      expect(await redis.client.xlen(RedisKeys.streamMoves())).toBe(3);
    });

    it('status koji nije ready (recovering ili bez ključa) vraća ERR_NOT_READY bez upisa', async () => {
      await redis.client.set(RedisKeys.canvasStatus(), 'recovering');
      expect(await place(mkUser(), 0, 0, 1)).toEqual(['ERR_NOT_READY']);
      await redis.client.del(RedisKeys.canvasStatus());
      expect(await place(mkUser(), 0, 0, 1)).toEqual(['ERR_NOT_READY']);
      expect(await redis.client.get(RedisKeys.canvasVersion())).toBe('0');
      expect(await redis.client.xlen(RedisKeys.streamMoves())).toBe(0);
    });

    it('koordinate van opsega se odbijaju bez promene stanja', async () => {
      const u = mkUser();
      for (const [x, y] of [
        [-1, 0],
        [0, -1],
        [W, 0],
        [0, H],
        [1.5, 0],
      ]) {
        expect(await place(u, x, y, 1)).toEqual(['ERR_INVALID_COORDS']);
      }
      expect(await place(u, W - 1, H - 1, 1)).toHaveLength(4); // poslednji piksel je u opsegu
      expect(await redis.client.get(RedisKeys.canvasVersion())).toBe('1');
    });

    it('cooldown blokira drugi potez i vraća preostalo vreme; odbijen potez ne menja platno', async () => {
      const user = mkUser();
      expect((await place(user, 0, 0, 1))[0]).toBe('OK');
      const second = await place(user, 1, 0, 1);
      expect(second[0]).toBe('ERR_COOLDOWN');
      expect(second[1]).toBeGreaterThan(0);
      expect(second[1]).toBeLessThanOrEqual(COOLDOWN_MS);
      expect(await pixelAt(1, 0)).toBe(0);
    });

    it('admin nema cooldown', async () => {
      const admin = mkUser('admin');
      for (let i = 0; i < 3; i++) {
        const res = await place(admin, i, 1, 2);
        expect(res[0]).toBe('OK');
        expect(res[3]).toBe(0);
      }
      expect(await redis.client.exists(RedisKeys.cooldown(admin.id))).toBe(0);
    });

    it('zona: drugi korisnik se odbija, vlasnik i admin prolaze, van zone i istekla zona ne smetaju', async () => {
      const owner = mkUser();
      const other = mkUser();
      const lockId = randomUUID();
      await redis.client.zadd(
        RedisKeys.zonesActive(),
        Date.now() + 60_000,
        `${lockId}|0|0|10|10|${owner.id}`,
      );

      expect(await place(other, 5, 5, 1)).toEqual(['ERR_ZONE_LOCKED', lockId]);
      expect(await pixelAt(5, 5)).toBe(0);
      expect((await place(owner, 5, 5, 1))[0]).toBe('OK');
      expect((await place(mkUser('admin'), 6, 6, 1))[0]).toBe('OK');
      expect((await place(other, 20, 20, 1))[0]).toBe('OK'); // van zone

      await redis.client.del(RedisKeys.zonesActive());
      await redis.client.zadd(
        RedisKeys.zonesActive(),
        Date.now() - 1000,
        `${lockId}|0|0|10|10|${owner.id}`,
      );
      expect((await place(mkUser(), 7, 7, 1))[0]).toBe('OK'); // zona je istekla
    });

    it('50 paralelnih poteza istog korisnika: tačno jedan uspeh', async () => {
      const user = mkUser();
      const results = await Promise.all(
        Array.from({ length: 50 }, (_, i) =>
          place(user, i % W, 0, 1 + (i % 5)),
        ),
      );
      expect(results.filter((r) => r[0] === 'OK')).toHaveLength(1);
      expect(results.filter((r) => r[0] === 'ERR_COOLDOWN')).toHaveLength(49);
      expect(await redis.client.get(RedisKeys.canvasVersion())).toBe('1');
      expect(await redis.client.xlen(RedisKeys.streamMoves())).toBe(1);
    });
  });

  describe('release_lock', () => {
    const release = (key: string, token: string) =>
      lua.run('release_lock', [key], [token]);

    it('briše lock samo sa ispravnim tokenom', async () => {
      const key = RedisKeys.lockRecovery();
      await redis.client.set(key, 'moj-token', 'PX', 30_000);

      expect(await release(key, 'tudji-token')).toBe(0);
      expect(await redis.client.get(key)).toBe('moj-token'); // lock ostaje

      expect(await release(key, 'moj-token')).toBe(1);
      expect(await redis.client.exists(key)).toBe(0);
    });

    it('nepostojeći lock vraća 0', async () => {
      expect(await release(RedisKeys.lockSnapshot(), 'x')).toBe(0);
    });
  });
});
