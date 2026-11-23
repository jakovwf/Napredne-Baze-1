import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  output,
  viewChild,
} from '@angular/core';
import { MatMiniFabButton } from '@angular/material/button';
import { CanvasService } from '../canvas';
import { View, fitView, isClick, panBy, screenToPixel, zoomAt } from '../viewport';

export interface PixelPos {
  x: number;
  y: number;
}

const LONG_PRESS_MS = 500;
const CLICK_THRESHOLD_PX = 5;

/**
 * prikaz platna sa zoom i pan kontrolama. transformacija se primenjuje imperativno na element
 * (bez signala), jer se menja desetine puta u sekundi; roditelj dobija samo retke događaje
 * (klik, info, pozicija kursora, najviše jednom po frame-u).
 */
@Component({
  selector: 'app-canvas-view',
  imports: [MatMiniFabButton],
  templateUrl: './canvas-view.html',
  styleUrl: './canvas-view.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CanvasView {
  protected readonly canvas = inject(CanvasService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly viewport = viewChild.required<ElementRef<HTMLDivElement>>('viewport');
  private readonly stage = viewChild.required<ElementRef<HTMLDivElement>>('stage');
  private readonly canvasEl = viewChild.required<ElementRef<HTMLCanvasElement>>('canvasEl');
  private readonly cursorEl = viewChild.required<ElementRef<HTMLDivElement>>('cursorEl');

  /** klik (bez prevlačenja) na piksel */
  readonly pixelClick = output<PixelPos>();
  /** desni klik ili dugi pritisak: informacije o pikselu */
  readonly pixelInfo = output<PixelPos>();
  /** piksel ispod kursora (null je van platna); najviše jednom po frame-u */
  readonly hover = output<PixelPos | null>();

  private view: View = { scale: 1, tx: 0, ty: 0 };
  private userMoved = false;
  private fitted = false;

  private readonly pointers = new Map<number, { x: number; y: number }>();
  private drag: { startX: number; startY: number; moved: boolean } | null = null;
  private pinchDist = 0;
  private pinchCenter = { x: 0, y: 0 };
  private longPress?: ReturnType<typeof setTimeout>;
  private longPressFired = false;
  private hoverRaf = 0;
  private hoverPos: { x: number; y: number } | null = null;
  private lastHover: PixelPos | null = null;
  private hoverEmitted = false;

  constructor() {
    // kad se platno prvi put učita, uklopi ga u ekran
    effect(() => {
      if (this.canvas.size() && !this.fitted) {
        this.fitted = true;
        queueMicrotask(() => this.fit());
      }
    });

    afterNextRender(() => {
      const vp = this.viewport().nativeElement;
      this.canvas.attach(this.canvasEl().nativeElement);

      // wheel mora biti ne-pasivan da bi se sprečilo skrolovanje stranice
      vp.addEventListener('wheel', this.onWheel, { passive: false });
      vp.addEventListener('pointerdown', this.onPointerDown);
      vp.addEventListener('pointermove', this.onPointerMove);
      vp.addEventListener('pointerup', this.onPointerUp);
      vp.addEventListener('pointercancel', this.onPointerCancel);
      vp.addEventListener('pointerleave', this.onPointerLeave);
      vp.addEventListener('contextmenu', this.onContextMenu);

      const ro = new ResizeObserver(() => {
        if (!this.userMoved && this.canvas.size()) this.fit();
        else this.apply();
      });
      ro.observe(vp);

      this.destroyRef.onDestroy(() => {
        ro.disconnect();
        vp.removeEventListener('wheel', this.onWheel);
        vp.removeEventListener('pointerdown', this.onPointerDown);
        vp.removeEventListener('pointermove', this.onPointerMove);
        vp.removeEventListener('pointerup', this.onPointerUp);
        vp.removeEventListener('pointercancel', this.onPointerCancel);
        vp.removeEventListener('pointerleave', this.onPointerLeave);
        vp.removeEventListener('contextmenu', this.onContextMenu);
        this.cancelLongPress();
        if (this.hoverRaf) cancelAnimationFrame(this.hoverRaf);
        this.canvas.detach();
      });

      if (this.canvas.size()) this.fit();
    });
  }

  // ===================== javno (dugmad) =====================

  fit(): void {
    const vp = this.viewport().nativeElement;
    const size = this.canvas.size();
    if (!size || !vp.clientWidth) return;
    this.view = fitView(vp.clientWidth, vp.clientHeight, size.width, size.height);
    this.userMoved = false;
    this.apply();
  }

  zoomBy(factor: number): void {
    const vp = this.viewport().nativeElement;
    this.userMoved = true;
    this.view = zoomAt(this.view, factor, vp.clientWidth / 2, vp.clientHeight / 2);
    this.apply();
  }

  // ===================== interno =====================

  private apply(): void {
    const { scale, tx, ty } = this.view;
    this.stage().nativeElement.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    this.updateCursor();
  }

  private local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.viewport().nativeElement.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private pixelAt(p: { x: number; y: number }): PixelPos | null {
    const size = this.canvas.size();
    if (!size) return null;
    return screenToPixel(this.view, p.x, p.y, size.width, size.height);
  }

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const factor = Math.exp(-e.deltaY * unit * 0.0015);
    const p = this.local(e);
    this.userMoved = true;
    this.view = zoomAt(this.view, factor, p.x, p.y);
    this.apply();
    this.queueHover(p);
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.viewport().nativeElement.setPointerCapture(e.pointerId);
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);

    if (this.pointers.size === 1) {
      this.drag = { startX: p.x, startY: p.y, moved: false };
      this.longPressFired = false;
      if (e.pointerType === 'touch') {
        // dugi pritisak (bez pomeranja) je informacija o pikselu
        this.longPress = setTimeout(() => {
          if (this.drag && !this.drag.moved && this.pointers.size === 1) {
            this.longPressFired = true;
            const px = this.pixelAt(p);
            if (px) this.pixelInfo.emit(px);
          }
        }, LONG_PRESS_MS);
      }
    } else if (this.pointers.size === 2) {
      // pinch: od ovog trenutka nije klik
      this.cancelLongPress();
      if (this.drag) this.drag.moved = true;
      this.pinchDist = this.pointerDistance();
      this.pinchCenter = this.pointerCenter();
    }
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const p = this.local(e);
    const prev = this.pointers.get(e.pointerId);
    if (e.pointerType === 'mouse') this.queueHover(p);
    if (!prev) return;
    this.pointers.set(e.pointerId, p);

    if (this.pointers.size === 2) {
      // pinch zoom oko centra između prstiju i pomeranje centra (pan)
      const dist = this.pointerDistance();
      const center = this.pointerCenter();
      if (this.pinchDist > 0) {
        this.view = panBy(
          zoomAt(this.view, dist / this.pinchDist, center.x, center.y),
          center.x - this.pinchCenter.x,
          center.y - this.pinchCenter.y,
        );
      }
      this.pinchDist = dist;
      this.pinchCenter = center;
      this.userMoved = true;
      this.apply();
      return;
    }

    if (this.drag) {
      if (
        !this.drag.moved &&
        !isClick(p.x - this.drag.startX, p.y - this.drag.startY, CLICK_THRESHOLD_PX)
      ) {
        this.drag.moved = true; // prešli smo prag: prevlačenje, ne klik
        this.cancelLongPress();
        this.viewport().nativeElement.classList.add('dragging');
      }
      if (this.drag.moved) {
        this.userMoved = true;
        this.view = panBy(this.view, p.x - prev.x, p.y - prev.y);
        this.apply();
      }
    }
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const p = this.local(e);
    const wasSingle = this.pointers.size === 1;
    this.pointers.delete(e.pointerId);
    this.cancelLongPress();
    this.viewport().nativeElement.classList.remove('dragging');

    if (wasSingle && this.drag && !this.drag.moved && !this.longPressFired) {
      const px = this.pixelAt(p);
      if (px) this.pixelClick.emit(px);
    }
    if (this.pointers.size === 0) this.drag = null;
    this.pinchDist = 0;
  };

  private readonly onPointerCancel = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    this.cancelLongPress();
    this.viewport().nativeElement.classList.remove('dragging');
    if (this.pointers.size === 0) this.drag = null;
    this.pinchDist = 0;
  };

  private readonly onPointerLeave = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') this.queueHover(null);
  };

  private readonly onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    const px = this.pixelAt(this.local(e));
    if (px) this.pixelInfo.emit(px);
  };

  private pointerDistance(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private pointerCenter(): { x: number; y: number } {
    const [a, b] = [...this.pointers.values()];
    return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : { x: 0, y: 0 };
  }

  private cancelLongPress(): void {
    if (this.longPress) clearTimeout(this.longPress);
    this.longPress = undefined;
  }

  /** najviše jedan događaj `hover` po frame-u, i samo kad se piksel promeni */
  private queueHover(p: { x: number; y: number } | null): void {
    this.hoverPos = p;
    if (this.hoverRaf) return;
    this.hoverRaf = requestAnimationFrame(() => {
      this.hoverRaf = 0;
      const px = this.hoverPos ? this.pixelAt(this.hoverPos) : null;
      this.updateCursor(px);
      const same =
        this.hoverEmitted &&
        ((!px && !this.lastHover) ||
          (!!px && !!this.lastHover && px.x === this.lastHover.x && px.y === this.lastHover.y));
      if (!same) {
        this.hoverEmitted = true;
        this.lastHover = px;
        this.hover.emit(px);
      }
    });
  }

  private updateCursor(px?: PixelPos | null): void {
    const el = this.cursorEl().nativeElement;
    const pos = px === undefined ? this.lastHover : px;
    if (!pos || this.view.scale < 4) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
  }
}
