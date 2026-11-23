import { HttpErrorResponse } from '@angular/common/http';

/** poruka na srpskom za grešku auth poziva (prijava i registracija) */
export function authErrorMessage(err: unknown): string {
  if (!(err instanceof HttpErrorResponse)) return 'Došlo je do neočekivane greške.';
  switch (err.status) {
    case 0:
      return 'Nema veze sa serverom. Proveri internet vezu i pokušaj ponovo.';
    case 400:
      return 'Uneti podaci nisu ispravni.';
    case 401:
      return 'Pogrešno korisničko ime ili lozinka.';
    case 409:
      return 'Korisničko ime je već zauzeto.';
    case 503:
      return 'Server trenutno nije dostupan. Pokušaj ponovo za par trenutaka.';
    default:
      return 'Došlo je do greške. Pokušaj ponovo.';
  }
}
