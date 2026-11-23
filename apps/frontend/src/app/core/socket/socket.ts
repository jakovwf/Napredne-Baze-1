import { Injectable, signal } from '@angular/core';
import type {
  CanvasStatus,
  ClientToServerEvents,
  PixelBatchPayload,
  PixelPlaceAck,
  PixelPlacePayload,
  ServerToClientEvents,
} from '@pixelboard/shared';
import { Subject } from 'rxjs';
import { Socket, io } from 'socket.io-client';

type PixelSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const ACK_TIMEOUT_MS = 8000;

/**
 * tanak omotač oko socket.io-client. isti origin (`/socket.io`, preko dev proxy-ja ili nginx-a),
 * `withCredentials` da se kolačić sesije šalje pri handshake-u. identitet se čita samo pri
 * handshake-u, pa se posle prijave i odjave veza mora ponovo uspostaviti (`reconnect()`).
 *
 * aplikacija je zoneless: učestali `pixel:batch` ide kroz običan Subject bez signala,
 * a signali se menjaju samo za retke događaje (veza, status platna).
 */
@Injectable({ providedIn: 'root' })
export class SocketService {
  private socket?: PixelSocket;

  /** da li je socket trenutno povezan */
  readonly connected = signal(false);
  /** da li je veza ikad uspostavljena (razlikuje "povezivanje" od "ponovnog povezivanja") */
  readonly everConnected = signal(false);
  /** poslednji poznati status platna */
  readonly status = signal<CanvasStatus>('ready');

  /** svako (re)povezivanje; okidač za ponovno učitavanje platna */
  readonly connect$ = new Subject<void>();
  readonly disconnect$ = new Subject<void>();
  /** visokofrekventno: pixel:batch */
  readonly batch$ = new Subject<PixelBatchPayload>();
  /** promena statusa platna: prethodni i novi */
  readonly statusChange$ = new Subject<{ from: CanvasStatus; to: CanvasStatus }>();

  connect(): void {
    if (this.socket) return;
    const socket: PixelSocket = io({ withCredentials: true });
    this.socket = socket;

    socket.on('connect', () => {
      this.connected.set(true);
      this.everConnected.set(true);
      this.connect$.next();
    });
    socket.on('disconnect', () => {
      this.connected.set(false);
      this.disconnect$.next();
    });
    socket.on('pixel:batch', (batch) => this.batch$.next(batch));
    socket.on('canvas:status', ({ status }) => {
      const from = this.status();
      this.status.set(status);
      this.statusChange$.next({ from, to: status });
    });
  }

  /** posle prijave i odjave: nova konekcija da server ponovo pročita identitet iz kolačića */
  reconnect(): void {
    this.socket?.disconnect();
    this.socket?.removeAllListeners();
    this.socket = undefined;
    this.connected.set(false);
    this.connect();
  }

  async placePixel(payload: PixelPlacePayload): Promise<PixelPlaceAck> {
    if (!this.socket?.connected) throw new Error('not-connected');
    return this.socket.timeout(ACK_TIMEOUT_MS).emitWithAck('pixel:place', payload);
  }
}
