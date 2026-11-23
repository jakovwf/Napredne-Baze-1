import { Inject, Injectable } from '@nestjs/common';
import {
  PALETTE,
  type CanvasStatus,
  type PixelPlaceError,
  type PublicUser,
} from '@pixelboard/shared';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { RedisKeys } from '../redis/keys';
import { LuaScriptsService } from '../redis/lua-scripts.service';
import { RedisService } from '../redis/redis.service';

export type PlaceOutcome =
  | { ok: true; version: number; streamId: string; cooldownMs: number }
  | {
      ok: false;
      error: PixelPlaceError;
      retryInMs?: number;
      lockId?: string;
    };

export interface CanvasSnapshot {
  data: Buffer;
  version: number;
  width: number;
  height: number;
}

export interface CanvasConfig {
  width: number;
  height: number;
  cooldownMs: number;
  status: CanvasStatus;
  palette: readonly string[];
}

const LUA_ERRORS: Record<string, PixelPlaceError> = {
  ERR_NOT_READY: 'NOT_READY',
  ERR_COOLDOWN: 'COOLDOWN',
  ERR_ZONE_LOCKED: 'ZONE_LOCKED',
  ERR_INVALID_COORDS: 'INVALID_COORDS',
};

@Injectable()
export class CanvasService {
  constructor(
    private readonly redis: RedisService,
    private readonly lua: LuaScriptsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** koordinate proverava skripta (dimenzije su u Redisu), a boju ovde */
  async placePixel(
    user: PublicUser,
    x: number,
    y: number,
    color: number,
  ): Promise<PlaceOutcome> {
    if (!Number.isInteger(color) || color < 0 || color >= PALETTE.length) {
      return { ok: false, error: 'INVALID_COLOR' };
    }

    // atomično: provera i upis poteza
    const res = (await this.lua.run(
      'place_pixel',
      [
        RedisKeys.canvasMain(),
        RedisKeys.canvasStatus(),
        RedisKeys.cooldown(user.id),
        RedisKeys.zonesActive(),
        RedisKeys.streamMoves(),
        RedisKeys.canvasVersion(),
        RedisKeys.configCanvas(),
        RedisKeys.canvasUpdates(),
      ],
      [user.id, user.username, x, y, color, Date.now(), user.role],
    )) as [string, string | number, number?, number?];

    const [code, a, version, cooldownMs] = res;
    if (code === 'OK') {
      return {
        ok: true,
        streamId: String(a),
        version: Number(version),
        cooldownMs: Number(cooldownMs ?? 0),
      };
    }
    const error = LUA_ERRORS[code] ?? 'NOT_READY';
    if (code === 'ERR_COOLDOWN') {
      return { ok: false, error, retryInMs: Number(a) };
    }
    if (code === 'ERR_ZONE_LOCKED') {
      return { ok: false, error, lockId: String(a) };
    }
    return { ok: false, error };
  }

  /** platno i verzija u jednom MULTI-ju, da budu konzistentan par */
  async getSnapshot(): Promise<CanvasSnapshot | null> {
    const res = await this.redis.client
      .multi()
      .getBuffer(RedisKeys.canvasMain())
      .get(RedisKeys.canvasVersion())
      .hmget(RedisKeys.configCanvas(), 'width', 'height')
      .exec();
    const data = res?.[0]?.[1] as Buffer | null | undefined;
    if (!data) return null;
    const [w, h] = (res?.[2]?.[1] ?? []) as (string | null)[];
    return {
      data,
      version: Number(res?.[1]?.[1] ?? 0),
      width: Number(w ?? this.config.canvas.width),
      height: Number(h ?? this.config.canvas.height),
    };
  }

  async getStatus(): Promise<CanvasStatus> {
    // status platna; sve osim "ready" znači da platno nije spremno
    const s = await this.redis.client.get(RedisKeys.canvasStatus());
    return s === 'ready' ? 'ready' : 'recovering';
  }

  async getConfig(): Promise<CanvasConfig> {
    // dimenzije i cooldown iz konfiguracije platna u Redisu
    const [w, h, cd] = await this.redis.client.hmget(
      RedisKeys.configCanvas(),
      'width',
      'height',
      'cooldown_ms',
    );
    return {
      width: Number(w ?? this.config.canvas.width),
      height: Number(h ?? this.config.canvas.height),
      cooldownMs: Number(cd ?? this.config.canvas.cooldownMs),
      status: await this.getStatus(),
      palette: PALETTE,
    };
  }
}
