-- pixelboard: cassandra šema (idempotentno, može se primeniti više puta)
-- princip: jedna tabela po upitu, bez allow filtering-a

CREATE KEYSPACE IF NOT EXISTS pixelboard
  WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};

USE pixelboard;

-- q1: registracija sa jedinstvenim username-om (insert ... if not exists), login po username-u
CREATE TABLE IF NOT EXISTS users_by_username (
  username_lower text PRIMARY KEY,
  user_id        uuid,
  username       text,        -- originalno pisanje za prikaz
  password_hash  text,        -- argon2id
  role           text,        -- 'user' | 'admin'
  created_at     timestamp
);

-- q2: istorija jednog piksela (ko, kada, kojom bojom), najnovije prvo
CREATE TABLE IF NOT EXISTS pixel_history (
  x         smallint,
  y         smallint,
  placed_at timestamp,
  seq       int,
  user_id   uuid,
  username  text,
  color     tinyint,
  PRIMARY KEY ((x, y), placed_at, seq)
) WITH CLUSTERING ORDER BY (placed_at DESC, seq DESC);

-- q3: svi potezi hronološki, po satnim bucket-ima (replay i oporavak)
CREATE TABLE IF NOT EXISTS moves_by_time (
  bucket    text,             -- 'YYYYMMDDHH' (utc)
  placed_at timestamp,
  seq       int,
  x         smallint,
  y         smallint,
  color     tinyint,
  user_id   uuid,
  PRIMARY KEY ((bucket), placed_at, seq)
) WITH CLUSTERING ORDER BY (placed_at ASC, seq ASC);

-- q4: heatmap (ćelije 10x10 → mreža 30x30)
CREATE TABLE IF NOT EXISTS heatmap_total (
  grid   text,                -- '10x10'
  cell_x smallint,
  cell_y smallint,
  moves  counter,
  PRIMARY KEY ((grid), cell_x, cell_y)
);

-- q5: aktivnost po satu u danu
CREATE TABLE IF NOT EXISTS activity_by_hour (
  day   date,
  hour  tinyint,
  moves counter,
  PRIMARY KEY ((day), hour)
);

-- q6: upotreba boja po danu
CREATE TABLE IF NOT EXISTS color_usage_daily (
  day   date,
  color tinyint,
  uses  counter,
  PRIMARY KEY ((day), color)
);

-- q7: istorija zaključanih zona, po mesecu
CREATE TABLE IF NOT EXISTS zone_locks_by_month (
  month       text,           -- 'YYYYMM'
  created_at  timestamp,
  lock_id     uuid,
  x1 smallint, y1 smallint, x2 smallint, y2 smallint,
  owner_id    uuid,
  owner_name  text,
  owner_type  text,           -- 'admin' | 'user'
  reason      text,
  expires_at  timestamp,
  released_at timestamp,      -- null dok traje
  released_by text,           -- 'expired' | username admina
  PRIMARY KEY ((month), created_at, lock_id)
) WITH CLUSTERING ORDER BY (created_at DESC, lock_id ASC);

-- q8: aktivne zone, za oporavak Redisa (red se briše na otključavanje ili istek)
CREATE TABLE IF NOT EXISTS zone_locks_active (
  scope      text,            -- 'main'
  lock_id    uuid,
  x1 smallint, y1 smallint, x2 smallint, y2 smallint,
  owner_id   uuid,
  owner_name text,
  owner_type text,
  reason     text,
  expires_at timestamp,
  PRIMARY KEY ((scope), lock_id)
);

-- q9: snapshot-ovi platna (oporavak i početna tačka replay-a)
-- najnoviji pre trenutka t: where scope = 'main' and taken_at <= ? limit 1
CREATE TABLE IF NOT EXISTS canvas_snapshots (
  scope          text,        -- 'main'
  taken_at       timestamp,
  snapshot_id    uuid,
  canvas_version bigint,
  last_stream_id text,
  width          smallint,
  height         smallint,
  data           blob,        -- celo platno, 1 bajt po pikselu (90 KB za 300x300)
  PRIMARY KEY ((scope), taken_at)
) WITH CLUSTERING ORDER BY (taken_at DESC);
