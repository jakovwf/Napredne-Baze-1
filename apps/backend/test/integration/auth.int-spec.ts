import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { CassandraService } from '../../src/cassandra/cassandra.service';
import { configureApp } from '../../src/configure-app';
import { RedisService } from '../../src/redis/redis.service';

// admin za seed se postavlja pre pravljenja modula (konfiguracija čita okruženje pri startu)
const adminName = `adm_${randomBytes(4).toString('hex')}`;
const adminPassword = 'seed-admin-pass-1';
process.env.ADMIN_USERNAME = adminName;
process.env.ADMIN_PASSWORD = adminPassword;

interface Body {
  id: string;
  username: string;
  role: string;
  message: string;
}
const body = (r: request.Response) => r.body as Body;

/** zahteva pokrenute Redis i Cassandru (vidi README, odeljak "Razvoj") */
describe('auth (integration)', () => {
  const createdNames = new Set<string>([adminName]);
  const sids = new Set<string>();

  let app: INestApplication;
  let redis: RedisService;
  let cassandra: CassandraService;

  const uniqueName = () => {
    const n = `t_${randomBytes(5).toString('hex')}`;
    createdNames.add(n);
    return n;
  };
  const http = () => request(app.getHttpServer() as App);
  const register = (username: string, password = 'password-123') =>
    http().post('/api/auth/register').send({ username, password });
  const login = (username: string, password: string) =>
    http().post('/api/auth/login').send({ username, password });
  const sidFrom = (res: request.Response): string => {
    const raw = (res.headers['set-cookie'] as unknown as string[]) ?? [];
    const m = /sid=([^;]+)/.exec(raw.join(';'));
    if (!m) throw new Error('nema sid kolačića');
    sids.add(m[1]);
    return m[1];
  };

  async function bootApp(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const a = moduleRef.createNestApplication();
    configureApp(a);
    await a.init();
    return a;
  }

  beforeAll(async () => {
    app = await bootApp();
    redis = app.get(RedisService);
    cassandra = app.get(CassandraService);
  });

  afterAll(async () => {
    for (const name of createdNames) {
      await cassandra.execute(
        'DELETE FROM users_by_username WHERE username_lower = ?',
        [name.toLowerCase()],
      );
    }
    for (const sid of sids) await redis.client.del(`session:${sid}`);
    await app.close();
  });

  it('register 201, isto ime (i drugačija velika/mala slova) 409', async () => {
    const name = uniqueName();
    const res = await register(name).expect(201);
    expect(body(res)).toEqual({
      id: expect.any(String) as string,
      username: name,
      role: 'user',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/hash|argon/i);
    await register(name).expect(409);
    await register(name.toUpperCase()).expect(409);
  });

  it('10 istovremenih registracija istog imena: tačno jedan 201, devet 409', async () => {
    const name = uniqueName();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => register(name)),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(9);
  });

  it('validacija: loše korisničko ime i nepoznato polje daju 400', async () => {
    await register('x').expect(400);
    await register('ima razmak').expect(400);
    await http()
      .post('/api/auth/register')
      .send({ username: uniqueName(), password: 'password-123', role: 'admin' })
      .expect(400);
  });

  it('login, me, logout, pa me vraća 401', async () => {
    const name = uniqueName();
    await register(name).expect(201);
    const res = await login(name, 'password-123').expect(200);
    expect(body(res).username).toBe(name);
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0];
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/Secure/i);
    const sid = sidFrom(res);

    const me = await http()
      .get('/api/auth/me')
      .set('Cookie', `sid=${sid}`)
      .expect(200);
    expect(body(me)).toEqual(res.body);

    await http()
      .post('/api/auth/logout')
      .set('Cookie', `sid=${sid}`)
      .expect(204);
    await http().get('/api/auth/me').set('Cookie', `sid=${sid}`).expect(401);
  });

  it('pogrešna lozinka i nepostojeći korisnik daju identičan 401', async () => {
    const name = uniqueName();
    await register(name).expect(201);
    const wrongPass = await login(name, 'pogresna-lozinka').expect(401);
    const noUser = await login(uniqueName(), 'pogresna-lozinka').expect(401);
    expect(body(wrongPass)).toEqual(noUser.body);
    expect(body(wrongPass).message).toBe('Pogrešno korisničko ime ili lozinka');
    expect(wrongPass.headers['set-cookie']).toBeUndefined();
  });

  it('sesija u Redisu ima TTL i polja korisnika', async () => {
    const name = uniqueName();
    await register(name).expect(201);
    const sid = sidFrom(await login(name, 'password-123').expect(200));
    const ttl = await redis.client.ttl(`session:${sid}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(7 * 86400);
    expect(await redis.client.hget(`session:${sid}`, 'role')).toBe('user');
    expect(await redis.client.hget(`session:${sid}`, 'username')).toBe(name);
  });

  it('sliding: rok se produžava tek kad padne ispod (TTL - 1 dan)', async () => {
    const name = uniqueName();
    await register(name).expect(201);
    const sid = sidFrom(await login(name, 'password-123').expect(200));
    const key = `session:${sid}`;

    // svež rok se ne dira
    await http().get('/api/auth/me').set('Cookie', `sid=${sid}`).expect(200);
    expect(await redis.client.ttl(key)).toBeGreaterThan(6 * 86400);

    // rok ispod praga: prvi zahtev ga vraća na pun
    await redis.client.expire(key, 3600);
    await http().get('/api/auth/me').set('Cookie', `sid=${sid}`).expect(200);
    expect(await redis.client.ttl(key)).toBeGreaterThan(6 * 86400);
  });

  it('seed: admin može da se prijavi, a ponovni start ne pravi duplikat', async () => {
    const res = await login(adminName, adminPassword).expect(200);
    expect(body(res).role).toBe('admin');
    sidFrom(res);

    const before = await cassandra.execute(
      'SELECT user_id FROM users_by_username WHERE username_lower = ?',
      [adminName.toLowerCase()],
    );
    const idBefore = String(before.first()['user_id']);

    const second = await bootApp(); // ponovni start je ponovni seed
    await second.close();

    const after = await cassandra.execute(
      'SELECT user_id FROM users_by_username WHERE username_lower = ?',
      [adminName.toLowerCase()],
    );
    expect(after.rowLength).toBe(1);
    expect(String(after.first()['user_id'])).toBe(idBefore);
    await login(adminName, adminPassword).expect(200);
  });
});
