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
