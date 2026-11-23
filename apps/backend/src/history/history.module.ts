import { Module } from '@nestjs/common';
import { PixelsController } from './pixels.controller';

/** čitanje istorije iz Cassandre (samo api) */
@Module({
  controllers: [PixelsController],
})
export class HistoryModule {}
