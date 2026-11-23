import { Inject, Injectable } from '@nestjs/common';
import type { PublicUser, Role } from '@pixelboard/shared';
import { randomBytes } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { RedisKeys } from '../redis/keys';
import { RedisService } from '../redis/redis.service';
import { SESSION_COOKIE, parseCookie } from './cookies';

const SID_PATTERN = /^[A-Za-z0-9_-]{43}$/; // 32 bajta u base64url
const DAY_SECONDS = 86_400;

@Injectable()
export class SessionService {
  private readonly ttlSeconds: number;

  constructor(
    private readonly redis: RedisService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.ttlSeconds = config.sessionTtlDays * DAY_SECONDS;
  }

  get ttlMs(): number {
    return this.ttlSeconds * 1000;
  }

  async create(user: PublicUser): Promise<string> {
    const sid = randomBytes(32).toString('base64url');
    const key = RedisKeys.session(sid);
    // hash sesije + rok trajanja u jednoj transakciji
    await this.redis.client
      .multi()
      .hset(key, {
        uid: user.id,
        username: user.username,
        role: user.role,
        createdAt: Date.now().toString(),
      })
      .expire(key, this.ttlSeconds)
      .exec();
    return sid;
  }

  /** učitava sesiju; rok se produžava tek kad padne ispod (TTL - 1 dan) */
  async get(sid: string): Promise<PublicUser | null> {
    if (!SID_PATTERN.test(sid)) return null;
    const key = RedisKeys.session(sid);
    // čita hash i preostali rok zajedno
    const res = await this.redis.client.multi().hgetall(key).ttl(key).exec();
    const data = (res?.[0]?.[1] ?? {}) as Record<string, string>;
    const ttl = Number(res?.[1]?.[1] ?? -2);
    if (!data.uid) return null;

    if (ttl >= 0 && ttl < this.ttlSeconds - DAY_SECONDS) {
      // sliding: ponovo postavlja pun rok
      await this.redis.client.expire(key, this.ttlSeconds);
    }
    return { id: data.uid, username: data.username, role: data.role as Role };
  }

  async destroy(sid: string): Promise<void> {
    if (!SID_PATTERN.test(sid)) return;
    // brisanje sesije (odjava)
    await this.redis.client.del(RedisKeys.session(sid));
  }

  /** za websocket handshake: sirovo `Cookie` zaglavlje u korisnika ili null */
  async authenticateCookieHeader(
    cookieHeader?: string,
  ): Promise<PublicUser | null> {
    const sid = parseCookie(cookieHeader, SESSION_COOKIE);
    return sid ? this.get(sid) : null;
  }
}
