export const APP_ROLES = ['api', 'worker'] as const;
export type AppRole = (typeof APP_ROLES)[number];

/** token za injektovanje tipizirane konfiguracije */
export const APP_CONFIG = Symbol('APP_CONFIG');

export interface AppConfig {
  nodeEnv: 'development' | 'production' | 'test';
  appRole: AppRole;
  port: number;
  redisUrl: string;
  cassandra: {
    contactPoints: string[];
    localDataCenter: string;
    keyspace: string;
  };
  canvas: { width: number; height: number; cooldownMs: number };
  sessionTtlDays: number;
  persister: { batchSize: number; blockMs: number; claimIdleMs: number };
  snapshot: { minMoves: number; intervalMs: number; keep: number };
  cookieSecure: boolean;
  admin: { username: string; password: string };
}

type Env = Record<string, string | undefined>;

/** čita i proverava okruženje; sve greške se skupljaju u jednu poruku */
export function loadConfig(env: Env): AppConfig {
  const errors: string[] = [];

  const text = (key: string): string => {
    const value = env[key]?.trim();
    if (!value) errors.push(`${key} je obavezna promenljiva`);
    return value ?? '';
  };

  const int = (key: string, fallback: number, min: number): number => {
    const raw = env[key]?.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min) {
      errors.push(`${key} mora biti ceo broj >= ${min} (dobijeno: "${raw}")`);
      return fallback;
    }
    return value;
  };

  const bool = (key: string, fallback: boolean): boolean => {
    const raw = env[key]?.trim().toLowerCase();
    if (!raw) return fallback;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    errors.push(`${key} mora biti true ili false (dobijeno: "${raw}")`);
    return fallback;
  };

  const nodeEnvRaw = env.NODE_ENV?.trim() || 'development';
  if (!['development', 'production', 'test'].includes(nodeEnvRaw)) {
    errors.push(
      `NODE_ENV mora biti development, production ili test (dobijeno: "${nodeEnvRaw}")`,
    );
  }
  const nodeEnv = nodeEnvRaw as AppConfig['nodeEnv'];

  const appRoleRaw = env.APP_ROLE?.trim();
  if (!appRoleRaw || !(APP_ROLES as readonly string[]).includes(appRoleRaw)) {
    errors.push(
      `APP_ROLE mora biti jedan od: ${APP_ROLES.join(' | ')} (dobijeno: ${appRoleRaw ? `"${appRoleRaw}"` : 'nije postavljeno'})`,
    );
  }

  const redisUrl = text('REDIS_URL');
  if (redisUrl && !/^rediss?:\/\//.test(redisUrl)) {
    errors.push('REDIS_URL mora početi sa redis:// ili rediss://');
  }

  const keyspace = text('CASSANDRA_KEYSPACE');
  if (keyspace && !/^[a-z][a-z0-9_]*$/.test(keyspace)) {
    errors.push('CASSANDRA_KEYSPACE sme da sadrži samo mala slova, cifre i _');
  }

  const adminPassword = text('ADMIN_PASSWORD');
  if (nodeEnv === 'production' && adminPassword === 'change-me') {
    errors.push(
      'ADMIN_PASSWORD ne sme biti "change-me" u produkciji, postavi pravu lozinku u .env',
    );
  }

  const config: AppConfig = {
    nodeEnv,
    appRole: appRoleRaw as AppRole,
    port: int('PORT', 3000, 1),
    redisUrl,
    cassandra: {
      contactPoints: text('CASSANDRA_CONTACT_POINTS')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      localDataCenter: text('CASSANDRA_DC'),
      keyspace,
    },
    canvas: {
      width: int('CANVAS_WIDTH', 300, 1),
      height: int('CANVAS_HEIGHT', 300, 1),
      cooldownMs: int('COOLDOWN_MS', 5000, 0),
    },
    sessionTtlDays: int('SESSION_TTL_DAYS', 7, 1),
    persister: {
      batchSize: int('PERSISTER_BATCH_SIZE', 500, 1),
      blockMs: int('PERSISTER_BLOCK_MS', 2000, 0),
      claimIdleMs: int('PERSISTER_CLAIM_IDLE_MS', 30000, 0),
    },
    snapshot: {
      minMoves: int('SNAPSHOT_MIN_MOVES', 10000, 1),
      intervalMs: int('SNAPSHOT_INTERVAL_MS', 300000, 1000),
      keep: int('SNAPSHOT_KEEP', 12, 1),
    },
    cookieSecure: bool('COOKIE_SECURE', false),
    admin: { username: text('ADMIN_USERNAME'), password: adminPassword },
  };

  if (errors.length > 0) {
    throw new Error(
      `Nevalidna konfiguracija:\n${errors.map((e) => `  - ${e}`).join('\n')}`,
    );
  }
  return config;
}
