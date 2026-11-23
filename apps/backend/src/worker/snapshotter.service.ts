import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { RedisKeys } from '../redis/keys';
import { LuaScriptsService } from '../redis/lua-scripts.service';
import { RedisService } from '../redis/redis.service';
import { SnapshotMeta, SnapshotsService } from '../snapshot/snapshots.service';

const CHECK_INTERVAL_MS = 10_000;
const LOCK_PX = 30_000;

/** iz odgovora XINFO STREAM (ravan niz) vadi last-generated-id */
export function lastGeneratedId(raw: unknown): string {
  if (!Array.isArray(raw)) return '0-0';
  const i = raw.indexOf('last-generated-id');
  const id: unknown = i >= 0 ? raw[i + 1] : undefined;
  return typeof id === 'string' ? id : '0-0';
}

/** periodično čuva platno iz Redisa u Cassandru, za oporavak posle gubitka Redisa */
@Injectable()
export class SnapshotterService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger('Snapshotter');
  private timer?: NodeJS.Timeout;
  private current?: Promise<unknown>;
  private lastVersion: number | null = null;
  private lastAt = Date.now();

  constructor(
    private readonly redis: RedisService,
    private readonly snapshots: SnapshotsService,
    private readonly lua: LuaScriptsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.appRole === 'worker') await this.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  async start(checkMs = CHECK_INTERVAL_MS): Promise<void> {
    const latest = await this.snapshots.latest();
    this.lastVersion = latest?.canvasVersion ?? null;
    this.lastAt = latest?.takenAt.getTime() ?? Date.now();
    this.timer = setInterval(() => {
      if (this.current) return; // prethodna provera još traje
      this.current = this.tick()
        .catch((e: Error) =>
          this.logger.error(`snapshot nije napravljen: ${e.message}`),
        )
        .finally(() => (this.current = undefined));
    }, checkMs);
    const { minMoves, intervalMs, keep } = this.config.snapshot;
    this.logger.log(
      `pokrenut (na ${minMoves} poteza ili ${intervalMs} ms, čuva se ${keep})`,
    );
  }

  /** tekući snapshot se završava pre gašenja */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.current;
  }

  /** jedna provera: snapshot kad je verzija različita i prošlo je dovoljno poteza ili vremena */
  async tick(): Promise<SnapshotMeta | null> {
    if (!(await this.isReady())) return null; // dok traje oporavak ne radi ništa
    // trenutna verzija platna
    const raw = await this.redis.client.get(RedisKeys.canvasVersion());
    if (raw === null) return null;
    const version = Number(raw);
    // posle oporavka verzija može biti manja, pa je dovoljno da bude različita
    if (version === this.lastVersion) return null;

    const { minMoves, intervalMs } = this.config.snapshot;
    const enoughMoves =
      this.lastVersion === null || version - this.lastVersion >= minMoves;
    const enoughTime = Date.now() - this.lastAt >= intervalMs;
    if (!enoughMoves && !enoughTime) return null;
    return this.takeSnapshot();
  }

  private async isReady(): Promise<boolean> {
    // status platna; snapshot se pravi samo kad je ready
    return (await this.redis.client.get(RedisKeys.canvasStatus())) === 'ready';
  }

  /**
   * pravi snapshot; vraća null ako nema izmena, ako platno nije spremno ili ako lock drži
   * druga instanca. bezbedno za istovremene pozive i više worker instanci.
   */
  async takeSnapshot(): Promise<SnapshotMeta | null> {
    if (!(await this.isReady())) return null;
    const client = this.redis.client;
    const token = randomUUID();
    // lock: samo jedna instanca pravi snapshot (ističe sam posle 30 s)
    const got = await client.set(
      RedisKeys.lockSnapshot(),
      token,
      'PX',
      LOCK_PX,
      'NX',
    );
    if (got !== 'OK') return null;

    try {
      // platno, verzija i poslednji ID streama u jednom MULTI-ju: place_pixel.lua je atomična
      // (piksel, verzija i XADD u istoj skripti), pa su sva tri iz istog trenutka.
      // last-generated-id ostaje tačan i kad je stream istrimovan.
      const res = await client
        .multi()
        .getBuffer(RedisKeys.canvasMain())
        .get(RedisKeys.canvasVersion())
        .call('XINFO', 'STREAM', RedisKeys.streamMoves())
        .exec();
      const data = res?.[0]?.[1] as Buffer | null | undefined;
      const version = Number(res?.[1]?.[1]);
      if (!data || Number.isNaN(version)) return null;
      // ako stream ne postoji, XINFO daje grešku samo za tu komandu
      const lastStreamId = res?.[2]?.[0]
        ? '0-0'
        : lastGeneratedId(res?.[2]?.[1]);

      const { width, height } = this.config.canvas;
      if (data.length !== width * height) {
        throw new Error(
          `canvas:main ima ${data.length} bajtova, konfiguracija očekuje ${width * height}`,
        );
      }

      // provera u Cassandri: druga instanca je možda već snimila ovu verziju
      const latest = await this.snapshots.latest();
      if (latest && latest.canvasVersion === version) {
        this.lastVersion = version;
        this.lastAt = latest.takenAt.getTime();
        return null;
      }

      const meta = await this.snapshots.save({
        data,
        version,
        lastStreamId,
        width,
        height,
      });
      this.lastVersion = version;
      this.lastAt = meta.takenAt.getTime();
      this.logger.log(
        `snapshot v${version} (poslednji ID u streamu ${lastStreamId})`,
      );
      await this.snapshots.prune(this.config.snapshot.keep);
      return meta;
    } finally {
      // oslobađa lock samo ako ga još drži ova instanca
      await this.lua.run('release_lock', [RedisKeys.lockSnapshot()], [token]);
    }
  }
}
