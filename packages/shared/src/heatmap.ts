/** stranica ćelije heatmape u pikselima (300×300 platno → mreža 30×30) */
export const HEATMAP_CELL_SIZE = 10;

/** oznaka mreže u heatmap_total.grid */
export const HEATMAP_GRID = `${HEATMAP_CELL_SIZE}x${HEATMAP_CELL_SIZE}`;

/** broj ćelija po jednoj dimenziji za zadatu dimenziju platna */
export function heatmapCells(canvasSize: number): number {
  return Math.ceil(canvasSize / HEATMAP_CELL_SIZE);
}
