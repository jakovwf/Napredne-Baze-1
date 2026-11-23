import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SnapshotModule } from '../snapshot/snapshot.module';
import { CanvasController } from './canvas.controller';
import { CanvasGateway } from './canvas.gateway';
import { CanvasService } from './canvas.service';
import { RecoveryService } from './recovery.service';

/** samo za APP_ROLE=api */
@Module({
  imports: [AuthModule, SnapshotModule],
  controllers: [CanvasController],
  providers: [CanvasService, CanvasGateway, RecoveryService],
  exports: [CanvasService, RecoveryService],
})
export class CanvasModule {}
