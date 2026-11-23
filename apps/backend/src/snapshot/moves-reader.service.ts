import { Injectable } from '@nestjs/common';
import { CassandraService } from '../cassandra/cassandra.service';

export interface StoredMove {
  placedAt: Date;
  seq: number;
  x: number;
  y: number;
  color: number;
  userId: string;
}

export interface MovesCursor {
  placedAt: Date;
  /** potezi sa (placed_at, seq) strogo posle ovog para; seq = -1 znači "svi posle placed_at" */
  seq: number;
}

const HOUR_MS = 3_600_000;

export function bucketOf(date: Date): string {
  return date.toISOString().slice(0, 13).replace(/[-T]/g, '');
}

/**
 * hronološki iterator nad moves_by_time. prolazi satne bucket-e od bucket-a kursora do `until`;
 * prvi bucket se čita tuple relacijom na clustering kolonama ((placed_at, seq) > (?, ?)),
 * ostali u celini. svaki upit pogađa tačno jednu particiju.
 */
@Injectable()
export class MovesReaderService {
  constructor(private readonly db: CassandraService) {}

  async *read(
    after: MovesCursor,
    until: Date = new Date(),
    fetchSize = 5000,
  ): AsyncGenerator<StoredMove[]> {
    const startHour = Math.floor(after.placedAt.getTime() / HOUR_MS) * HOUR_MS;
    for (let h = startHour; h <= until.getTime(); h += HOUR_MS) {
      const bucket = bucketOf(new Date(h));
      const first = h === startHour;
      const query = first
        ? 'SELECT placed_at, seq, x, y, color, user_id FROM moves_by_time WHERE bucket = ? AND (placed_at, seq) > (?, ?)'
        : 'SELECT placed_at, seq, x, y, color, user_id FROM moves_by_time WHERE bucket = ?';
      const params = first ? [bucket, after.placedAt, after.seq] : [bucket];

      let pageState: string | undefined;
      do {
        // jedna stranica poteza iz jedne satne particije
        const res = await this.db.client.execute(query, params, {
          prepare: true,
          fetchSize,
          pageState,
        });
        if (res.rows.length > 0) {
          yield res.rows.map((r) => ({
            placedAt: r['placed_at'] as Date,
            seq: r['seq'] as number,
            x: r['x'] as number,
            y: r['y'] as number,
            color: r['color'] as number,
            userId: String(r['user_id']),
          }));
        }
        pageState = res.pageState ?? undefined;
      } while (pageState);
    }
  }
}
