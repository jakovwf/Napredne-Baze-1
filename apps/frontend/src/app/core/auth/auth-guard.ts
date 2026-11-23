import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStore } from './auth.store';

/** samo za prijavljene; gost se šalje na /login */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthStore);
  return auth.status() === 'authenticated' ? true : inject(Router).createUrlTree(['/login']);
};
