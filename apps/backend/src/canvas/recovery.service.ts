import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import type { CanvasStatus } from '@pixelboard/shared';
import { randomUUID } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { RedisKeys } from '../redis/keys';
import { LuaScriptsService } from '../redis/lua-scripts.service';
import { RedisService } from '../redis/redis.service';
import { CanvasGateway } from './canvas.gateway';

const LOCK_PX = 600_000; // 10 min, bez obnavljanja
const CHECK_EVERY_MS = 5_000;

/**
 * priprema platna: kad `canvas:main` ne postoji ili status nije `ready`, platno se postavlja
 * pod lock-om `lock:recovery`. za sada samo prazan start; vraćanje iz Cassandre dolazi kasnije.
 * provera radi pri startu i periodično, u pozadini (ne blokira start api-ja).
 */
@Injectable()
export class RecoveryService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger('Recovery');
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;

  constructor(
    private readonly redis: RedisService,
    private readonly lua: LuaScriptsService,
    private readonly gateway: CanvasGateway,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    void this.check();
    this.timer = setInterval(() => void this.check(), CHECK_EVERY_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** jedna provera; ne preklapa se sa prethodnom, a greška se samo loguje */
  check(): Promise<void> {
    this.running ??= this.ensureReady()
      .catch((err: Error) => this.logger.error(`oporavak: ${err.message}`))
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }

  /** čeka završetak provere koja je u toku (za testove) */
  async settled(): Promise<void> {
    await this.running;
  }

  /** ako platno nije spremno, preuzima lock i postavlja ga; ko ne dobije lock ne radi ništa */
  async ensureReady(): Promise<void> {
    if (await this.isReady()) return;

    const token = randomUUID();
    // lock: samo jedna instanca postavlja platno, ističe sam posle 10 min
    const got = await this.redis.client.set(
      RedisKeys.lockRecovery(),
      token,
      'PX',
      LOCK_PX,
      'NX',
    );
    if (got !== 'OK') return;

    try {
      // pod lock-om ponovo proveri: druga instanca je možda upravo završila
      if (await this.isReady()) return;
      await this.rebuild();
    } finally {
      // oslobađa lock samo ako ga još drži ova instanca
      await this.lua
        .run('release_lock', [RedisKeys.lockRecovery()], [token])
        .catch(() => undefined);
    }
  }

  private async isReady(): Promise<boolean> {
    const [status, exists] = await Promise.all([
      this.redis.client.get(RedisKeys.canvasStatus()),
      this.redis.client.exists(RedisKeys.canvasMain()),
    ]);
    return status === 'ready' && exists === 1;
  }

  private async rebuild(): Promise<void> {
    const { width, height, cooldownMs } = this.config.canvas;
    await this.setStatus('recovering');

    // prvo podaci i verzija, status ready tek na kraju
    await this.redis.client
      .multi()
      .set(RedisKeys.canvasMain(), Buffer.alloc(width * height))
      .set(RedisKeys.canvasVersion(), 0)
      .hset(RedisKeys.configCanvas(), {
        width,
        height,
        cooldown_ms: cooldownMs,
      })
      .exec();
    await this.setStatus('ready');
    this.logger.log(`platno spremno (${width}x${height}, prazno)`);
  }

  private async setStatus(status: CanvasStatus): Promise<void> {
    // status platna; klijenti ga dobijaju preko gateway-a
    await this.redis.client.set(RedisKeys.canvasStatus(), status);
    this.gateway.emitStatus(status);
  }
}
