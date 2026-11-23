import { Injectable, Logger } from '@nestjs/common';
import { types } from 'cassandra-driver';
import { CassandraService } from '../cassandra/cassandra.service';

const SCOPE = 'main';

/** metapodaci snapshot-a (bez bajtova platna) */
export interface SnapshotMeta {
  snapshotId: string;
  takenAt: Date;
  canvasVersion: number;
  /** ID poslednje poruke u streamu obuhvaćene snapshot-om; odatle kreće replay poteza */
  lastStreamId: string;
  width: number;
  height: number;
}

/** snapshot-ovi platna: jedan red po snapshot-u, platno je jedan blob */
@Injectable()
export class SnapshotsService {
  private readonly logger = new Logger('Snapshots');

  constructor(private readonly db: CassandraService) {}

  /** upis jednog reda je atomičan, pa nema delimičnih snapshot-ova */
  async save(input: {
    data: Buffer;
    version: number;
    lastStreamId: string;
    width: number;
    height: number;
  }): Promise<SnapshotMeta> {
    const snapshotId = types.Uuid.random();
    const takenAt = new Date();
    // novi snapshot platna (ceo blob u jednom redu)
    await this.db.execute(
      `INSERT INTO canvas_snapshots
         (scope, taken_at, snapshot_id, canvas_version, last_stream_id, width, height, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        SCOPE,
        takenAt,
        snapshotId,
        types.Long.fromNumber(input.version),
        input.lastStreamId,
        input.width,
        input.height,
        input.data,
      ],
    );
    return {
      snapshotId: snapshotId.toString(),
      takenAt,
      canvasVersion: input.version,
      lastStreamId: input.lastStreamId,
      width: input.width,
      height: input.height,
    };
  }

  /** metapodaci svih snapshot-ova, najnoviji prvi (clustering taken_at DESC) */
  async list(limit?: number): Promise<SnapshotMeta[]> {
    // bez bajtova platna, samo metapodaci
    const res = await this.db.execute(
      `SELECT taken_at, snapshot_id, canvas_version, last_stream_id, width, height
         FROM canvas_snapshots WHERE scope = ?${limit ? ` LIMIT ${Number(limit)}` : ''}`,
      [SCOPE],
    );
    return res.rows.map(toMeta);
  }

  async latest(): Promise<SnapshotMeta | null> {
    return (await this.list(1))[0] ?? null;
  }

  /** najnoviji snapshot napravljen pre ili u trenutku `at` */
  async latestBefore(at: Date): Promise<SnapshotMeta | null> {
    // clustering je taken_at DESC, pa je prvi red sa taken_at <= at najnoviji
    const res = await this.db.execute(
      `SELECT taken_at, snapshot_id, canvas_version, last_stream_id, width, height
         FROM canvas_snapshots WHERE scope = ? AND taken_at <= ? LIMIT 1`,
      [SCOPE, at],
    );
    const row = res.first();
    return row ? toMeta(row) : null;
  }

  /** bajtovi platna jednog snapshot-a; null ako red više ne postoji ili je prazan */
  async loadData(meta: SnapshotMeta): Promise<Buffer | null> {
    const res = await this.db.execute(
      'SELECT data FROM canvas_snapshots WHERE scope = ? AND taken_at = ?',
      [SCOPE, meta.takenAt],
    );
    const data = res.first()?.['data'] as Buffer | null | undefined;
    if (!data || data.length !== meta.width * meta.height) return null;
    return data;
  }

  /** čuva poslednjih `keep` snapshot-ova, stariji se brišu */
  async prune(keep: number): Promise<number> {
    const old = (await this.list()).slice(keep);
    for (const s of old) {
      // briše stariji snapshot
      await this.db.execute(
        'DELETE FROM canvas_snapshots WHERE scope = ? AND taken_at = ?',
        [SCOPE, s.takenAt],
      );
    }
    if (old.length > 0)
      this.logger.log(`obrisano ${old.length} starih snapshot-ova`);
    return old.length;
  }
}

function toMeta(r: types.Row): SnapshotMeta {
  return {
    takenAt: r['taken_at'] as Date,
    snapshotId: (r['snapshot_id'] as types.Uuid).toString(),
    canvasVersion: (r['canvas_version'] as types.Long).toNumber(),
    lastStreamId: r['last_stream_id'] as string,
    width: r['width'] as number,
    height: r['height'] as number,
  };
}
