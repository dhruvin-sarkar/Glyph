import { BG_COLOR, GLYPH_CHARSET, GLYPH_FONT_FAMILY, GLYPH_FONT_WEIGHT, TONE_COLORS, TONE_COUNT } from './types';

/* ═══════════════════════════════════════════════════════════════════════════
 *  GLYPHFIELD · GLYPH ATLAS — how text becomes an image
 *
 *  A font is a set of vector outlines. Drawing a letter means *rasterising*
 *  its outline: for every pixel, compute how much of that pixel the shape
 *  covers (its "ink coverage", 0…1). That coverage becomes the pixel's alpha,
 *  and alpha blends the letter's colour over the background.
 *
 *  Rasterising ~15 000 letters every frame would be far too slow, so the
 *  renderer does it ONCE per font size and keeps the result in an atlas:
 *
 *    1. MEASURE the font → one cell = one character advance wide and
 *       LINE_HEIGHT font-sizes tall, rounded to whole device pixels.
 *    2. RASTERISE every character of GLYPH_CHARSET once, in white, into a
 *       strip of cell-sized tiles. Every tile shares the same baseline, so
 *       every row of the field has exactly the same rhythm.
 *    3. COLOUR each glyph per (tone, brightness level):
 *         colour = mix(BG, tone, level / (L − 1)),   alpha = ink coverage.
 *
 *  The WebGL2 renderer uploads only the white strip (step 2) and applies
 *  step 3 on the graphics card, per pixel. The Canvas 2D fallback bakes
 *  step 3 into one big image instead — the strip stamped once per band:
 *
 *        atlas  ┌─────────────────────────────── ! " # $ % … ÷ ─┐
 *               │ INK   level 1  (barely above the background)    │
 *               │ INK   level 2                                    │
 *               │  …                                               │
 *               │ INK   level 15 (#E9EDF2 exactly)                 │
 *               │ MINT  level 1 … 15                               │
 *               │ ICE   level 1 … 15                               │
 *               │ MUTED level 1 … 15                               │
 *               └──────────────────────────────────────────────────┘
 *
 *  Either way, drawing a character afterwards is an exact pixel copy from
 *  the atlas at whole-pixel positions: no font engine, no colour changes, no
 *  blur and no per-frame allocation. Level 0 would be the background colour
 *  itself (invisible), so it is never stored or drawn.
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Row height as a multiple of the font size. JetBrains Mono advances 0.6 em,
 * so 1.2 em rows make every cell exactly twice as tall as it is wide
 * (aspect 0.5): the field reads as an even texture, not as lines of text.
 */
export const LINE_HEIGHT = 1.2;

/** Brightness levels per tone, including the invisible level 0. */
export const ATLAS_LEVELS = 16;

/** Longest atlas side in px. Below every GPU's texture limit, so the atlas stays one GPU texture. */
export const ATLAS_MAX_DIM = 8192;

/** Atlas pixel budget (16 Mpx ≈ 64 MB RGBA). Brightness levels are reduced before it is exceeded. */
export const ATLAS_MAX_PIXELS = 16_777_216;

const SPACE = 32;

/* ─── Character → atlas column ───────────────────────────────────────────── */

function buildColumnLut(charset: string): Int16Array {
  const fallback = Math.max(0, charset.indexOf('?'));
  const lut = new Int16Array(256).fill(fallback);
  for (let i = 0; i < charset.length; i++) {
    const code = charset.charCodeAt(i);
    if (code < 256) lut[code] = i;
  }
  return lut;
}

/**
 * Char code (0…255) → index in GLYPH_CHARSET, i.e. the glyph's column in the
 * atlas. Codes outside the charset map to '?', so a stray character is
 * visible instead of silently missing. (Every charset code is < 256.)
 */
export const GLYPH_COLUMN: Int16Array = buildColumnLut(GLYPH_CHARSET);

/* ─── Colour helpers ─────────────────────────────────────────────────────── */

export type Rgb = readonly [number, number, number];

/** '#RRGGBB' or '#RGB' → [r, g, b] (0…255). Unparseable input → black. */
export function hexToRgb(hex: string): Rgb {
  let s = hex.trim().replace(/^#/, '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = s.length >= 6 ? Number.parseInt(s.slice(0, 6), 16) : Number.NaN;
  if (!Number.isFinite(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Linear interpolation a → b per channel (t = 0 gives a, t = 1 gives b), rounded to bytes. */
export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

export function rgbCss(c: Rgb): string {
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/* ─── Drawing surfaces ───────────────────────────────────────────────────── */

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A detached 2D drawing surface: an OffscreenCanvas when available, else an unattached <canvas>. */
export interface Surface {
  readonly canvas: OffscreenCanvas | HTMLCanvasElement;
  readonly ctx: Ctx2D;
}

/**
 * Create a detached 2D surface. Returns null outside a browser (e.g. unit
 * tests) or when the browser refuses a context — callers degrade gracefully.
 * `willReadFrequently` keeps the pixels in CPU memory, which makes
 * getImageData() cheap (used by the coverage measurement).
 */
export function createSurface(width: number, height: number, willReadFrequently = false): Surface | null {
  const w = Math.max(1, Math.floor(Number.isFinite(width) ? width : 1));
  const h = Math.max(1, Math.floor(Number.isFinite(height) ? height : 1));
  const settings: CanvasRenderingContext2DSettings = { alpha: true, willReadFrequently };
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d', settings);
      if (ctx) return { canvas, ctx };
    }
  } catch {
    // OffscreenCanvas without a 2D context (older Safari) → fall back to a DOM canvas below.
  }
  try {
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', settings);
      if (ctx) return { canvas, ctx };
    }
  } catch {
    // No canvas implementation at all (non-browser runtime).
  }
  return null;
}

/** Free a surface's backing store immediately instead of waiting for garbage collection. */
export function releaseSurface(surface: Surface | null): void {
  if (!surface) return;
  surface.canvas.width = 0;
  surface.canvas.height = 0;
}

/* ─── Font metrics → cell geometry ───────────────────────────────────────── */

/** CSS font shorthand of the field font at `px` pixels (device px inside the renderer). */
export function glyphFont(px: number): string {
  const size = Number.isFinite(px) && px > 0 ? Math.round(px * 1000) / 1000 : 16;
  return `${GLYPH_FONT_WEIGHT} ${size}px ${GLYPH_FONT_FAMILY}`;
}

/** Everything needed to place a glyph inside its tile (all values in the surface's own pixels). */
export interface GlyphCell {
  /** font size the glyphs are rasterised at */
  readonly fontPx: number;
  /** measured advance of 'M' (unrounded) */
  readonly advance: number;
  /** tile size — whole pixels */
  readonly cellW: number;
  readonly cellH: number;
  /** alphabetic baseline, measured down from the tile's top edge — a whole pixel */
  readonly baseline: number;
}

/**
 * Measure the field font at `fontPx` and derive the tile geometry.
 *
 * - cellW = the advance of 'M' rounded to whole pixels (a monospace font gives
 *   every character this advance), cellH = fontPx × LINE_HEIGHT rounded —
 *   unless explicit tile sizes are passed (coverage measurement does that).
 * - The baseline centres the font's em box (ascent + descent) vertically in
 *   the tile and is rounded to a whole pixel, so horizontal strokes such as
 *   '-' and '=' land on the pixel grid: crisp, and identical in every row.
 *
 * Leaves `ctx` with the field font and an alphabetic baseline set.
 */
export function measureGlyphCell(ctx: Ctx2D, fontPx: number, cellW?: number, cellH?: number): GlyphCell {
  const px = Number.isFinite(fontPx) && fontPx > 0 ? fontPx : 16;
  ctx.font = glyphFont(px);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.direction = 'ltr';

  const m = ctx.measureText('M');
  const advance = m.width > 0 ? m.width : px * 0.6;
  const w = cellW !== undefined && cellW >= 1 ? Math.round(cellW) : Math.max(1, Math.round(advance));
  const h = cellH !== undefined && cellH >= 1 ? Math.round(cellH) : Math.max(1, Math.round(px * LINE_HEIGHT));

  // Font-wide ascent/descent (identical for every character → identical rows).
  let ascent = m.fontBoundingBoxAscent;
  let descent = m.fontBoundingBoxDescent;
  if (!(ascent > 0) || !(descent >= 0)) {
    // Older engines lack the font box: approximate it with the ink box of tall and deep glyphs.
    const ink = ctx.measureText('Hg|');
    ascent = ink.actualBoundingBoxAscent;
    descent = ink.actualBoundingBoxDescent;
  }
  if (!(ascent > 0)) ascent = px * 0.8;
  if (!(descent >= 0)) descent = px * 0.2;

  const baseline = Math.round((h - (ascent + descent)) / 2 + ascent);
  return { fontPx: px, advance, cellW: w, cellH: h, baseline };
}

/**
 * Rasterise `chars` in white into consecutive cellW × cellH tiles, `perRow`
 * tiles per row: tile i sits at column i mod perRow, row ⌊i / perRow⌋.
 * Each glyph is centred on its advance, sits on the shared baseline and is
 * clipped to its own tile, so no ink can leak into a neighbour (no seams).
 * Spaces are skipped (nothing to draw).
 */
export function renderGlyphTiles(ctx: Ctx2D, chars: string, cell: GlyphCell, perRow: number): void {
  const { cellW, cellH, baseline } = cell;
  const cols = Math.max(1, Math.floor(perRow));
  ctx.save();
  ctx.font = glyphFont(cell.fontPx);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.direction = 'ltr';
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < chars.length; i++) {
    if (chars.charCodeAt(i) === SPACE) continue;
    const ch = chars[i];
    const x = (i % cols) * cellW;
    const y = Math.floor(i / cols) * cellH;
    // Whole-pixel origin: the glyph rasterises identically wherever it is later copied.
    const gx = x + Math.round((cellW - ctx.measureText(ch).width) / 2);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, cellW, cellH);
    ctx.clip();
    ctx.fillText(ch, gx, y + baseline);
    ctx.restore();
  }
  ctx.restore();
}

/* ─── Atlas layout (pure — unit-tested) ──────────────────────────────────── */

export interface AtlasLayout {
  /** brightness levels L, including the invisible level 0 (L − 1 bands are stored per tone) */
  readonly levels: number;
  /** glyph tiles per strip row */
  readonly perRow: number;
  /** rows needed for one full strip of glyphs */
  readonly stripRows: number;
  /** height of one (tone, level) band = stripRows × cellH */
  readonly bandH: number;
  /** atlas size, px */
  readonly width: number;
  readonly height: number;
}

/**
 * Plan the atlas: one strip of glyph tiles per (tone, level ≥ 1) band.
 * The strip wraps onto extra rows if it would exceed `maxDim`; the number of
 * levels is lowered (never below 2) when the atlas would exceed `maxDim` or
 * `maxPixels` — only at very large glyph sizes.
 */
export function planAtlasLayout(
  glyphCount: number,
  toneCount: number,
  cellW: number,
  cellH: number,
  preferredLevels: number = ATLAS_LEVELS,
  maxDim: number = ATLAS_MAX_DIM,
  maxPixels: number = ATLAS_MAX_PIXELS,
): AtlasLayout {
  const n = Math.max(1, Math.floor(glyphCount));
  const tones = Math.max(1, Math.floor(toneCount));
  const w = Math.max(1, Math.floor(cellW));
  const h = Math.max(1, Math.floor(cellH));

  const perRow = Math.max(1, Math.min(n, Math.floor(maxDim / w)));
  const stripRows = Math.ceil(n / perRow);
  const width = perRow * w;
  const bandH = stripRows * h;

  const bandsThatFit = Math.min(Math.floor(maxDim / bandH), Math.floor(maxPixels / (width * bandH)));
  const wanted = Math.max(1, Math.floor(preferredLevels) - 1);
  const visible = Math.max(1, Math.min(wanted, Math.floor(bandsThatFit / tones)));

  return { levels: visible + 1, perRow, stripRows, bandH, width, height: tones * visible * bandH };
}

/* ─── The white glyph strip (shared by both renderer back-ends) ──────────── */

export interface GlyphStrip {
  /** every glyph of GLYPH_CHARSET once, white on transparent: alpha = ink coverage */
  readonly surface: Surface;
  /** glyph tiles per row; tile of charset index i sits at (i mod perRow, ⌊i / perRow⌋) */
  readonly perRow: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Rasterise the whole charset once, in white, into cell-sized tiles (wrapping
 * onto extra rows only if one row would be wider than `maxDim`).
 * The caller owns the surface and must release it.
 */
export function buildGlyphStrip(cell: GlyphCell, maxDim: number = ATLAS_MAX_DIM): GlyphStrip | null {
  const layout = planAtlasLayout(GLYPH_CHARSET.length, 1, cell.cellW, cell.cellH, 2, maxDim);
  const surface = createSurface(layout.width, layout.bandH);
  if (!surface) return null;
  renderGlyphTiles(surface.ctx, GLYPH_CHARSET, cell, layout.perRow);
  return { surface, perRow: layout.perRow, width: layout.width, height: layout.bandH };
}

/* ─── The atlas ──────────────────────────────────────────────────────────── */

export interface GlyphAtlas {
  /** the pre-rendered image: an ImageBitmap where supported, otherwise a canvas */
  readonly source: CanvasImageSource;
  /** tile size, device px */
  readonly cellW: number;
  readonly cellH: number;
  /** brightness levels L (level 0 is the invisible background and is never drawn) */
  readonly levels: number;
  readonly width: number;
  readonly height: number;
  /** char code (0…255) → x of its tile, px (unknown codes → the '?' tile) */
  readonly tileX: Int32Array;
  /** char code (0…255) → y of its tile inside a band, px */
  readonly tileY: Int32Array;
  /** [tone × levels + level] → y of that (tone, level) band, px (entries for level 0 are unused) */
  readonly bandY: Int32Array;
  /** Free the image memory. Idempotent. */
  release(): void;
}

const BG_RGB = hexToRgb(BG_COLOR);

/**
 * Build the glyph atlas for an already-measured cell (device pixels).
 * Returns null if the browser cannot allocate it (the renderer then draws background only).
 *
 * Cost: one fillText per character (≈ 100) plus two rectangle operations per
 * band (≈ 60) — a few milliseconds — so rebuilding on every resize or
 * quality step is cheap.
 */
export function buildGlyphAtlas(cell: GlyphCell, preferredLevels: number = ATLAS_LEVELS): GlyphAtlas | null {
  const { cellW, cellH } = cell;
  let layout = planAtlasLayout(GLYPH_CHARSET.length, TONE_COUNT, cellW, cellH, preferredLevels);

  // 1 — the white master strip: every glyph exactly once (same tile layout as the atlas bands).
  const white = buildGlyphStrip(cell);
  if (!white) return null;
  const strip = white.surface;

  // 2 — the atlas itself (retry with fewer levels if a huge allocation is refused).
  let atlas = createSurface(layout.width, layout.height);
  while (!atlas && layout.levels > 2) {
    layout = planAtlasLayout(GLYPH_CHARSET.length, TONE_COUNT, cellW, cellH, Math.ceil(layout.levels / 2));
    atlas = createSurface(layout.width, layout.height);
  }
  if (!atlas) {
    releaseSurface(strip);
    return null;
  }

  // 3 — stamp the strip once per (tone, level) band and recolour it in place.
  //     'source-atop' paints only where ink already is and keeps the ink's alpha,
  //     so each band becomes:  colour = mix(BG, tone, level / (L − 1)),  alpha = coverage.
  const { ctx } = atlas;
  const L = layout.levels;
  const bandY = new Int32Array(TONE_COUNT * L);
  ctx.imageSmoothingEnabled = false;
  let band = 0;
  for (let tone = 0; tone < TONE_COUNT; tone++) {
    const toneRgb = hexToRgb(TONE_COLORS[tone] ?? TONE_COLORS[0]);
    for (let level = 1; level < L; level++, band++) {
      const y = band * layout.bandH;
      bandY[tone * L + level] = y;
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(strip.canvas, 0, y);
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = rgbCss(mixRgb(BG_RGB, toneRgb, level / (L - 1)));
      ctx.fillRect(0, y, layout.width, layout.bandH);
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  releaseSurface(strip);

  // 4 — char code → tile position lookup tables (so the draw loop does no arithmetic on glyph ids).
  const tileX = new Int32Array(256);
  const tileY = new Int32Array(256);
  for (let code = 0; code < 256; code++) {
    const column = GLYPH_COLUMN[code];
    tileX[code] = (column % layout.perRow) * cellW;
    tileY[code] = Math.floor(column / layout.perRow) * cellH;
  }

  // 5 — freeze the pixels into an ImageBitmap (an immutable, GPU-friendly image) when possible.
  const canvas = atlas.canvas;
  let source: CanvasImageSource = canvas;
  let bitmap: ImageBitmap | null = null;
  if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
    try {
      bitmap = canvas.transferToImageBitmap();
      source = bitmap;
      canvas.width = 0;
      canvas.height = 0;
    } catch {
      bitmap = null;
      source = canvas;
    }
  }

  let released = false;
  return {
    source,
    cellW,
    cellH,
    levels: L,
    width: layout.width,
    height: layout.height,
    tileX,
    tileY,
    bandY,
    release() {
      if (released) return;
      released = true;
      bitmap?.close();
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}
