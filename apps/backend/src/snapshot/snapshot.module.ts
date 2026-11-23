import { Module } from '@nestjs/common';
import { MovesReaderService } from './moves-reader.service';
import { SnapshotsService } from './snapshots.service';

/** pristup snapshot-ovima i istoriji poteza u Cassandri (koriste ga worker i oporavak platna) */
@Module({
  providers: [SnapshotsService, MovesReaderService],
  exports: [SnapshotsService, MovesReaderService],
})
export class SnapshotModule {}
