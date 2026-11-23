import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { PALETTE } from '@pixelboard/shared';
import type { CanvasStatus, PixelBatchPayload, PixelPlaceError } from '@pixelboard/shared';
import { firstValueFrom } from 'rxjs';
import { SocketService } from '../core/socket/socket';
import {
  PixelBatch,
  Rect,
  applyBatch,
  expandRect,
  mergeBuffered,
  paletteToUint32,
  unionRect,
} from './canvas-logic';

export type SyncState = 'idle' | 'loading' | 'ready' | 'error';

export interface CanvasConfig {
  width: number;
  height: number;
  cooldownMs: number;
  status: CanvasStatus;
  palette: string[];
}

export type PlaceResult =
  | { ok: true; cooldownMs: number }
  | {
      ok: false;
      error: PixelPlaceError | 'NETWORK';
      retryInMs?: number;
      lockId?: string;
    };

const DEFAULT_RETRY_MS = 2000;
const ERROR_RETRY_MS = 3000;

/**
 * stanje i iscrtavanje platna. platno nije u store-u: bafer boja (Uint8Array) i ImageData
 * (Uint32Array pogled nad istim bajtovima) žive ovde, a iscrtava se u requestAnimationFrame
 * samo za dirty rect.
 *
 * aplikacija je zoneless: socket događaji i rAF ne pokreću detekciju promena, a signali ispod
 * se menjaju samo za retke događaje (sinhronizacija, veličina, konfiguracija).
 */
@Injectable({ providedIn: 'root' })
export class CanvasService {
  private readonly http = inject(HttpClient);
  private readonly socket = inject(SocketService);

  // ---- retko menjani signali ----
  readonly syncState = signal<SyncState>('idle');
  readonly size = signal<{ width: number; height: number } | null>(null);
  readonly config = signal<CanvasConfig | null>(null);
  /** poslednja greška sinhronizacije (za prikaz) */
  readonly syncError = signal<string | null>(null);

  // ---- bafer platna (van signala) ----
  private data: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  private width = 0;
  private height = 0;
  private version = 0;
  private palette = paletteToUint32(PALETTE);

  // ---- iscrtavanje ----
  private canvas?: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null = null;
  private image?: ImageData;
  private pixels32?: Uint32Array;
  private dirty: Rect | null = null;
  private fullRedrawPending = false;
  private raf = 0;

  // ---- sinhronizacija ----
  private syncSeq = 0;
  private buffering = false;
  private buffer: PixelBatch[] = [];
  private started = false;

  /** povezuje socket događaje; poziva se jednom pri pokretanju aplikacije */
  start(): void {
    if (this.started) return;
    this.started = true;

    // svako (re)povezivanje: buferuj batch-eve, preuzmi platno, spoji
    this.socket.connect$.subscribe(() => void this.sync());
    this.socket.batch$.subscribe((b) => this.onBatch(b));
    // posle oporavka Redisa verzija platna može da se vrati unazad, pa se platno preuzima ponovo
    this.socket.statusChange$.subscribe(({ from, to }) => {
      if (to === 'ready' && from !== 'ready') void this.sync();
    });
  }

  // ===================== sinhronizacija =====================

  /** preuzima platno i spaja ga sa baferovanim batch-evima; novi poziv poništava stari */
  async sync(): Promise<void> {
    const seq = ++this.syncSeq;
    this.buffering = true; // od ovog trenutka batch-evi se samo skupljaju
    this.buffer = [];
    this.syncState.set('loading');

    while (seq === this.syncSeq) {
      try {
        const [res, config] = await Promise.all([
          firstValueFrom(
            this.http.get('/api/canvas', { responseType: 'arraybuffer', observe: 'response' }),
          ),
          firstValueFrom(this.http.get<CanvasConfig>('/api/canvas/config')).catch(() => null),
        ]);
        if (seq !== this.syncSeq) return; // u međuvremenu je pokrenuta nova sinhronizacija

        const width = Number(res.headers.get('X-Canvas-Width'));
        const height = Number(res.headers.get('X-Canvas-Height'));
        const version = Number(res.headers.get('X-Canvas-Version'));
        const body = new Uint8Array(res.body ?? new ArrayBuffer(0));
        if (!width || !height || body.length !== width * height || Number.isNaN(version)) {
          throw new Error('Neispravan odgovor servera za platno');
        }

        this.load(body, width, height, version);
        const merged = mergeBuffered(this.data, width, height, version, this.buffer);
        this.version = merged.version;
        this.buffer = [];
        this.buffering = false;
        if (merged.dirty) this.markRect(merged.dirty);
        if (config) {
          this.config.set(config);
          this.palette = paletteToUint32(config.palette);
          this.fullRedrawPending = true;
          this.schedule();
        }
        this.syncError.set(null);
        this.syncState.set('ready');
        return;
      } catch (err) {
        if (seq !== this.syncSeq) return;
        let waitMs = ERROR_RETRY_MS;
        if (err instanceof HttpErrorResponse && err.status === 503) {
          // oporavak platna u toku: ponovi posle Retry-After
          const s = Number(err.headers.get('Retry-After'));
          waitMs = Number.isFinite(s) && s > 0 ? Math.min(s * 1000, 10_000) : DEFAULT_RETRY_MS;
          this.syncError.set('Platno se vraća, sačekaj trenutak.');
        } else {
          this.syncError.set('Ne mogu da učitam platno. Pokušavam ponovo…');
          this.syncState.set('error');
        }
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
  }

  private onBatch(batch: PixelBatchPayload): void {
    if (this.buffering) {
      this.buffer.push(batch);
      return;
    }
    const r = applyBatch(this.data, this.width, this.height, batch, this.version);
    if (r.applied === 0) return;
    this.version = r.version;
    if (r.dirty) this.markRect(r.dirty);
  }

  /** postavlja novo platno (preuzeto sa servera) */
  private load(data: Uint8Array, width: number, height: number, version: number): void {
    this.data = data;
    this.width = width;
    this.height = height;
    this.version = version;
    this.size.set({ width, height });
    this.rebuildImage();
    this.fullRedrawPending = true;
    this.schedule();
  }

  // ===================== iscrtavanje =====================

  /** vezuje <canvas> element (poziva ga CanvasView) */
  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.rebuildImage();
    this.fullRedrawPending = true;
    this.schedule();
  }

  detach(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.canvas = undefined;
    this.ctx = null;
    this.image = undefined;
    this.pixels32 = undefined;
  }

  private rebuildImage(): void {
    if (!this.canvas || !this.ctx || !this.width) return;
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.image = this.ctx.createImageData(this.width, this.height);
    // Uint32 pogled nad istim bajtovima kao ImageData (jedan upis je jedan piksel)
    this.pixels32 = new Uint32Array(this.image.data.buffer);
  }

  private markRect(rect: Rect): void {
    this.dirty = unionRect(this.dirty, rect);
    this.schedule();
  }

  private schedule(): void {
    if (this.raf || !this.ctx) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.flush();
    });
  }

  /** jedan prolaz iscrtavanja: ceo bafer (posle učitavanja) ili samo dirty rect */
  private flush(): void {
    const { ctx, image, pixels32 } = this;
    if (!ctx || !image || !pixels32) return;

    if (this.fullRedrawPending) {
      for (let i = 0; i < this.data.length; i++) pixels32[i] = this.palette[this.data[i]] ?? 0;
      ctx.putImageData(image, 0, 0);
      this.fullRedrawPending = false;
      this.dirty = null;
      return;
    }
    const d = this.dirty;
    if (!d) return;
    this.dirty = null;
    for (let y = d.y; y < d.y + d.h; y++) {
      for (let x = d.x; x < d.x + d.w; x++) {
        const i = y * this.width + x;
        pixels32[i] = this.palette[this.data[i]] ?? 0;
      }
    }
    // putImageData samo za ograničavajući pravougaonik promenjenih piksela
    ctx.putImageData(image, 0, 0, d.x, d.y, d.w, d.h);
  }

  // ===================== pristup pikselima =====================

  colorAt(x: number, y: number): number | null {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    return this.data[y * this.width + x];
  }

  get canvasWidth(): number {
    return this.width;
  }

  get canvasHeight(): number {
    return this.height;
  }

  private writePixel(x: number, y: number, color: number): void {
    this.data[y * this.width + x] = color;
    this.markRect(expandRect(null, x, y));
  }

  /**
   * optimističko bojenje: piksel se boji odmah, pa se šalje serveru. na grešku se vraća stara
   * boja, ali samo ako piksel još ima našu boju (drugi igrač ga je u međuvremenu mogao prebojiti).
   */
  async place(x: number, y: number, color: number): Promise<PlaceResult> {
    const old = this.colorAt(x, y);
    if (old === null) return { ok: false, error: 'INVALID_COORDS' };
    this.writePixel(x, y, color);

    const revert = () => {
      if (this.colorAt(x, y) === color) this.writePixel(x, y, old);
    };
    try {
      const ack = await this.socket.placePixel({ x, y, color });
      if (ack.ok) return { ok: true, cooldownMs: ack.cooldownMs };
      revert();
      return { ok: false, error: ack.error, retryInMs: ack.retryInMs, lockId: ack.lockId };
    } catch {
      revert();
      return { ok: false, error: 'NETWORK' };
    }
  }
}
