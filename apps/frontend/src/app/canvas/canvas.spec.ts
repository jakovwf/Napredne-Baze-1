import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { PALETTE } from '@pixelboard/shared';
import { vi } from 'vitest';
import { SocketService } from '../core/socket/socket';
import { CanvasService } from './canvas';

const W = 4;
const H = 3;

const canvasBody = (fill = 0): ArrayBuffer => new Uint8Array(W * H).fill(fill).buffer;

describe('CanvasService', () => {
  let service: CanvasService;
  let socket: SocketService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(CanvasService);
    socket = TestBed.inject(SocketService);
    http = TestBed.inject(HttpTestingController);
    service.start();
  });

  afterEach(() => vi.useRealTimers());

  const flushCanvas = (version: number, body = canvasBody()) => {
    http.expectOne('/api/canvas').flush(body, {
      headers: {
        'X-Canvas-Version': String(version),
        'X-Canvas-Width': String(W),
        'X-Canvas-Height': String(H),
      },
    });
    http
      .expectOne('/api/canvas/config')
      .flush({ width: W, height: H, cooldownMs: 5000, status: 'ready', palette: PALETTE });
  };

  const ready = async (version = 10) => {
    socket.connect$.next();
    flushCanvas(version);
    await vi.waitFor(() => expect(service.syncState()).toBe('ready'));
  };

  it('connect: baferuje batch-eve tokom preuzimanja i primenjuje samo novije od verzije platna', async () => {
    socket.connect$.next();
    expect(service.syncState()).toBe('loading');

    // stižu dok se platno preuzima
    socket.batch$.next({ v: [9], p: [[0, 0, 3]] }); // stariji od platna: odbačen
    socket.batch$.next({ v: [11], p: [[1, 0, 4]] }); // noviji: primenjen
    flushCanvas(10);
    await vi.waitFor(() => expect(service.syncState()).toBe('ready'));

    expect(service.colorAt(0, 0)).toBe(0);
    expect(service.colorAt(1, 0)).toBe(4);
    expect(service.size()).toEqual({ width: W, height: H });
    expect(service.config()?.cooldownMs).toBe(5000);
  });

  it('posle sinhronizacije batch-evi se primenjuju odmah, već viđena verzija se ignoriše', async () => {
    await ready();
    socket.batch$.next({ v: [11], p: [[2, 1, 7]] });
    expect(service.colorAt(2, 1)).toBe(7);
    socket.batch$.next({ v: [11], p: [[2, 1, 9]] });
    expect(service.colorAt(2, 1)).toBe(7);
    socket.batch$.next({ v: [12], p: [[2, 1, 9]] });
    expect(service.colorAt(2, 1)).toBe(9);
  });

  it('posle oporavka (recovering u ready) preuzima celo platno i prihvata manju verziju', async () => {
    await ready();

    socket.statusChange$.next({ from: 'ready', to: 'recovering' });
    http.expectNone('/api/canvas');

    socket.statusChange$.next({ from: 'recovering', to: 'ready' });
    flushCanvas(3, canvasBody(5)); // verzija posle oporavka je manja
    await vi.waitFor(() => expect(service.colorAt(0, 0)).toBe(5));
    socket.batch$.next({ v: [4], p: [[0, 0, 8]] });
    expect(service.colorAt(0, 0)).toBe(8);
  });

  it('503 ponavlja preuzimanje posle Retry-After', async () => {
    vi.useFakeTimers();
    socket.connect$.next();
    http.expectOne('/api/canvas').flush(new ArrayBuffer(0), {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Retry-After': '2' },
    });
    http.expectOne('/api/canvas/config').flush({}, { status: 503, statusText: 'x' });
    await vi.advanceTimersByTimeAsync(1999);
    http.expectNone('/api/canvas');
    await vi.advanceTimersByTimeAsync(2);
    http.expectOne('/api/canvas');
    http.expectOne('/api/canvas/config');
  });

  it('place: optimistično boji, a na grešku vraća staru boju', async () => {
    await ready(1);
    vi.spyOn(socket, 'placePixel').mockResolvedValue({
      ok: false,
      error: 'COOLDOWN',
      retryInMs: 3000,
    });
    const p = service.place(1, 1, 6);
    expect(service.colorAt(1, 1)).toBe(6); // odmah
    expect(await p).toMatchObject({ ok: false, error: 'COOLDOWN', retryInMs: 3000 });
    expect(service.colorAt(1, 1)).toBe(0); // vraćeno
  });

  it('place: uspeh vraća cooldownMs i ostavlja boju, a mrežna greška vraća staru', async () => {
    await ready(1);
    vi.spyOn(socket, 'placePixel').mockResolvedValueOnce({ ok: true, cooldownMs: 5000 });
    expect(await service.place(0, 2, 4)).toEqual({ ok: true, cooldownMs: 5000 });
    expect(service.colorAt(0, 2)).toBe(4);

    vi.spyOn(socket, 'placePixel').mockRejectedValueOnce(new Error('timeout'));
    expect(await service.place(3, 2, 9)).toMatchObject({ ok: false, error: 'NETWORK' });
    expect(service.colorAt(3, 2)).toBe(0);
  });

  it('place: ne vraća boju ako je drugi igrač u međuvremenu prebrisao piksel', async () => {
    await ready(1);
    let release!: () => void;
    vi.spyOn(socket, 'placePixel').mockImplementation(
      () =>
        new Promise((r) => {
          release = () => r({ ok: false, error: 'ZONE_LOCKED' });
        }),
    );
    const p = service.place(1, 1, 6);
    socket.batch$.next({ v: [2], p: [[1, 1, 12]] }); // tuđi potez prebrisao
    release();
    await p;
    expect(service.colorAt(1, 1)).toBe(12);
  });
});
