import {
  Controller,
  Get,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';
import { CanvasService } from './canvas.service';

@Controller('canvas')
export class CanvasController {
  constructor(private readonly canvas: CanvasService) {}

  /** puno platno (1 bajt po pikselu) i verzija za konzistentno učitavanje */
  @Get()
  async getCanvas(@Res() res: Response): Promise<void> {
    // dok status nije ready (oporavak) platno u Redisu nije pouzdano: 503 + Retry-After
    const snap =
      (await this.canvas.getStatus()) === 'ready'
        ? await this.canvas.getSnapshot()
        : null;
    if (!snap) {
      res.setHeader('Retry-After', '2');
      throw new ServiceUnavailableException(
        'Platno se oporavlja, pokušajte ponovo',
      );
    }
    res
      .status(200)
      .set({
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Canvas-Version': String(snap.version),
        'X-Canvas-Width': String(snap.width),
        'X-Canvas-Height': String(snap.height),
      })
      .send(snap.data);
  }

  @Get('config')
  getConfig() {
    return this.canvas.getConfig();
  }
}
