import { randomInt, randomUUID } from 'node:crypto';
import type { StreamEntry } from '../../src/worker/persister/persister.service';

/** nasumičan istorijski sat (2001–2010, UTC): svaki test dobija svoju particiju i dan */
export function randomHourBase(): number {
  return Date.UTC(
    randomInt(2001, 2011),
    randomInt(0, 12),
    randomInt(1, 28),
    randomInt(0, 24),
    0,
    0,
    0,
  );
}

export interface SeedMove {
  id: string;
  uid: string;
  username: string;
  x: number;
  y: number;
  c: number;
}

export function makeSeed(
  n: number,
  opts: {
    base?: number;
    users?: string[];
    pixel?: (i: number) => [number, number];
  } = {},
): SeedMove[] {
  const base = opts.base ?? randomHourBase();
  const users = opts.users ?? [randomUUID()];
  return Array.from({ length: n }, (_, i) => {
    const [x, y] = opts.pixel ? opts.pixel(i) : [i % 7, i % 5];
    return {
      id: `${base + i}-0`,
      uid: users[i % users.length],
      username: `u${i % users.length}`,
      x,
      y,
      c: (i * 3) % 32,
    };
  });
}

export const toFields = (m: SeedMove): string[] => [
  'uid',
  m.uid,
  'u',
  m.username,
  'x',
  String(m.x),
  'y',
  String(m.y),
  'c',
  String(m.c),
];

export const toEntries = (seed: SeedMove[]): StreamEntry[] =>
  seed.map((m) => [m.id, toFields(m)]);

/** 'YYYYMMDDHH' (UTC) za prvi potez u seed-u */
export const bucketOf = (seed: SeedMove[]): string =>
  new Date(Number(seed[0].id.split('-')[0]))
    .toISOString()
    .slice(0, 13)
    .replace(/[-T]/g, '');

export async function waitFor(
  cond: () => Promise<boolean>,
  timeoutMs = 20_000,
  stepMs = 50,
): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  throw new Error(`waitFor: uslov nije ispunjen u ${timeoutMs} ms`);
}
