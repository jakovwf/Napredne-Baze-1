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
import { AuthStore } from './auth.store';
import { guestGuard } from './guest-guard';

describe('guestGuard', () => {
  const run = () =>
    TestBed.runInInjectionContext(() =>
      guestGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  it('propušta gosta, a prijavljenog preusmerava na /', () => {
    const store = unprotected(TestBed.inject(AuthStore));
    patchState(store, { status: 'guest' });
    expect(run()).toBe(true);

    patchState(store, {
      status: 'authenticated',
      user: { id: '1', username: 'a', role: 'user' },
    });
    const r = run();
    expect(r).toBeInstanceOf(UrlTree);
    expect(String(r)).toBe('/');
  });
});
