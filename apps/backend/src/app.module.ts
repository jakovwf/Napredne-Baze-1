import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { RedisModule } from './redis/redis.module';
import { CassandraModule } from './cassandra/cassandra.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';

/** modul za APP_ROLE=api */
@Module({
  imports: [
    ConfigModule,
    RedisModule,
    CassandraModule,
    HealthModule,
    AuthModule,
  ],
})
export class AppModule {}
