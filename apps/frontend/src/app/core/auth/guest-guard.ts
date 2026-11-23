import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStore } from './auth.store';

/** samo za goste: prijavljen korisnik se sa /login i /register preusmerava na / */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthStore);
  return auth.status() === 'authenticated' ? inject(Router).createUrlTree(['/']) : true;
};
