import { ValidatorFn, Validators } from '@angular/forms';

/** pravila odgovaraju backend DTO-ovima za registraciju */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const USERNAME_PATTERN = /^[A-Za-z0-9_]+$/;

export const usernameValidators: ValidatorFn[] = [
  Validators.required,
  Validators.minLength(USERNAME_MIN),
  Validators.maxLength(USERNAME_MAX),
  Validators.pattern(USERNAME_PATTERN),
];

export const passwordValidators: ValidatorFn[] = [
  Validators.required,
  Validators.minLength(PASSWORD_MIN),
  Validators.maxLength(PASSWORD_MAX),
];
