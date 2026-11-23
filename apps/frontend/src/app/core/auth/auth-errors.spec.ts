import { HttpErrorResponse } from '@angular/common/http';
import { authErrorMessage } from './auth-errors';

const err = (status: number) => new HttpErrorResponse({ status });

describe('authErrorMessage', () => {
  it('prevodi statuse u poruke na srpskom', () => {
    expect(authErrorMessage(err(401))).toBe('Pogrešno korisničko ime ili lozinka.');
    expect(authErrorMessage(err(409))).toBe('Korisničko ime je već zauzeto.');
    expect(authErrorMessage(err(0))).toContain('Nema veze');
  });

  it('nepoznata greška ima opštu poruku', () => {
    expect(authErrorMessage(new Error('x'))).toContain('neočekivane');
    expect(authErrorMessage(err(500))).toContain('Došlo je do greške');
  });
});
