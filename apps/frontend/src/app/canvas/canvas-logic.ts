/**
 * čista logika platna (bez DOM-a), da bude testabilna: spajanje bafera, primena batch-eva,
 * dirty rect i konverzija palete
 */

export interface PixelBatch {
  /** v[i] je verzija platna za p[i] */
  v: number[];
  /** p[i] = [x, y, boja] */
  p: [number, number, number][];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * paleta ("#RRGGBB") u RGBA kao Uint32. ImageData je niz bajtova R,G,B,A; kad se isti bafer
 * čita kao Uint32Array na little-endian procesorima, vrednost je 0xAABBGGRR.
 * endianness se proverava u vreme izvršavanja.
 */
export function paletteToUint32(
  palette: readonly string[],
  littleEndian = isLittleEndian(),
): Uint32Array {
  const out = new Uint32Array(palette.length);
  palette.forEach((hex, i) => {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = (n >> 16) & 0xff;
    const g = (n >> 8) & 0xff;
    const b = n & 0xff;
    out[i] = littleEndian
      ? ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0
      : ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0;
  });
  return out;
}

export function isLittleEndian(): boolean {
  return new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
}

/** proširuje pravougaonik tako da obuhvati tačku */
export function expandRect(rect: Rect | null, x: number, y: number): Rect {
  if (!rect) return { x, y, w: 1, h: 1 };
  const x1 = Math.min(rect.x, x);
  const y1 = Math.min(rect.y, y);
  const x2 = Math.max(rect.x + rect.w, x + 1);
  const y2 = Math.max(rect.y + rect.h, y + 1);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.w, b.x + b.w);
  const y2 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export interface ApplyResult {
  /** najveća primenjena verzija (ili `fromVersion` ako ništa nije primenjeno) */
  version: number;
  applied: number;
  dirty: Rect | null;
}

/**
 * primenjuje batch na bafer. poteze sa verzijom <= `fromVersion` preskače (već su sadržani
 * u preuzetom platnu), a piksele van platna ignoriše.
 */
export function applyBatch(
  data: Uint8Array,
  width: number,
  height: number,
  batch: PixelBatch,
  fromVersion: number,
): ApplyResult {
  let version = fromVersion;
  let applied = 0;
  let dirty: Rect | null = null;
  for (let i = 0; i < batch.p.length; i++) {
    const v = batch.v[i];
    if (v <= fromVersion) continue;
    const [x, y, color] = batch.p[i];
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    data[y * width + x] = color;
    dirty = expandRect(dirty, x, y);
    applied++;
    if (v > version) version = v;
  }
  return { version, applied, dirty };
}

/**
 * spajanje bafera sa preuzetim platnom: batch-evi se primenjuju redom kojim su stigli,
 * a oni sa verzijom <= verziji preuzetog platna se odbacuju
 */
export function mergeBuffered(
  data: Uint8Array,
  width: number,
  height: number,
  canvasVersion: number,
  buffered: PixelBatch[],
): ApplyResult {
  let version = canvasVersion;
  let applied = 0;
  let dirty: Rect | null = null;
  for (const batch of buffered) {
    const r = applyBatch(data, width, height, batch, canvasVersion);
    if (r.version > version) version = r.version;
    applied += r.applied;
    dirty = unionRect(dirty, r.dirty);
  }
  return { version, applied, dirty };
}
