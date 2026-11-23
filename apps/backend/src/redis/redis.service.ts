import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Redis, RedisOptions } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/config';

/** razmak između pokušaja ponovnog povezivanja: 200 ms, 400 ms, ... najviše 5 s */
export function redisRetryStrategy(times: number): number {
  return Math.min(times * 200, 5_000);
}

@Injectable()
export class RedisService implements OnApplicationShutdown {
  private readonly logger = new Logger('Redis');
  private readonly connections = new Set<Redis>();

  /** glavna konekcija za obične komande i lua skripte */
  readonly client: Redis;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.client = this.attach(
      new Redis(config.redisUrl, {
        retryStrategy: redisRetryStrategy,
        // komanda koja čeka na vezu puca posle 3 pokušaja umesto da visi zauvek,
        // pa health i api zahtevi brzo vraćaju grešku kad redis padne
        maxRetriesPerRequest: 3,
      }),
      'main',
    );
  }

  /**
   * nova nezavisna konekcija sa istim podešavanjima; potrebna za pub/sub subscriber
   * i za blokirajuće komande (XREADGROUP BLOCK) koje bi zaključale glavnu konekciju.
   * blokirajuće petlje šalju `{ maxRetriesPerRequest: null }`.
   */
  duplicate(name = 'dup', override: Partial<RedisOptions> = {}): Redis {
    return this.attach(this.client.duplicate(override), name);
  }

  private attach(client: Redis, name: string): Redis {
    this.connections.add(client);
    client.on('connect', () => this.logger.log(`[${name}] povezan`));
    client.on('close', () => this.logger.warn(`[${name}] veza prekinuta`));
    client.on('error', (err: Error) =>
      this.logger.error(`[${name}] ${err.message}`),
    );
    return client;
  }

  /** konekcije se zatvaraju tek pri gašenju aplikacije, posle ostalih servisa */
  async onApplicationShutdown(): Promise<void> {
    await Promise.all(
      [...this.connections].map(async (c) => {
        try {
          // QUIT: uredno zatvaranje konekcije
          await c.quit();
        } catch {
          c.disconnect();
        }
      }),
    );
    this.connections.clear();
  }
}
