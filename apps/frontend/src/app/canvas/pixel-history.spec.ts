import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { PixelHistoryService } from './pixel-history';

describe('PixelHistoryService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  it('traži stranicu istorije sa limitom i pageState, a prva stranica nema pageState', async () => {
    const service = TestBed.inject(PixelHistoryService);
    const http = TestBed.inject(HttpTestingController);

    const promise = service.load(3, 4, 'abcd');
    const req = http.expectOne((r) => r.url === '/api/pixels/3/4/history');
    expect(req.request.params.get('limit')).toBe('20');
    expect(req.request.params.get('pageState')).toBe('abcd');
    req.flush({
      items: [{ username: 'a', color: 1, placedAt: '2026-01-01T00:00:00Z' }],
      nextPageState: null,
    });
    expect((await promise).items).toHaveLength(1);

    void service.load(0, 0);
    const first = http.expectOne((r) => r.url === '/api/pixels/0/0/history');
    expect(first.request.params.has('pageState')).toBe(false);
    first.flush({ items: [], nextPageState: null });
    http.verify();
  });
});
