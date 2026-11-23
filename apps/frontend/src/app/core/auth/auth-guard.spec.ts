import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { patchState } from '@ngrx/signals';
import { unprotected } from '@ngrx/signals/testing';
import { authGuard } from './auth-guard';
import { AuthStore } from './auth.store';

describe('authGuard', () => {
  const run = () =>
    TestBed.runInInjectionContext(() =>
      authGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  it('propušta prijavljenog, a gosta šalje na /login', () => {
    const store = unprotected(TestBed.inject(AuthStore));
    patchState(store, {
      status: 'authenticated',
      user: { id: '1', username: 'a', role: 'user' },
    });
    expect(run()).toBe(true);

    patchState(store, { status: 'guest', user: null });
    const r = run();
    expect(r).toBeInstanceOf(UrlTree);
    expect(String(r)).toBe('/login');
  });
});
