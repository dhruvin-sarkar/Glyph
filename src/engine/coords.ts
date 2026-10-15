import type { FrameContext } from './types';

/**
 * Coordinate conventions shared by every experiment.
 *
 *  • Stage px  — CSS pixels, origin at the canvas' top-left, +y down.
 *  • Grid      — cell (c, r) is centred at (originX + (c + ½)·cellW, originY + (r + ½)·cellH).
 *  • World (u) — normalised maths coordinates: origin at the stage centre,
 *                1 unit = half the stage height, +x right, +y UP.
 *                So y ∈ [−1, 1] and x ∈ [−aspect, aspect] with aspect = width / height.
 *
 * Expressing every equation in world units keeps the pictures resolution-independent:
 * changing the glyph density changes the resolution, never the pattern.
 */
export type GridGeometry = Pick<
  FrameContext,
  'width' | 'height' | 'cols' | 'rows' | 'cellW' | 'cellH' | 'originX' | 'originY'
>;

/** CSS px per world unit (half the stage height). */
export function pxPerUnit(g: Pick<GridGeometry, 'height'>): number {
  return Math.max(1, g.height) / 2;
}

/** Half-width of the stage in world units (the stage spans x ∈ [−aspect, aspect]). */
export function worldAspect(g: Pick<GridGeometry, 'width' | 'height'>): number {
  return Math.max(1, g.width) / Math.max(1, g.height);
}

export function stageToWorldX(px: number, g: GridGeometry): number {
  return (px - g.width / 2) / pxPerUnit(g);
}

export function stageToWorldY(py: number, g: GridGeometry): number {
  return (g.height / 2 - py) / pxPerUnit(g);
}

export function worldToStageX(x: number, g: GridGeometry): number {
  return g.width / 2 + x * pxPerUnit(g);
}

export function worldToStageY(y: number, g: GridGeometry): number {
  return g.height / 2 - y * pxPerUnit(g);
}

export function cellCenterX(col: number, g: GridGeometry): number {
  return g.originX + (col + 0.5) * g.cellW;
}

export function cellCenterY(row: number, g: GridGeometry): number {
  return g.originY + (row + 0.5) * g.cellH;
}

/** Integer column containing stage x (may be out of range — check before indexing). */
export function stageToCol(px: number, g: GridGeometry): number {
  return Math.floor((px - g.originX) / g.cellW);
}

/** Integer row containing stage y (may be out of range — check before indexing). */
export function stageToRow(py: number, g: GridGeometry): number {
  return Math.floor((py - g.originY) / g.cellH);
}

/** World x of every column centre. Call in resize(); reuse `out` when its length matches. */
export function columnWorldX(g: GridGeometry, out?: Float32Array): Float32Array {
  const arr = out && out.length === g.cols ? out : new Float32Array(g.cols);
  for (let c = 0; c < g.cols; c++) arr[c] = stageToWorldX(cellCenterX(c, g), g);
  return arr;
}

/** World y of every row centre. Call in resize(); reuse `out` when its length matches. */
export function rowWorldY(g: GridGeometry, out?: Float32Array): Float32Array {
  const arr = out && out.length === g.rows ? out : new Float32Array(g.rows);
  for (let r = 0; r < g.rows; r++) arr[r] = stageToWorldY(cellCenterY(r, g), g);
  return arr;
}
