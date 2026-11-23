import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { PALETTE } from '@pixelboard/shared';
import type { Redis } from 'ioredis';
import { hostname } from 'node:os';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { RedisKeys } from '../../redis/keys';
import { RedisService } from '../../redis/redis.service';
import { InvalidMoveError, Move, parseMove } from './move-record';
import { MoveWriter, Statement, counterStatements } from './move-writer';
import {
  parsePendingSummary,
  parseXinfoGroups,
  safeTrimId,
} from './stream-info';

export const PERSISTER_GROUP = 'persisters';

/** [id, [polje, vrednost, ...]] */
export type StreamEntry = [string, string[]];

const CLAIM_INTERVAL_MS = 30_000;
const TRIM_INTERVAL_MS = 10_000;
const RETRY_PAUSE_MS = 1_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * prebacuje poteze iz Redis Stream-a (stream:moves) u Cassandru.
 * poruka se potvrđuje (XACK) tek posle uspešnog upisa, pa pad u bilo kom trenutku pre toga
 * ostavlja poruku pending i ona se ponovo obrađuje. činjenice su idempotentne (ključ iz ID-a
 * poruke), a brojači nisu (aproksimacija).
 */
@Injectable()
export class PersisterService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger('Persister');
  private readonly limits: { width: number; height: number; colors: number };

  consumer = `worker-${hostname()}-${process.pid}`;

  private blocking?: Redis;
  private loop?: Promise<void>;
  private claimTimer?: NodeJS.Timeout;
  private stopping = false;
  private lastTrim = 0;
  /** obrada je serijalizovana: glavna petlja i XAUTOCLAIM se ne preklapaju */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly redis: RedisService,
    private readonly writer: MoveWriter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.limits = {
      width: config.canvas.width,
      height: config.canvas.height,
      colors: PALETTE.length,
    };
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.appRole === 'worker') await this.start();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.loop) await this.stop();
  }

  async start(): Promise<void> {
    this.stopping = false;
    await this.ensureGroup();
    // poseban konekcija: XREADGROUP BLOCK zaključava konekciju dok čeka poruke
    this.blocking = this.redis.duplicate('persister-read', {
      maxRetriesPerRequest: null,
    });
    this.loop = this.runLoop();
    this.claimTimer = setInterval(() => {
      this.claimOnce().catch((e: Error) =>
        this.logger.warn(`preuzimanje nije uspelo: ${e.message}`),
      );
    }, CLAIM_INTERVAL_MS);
    this.logger.log(`pokrenut kao ${this.consumer}`);
  }

  /** tekući batch se dovrši (upis i potvrda), pa se konekcija zatvori */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.claimTimer) clearInterval(this.claimTimer);
    await this.loop; // petlja izlazi najkasnije posle jednog BLOCK intervala
    await this.chain;
    this.blocking?.disconnect();
    this.blocking = undefined;
    this.loop = undefined;
  }

  /**
   * grupa se pravi od ID-a 0 (ne $), da poruke dodate pre kreiranja grupe ne propadnu;
   * MKSTREAM pravi stream ako ne postoji, a BUSYGROUP znači da grupa već postoji
   */
  async ensureGroup(): Promise<void> {
    try {
      // pravi consumer grupu nad streamom poteza
      await this.redis.client.xgroup(
        'CREATE',
        RedisKeys.streamMoves(),
        PERSISTER_GROUP,
        '0',
        'MKSTREAM',
      );
    } catch (err) {
      if (!(err as Error).message.includes('BUSYGROUP')) throw err;
    }
  }

  private async runLoop(): Promise<void> {
    while (!this.stopping) {
      try {
        // čita nove poruke za ovog consumer-a (samo ">" = još neisporučene)
        const res = (await this.blocking!.call(
          'XREADGROUP',
          'GROUP',
          PERSISTER_GROUP,
          this.consumer,
          'COUNT',
          this.config.persister.batchSize,
          'BLOCK',
          this.config.persister.blockMs,
          'STREAMS',
          RedisKeys.streamMoves(),
          '>',
        )) as [string, StreamEntry[]][] | null;
        if (res?.[0]?.[1]?.length) await this.processEntries(res[0][1]);
      } catch (err) {
        if (this.stopping) break;
        const msg = (err as Error).message;
        this.logger.error(`greška u petlji: ${msg}`);
        // Redis je obrisan pa su nestali i stream i grupa: napravi grupu i nastavi
        if (msg.includes('NOGROUP')) {
          await this.ensureGroup().catch((e: Error) =>
            this.logger.error(`pravljenje grupe nije uspelo: ${e.message}`),
          );
        }
        await sleep(RETRY_PAUSE_MS);
      }
    }
  }

  /** obrada jednog batch-a, serijalizovano */
  processEntries(entries: StreamEntry[]): Promise<void> {
    const run = this.chain.then(() => this.processBatch(entries));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async processBatch(entries: StreamEntry[]): Promise<void> {
    const moves: Move[] = [];
    for (const [id, fields] of entries) {
      try {
        moves.push(parseMove(id, fields, this.limits));
      } catch (err) {
        if (!(err instanceof InvalidMoveError)) throw err;
        // neispravna poruka se loguje i potvrđuje, da ne blokira ostale
        this.logger.warn(`odbačena poruka ${id}: ${err.message}`);
      }
    }

    // prvo činjenice (idempotentne), pa brojači; greška znači bez XACK-a i ponavljanje
    // posle kratke pauze (poruke ostaju pending)
    if (moves.length > 0) {
      let factsDone = false;
      let counters: Statement[] | null = null;
      for (let attempt = 1; ; attempt++) {
        try {
          if (!factsDone) {
            await this.writer.writeFacts(moves);
            factsDone = true;
          }
          counters ??= counterStatements(moves);
          counters = await this.writer.applyCounters(counters);
          if (counters.length > 0) {
            throw new Error(`${counters.length} brojača nije upisano`);
          }
          break;
        } catch (err) {
          this.logger.error(
            `batch od ${moves.length} poteza nije upisan (pokušaj ${attempt}): ${(err as Error).message}`,
          );
          if (this.stopping) return; // ostaje pending, preuzima ga sledeći start
          await sleep(RETRY_PAUSE_MS);
        }
      }
    }

    await this.ack(entries.map(([id]) => id));
    await this.trimIfDue();
  }

  /** XACK uz ponavljanje: bez potvrde poruka bi se ponovo obrađivala */
  private async ack(ids: string[]): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        // potvrđuje obrađene poruke, pa više nisu pending
        await this.redis.client.xack(
          RedisKeys.streamMoves(),
          PERSISTER_GROUP,
          ...ids,
        );
        return;
      } catch (err) {
        this.logger.error(`XACK nije uspeo: ${(err as Error).message}`);
        if (this.stopping && attempt >= 3) throw err;
        await sleep(RETRY_PAUSE_MS);
      }
    }
  }

  /**
   * preuzima poruke consumer-a koji je pao (pending duže od PERSISTER_CLAIM_IDLE_MS) i obrađuje
   * ih istom putanjom kao nove; vraća broj preuzetih poruka
   */
  async claimOnce(): Promise<number> {
    let cursor = '0-0';
    let total = 0;
    do {
      let res: [string, (StreamEntry | null)[], string[]?];
      try {
        // XAUTOCLAIM: dodeljuje ovom consumer-u poruke koje predugo stoje nepotvrđene
        res = (await this.redis.client.call(
          'XAUTOCLAIM',
          RedisKeys.streamMoves(),
          PERSISTER_GROUP,
          this.consumer,
          this.config.persister.claimIdleMs,
          cursor,
          'COUNT',
          this.config.persister.batchSize,
        )) as [string, (StreamEntry | null)[], string[]?];
      } catch (err) {
        if (!(err as Error).message.includes('NOGROUP')) throw err;
        await this.ensureGroup();
        return total;
      }
      cursor = res[0];
      const entries = res[1].filter((e): e is StreamEntry => !!e);
      if (entries.length > 0) {
        this.logger.warn(`preuzeto ${entries.length} nepotvrđenih poruka`);
        await this.processEntries(entries);
        total += entries.length;
      }
    } while (cursor !== '0-0' && !this.stopping);
    return total;
  }

  private async trimIfDue(): Promise<void> {
    if (Date.now() - this.lastTrim < TRIM_INTERVAL_MS) return;
    this.lastTrim = Date.now();
    try {
      await this.trim();
    } catch (err) {
      this.logger.warn(`trimovanje nije uspelo: ${(err as Error).message}`);
    }
  }

  /**
   * XTRIM MINID do najstarijeg pending ID-a (ili last-delivered-id ako nema pending poruka).
   * nikad MAXLEN: briše najstarije poruke bez obzira da li su upisane u Cassandru.
   * `exact` (bez `~`) koriste testovi, a rad koristi približno trimovanje (jeftinije).
   */
  async trim(exact = false): Promise<number> {
    const key = RedisKeys.streamMoves();
    // sažetak nepotvrđenih poruka grupe (broj i najstariji ID)
    const pending = parsePendingSummary(
      await this.redis.client.call('XPENDING', key, PERSISTER_GROUP),
    );
    // last-delivered-id grupe
    const groups = parseXinfoGroups(
      await this.redis.client.call('XINFO', 'GROUPS', key),
    );
    const minId = safeTrimId(
      pending,
      groups.find((g) => g.name === PERSISTER_GROUP),
    );
    if (!minId) return 0;
    // briše poruke starije od bezbednog ID-a
    return Number(
      await this.redis.client.call(
        'XTRIM',
        key,
        'MINID',
        ...(exact ? [] : ['~']),
        minId,
      ),
    );
  }
}
