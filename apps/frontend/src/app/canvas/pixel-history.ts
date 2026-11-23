import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface PixelHistoryItem {
  username: string;
  color: number;
  placedAt: string;
}

export interface PixelHistoryPage {
  items: PixelHistoryItem[];
  nextPageState: string | null;
}

/** istorija jednog piksela (GET /api/pixels/:x/:y/history) */
@Injectable({ providedIn: 'root' })
export class PixelHistoryService {
  private readonly http = inject(HttpClient);

  load(x: number, y: number, pageState?: string | null, limit = 20): Promise<PixelHistoryPage> {
    let params = new HttpParams().set('limit', limit);
    if (pageState) params = params.set('pageState', pageState);
    return firstValueFrom(
      this.http.get<PixelHistoryPage>(`/api/pixels/${x}/${y}/history`, { params }),
    );
  }
}
