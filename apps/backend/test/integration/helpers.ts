import type { Redis } from 'ioredis';

/** FLUSHDB samo nad test bazom, nikad nad db 0 gde je razvojno platno */
export async function flushTestDb(client: Redis): Promise<void> {
  const db = client.options.db ?? 0;
  if (db === 0) {
    throw new Error(
      'Odbijam FLUSHDB nad Redis db 0, integracioni testovi koriste db različit od 0',
    );
  }
  // briše sve ključeve u test bazi
  await client.flushdb();
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** priprema prazno platno spremno za poteze (dimenzije iz okruženja) */
export async function seedCanvas(client: Redis): Promise<void> {
  const width = Number(process.env.CANVAS_WIDTH);
  const height = Number(process.env.CANVAS_HEIGHT);
  const cooldownMs = Number(process.env.COOLDOWN_MS);
  await client
    .multi()
    // platno: 1 bajt po pikselu, sve bele (0)
    .set('canvas:main', Buffer.alloc(width * height))
    .set('canvas:version', 0)
    .hset('config:canvas', {
      width,
      height,
      cooldown_ms: cooldownMs,
    })
    .set('canvas:status', 'ready')
    .exec();
}
