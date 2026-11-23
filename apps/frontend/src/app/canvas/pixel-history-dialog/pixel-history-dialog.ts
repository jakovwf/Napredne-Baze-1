import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { PALETTE } from '@pixelboard/shared';
import { PixelHistoryItem, PixelHistoryService } from '../pixel-history';

export interface PixelHistoryDialogData {
  x: number;
  y: number;
}

/** dijalog sa istorijom jednog piksela (najnovije prvo, učitavanje po stranicama) */
@Component({
  selector: 'app-pixel-history-dialog',
  imports: [
    DatePipe,
    MatButton,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatProgressSpinner,
  ],
  templateUrl: './pixel-history-dialog.html',
  styleUrl: './pixel-history-dialog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PixelHistoryDialog implements OnInit {
  protected readonly data = inject<PixelHistoryDialogData>(MAT_DIALOG_DATA);
  private readonly api = inject(PixelHistoryService);

  protected readonly items = signal<PixelHistoryItem[]>([]);
  protected readonly next = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly loaded = signal(false);

  ngOnInit(): void {
    void this.loadMore();
  }

  protected hex(color: number): string {
    return PALETTE[color] ?? '#000000';
  }

  protected async loadMore(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const page = await this.api.load(this.data.x, this.data.y, this.next());
      this.items.update((list) => [...list, ...page.items]);
      this.next.set(page.nextPageState);
      this.loaded.set(true);
    } catch {
      this.error.set('Ne mogu da učitam istoriju. Pokušaj ponovo.');
    } finally {
      this.loading.set(false);
    }
  }
}
