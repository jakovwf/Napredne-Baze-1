import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatError, MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatProgressBar } from '@angular/material/progress-bar';
import { Router, RouterLink } from '@angular/router';
import { AuthStore } from '../../core/auth/auth.store';
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  USERNAME_MAX,
  USERNAME_MIN,
  passwordValidators,
  usernameValidators,
} from '../../core/auth/validators';

@Component({
  selector: 'app-register',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButton,
    MatFormField,
    MatLabel,
    MatError,
    MatHint,
    MatInput,
    MatProgressBar,
  ],
  templateUrl: './register.html',
  styleUrl: './register.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Register {
  protected readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  protected readonly usernameMin = USERNAME_MIN;
  protected readonly usernameMax = USERNAME_MAX;
  protected readonly passwordMin = PASSWORD_MIN;
  protected readonly passwordMax = PASSWORD_MAX;

  protected readonly form = inject(FormBuilder).nonNullable.group({
    username: ['', usernameValidators],
    password: ['', passwordValidators],
  });

  constructor() {
    this.auth.clearError();
  }

  /** registracija, pa automatska prijava i preusmeravanje na platno */
  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { username, password } = this.form.getRawValue();
    if (await this.auth.register(username, password)) await this.router.navigateByUrl('/');
  }
}
