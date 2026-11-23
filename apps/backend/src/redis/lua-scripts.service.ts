import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RedisService } from './redis.service';

export const DEFAULT_LUA_DIR = join(__dirname, 'lua');

const KEYS_HEADER = /^--\s*numberOfKeys:\s*(\d+)\s*$/;

/**
 * učitava sve `*.lua` fajlove iz direktorijuma i registruje ih preko `defineCommand`.
 * ime komande = ime fajla bez ekstenzije; prvi red fajla je `-- numberOfKeys: N`.
 * ioredis sam koristi EVALSHA sa povratkom na EVAL kad skripta nije u kešu (NOSCRIPT).
 */
@Injectable()
export class LuaScriptsService implements OnModuleInit {
  private readonly logger = new Logger('Lua');
  private readonly loaded = new Set<string>();

  constructor(private readonly redis: RedisService) {}

  async onModuleInit(): Promise<void> {
    await this.load(DEFAULT_LUA_DIR);
  }

  /** vraća imena registrovanih komandi; nepostojeći direktorijum znači da nema skripti */
  async load(dir: string): Promise<string[]> {
    let files: string[];
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith('.lua')).sort();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }

    const names: string[] = [];
    for (const file of files) {
      const name = file.slice(0, -'.lua'.length);
      const lua = await readFile(join(dir, file), 'utf8');
      const firstLine = lua.split(/\r?\n/, 1)[0] ?? '';
      const match = KEYS_HEADER.exec(firstLine.trim());
      if (!match) {
        throw new Error(
          `Lua skripta ${file}: prvi red mora biti "-- numberOfKeys: N"`,
        );
      }
      this.redis.client.defineCommand(name, {
        numberOfKeys: Number(match[1]),
        lua,
      });
      this.loaded.add(name);
      names.push(name);
    }
    if (names.length > 0) {
      this.logger.log(`registrovane skripte: ${names.join(', ')}`);
    }
    return names;
  }

  /** poziva registrovanu skriptu: `run('place_pixel', [key1, key2], [arg1, ...])` */
  run(
    name: string,
    keys: string[],
    args: (string | number)[] = [],
  ): Promise<unknown> {
    if (!this.loaded.has(name)) {
      throw new Error(`Lua skripta "${name}" nije registrovana`);
    }
    const client = this.redis.client as unknown as Record<
      string,
      (...a: (string | number)[]) => Promise<unknown>
    >;
    return client[name](...keys, ...args);
  }
}
