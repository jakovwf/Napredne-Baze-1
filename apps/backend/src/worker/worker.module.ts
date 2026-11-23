import { Module } from '@nestjs/common';
import { CassandraModule } from '../cassandra/cassandra.module';
import { ConfigModule } from '../config/config.module';
import { RedisModule } from '../redis/redis.module';
import { MoveWriter } from './persister/move-writer';
import { PersisterService } from './persister/persister.service';

/** modul za APP_ROLE=worker */
@Module({
  imports: [ConfigModule, RedisModule, CassandraModule],
  providers: [PersisterService, MoveWriter],
})
export class WorkerModule {}
