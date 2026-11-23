import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type {
  ClientToServerEvents,
  PixelBatchPayload,
  ServerToClientEvents,
} from '@pixelboard/shared';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { CassandraService } from '../../src/cassandra/cassandra.service';
import { RecoveryService } from '../../src/canvas/recovery.service';
import { configureApp } from '../../src/configure-app';
import { RedisService } from '../../src/redis/redis.service';
import { flushTestDb } from './helpers';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

/** zahteva pokrenute Redis i Cassandru; koristi Redis db 1 (vidi setup-int-env.ts) */
describe('canvas gateway (integration)', () => {
  let appA: INestApplication;
  let appB: INestApplication;
  let redis: RedisService;
  let cassandra: CassandraService;
  const clients: Client[] = [];
  const usernames: string[] = [];

  const urlOf = (app: INestApplication) =>
    `http://127.0.0.1:${((app.getHttpServer() as Server).address() as AddressInfo).port}`;

  async function boot(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    return app;
  }

  /** registruje, prijavljuje i vraća Cookie zaglavlje sesije */
  async function loginCookie(): Promise<string> {
    const username = `g_${randomBytes(5).toString('hex')}`;
    usernames.push(username);
    const http = request(appA.getHttpServer() as App);
    await http
      .post('/api/auth/register')
      .send({ username, password: 'password-123' })
      .expect(201);
    const res = await http
      .post('/api/auth/login')
      .send({ username, password: 'password-123' })
      .expect(200);
    const raw = res.headers['set-cookie'] as unknown as string[];
    return raw[0].split(';')[0];
  }

  async function connect(
    app: INestApplication,
    cookie?: string,
  ): Promise<Client> {
    const socket: Client = io(urlOf(app), {
      extraHeaders: cookie ? { cookie } : {},
      transports: ['websocket'],
      reconnection: false,
    });
    clients.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    return socket;
  }

  const nextBatch = (socket: Client, ms = 3000) =>
    new Promise<PixelBatchPayload>((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error(`pixel:batch nije stigao u ${ms} ms`)),
        ms,
      );
      socket.once('pixel:batch', (b) => {
        clearTimeout(t);
        resolve(b);
      });
    });

  beforeAll(async () => {
    appA = await boot();
    appB = await boot();
    redis = appA.get(RedisService);
    cassandra = appA.get(CassandraService);
    await appA.get(RecoveryService).settled();
    await appB.get(RecoveryService).settled();
    await flushTestDb(redis.client);
    await appA.get(RecoveryService).ensureReady();
    // kratak cooldown da test može više puta da boji
    await redis.client.hset('config:canvas', 'cooldown_ms', 100);
  });

  afterAll(async () => {
    for (const c of clients) c.close();
    for (const name of usernames) {
      await cassandra.execute(
        'DELETE FROM users_by_username WHERE username_lower = ?',
        [name],
      );
    }
    await flushTestDb(redis.client);
    await appA.close();
    await appB.close();
  });

  it('prijavljen klijent boji piksel, a dva klijenta dobijaju pixel:batch', async () => {
    const cookie = await loginCookie();
    const placer = await connect(appA, cookie);
    const watcher = await connect(appA); // gost samo posmatra

    const b1 = nextBatch(placer);
    const b2 = nextBatch(watcher);
    const ack = await placer.emitWithAck('pixel:place', {
      x: 5,
      y: 6,
      color: 4,
    });
    expect(ack).toEqual({ ok: true, cooldownMs: 100 });

    const [p1, p2] = await Promise.all([b1, b2]);
    expect(p1.p).toEqual([[5, 6, 4]]);
    expect(p2).toEqual(p1);
    expect(p1.v).toHaveLength(1);
  });

  it('gost dobija UNAUTHORIZED', async () => {
    const guest = await connect(appA);
    const ack = await guest.emitWithAck('pixel:place', {
      x: 1,
      y: 1,
      color: 1,
    });
    expect(ack).toEqual({ ok: false, error: 'UNAUTHORIZED' });
  });

  it('nevalidan payload, boja i granice vraćaju grešku u ack-u', async () => {
    const s = await connect(appA, await loginCookie());
    expect(
      await s.emitWithAck('pixel:place', { x: 'a', y: 0, color: 0 } as never),
    ).toEqual({ ok: false, error: 'INVALID_PAYLOAD' });
    expect(
      await s.emitWithAck('pixel:place', { x: 0, y: 0, color: 99 }),
    ).toMatchObject({ ok: false, error: 'INVALID_COLOR' });
    expect(
      await s.emitWithAck('pixel:place', { x: 9999, y: 0, color: 0 }),
    ).toMatchObject({ ok: false, error: 'INVALID_COORDS' });
  });

  it('cooldown se vraća kao COOLDOWN sa retryInMs', async () => {
    await redis.client.hset('config:canvas', 'cooldown_ms', 5000);
    const s = await connect(appA, await loginCookie());
    expect(
      (await s.emitWithAck('pixel:place', { x: 0, y: 0, color: 1 })).ok,
    ).toBe(true);
    const second = await s.emitWithAck('pixel:place', { x: 1, y: 0, color: 1 });
    expect(second).toMatchObject({ ok: false, error: 'COOLDOWN' });
    await redis.client.hset('config:canvas', 'cooldown_ms', 100);
  });

  it('dobija canvas:status pri konekciji', async () => {
    const socket: Client = io(urlOf(appA), {
      transports: ['websocket'],
      reconnection: false,
    });
    clients.push(socket);
    const status = await new Promise((resolve) =>
      socket.once('canvas:status', resolve),
    );
    expect(status).toEqual({ status: 'ready' });
  });

  it('dve api instance: piksel sa A stiže klijentu na B, tačno jednom', async () => {
    const onA = await connect(appA, await loginCookie());
    const onB = await connect(appB);

    const received: PixelBatchPayload[] = [];
    onB.on('pixel:batch', (b) => received.push(b));
    const first = nextBatch(onB);
    const ack = await onA.emitWithAck('pixel:place', {
      x: 10,
      y: 11,
      color: 7,
    });
    expect(ack.ok).toBe(true);

    const batch = await first;
    expect(batch.p).toEqual([[10, 11, 7]]);
    await new Promise((r) => setTimeout(r, 200));
    expect(received).toHaveLength(1); // nije duplirano kroz adapter
  });
});
