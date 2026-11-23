import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthStore } from '../auth/auth.store';

/** pozivi na koje 401 ne znači "sesija je istekla" (pogrešni podaci ili provera sesije) */
const PUBLIC_AUTH_CALLS = ['/api/auth/login', '/api/auth/register', '/api/auth/me'];

/**
 * šalje kolačić sesije uz svaki /api poziv i, kad zaštićen poziv vrati 401,
 * prebacuje AuthStore u stanje gosta
 */
export const credentialsInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api')) return next(req);
  const auth = inject(AuthStore);
  return next(req.clone({ withCredentials: true })).pipe(
    catchError((err: unknown) => {
      if (
        err instanceof HttpErrorResponse &&
        err.status === 401 &&
        !PUBLIC_AUTH_CALLS.some((u) => req.url.startsWith(u))
      ) {
        auth.sessionExpired();
      }
      return throwError(() => err);
    }),
  );
};
