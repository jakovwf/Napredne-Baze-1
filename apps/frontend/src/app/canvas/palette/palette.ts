import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/** paleta od 32 boje (dok na dnu ekrana) */
@Component({
  selector: 'app-palette',
  templateUrl: './palette.html',
  styleUrl: './palette.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Palette {
  readonly colors = input.required<readonly string[]>();
  readonly selected = input<number>(0);
  readonly disabled = input<boolean>(false);
  readonly colorSelect = output<number>();

  protected pick(index: number): void {
    this.colorSelect.emit(index);
  }
}
