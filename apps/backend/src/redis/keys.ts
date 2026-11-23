/** katalog redis ključeva; ključevi se nigde ne kucaju ručno, samo kroz ovu mapu */
export const RedisKeys = {
  // platno
  canvasMain: (): string => 'canvas:main',
  canvasVersion: (): string => 'canvas:version',
  canvasStatus: (): string => 'canvas:status',
  configCanvas: (): string => 'config:canvas',

  // cooldown
  cooldown: (uid: string): string => `cooldown:${uid}`,

  // sesije i online status
  session: (sid: string): string => `session:${sid}`,
  onlineUsers: (): string => 'online:users',

  // zone
  zonesActive: (): string => 'zones:active',
  zone: (lockId: string): string => `zone:${lockId}`,

  // streamovi i pub/sub
  streamMoves: (): string => 'stream:moves',
  canvasUpdates: (): string => 'canvas:updates', // pub/sub kanal
  chatGlobal: (): string => 'chat:global',

  // distribuirani lock-ovi
  lockRecovery: (): string => 'lock:recovery',
  lockSnapshot: (): string => 'lock:snapshot',
  lockZoneScheduler: (): string => 'lock:zone-scheduler',
} as const;
