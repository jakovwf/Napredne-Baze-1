import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { PublicUser } from '@pixelboard/shared';
import { vi } from 'vitest';
import { SocketService } from '../socket/socket';
import { AuthStore } from './auth.store';

const user: PublicUser = { id: 'u1', username: 'pera', role: 'user' };

describe('AuthStore', () => {
  const socket = { reconnect: vi.fn() };
  let http: HttpTestingController;
  let store: InstanceType<typeof AuthStore>;

  beforeEach(() => {
    socket.reconnect.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SocketService, useValue: socket },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(AuthStore);
  });

  afterEach(() => http.verify());

  it('init: me 200 je prijavljen, me 401 je gost', async () => {
    const ok = store.init();
    http.expectOne('/api/auth/me').flush(user);
    await ok;
    expect(store.status()).toBe('authenticated');
    expect(store.user()).toEqual(user);

    const fail = store.init();
    http.expectOne('/api/auth/me').flush({}, { status: 401, statusText: 'Unauthorized' });
    await fail;
    expect(store.status()).toBe('guest');
    expect(store.user()).toBeNull();
  });

  it('login: uspeh postavlja korisnika i ponovo povezuje socket', async () => {
    const p = store.login('pera', 'lozinka123');
    const req = http.expectOne('/api/auth/login');
    expect(req.request.body).toEqual({ username: 'pera', password: 'lozinka123' });
    req.flush(user);
    expect(await p).toBe(true);
    expect(store.status()).toBe('authenticated');
    expect(socket.reconnect).toHaveBeenCalledTimes(1);
  });

  it('login: 401 daje poruku i ostaje gost', async () => {
    const p = store.login('pera', 'pogresna');
    http.expectOne('/api/auth/login').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(await p).toBe(false);
    expect(store.error()).toBe('Pogrešno korisničko ime ili lozinka.');
    expect(store.user()).toBeNull();
    expect(socket.reconnect).not.toHaveBeenCalled();
  });

  it('register: 409 ne prijavljuje, uspeh automatski prijavljuje', async () => {
    const taken = store.register('pera', 'lozinka123');
    http.expectOne('/api/auth/register').flush({}, { status: 409, statusText: 'Conflict' });
    expect(await taken).toBe(false);
    expect(store.error()).toBe('Korisničko ime je već zauzeto.');
    http.expectNone('/api/auth/login');

    const ok = store.register('pera', 'lozinka123');
    http.expectOne('/api/auth/register').flush(user, { status: 201, statusText: 'Created' });
    await vi.waitFor(() => http.expectOne('/api/auth/login').flush(user));
    expect(await ok).toBe(true);
    expect(store.status()).toBe('authenticated');
  });

  it('logout i istekla sesija vraćaju gosta i ponovo povezuju socket', async () => {
    const login = store.login('pera', 'lozinka123');
    http.expectOne('/api/auth/login').flush(user);
    await login;
    socket.reconnect.mockClear();

    const out = store.logout();
    http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    await out;
    expect(store.status()).toBe('guest');
    expect(socket.reconnect).toHaveBeenCalledTimes(1);

    // gost nema šta da izgubi
    store.sessionExpired();
    expect(socket.reconnect).toHaveBeenCalledTimes(1);

    const again = store.login('pera', 'lozinka123');
    http.expectOne('/api/auth/login').flush(user);
    await again;
    socket.reconnect.mockClear();
    store.sessionExpired();
    expect(store.status()).toBe('guest');
    expect(socket.reconnect).toHaveBeenCalledTimes(1);
  });
});
