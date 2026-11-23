import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { CanvasStatus } from '@pixelboard/shared';
import { CassandraService } from '../cassandra/cassandra.service';
import { RedisKeys } from '../redis/keys';
import { RedisService } from '../redis/redis.service';

const CHECK_TIMEOUT_MS = 2_000;

export interface HealthBody {
  status: 'ok' | 'error';
  redis: 'up' | 'down';
  cassandra: 'up' | 'down';
  /** status platna; tokom oporavka je samo informacija, ne utiče na kod odgovora */
  canvas?: CanvasStatus;
  errors?: { redis?: string; cassandra?: string };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout posle ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const errMsg = (reason: unknown): string =>
  reason instanceof Error ? reason.message : String(reason);

@Controller('health')
export class HealthController {
  constructor(
    private readonly redis: RedisService,
    private readonly cassandra: CassandraService,
  ) {}

  /** 200 dok su redis i cassandra dostupni (i tokom oporavka platna), 503 kad neka nije */
  @Get()
  async health(@Res({ passthrough: true }) res: Response): Promise<HealthBody> {
    const [redis, cassandra] = await Promise.allSettled([
      withTimeout(this.canvasStatus(), CHECK_TIMEOUT_MS),
      // proba da cassandra odgovara
      withTimeout(
        this.cassandra.execute('SELECT release_version FROM system.local'),
        CHECK_TIMEOUT_MS,
      ),
    ]);

    const errors: NonNullable<HealthBody['errors']> = {};
    if (redis.status === 'rejected') errors.redis = errMsg(redis.reason);
    if (cassandra.status === 'rejected')
      errors.cassandra = errMsg(cassandra.reason);

    const ok = !errors.redis && !errors.cassandra;
    if (!ok) res.status(503);
    return {
      status: ok ? 'ok' : 'error',
      redis: errors.redis ? 'down' : 'up',
      cassandra: errors.cassandra ? 'down' : 'up',
      ...(redis.status === 'fulfilled' ? { canvas: redis.value } : {}),
      ...(ok ? {} : { errors }),
    };
  }

  /** PING pa status platna; bez ključa ili sa nepoznatom vrednošću platno nije spremno */
  private async canvasStatus(): Promise<CanvasStatus> {
    // proba da redis odgovara
    await this.redis.client.ping();
    // čita status platna
    const status = await this.redis.client.get(RedisKeys.canvasStatus());
    return status === 'ready' ? 'ready' : 'recovering';
  }
}
