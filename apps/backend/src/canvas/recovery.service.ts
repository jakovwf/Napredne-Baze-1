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
import {
  MovesCursor,
  MovesReaderService,
} from '../snapshot/moves-reader.service';
import { SnapshotMeta, SnapshotsService } from '../snapshot/snapshots.service';
import { CanvasGateway } from './canvas.gateway';

const LOCK_PX = 600_000; // 10 min, dovoljno da oporavak stane; bez obnavljanja
const CHECK_EVERY_MS = 5_000;
const HOUR_MS = 3_600_000;

/**
 * inicijalizacija i oporavak platna. kad `canvas:main` ne postoji ili status nije `ready`
 * (prvi start ili gubitak Redisa), platno se vraća iz poslednjeg upotrebljivog snapshot-a
 * u Cassandri plus replay poteza posle njega. radi pod lock-om `lock:recovery`, pri startu
 * i periodično na ~5 s, u pozadini (ne blokira start api-ja).
 */
@Injectable()
export class RecoveryService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger('Recovery');
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;

  /** koliko puta je ova instanca postavila platno (za testove) */
  recoveries = 0;

  constructor(
    private readonly redis: RedisService,
    private readonly lua: LuaScriptsService,
    private readonly gateway: CanvasGateway,
    private readonly snapshots: SnapshotsService,
    private readonly moves: MovesReaderService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    void this.check();
    this.timer = setInterval(() => void this.check(), CHECK_EVERY_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** jedna provera; ne preklapa se sa prethodnom, a greška se samo loguje (sledeći tik ponavlja) */
  check(): Promise<void> {
    this.running ??= this.ensureReady()
      .catch((err: Error) =>
        this.logger.error(`oporavak nije uspeo: ${err.message}`),
      )
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }

  /** čeka završetak provere koja je u toku (za testove) */
  async settled(): Promise<void> {
    await this.running;
  }

  /** ako platno nije spremno, preuzima lock i vraća ga; ko ne dobije lock ne radi ništa */
  async ensureReady(): Promise<void> {
    if (await this.isReady()) return;

    const token = randomUUID();
    // lock: samo jedna instanca vraća platno, ističe sam posle 10 min
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
    const started = Date.now();
    const { width, height, cooldownMs } = this.config.canvas;
    await this.setStatus('recovering');

    const { data, version, source } = await this.restore();

    // prvo podaci i verzija u jednoj transakciji, status ready tek na kraju: dok status nije
    // ready place_pixel vraća ERR_NOT_READY, a GET /api/canvas 503
    await this.redis.client
      .multi()
      .set(RedisKeys.canvasMain(), data)
      .set(RedisKeys.canvasVersion(), String(version))
      .hset(RedisKeys.configCanvas(), {
        width,
        height,
        cooldown_ms: cooldownMs,
      })
      .exec();
    await this.setStatus('ready');

    this.recoveries++;
    this.logger.log(
      `platno spremno (${width}x${height}, verzija ${version}, ${source}) za ${Date.now() - started} ms`,
    );
  }

  /** snapshot + replay poteza, ili prazno platno uz snapshot #0 kad nema upotrebljivog snapshot-a */
  private async restore(): Promise<{
    data: Buffer;
    version: number;
    source: string;
  }> {
    const { width, height } = this.config.canvas;

    // najnoviji snapshot prvi; snapshot druge veličine ili neupotrebljiv se preskače
    for (const meta of await this.snapshots.list()) {
      if (meta.width !== width || meta.height !== height) {
        this.logger.warn(
          `preskačem snapshot ${meta.width}x${meta.height}, konfiguracija je ${width}x${height}`,
        );
        continue;
      }
      const data = await this.snapshots.loadData(meta);
      if (!data) {
        this.logger.warn(
          `preskačem neupotrebljiv snapshot v${meta.canvasVersion}`,
        );
        continue;
      }
      const applied = await this.replay(data, meta);
      return {
        data,
        version: meta.canvasVersion + applied,
        source: `snapshot v${meta.canvasVersion} + ${applied} poteza iz replay-a`,
      };
    }

    // nema upotrebljivog snapshot-a: prazno platno i odmah snapshot #0 (osnova za sledeći oporavak)
    const data = Buffer.alloc(width * height);
    const meta = await this.snapshots.save({
      data,
      version: 0,
      lastStreamId: '0-0',
      width,
      height,
    });
    const applied = await this.replay(data, meta);
    return {
      data,
      version: applied,
      source: `prazno platno + snapshot #0 + ${applied} poteza iz replay-a`,
    };
  }

  /**
   * replay poteza posle snapshot-a. ID poruke je (ms, seq), a moves_by_time je klasterovan po
   * (placed_at, seq), pa je "posle snapshot-a" tačno (placed_at, seq) > (ms, seq): nijedan
   * potez nije izgubljen ni primenjen dvaput, ni kad više poteza ima isti ms.
   * za '0-0' (snapshot #0) kreće se od početka bucket-a u kom je taken_at.
   */
  private async replay(data: Buffer, meta: SnapshotMeta): Promise<number> {
    const { width, height } = this.config.canvas;
    let applied = 0;
    for await (const page of this.moves.read(this.cursorFor(meta))) {
      for (const m of page) {
        if (m.x < 0 || m.y < 0 || m.x >= width || m.y >= height) continue;
        data[m.y * width + m.x] = m.color;
        applied++;
      }
    }
    return applied;
  }

  private cursorFor(meta: SnapshotMeta): MovesCursor {
    const m = /^(\d+)-(\d+)$/.exec(meta.lastStreamId);
    if (!m || meta.lastStreamId === '0-0') {
      const hourStart = Math.floor(meta.takenAt.getTime() / HOUR_MS) * HOUR_MS;
      return { placedAt: new Date(hourStart), seq: -1 };
    }
    return { placedAt: new Date(Number(m[1])), seq: Number(m[2]) };
  }

  private async setStatus(status: CanvasStatus): Promise<void> {
    // status platna; klijenti ga dobijaju preko gateway-a
    await this.redis.client.set(RedisKeys.canvasStatus(), status);
    this.gateway.emitStatus(status);
  }
}
