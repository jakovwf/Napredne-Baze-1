import { Global, Module } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { APP_CONFIG, loadConfig } from './config';

/** lokalne vrednosti iz apps/backend/.env.local; postojeće promenljive okruženja se ne pregaze */
function loadEnvLocal(): void {
  // testovi koriste sopstveno okruženje
  if (process.env.NODE_ENV === 'test') return;
  const file = join(__dirname, '..', '..', '.env.local');
  if (existsSync(file)) process.loadEnvFile(file);
}

/** tipizirana konfiguracija za api i worker */
@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      // provera okruženja pri startu; greška se hvata u main.ts
      useFactory: () => {
        loadEnvLocal();
        return loadConfig(process.env);
      },
    },
  ],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
