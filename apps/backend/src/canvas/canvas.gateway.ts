import { Logger, OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type {
  CanvasStatus,
  ClientToServerEvents,
  PixelBatchPayload,
  PixelPlaceAck,
  PublicUser,
  ServerToClientEvents,
} from '@pixelboard/shared';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Server, Socket } from 'socket.io';
import { SessionService } from '../auth/session.service';
import { RedisKeys } from '../redis/keys';
import { RedisService } from '../redis/redis.service';
import { CanvasService } from './canvas.service';

interface SocketData {
  user?: PublicUser;
}
type CanvasServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;
type CanvasSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

export const BATCH_INTERVAL_MS = 50;

@WebSocketGateway()
export class CanvasGateway
  implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy
{
  private readonly logger = new Logger('CanvasGateway');
  private timer?: NodeJS.Timeout;
  private buffer: PixelBatchPayload = { v: [], p: [] };

  @WebSocketServer() server!: CanvasServer;

  constructor(
    private readonly sessions: SessionService,
    private readonly canvas: CanvasService,
    private readonly redis: RedisService,
  ) {}

  async afterInit(server: CanvasServer): Promise<void> {
    // redis adapter: emit-ovi rade preko više api instanci (traži posebne pub i sub konekcije)
    const pub = this.redis.duplicate('io-pub');
    const sub = this.redis.duplicate('io-sub', { maxRetriesPerRequest: null });
    server.adapter(createAdapter(pub, sub));

    // gost se povezuje (vidi platno); bez važeće sesije socket.data.user ostaje prazan
    server.use((socket, next) => {
      this.sessions
        .authenticateCookieHeader(socket.handshake.headers.cookie)
        .then((user) => {
          if (user) socket.data.user = user;
          next();
        })
        .catch((err: Error) => next(err));
    });

    await this.subscribeUpdates();
  }

  /** pub/sub kanal koji puni place_pixel.lua; poruke se skupljaju i šalju u batch-evima */
  private async subscribeUpdates(): Promise<void> {
    // poseban subscriber: konekcija u subscribe režimu ne sme da izvršava obične komande
    const sub = this.redis.duplicate('canvas-sub', {
      maxRetriesPerRequest: null,
    });
    sub.on('message', (_channel: string, message: string) =>
      this.onUpdate(message),
    );
    // pretplata na promene platna
    await sub.subscribe(RedisKeys.canvasUpdates());
    this.timer = setInterval(() => this.flush(), BATCH_INTERVAL_MS);
    this.logger.log(`batch promena na svakih ${BATCH_INTERVAL_MS} ms`);
  }

  private onUpdate(message: string): void {
    const [v, x, y, c] = message.split(',').map(Number);
    if ([v, x, y, c].some((n) => !Number.isFinite(n))) return;
    this.buffer.v.push(v);
    this.buffer.p.push([x, y, c]);
  }

  private flush(): void {
    if (this.buffer.v.length === 0 || !this.server) return;
    const batch = this.buffer;
    this.buffer = { v: [], p: [] };
    // local: samo socketi na ovoj instanci; svaka instanca ima sopstvenu pretplatu,
    // pa bi običan emit kroz adapter isporučio poruku dvaput klijentima drugih instanci
    this.server.local.emit('pixel:batch', batch);
  }

  /** status platna svim klijentima na svim instancama (kroz adapter) */
  emitStatus(status: CanvasStatus): void {
    this.server?.emit('canvas:status', { status });
  }

  async handleConnection(socket: CanvasSocket): Promise<void> {
    socket.emit('canvas:status', { status: await this.canvas.getStatus() });
  }

  @SubscribeMessage('pixel:place')
  async onPlace(
    @ConnectedSocket() socket: CanvasSocket,
    @MessageBody() payload: unknown,
  ): Promise<PixelPlaceAck> {
    const user = socket.data.user;
    if (!user) return { ok: false, error: 'UNAUTHORIZED' };

    const p = payload as Record<string, unknown> | null;
    if (
      !p ||
      typeof p !== 'object' ||
      typeof p.x !== 'number' ||
      typeof p.y !== 'number' ||
      typeof p.color !== 'number'
    ) {
      return { ok: false, error: 'INVALID_PAYLOAD' };
    }

    const res = await this.canvas.placePixel(user, p.x, p.y, p.color);
    if (res.ok) return { ok: true, cooldownMs: res.cooldownMs };
    return {
      ok: false,
      error: res.error,
      retryInMs: res.retryInMs,
      lockId: res.lockId,
    };
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
