import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { RedisModule } from './redis/redis.module';
import { CassandraModule } from './cassandra/cassandra.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { CanvasModule } from './canvas/canvas.module';
import { HistoryModule } from './history/history.module';

/** modul za APP_ROLE=api */
@Module({
  imports: [
    ConfigModule,
    RedisModule,
    CassandraModule,
    HealthModule,
    AuthModule,
    CanvasModule,
    HistoryModule,
  ],
})
export class AppModule {}
