import { Module } from '@nestjs/common';
import { CassandraModule } from '../cassandra/cassandra.module';
import { ConfigModule } from '../config/config.module';
import { RedisModule } from '../redis/redis.module';
import { SnapshotModule } from '../snapshot/snapshot.module';
import { MoveWriter } from './persister/move-writer';
import { PersisterService } from './persister/persister.service';
import { SnapshotterService } from './snapshotter.service';

/** modul za APP_ROLE=worker */
@Module({
  imports: [ConfigModule, RedisModule, CassandraModule, SnapshotModule],
  providers: [PersisterService, MoveWriter, SnapshotterService],
})
export class WorkerModule {}
