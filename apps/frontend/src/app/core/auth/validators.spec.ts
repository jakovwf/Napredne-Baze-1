import { FormControl } from '@angular/forms';
import { passwordValidators, usernameValidators } from './validators';

const errors = (value: string, validators = usernameValidators) =>
  Object.keys(new FormControl(value, validators).errors ?? {});

describe('validatori korisničkog imena', () => {
  it('prihvata 3–20 karaktera [A-Za-z0-9_]', () => {
    expect(errors('abc')).toEqual([]);
    expect(errors('A_b_9')).toEqual([]);
    expect(errors('a'.repeat(20))).toEqual([]);
  });

  it('odbija prekratko, predugačko, prazno i nedozvoljene karaktere', () => {
    expect(errors('ab')).toContain('minlength');
    expect(errors('a'.repeat(21))).toContain('maxlength');
    expect(errors('')).toContain('required');
    expect(errors('ima razmak')).toContain('pattern');
    expect(errors('čćž')).toContain('pattern');
  });
});

describe('validatori lozinke', () => {
  it('prihvata 8–128 karaktera, odbija 7, 129 i prazno', () => {
    expect(errors('x'.repeat(8), passwordValidators)).toEqual([]);
    expect(errors('x'.repeat(128), passwordValidators)).toEqual([]);
    expect(errors('x'.repeat(7), passwordValidators)).toContain('minlength');
    expect(errors('x'.repeat(129), passwordValidators)).toContain('maxlength');
    expect(errors('', passwordValidators)).toContain('required');
  });
});
