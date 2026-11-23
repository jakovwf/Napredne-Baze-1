/** čista matematika za zoom i pan platna (bez DOM-a) */

export interface View {
  /** skala (CSS pikseli po pikselu platna) */
  scale: number;
  /** pomeraj gornjeg levog ugla platna u odnosu na kontejner (CSS px) */
  tx: number;
  ty: number;
}

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 64;

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** skala i pomeraj da se celo platno uklopi u kontejner i centrira */
export function fitView(
  containerW: number,
  containerH: number,
  canvasW: number,
  canvasH: number,
  margin = 16,
): View {
  const availW = Math.max(1, containerW - margin * 2);
  const availH = Math.max(1, containerH - margin * 2);
  const scale = clamp(Math.min(availW / canvasW, availH / canvasH), MIN_SCALE, MAX_SCALE);
  return {
    scale,
    tx: (containerW - canvasW * scale) / 2,
    ty: (containerH - canvasH * scale) / 2,
  };
}

/** zumira oko tačke (cx, cy) u koordinatama kontejnera, tako da tačka ostane pod kursorom */
export function zoomAt(view: View, factor: number, cx: number, cy: number): View {
  const scale = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE);
  const k = scale / view.scale;
  return { scale, tx: cx - (cx - view.tx) * k, ty: cy - (cy - view.ty) * k };
}

export function panBy(view: View, dx: number, dy: number): View {
  return { ...view, tx: view.tx + dx, ty: view.ty + dy };
}

/** koordinate u kontejneru u piksel platna (ili null ako je van platna) */
export function screenToPixel(
  view: View,
  sx: number,
  sy: number,
  canvasW: number,
  canvasH: number,
): { x: number; y: number } | null {
  const x = Math.floor((sx - view.tx) / view.scale);
  const y = Math.floor((sy - view.ty) / view.scale);
  if (x < 0 || y < 0 || x >= canvasW || y >= canvasH) return null;
  return { x, y };
}

/** razlikuje klik od prevlačenja: pomeraj manji ili jednak pragu je klik */
export function isClick(dx: number, dy: number, threshold = 5): boolean {
  return Math.hypot(dx, dy) <= threshold;
}
