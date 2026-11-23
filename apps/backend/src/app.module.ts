import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';

/** modul za APP_ROLE=api */
@Module({
  imports: [ConfigModule],
})
export class AppModule {}
