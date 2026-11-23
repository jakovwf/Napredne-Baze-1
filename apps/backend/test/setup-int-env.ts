// okruženje za integracione testove; vrednosti iz okruženja imaju prednost
const defaults: Record<string, string> = {
  APP_ROLE: 'api',
  // redis db 1 i poseban keyspace, da testovi ne diraju razvojne podatke (db 0, keyspace pixelboard)
  REDIS_URL: process.env.INT_REDIS_URL ?? 'redis://localhost:6379/1',
  CASSANDRA_CONTACT_POINTS: 'localhost',
  CASSANDRA_DC: 'datacenter1',
  CASSANDRA_KEYSPACE: process.env.INT_CASSANDRA_KEYSPACE ?? 'pixelboard_test',
  ADMIN_USERNAME: 'admin',
  ADMIN_PASSWORD: 'change-me',
  // malo platno
  CANVAS_WIDTH: '64',
  CANVAS_HEIGHT: '32',
  COOLDOWN_MS: '5000',
  // persister: kratak BLOCK (brz stop) i claim idle 0 (XAUTOCLAIM odmah preuzima pending)
  PERSISTER_BLOCK_MS: '200',
  PERSISTER_CLAIM_IDLE_MS: '0',
  SNAPSHOT_KEEP: '3',
};
for (const [key, value] of Object.entries(defaults)) {
  process.env[key] ??= value;
}
// test uvek ide na test bazu, bez obzira na ostatak okruženja
process.env.REDIS_URL = defaults.REDIS_URL;
process.env.CASSANDRA_KEYSPACE = defaults.CASSANDRA_KEYSPACE;
