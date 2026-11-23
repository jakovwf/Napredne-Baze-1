import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { PublicUser } from '@pixelboard/shared';
import { PALETTE } from '@pixelboard/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { CanvasService } from '../../src/canvas/canvas.service';
import { RecoveryService } from '../../src/canvas/recovery.service';
import { configureApp } from '../../src/configure-app';
import { RedisService } from '../../src/redis/redis.service';
import { flushTestDb } from './helpers';

const W = Number(process.env.CANVAS_WIDTH);
const H = Number(process.env.CANVAS_HEIGHT);

const mkUser = (): PublicUser => ({
  id: randomUUID(),
  username: `u_${randomUUID().slice(0, 8)}`,
  role: 'user',
});

/** zahteva pokrenute Redis i Cassandru; koristi Redis db 1 (vidi setup-int-env.ts) */
describe('canvas (integration)', () => {
  let app: INestApplication;
  let redis: RedisService;
  let canvas: CanvasService;
  let recovery: RecoveryService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    redis = app.get(RedisService);
    canvas = app.get(CanvasService);
    recovery = app.get(RecoveryService);
    await recovery.settled();
  });

  beforeEach(async () => {
    await recovery.settled();
    await flushTestDb(redis.client);
    await recovery.ensureReady();
  });

  afterAll(async () => {
    await flushTestDb(redis.client);
    await app.close();
  });

  const http = () => request(app.getHttpServer() as App);

  describe('GET /api/canvas', () => {
    it('vraća W*H bajtova sa zaglavljima i upisanim pikselom', async () => {
      const placed = await canvas.placePixel(mkUser(), 4, 3, 9);
      expect(placed).toMatchObject({ ok: true, version: 1 });

      const res = await http()
        .get('/api/canvas')
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(res.headers['content-type']).toMatch(/application\/octet-stream/);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-canvas-version']).toBe('1');
      expect(res.headers['x-canvas-width']).toBe(String(W));
      expect(res.headers['x-canvas-height']).toBe(String(H));
      const buf = res.body as Buffer;
      expect(buf.length).toBe(W * H);
      expect(buf[3 * W + 4]).toBe(9);
    });

    it('vraća 503 sa Retry-After dok status nije ready', async () => {
      // lock sprečava periodičnu proveru da u međuvremenu vrati status
      await redis.client.set('lock:recovery', 'test', 'PX', 30_000);
      await redis.client.set('canvas:status', 'recovering');
      const res = await http().get('/api/canvas').expect(503);
      expect(res.headers['retry-after']).toBe('2');
    });
  });

  describe('GET /api/canvas/config', () => {
    it('vraća dimenzije, cooldown, status i paletu', async () => {
      const res = await http().get('/api/canvas/config').expect(200);
      expect(res.body).toEqual({
        width: W,
        height: H,
        cooldownMs: Number(process.env.COOLDOWN_MS),
        status: 'ready',
        palette: PALETTE,
      });
    });
  });

  describe('prazan start', () => {
    it('na praznom Redisu postavlja platno, verziju 0, konfiguraciju i status ready', async () => {
      await flushTestDb(redis.client);
      await recovery.ensureReady();
      expect(await redis.client.get('canvas:status')).toBe('ready');
      expect(await redis.client.get('canvas:version')).toBe('0');
      expect(await redis.client.strlen('canvas:main')).toBe(W * H);
      expect(await redis.client.hgetall('config:canvas')).toEqual({
        width: String(W),
        height: String(H),
        cooldown_ms: process.env.COOLDOWN_MS,
      });
      expect(await redis.client.exists('lock:recovery')).toBe(0); // lock je oslobođen
    });

    it('ponovni poziv ne resetuje platno', async () => {
      await canvas.placePixel(mkUser(), 1, 1, 7);
      await recovery.ensureReady();
      await recovery.ensureReady();
      expect(await redis.client.get('canvas:version')).toBe('1');
      const buf = await redis.client.getBuffer('canvas:main');
      expect(buf![W + 1]).toBe(7);
    });

    it('istovremeni pozivi na praznoj bazi: jedna inicijalizacija, nema greške', async () => {
      await flushTestDb(redis.client);
      await Promise.all([recovery.ensureReady(), recovery.ensureReady()]);
      // ko nije dobio lock ne radi ništa; jedna provera više završava posao
      await recovery.ensureReady();
      expect(await redis.client.get('canvas:status')).toBe('ready');
      expect(await redis.client.strlen('canvas:main')).toBe(W * H);
    });
  });
});
