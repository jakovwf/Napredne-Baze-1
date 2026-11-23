import { HEATMAP_CELL_SIZE } from '@pixelboard/shared';

/** potez izveden iz jedne poruke stream:moves */
export interface Move {
  streamId: string;
  /** iz ID-a poruke (<ms>-<seq>); zajedno čine clustering key, osnova idempotentnosti */
  placedAt: Date;
  seq: number;
  uid: string;
  username: string;
  x: number;
  y: number;
  color: number;
  /** 'YYYYMMDDHH' (UTC) */
  bucket: string;
  /** 'YYYY-MM-DD' (UTC) */
  day: string;
  hour: number;
  cellX: number;
  cellY: number;
}

export interface MoveLimits {
  width: number;
  height: number;
  colors: number;
}

export class InvalidMoveError extends Error {}

const STREAM_ID = /^(\d{1,15})-(\d{1,10})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INT = /^\d{1,9}$/;
const INT32_MAX = 2_147_483_647;

/** ID poruke u (placed_at, seq); isti ID uvek daje isti primarni ključ */
export function parseStreamId(id: string): { placedAt: Date; seq: number } {
  const m = STREAM_ID.exec(id);
  if (!m) throw new InvalidMoveError(`neispravan stream ID "${id}"`);
  const seq = Number(m[2]);
  if (seq > INT32_MAX) throw new InvalidMoveError(`seq van opsega: ${seq}`);
  const placedAt = new Date(Number(m[1]));
  if (Number.isNaN(placedAt.getTime())) {
    throw new InvalidMoveError(`neispravan timestamp u ID-u "${id}"`);
  }
  return { placedAt, seq };
}

function fieldMap(fields: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (let i = 0; i + 1 < fields.length; i += 2) {
    map.set(fields[i], fields[i + 1]);
  }
  return map;
}

function intField(map: Map<string, string>, name: string): number {
  const raw = map.get(name);
  if (raw === undefined) {
    throw new InvalidMoveError(`nedostaje polje "${name}"`);
  }
  if (!INT.test(raw)) {
    throw new InvalidMoveError(`polje "${name}" nije ceo broj: "${raw}"`);
  }
  return Number(raw);
}

/** baca InvalidMoveError za poruku koja ne može da se obradi */
export function parseMove(
  streamId: string,
  fields: string[],
  limits: MoveLimits,
): Move {
  const { placedAt, seq } = parseStreamId(streamId);
  const map = fieldMap(fields);

  const uid = map.get('uid');
  if (!uid || !UUID.test(uid)) {
    throw new InvalidMoveError(`neispravan uid "${uid}"`);
  }
  const username = map.get('u');
  if (!username) throw new InvalidMoveError('nedostaje polje "u"');

  const x = intField(map, 'x');
  const y = intField(map, 'y');
  const color = intField(map, 'c');
  if (x >= limits.width || y >= limits.height) {
    throw new InvalidMoveError(`koordinate van platna: (${x},${y})`);
  }
  if (color >= limits.colors) {
    throw new InvalidMoveError(`boja van palete: ${color}`);
  }

  const iso = placedAt.toISOString(); // UTC: 2026-11-23T11:22:33.444Z
  return {
    streamId,
    placedAt,
    seq,
    uid: uid.toLowerCase(),
    username,
    x,
    y,
    color,
    bucket: iso.slice(0, 13).replace(/[-T]/g, ''),
    day: iso.slice(0, 10),
    hour: placedAt.getUTCHours(),
    cellX: Math.floor(x / HEATMAP_CELL_SIZE),
    cellY: Math.floor(y / HEATMAP_CELL_SIZE),
  };
}
