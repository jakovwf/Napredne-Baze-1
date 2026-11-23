import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { CooldownStore } from '../cooldown.store';

/**
 * odbrojavač cooldown-a. tajmer (100 ms) živi samo ovde i radi samo dok je cooldown aktivan;
 * signal `remaining` čita samo ovaj šablon, pa ostatak aplikacije ne vidi promene.
 */
@Component({
  selector: 'app-cooldown-badge',
  templateUrl: './cooldown-badge.html',
  styleUrl: './cooldown-badge.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CooldownBadge {
  protected readonly cooldown = inject(CooldownStore);
  protected readonly remaining = signal(0);

  constructor() {
    effect((onCleanup) => {
      if (!this.cooldown.active()) {
        this.remaining.set(0);
        return;
      }
      const tick = () => this.remaining.set(this.cooldown.remainingMs());
      tick();
      const id = setInterval(tick, 100);
      onCleanup(() => clearInterval(id));
    });
  }

  protected percent(): number {
    const total = this.cooldown.total();
    return total > 0 ? Math.min(100, (this.remaining() / total) * 100) : 0;
  }

  protected seconds(): string {
    return (this.remaining() / 1000).toFixed(1);
  }
}
