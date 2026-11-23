import { Injectable } from '@nestjs/common';
import { HEATMAP_GRID } from '@pixelboard/shared';
import { concurrent, types } from 'cassandra-driver';
import { CassandraService } from '../../cassandra/cassandra.service';
import type { Move } from './move-record';

export interface Statement {
  query: string;
  params: unknown[];
}

const CONCURRENCY = 128;

/**
 * činjenice (pixel_history, moves_by_time): primarni ključ sadrži (placed_at, seq) izveden iz
 * ID-a poruke. ponovljena isporuka iste poruke piše u isti red (insert je u Cassandri upsert),
 * pa je ponovni pokušaj bezbedan.
 */
export function factStatements(moves: Move[]): Statement[] {
  const out: Statement[] = [];
  for (const m of moves) {
    out.push(
      {
        query:
          'INSERT INTO pixel_history (x, y, placed_at, seq, user_id, username, color) VALUES (?, ?, ?, ?, ?, ?, ?)',
        params: [m.x, m.y, m.placedAt, m.seq, m.uid, m.username, m.color],
      },
      {
        query:
          'INSERT INTO moves_by_time (bucket, placed_at, seq, x, y, color, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        params: [m.bucket, m.placedAt, m.seq, m.x, m.y, m.color, m.uid],
      },
    );
  }
  return out;
}

/**
 * brojači (counter tabele): `counter = counter + n` nije idempotentno, ponovni pokušaj
 * uvećava dvaput. zato je statistika aproksimacija, a istina su činjenice iznad.
 * pre upisa se agregira u memoriji: jedan upis po ključu umesto po potezu.
 */
export function counterStatements(moves: Move[]): Statement[] {
  const agg = new Map<
    string,
    { query: string; params: unknown[]; n: number }
  >();
  const add = (query: string, keyParams: unknown[]) => {
    const key = `${query}|${keyParams.map((p) => String(p)).join('|')}`;
    const cur = agg.get(key);
    if (cur) cur.n += 1;
    else agg.set(key, { query, params: keyParams, n: 1 });
  };

  for (const m of moves) {
    const day = types.LocalDate.fromString(m.day);
    add(
      'UPDATE heatmap_total SET moves = moves + ? WHERE grid = ? AND cell_x = ? AND cell_y = ?',
      [HEATMAP_GRID, m.cellX, m.cellY],
    );
    add(
      'UPDATE activity_by_hour SET moves = moves + ? WHERE day = ? AND hour = ?',
      [day, m.hour],
    );
    add(
      'UPDATE color_usage_daily SET uses = uses + ? WHERE day = ? AND color = ?',
      [day, m.color],
    );
  }
  // prvi parametar je inkrement (n), ostali su ključ
  return [...agg.values()].map(({ query, params, n }) => ({
    query,
    params: [types.Long.fromNumber(n), ...params],
  }));
}

@Injectable()
export class MoveWriter {
  constructor(private readonly db: CassandraService) {}

  /** baca grešku ako bilo koji upis padne; pozivalac tada ne sme da potvrdi poruke */
  async writeFacts(moves: Move[]): Promise<void> {
    const failed = await this.runAll(factStatements(moves));
    if (failed.length > 0) throw failed[0].error;
  }

  /** primenjuje brojače i vraća samo one koji nisu uspeli, da ponovni pokušaj ne duplira ostale */
  async applyCounters(statements: Statement[]): Promise<Statement[]> {
    const failed = await this.runAll(statements);
    return failed.map((f) => f.statement);
  }

  private async runAll(
    statements: Statement[],
  ): Promise<{ statement: Statement; error: Error }[]> {
    if (statements.length === 0) return [];
    // prepared statement-i, konkurentno (najviše CONCURRENCY upita odjednom);
    // greške se skupljaju umesto da prekinu ostale upise
    const result = await concurrent.executeConcurrent(
      this.db.client,
      statements,
      {
        concurrencyLevel: CONCURRENCY,
        raiseOnFirstError: false,
        collectResults: true,
      },
    );
    // za neuspeo upit je na istom mestu u nizu Error umesto ResultSet-a
    const failed: { statement: Statement; error: Error }[] = [];
    (result.resultItems as unknown[]).forEach((item, i) => {
      if (item instanceof Error) {
        failed.push({ statement: statements[i], error: item });
      }
    });
    return failed;
  }
}
