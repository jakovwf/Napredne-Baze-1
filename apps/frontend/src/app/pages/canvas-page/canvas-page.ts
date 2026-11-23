import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatProgressBar } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { PALETTE } from '@pixelboard/shared';
import { AuthStore } from '../../core/auth/auth.store';
import { SocketService } from '../../core/socket/socket';
import { CanvasService } from '../../canvas/canvas';
import { CanvasView, PixelPos } from '../../canvas/canvas-view/canvas-view';
import { CooldownBadge } from '../../canvas/cooldown-badge/cooldown-badge';
import { CooldownStore } from '../../canvas/cooldown.store';
import { Palette } from '../../canvas/palette/palette';
import { placeErrorMessage } from '../../canvas/place-errors';

interface HoverInfo {
  x: number;
  y: number;
  color: number;
}

/** glavna stranica: platno uživo, paleta i cooldown (prijavljeni) ili poziv na prijavu (gosti) */
@Component({
  selector: 'app-canvas-page',
  imports: [CanvasView, Palette, CooldownBadge, MatButton, MatProgressBar, RouterLink],
  templateUrl: './canvas-page.html',
  styleUrl: './canvas-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CanvasPage {
  protected readonly auth = inject(AuthStore);
  protected readonly canvas = inject(CanvasService);
  protected readonly socket = inject(SocketService);
  protected readonly cooldown = inject(CooldownStore);
  private readonly snack = inject(MatSnackBar);

  protected readonly palette = computed(() => this.canvas.config()?.palette ?? PALETTE);
  protected readonly selectedColor = signal(5);
  protected readonly hover = signal<HoverInfo | null>(null);

  /** true dok traje oporavak platna */
  protected readonly recovering = computed(() => this.socket.status() === 'recovering');

  protected readonly hoverHex = computed(() => {
    const h = this.hover();
    return h ? (this.palette()[h.color] ?? '#000') : '#000';
  });

  protected onHover(pos: PixelPos | null): void {
    this.hover.set(pos ? { ...pos, color: this.canvas.colorAt(pos.x, pos.y) ?? 0 } : null);
  }

  protected async onPixelClick(pos: PixelPos): Promise<void> {
    if (this.auth.status() !== 'authenticated') {
      this.notify(placeErrorMessage('UNAUTHORIZED'));
      return;
    }
    if (this.recovering()) {
      this.notify(placeErrorMessage('NOT_READY'));
      return;
    }
    if (this.cooldown.active()) {
      this.notify(placeErrorMessage('COOLDOWN', this.cooldown.remainingMs()));
      return;
    }
    if (this.canvas.syncState() !== 'ready') return;

    const res = await this.canvas.place(pos.x, pos.y, this.selectedColor());
    if (res.ok) {
      // trajanje dolazi sa servera (za admina je 0), kraj se računa po satu klijenta
      this.cooldown.startFor(res.cooldownMs);
      return;
    }
    if (res.error === 'COOLDOWN' && res.retryInMs) this.cooldown.startFor(res.retryInMs);
    if (res.error === 'UNAUTHORIZED') this.auth.sessionExpired();
    this.notify(placeErrorMessage(res.error, res.retryInMs));
  }

  private notify(message: string): void {
    this.snack.open(message, 'U redu', { duration: 3500 });
  }
}
