import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { patchState } from '@ngrx/signals';
import { unprotected } from '@ngrx/signals/testing';
import { vi } from 'vitest';
import { AuthStore } from '../auth/auth.store';
import { SocketService } from '../socket/socket';
import { credentialsInterceptor } from './credentials-interceptor';

describe('credentialsInterceptor', () => {
  let http: HttpClient;
  let ctl: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([credentialsInterceptor])),
        provideHttpClientTesting(),
        { provide: SocketService, useValue: { reconnect: vi.fn() } },
      ],
    });
    http = TestBed.inject(HttpClient);
    ctl = TestBed.inject(HttpTestingController);
    patchState(unprotected(TestBed.inject(AuthStore)), {
      status: 'authenticated',
      user: { id: '1', username: 'a', role: 'user' },
    });
  });

  it('dodaje withCredentials na /api pozive', () => {
    http.get('/api/canvas/config').subscribe();
    const req = ctl.expectOne('/api/canvas/config');
    expect(req.request.withCredentials).toBe(true);
    req.flush({});
  });

  it('401 zaštićenog poziva prebacuje u gosta, a 401 prijave ne menja stanje', () => {
    http.post('/api/auth/login', {}).subscribe({ error: () => undefined });
    ctl.expectOne('/api/auth/login').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(TestBed.inject(AuthStore).status()).toBe('authenticated');

    http.post('/api/auth/logout', {}).subscribe({ error: () => undefined });
    ctl.expectOne('/api/auth/logout').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(TestBed.inject(AuthStore).status()).toBe('guest');
  });
});
