import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatToolbar } from '@angular/material/toolbar';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { CooldownStore } from './canvas/cooldown.store';
import { AuthStore } from './core/auth/auth.store';
import { SocketService } from './core/socket/socket';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, MatToolbar, MatButton, MatMenu, MatMenuItem, MatMenuTrigger],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly auth = inject(AuthStore);
  protected readonly socket = inject(SocketService);
  private readonly cooldown = inject(CooldownStore);
  private readonly router = inject(Router);

  constructor() {
    // cooldown pripada korisniku: pri promeni identiteta (prijava, odjava) se briše
    effect(() => {
      this.auth.user();
      this.cooldown.clear();
    });
  }

  protected async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigateByUrl('/');
  }
}
