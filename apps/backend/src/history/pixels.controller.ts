import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Param,
  Query,
} from '@nestjs/common';
import { types } from 'cassandra-driver';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { CassandraService } from '../cassandra/cassandra.service';
import { APP_CONFIG, type AppConfig } from '../config/config';

export class PixelParams {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  x!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  y!: number;
}

export class HistoryQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-f]{1,4096}$/i, { message: 'pageState nije ispravan' })
  pageState?: string;
}

export interface PixelHistoryItem {
  username: string;
  color: number;
  placedAt: string;
}

@Controller('pixels')
export class PixelsController {
  constructor(
    private readonly db: CassandraService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** istorija jednog piksela: jedna particija (x, y), najnovije prvo, uz paging */
  @Get(':x/:y/history')
  async history(
    @Param() { x, y }: PixelParams,
    @Query() { limit = 20, pageState }: HistoryQuery,
  ): Promise<{ items: PixelHistoryItem[]; nextPageState: string | null }> {
    const { width, height } = this.config.canvas;
    if (x >= width || y >= height) {
      throw new BadRequestException('Koordinate su van platna');
    }
    let res: types.ResultSet;
    try {
      // čita jednu stranicu iz particije piksela; pageState nastavlja od prethodne stranice
      res = await this.db.client.execute(
        'SELECT username, color, placed_at FROM pixel_history WHERE x = ? AND y = ?',
        [x, y],
        { prepare: true, fetchSize: limit, pageState },
      );
    } catch (err) {
      // neispravan pageState drajver prijavljuje kao običnu grešku
      if (pageState) throw new BadRequestException('pageState nije ispravan');
      throw err;
    }
    return {
      items: res.rows.map((r) => ({
        username: r['username'] as string,
        color: r['color'] as number,
        placedAt: (r['placed_at'] as Date).toISOString(),
      })),
      nextPageState: res.pageState ?? null,
    };
  }
}
