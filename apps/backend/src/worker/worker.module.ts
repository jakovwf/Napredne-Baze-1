import { Module } from '@nestjs/common';
import { CassandraModule } from '../cassandra/cassandra.module';
import { ConfigModule } from '../config/config.module';
import { RedisModule } from '../redis/redis.module';

/** modul za APP_ROLE=worker */
@Module({
  imports: [ConfigModule, RedisModule, CassandraModule],
})
export class WorkerModule {}
