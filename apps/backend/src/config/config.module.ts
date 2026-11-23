import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { join } from 'node:path';
import { APP_CONFIG, loadConfig } from './config';

/** tipizirana konfiguracija za api i worker; lokalne vrednosti iz apps/backend/.env.local */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      envFilePath: join(__dirname, '..', '..', '.env.local'),
    }),
  ],
  providers: [
    // provera okruženja pri startu; greška se hvata u main.ts
    { provide: APP_CONFIG, useFactory: () => loadConfig(process.env) },
  ],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
