import {
  PixelBatch,
  applyBatch,
  expandRect,
  mergeBuffered,
  paletteToUint32,
  unionRect,
} from './canvas-logic';

const W = 10;
const H = 5;

describe('paletteToUint32', () => {
  it('little-endian je 0xAABBGGRR, big-endian 0xRRGGBBAA', () => {
    const little = paletteToUint32(['#FF8040', '#000000'], true);
    expect(little[0]).toBe(0xff4080ff);
    expect(little[1]).toBe(0xff000000);
    expect(paletteToUint32(['#FF8040'], false)[0]).toBe(0xff8040ff);
  });

  it('isti bafer kao ImageData: bajtovi su R,G,B,A', () => {
    const palette = paletteToUint32(['#102030']);
    const buf = new ArrayBuffer(4);
    new Uint32Array(buf)[0] = palette[0];
    expect(Array.from(new Uint8Array(buf))).toEqual([0x10, 0x20, 0x30, 0xff]);
  });
});

describe('expandRect i unionRect', () => {
  it('proširuje po tačkama i spaja pravougaonike', () => {
    let r = expandRect(null, 3, 4);
    expect(r).toEqual({ x: 3, y: 4, w: 1, h: 1 });
    r = expandRect(r, 1, 6);
    expect(r).toEqual({ x: 1, y: 4, w: 3, h: 3 });
    expect(unionRect(null, null)).toBeNull();
    expect(unionRect({ x: 0, y: 0, w: 2, h: 2 }, { x: 5, y: 1, w: 1, h: 3 })).toEqual({
      x: 0,
      y: 0,
      w: 6,
      h: 4,
    });
  });
});

describe('applyBatch', () => {
  it('upisuje piksele, vraća najveću verziju i dirty rect', () => {
    const data = new Uint8Array(W * H);
    const r = applyBatch(
      data,
      W,
      H,
      {
        v: [11, 12],
        p: [
          [2, 1, 7],
          [5, 3, 9],
        ],
      },
      10,
    );
    expect(data[1 * W + 2]).toBe(7);
    expect(data[3 * W + 5]).toBe(9);
    expect(r).toEqual({ version: 12, applied: 2, dirty: { x: 2, y: 1, w: 4, h: 3 } });
  });

  it('preskače verzije <= fromVersion i piksele van platna', () => {
    const data = new Uint8Array(W * H);
    const r = applyBatch(
      data,
      W,
      H,
      {
        v: [10, 11, 12],
        p: [
          [0, 0, 1],
          [1, 0, 2],
          [W, 0, 3],
        ],
      },
      10,
    );
    expect(data[0]).toBe(0);
    expect(data[1]).toBe(2);
    expect(r).toEqual({ version: 11, applied: 1, dirty: { x: 1, y: 0, w: 1, h: 1 } });
  });
});

describe('mergeBuffered', () => {
  it('odbacuje batch-eve sa verzijom <= verziji platna, ostale primenjuje redom', () => {
    const data = new Uint8Array(W * H);
    const buffered: PixelBatch[] = [
      { v: [99], p: [[0, 0, 1]] }, // stariji od platna: odbačen
      { v: [100], p: [[1, 0, 2]] }, // jednak: odbačen
      {
        v: [101, 102],
        p: [
          [2, 0, 3],
          [2, 0, 4],
        ],
      }, // isti piksel dvaput: važi poslednji
      { v: [103], p: [[3, 0, 5]] },
    ];
    const r = mergeBuffered(data, W, H, 100, buffered);
    expect(Array.from(data.slice(0, 4))).toEqual([0, 0, 4, 5]);
    expect(r.version).toBe(103);
    expect(r.applied).toBe(3);
    expect(r.dirty).toEqual({ x: 2, y: 0, w: 2, h: 1 });
  });

  it('prazan bafer ostavlja verziju platna', () => {
    const r = mergeBuffered(new Uint8Array(W * H), W, H, 7, []);
    expect(r).toEqual({ version: 7, applied: 0, dirty: null });
  });
});
