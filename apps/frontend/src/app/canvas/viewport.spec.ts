import { MAX_SCALE, MIN_SCALE, fitView, isClick, panBy, screenToPixel, zoomAt } from './viewport';

describe('viewport', () => {
  it('fitView uklapa i centrira', () => {
    const v = fitView(1000, 600, 1000, 1000, 0);
    expect(v.scale).toBeCloseTo(0.6);
    expect(v.tx).toBeCloseTo(200);
    expect(v.ty).toBeCloseTo(0);
  });

  it('zoomAt drži tačku pod kursorom, a zoom je ograničen', () => {
    const v0 = { scale: 2, tx: 10, ty: 20 };
    const cx = 110;
    const cy = 220;
    const before = { x: (cx - v0.tx) / v0.scale, y: (cy - v0.ty) / v0.scale };
    const v1 = zoomAt(v0, 1.5, cx, cy);
    expect((cx - v1.tx) / v1.scale).toBeCloseTo(before.x);
    expect((cy - v1.ty) / v1.scale).toBeCloseTo(before.y);
    expect(v1.scale).toBeCloseTo(3);

    expect(zoomAt({ scale: 1, tx: 0, ty: 0 }, 1e9, 0, 0).scale).toBe(MAX_SCALE);
    expect(zoomAt({ scale: 1, tx: 0, ty: 0 }, 1e-9, 0, 0).scale).toBe(MIN_SCALE);
  });

  it('panBy pomera, a screenToPixel vraća null van platna', () => {
    expect(panBy({ scale: 2, tx: 1, ty: 2 }, 5, -3)).toEqual({ scale: 2, tx: 6, ty: -1 });

    const v = { scale: 4, tx: 100, ty: 50 };
    expect(screenToPixel(v, 100, 50, 10, 10)).toEqual({ x: 0, y: 0 });
    expect(screenToPixel(v, 107, 59, 10, 10)).toEqual({ x: 1, y: 2 });
    expect(screenToPixel(v, 99, 50, 10, 10)).toBeNull();
    expect(screenToPixel(v, 140, 50, 10, 10)).toBeNull();
  });

  it('isClick poštuje prag pomeraja', () => {
    expect(isClick(3, 4)).toBe(true);
    expect(isClick(4, 4)).toBe(false);
  });
});
