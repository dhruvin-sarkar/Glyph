import { BG_COLOR, GLYPH_CHARSET, RAMPS, TONE_COLORS, TONE_COUNT } from './types';
import type { AsciiRendererAPI, GlyphField, GlyphRamp, RendererMetrics } from './types';
import {
  ATLAS_LEVELS,
  ATLAS_MAX_DIM,
  GLYPH_COLUMN,
  LINE_HEIGHT,
  buildGlyphAtlas,
  buildGlyphStrip,
  createSurface,
  hexToRgb,
  measureGlyphCell,
  releaseSurface,
} from './GlyphAtlas';
import type { GlyphAtlas, GlyphCell, Surface } from './GlyphAtlas';
import { buildRamp, measureGlyphCoverage } from './GlyphRamp';

/* ═══════════════════════════════════════════════════════════════════════════
 *  GLYPHFIELD · ASCII RENDERER — character field → pixels
 *
 *  Every frame the experiment fills a GlyphField: per cell a character code,
 *  an intensity 0…1 and a tone. The renderer turns that into an image:
 *
 *    level  = round(intensity · (L − 1))           (L = 16 brightness levels)
 *    colour = mix(BG, tone, level / (L − 1))       (the glyph's ink colour)
 *    pixel  = mix(BG, colour, coverage)            (coverage from the glyph atlas)
 *
 *  at   x = originX + col · cellW,   y = originY + row · cellH   in whole device
 *  pixels. Every glyph pixel is an exact copy from the atlas — no resampling,
 *  so no blur — and every cell has exactly the same size, so the grid is
 *  perfectly even.
 *
 *  Two interchangeable back-ends produce the same pixels:
 *
 *    • WebGL2 (preferred). The graphics card copies ALL glyphs in one draw
 *      call: a small program (a fragment shader) runs once per screen pixel,
 *      works out which cell the pixel is in, reads that cell's character,
 *      level and tone, and copies the matching pixel of the glyph from the
 *      atlas. ≈ 13 000 glyphs cost well under a millisecond.
 *    • Canvas 2D (fallback). One drawImage() per glyph from a pre-tinted
 *      atlas (one band per tone × level). Correct everywhere, but each call
 *      costs the browser ~1–3 µs, so dense fields are slower.
 *
 *  The optional glow layer is shared: one pixel per cell, lit only on the
 *  brightest cells, stretched over the grid by the browser (bilinear
 *  upscaling — a soft blur for free) plus a CSS blur, blended with 'screen'.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Cells dimmer than this are not drawn at all. */
const MIN_INTENSITY = 0.02;
const QUESTION = 63; // '?' — drawn for codes outside the charset

/** The glow starts above this intensity: only crests glow, never the whole field. */
const GLOW_KNEE = 0.55;
const GLOW_SPAN_INV = 1 / (1 - GLOW_KNEE);
const GLOW_OPACITY = '0.45';
/** CSS blur radius ≈ 0.9 cell widths, kept between 6 and 14 CSS px. */
const GLOW_BLUR_PER_CELL = 0.9;
const GLOW_BLUR_MIN = 6;
const GLOW_BLUR_MAX = 14;
/** Glow gain per tone (INK, MINT, ICE, MUTED): accents glow a touch more, structure barely. */
const GLOW_TONE_GAIN: readonly number[] = [1, 1.15, 1, 0.5];
/**
 * A glyph's halo also scales with how much ink it has (light emitted ∝ ink):
 * weight = floor + (1 − floor) · coverage. The floor keeps thin glyphs glowing a little.
 */
const GLOW_INK_FLOOR = 0.5;
/** Inline glow styles this renderer owns (removed again on destroy). */
const GLOW_STYLE_PROPS: readonly string[] = [
  'left',
  'top',
  'width',
  'height',
  'filter',
  'mix-blend-mode',
  'opacity',
  'image-rendering',
  'pointer-events',
  'display',
];

const RAMP_CACHE_LIMIT = 64;

/** Opaque black as one 32-bit RGBA pixel in this machine's byte order. */
const OPAQUE_BLACK = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1 ? 0xff000000 : 0x000000ff;

/** Nominal cell (14 px font) used only until the first configure(). */
const NOMINAL_FONT_PX = 14;
const NOMINAL_CELL: GlyphCell = {
  fontPx: NOMINAL_FONT_PX,
  advance: NOMINAL_FONT_PX * 0.6,
  cellW: Math.round(NOMINAL_FONT_PX * 0.6),
  cellH: Math.round(NOMINAL_FONT_PX * LINE_HEIGHT),
  baseline: Math.round(NOMINAL_FONT_PX * 0.9),
};

const BG_RGB = hexToRgb(BG_COLOR);
const TONE_RGB = TONE_COLORS.map(hexToRgb);
/** tone byte → a valid tone index (unknown tones draw as INK) */
const TONE_INDEX = new Uint8Array(256);
for (let b = 0; b < 256; b++) TONE_INDEX[b] = b < TONE_COUNT ? b : 0;

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function toDevicePx(css: number, dpr: number): number {
  return Number.isFinite(css) && css > 0 ? Math.max(1, Math.round(css * dpr)) : 1;
}

/** Cell metrics in CSS px: device pixels ÷ dpr, so cellW·dpr and cellH·dpr are whole numbers. */
function cssMetrics(cell: GlyphCell, fontSize: number, dpr: number): RendererMetrics {
  return Object.freeze({ cellW: cell.cellW / dpr, cellH: cell.cellH / dpr, fontSize, dpr });
}

/* ─── Back-end contract ──────────────────────────────────────────────────── */

type BackendKind = 'webgl2' | 'canvas2d' | 'none';

interface GlyphBackend {
  readonly kind: BackendKind;
  /** A new cell was measured (device px): rebuild the glyph images. */
  setCell(cell: GlyphCell): void;
  /** Paint the whole canvas: background + every visible cell, grid origin at (ox, oy) device px. */
  draw(field: GlyphField, ox: number, oy: number): number;
  destroy(): void;
}

/* ─── Back-end 1: WebGL2 — every glyph in one draw call ──────────────────── */

const GL_ATTRIBUTES: WebGLContextAttributes = {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
};

const VERTEX_SHADER = `#version 300 es
// One triangle large enough to cover the whole canvas; the fragment shader does the work.
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp usampler2D;

uniform usampler2D uCells; // one texel per cell: r = glyph column, g = level (0 = empty), b = tone
uniform sampler2D uGlyphs; // the white glyph strip: alpha = ink coverage
uniform ivec2 uOrigin;     // top-left corner of cell (0,0), device px from the canvas' top-left
uniform ivec2 uCell;       // cell size, device px
uniform ivec2 uGrid;       // columns, rows
uniform int uPerRow;       // glyph tiles per strip row
uniform int uHeight;       // canvas height, device px
uniform float uTop;        // L - 1, the brightest level
uniform vec3 uBg;
uniform vec3 uTones[${TONE_COUNT}];

out vec4 outColor;

void main() {
  outColor = vec4(uBg, 1.0);
  // gl_FragCoord counts rows from the bottom; the field counts them from the top.
  ivec2 p = ivec2(int(gl_FragCoord.x), uHeight - 1 - int(gl_FragCoord.y)) - uOrigin;
  if (p.x < 0 || p.y < 0) return;
  ivec2 cell = p / uCell;                                   // the cell this pixel belongs to
  if (cell.x >= uGrid.x || cell.y >= uGrid.y) return;
  uvec4 c = texelFetch(uCells, cell, 0);
  if (c.g == 0u) return;                                    // empty cell: background
  int column = int(c.r);
  ivec2 tile = ivec2(column % uPerRow, column / uPerRow) * uCell;
  float ink = texelFetch(uGlyphs, tile + (p - cell * uCell), 0).a; // exact pixel copy
  vec3 tint = mix(uBg, uTones[int(c.b)], float(c.g) / uTop);       // this level's ink colour
  outColor = vec4(mix(uBg, tint, ink), 1.0);                       // ink over background
}`;

function compileProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
  const vs = gl.createShader(gl.VERTEX_SHADER);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!vs || !fs || !program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    gl.deleteProgram(program);
    return null;
  }
  gl.shaderSource(vs, VERTEX_SHADER);
  gl.compileShader(vs);
  gl.shaderSource(fs, FRAGMENT_SHADER);
  gl.compileShader(fs);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  // Shaders are only flagged for deletion here; they live as long as the program.
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

let webgl2Verdict: boolean | null = null;

/**
 * Can this browser run the glyph shader? Tested once, on a throw-away canvas,
 * so a driver problem can never leave the real stage canvas stuck with a
 * broken WebGL context (a canvas cannot switch back to 2D afterwards).
 */
function webgl2Usable(): boolean {
  if (webgl2Verdict !== null) return webgl2Verdict;
  webgl2Verdict = false;
  if (typeof document === 'undefined') return false;
  try {
    const probe = document.createElement('canvas');
    probe.width = 1;
    probe.height = 1;
    const gl = probe.getContext('webgl2', GL_ATTRIBUTES);
    if (gl) {
      const program = compileProgram(gl);
      webgl2Verdict = program !== null && Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) >= 2048;
      gl.deleteProgram(program);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    webgl2Verdict = false;
  }
  return webgl2Verdict;
}

/**
 * Pack the field into 4 bytes per cell for the GPU: glyph column, brightness
 * level (0 = draw nothing) and tone — the same decisions the Canvas 2D loop
 * makes. Returns how many glyphs will be visible. (Exported for unit tests.)
 */
export function packCells(field: GlyphField, cells: Uint8Array, n: number): number {
  const glyph = field.glyph;
  const intensity = field.intensity;
  const tone = field.tone;
  const top = ATLAS_LEVELS - 1;
  let drawn = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const code = glyph[i];
    const v = intensity[i];
    if (code === 0 || code === 32 || !(v >= MIN_INTENSITY)) {
      cells[p + 1] = 0; // empty — `!(v >= …)` also rejects NaN
      continue;
    }
    const level = v < 1 ? (v * top + 0.5) | 0 : top; // round(v·(L−1)), clamped to L−1
    cells[p + 1] = level;
    if (level === 0) continue; // level 0 is the background colour: invisible
    cells[p] = GLYPH_COLUMN[code < 256 ? code : QUESTION];
    cells[p + 2] = TONE_INDEX[tone[i]];
    drawn++;
  }
  return drawn;
}

interface GlUniforms {
  readonly origin: WebGLUniformLocation | null;
  readonly cell: WebGLUniformLocation | null;
  readonly grid: WebGLUniformLocation | null;
  readonly perRow: WebGLUniformLocation | null;
  readonly height: WebGLUniformLocation | null;
}

function createWebGLBackend(canvas: HTMLCanvasElement): GlyphBackend | null {
  if (!webgl2Usable()) return null;
  let context: WebGL2RenderingContext | null = null;
  try {
    context = canvas.getContext('webgl2', GL_ATTRIBUTES);
  } catch {
    context = null;
  }
  if (!context) return null; // e.g. the canvas already has a 2D context
  const gl = context;
  const maxTexture = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 4096;
  const toneData = new Float32Array(TONE_COUNT * 3);
  for (let t = 0; t < TONE_COUNT; t++) {
    for (let k = 0; k < 3; k++) toneData[t * 3 + k] = TONE_RGB[t][k] / 255;
  }

  let program: WebGLProgram | null = null;
  let uniforms: GlUniforms | null = null;
  let cellTexture: WebGLTexture | null = null;
  let glyphTexture: WebGLTexture | null = null;
  let glyphsReady = false;
  let lost = false;
  let currentCell: GlyphCell | null = null;
  /** per cell: glyph column, level, tone, (unused) — re-allocated only when the grid size changes */
  let cells = new Uint8Array(4);
  let texCols = 0;
  let texRows = 0;
  let viewW = -1;
  let viewH = -1;

  function makeTexture(internalFormat: number, format: number): WebGLTexture | null {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // 1×1 placeholder so the texture is always complete (no "unbound texture" warnings).
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 1, 1, 0, format, gl.UNSIGNED_BYTE, new Uint8Array(4));
    return texture;
  }

  function uploadGlyphs(cell: GlyphCell): void {
    glyphsReady = false;
    if (!program || !uniforms || !glyphTexture) return;
    const strip = buildGlyphStrip(cell, Math.min(ATLAS_MAX_DIM, maxTexture));
    if (!strip) return;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, glyphTexture);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, strip.surface.canvas);
    releaseSurface(strip.surface);
    gl.useProgram(program);
    gl.uniform2i(uniforms.cell, cell.cellW, cell.cellH);
    gl.uniform1i(uniforms.perRow, strip.perRow);
    glyphsReady = true;
  }

  function setup(): boolean {
    program = compileProgram(gl);
    if (!program) return false;
    const p = program;
    uniforms = {
      origin: gl.getUniformLocation(p, 'uOrigin'),
      cell: gl.getUniformLocation(p, 'uCell'),
      grid: gl.getUniformLocation(p, 'uGrid'),
      perRow: gl.getUniformLocation(p, 'uPerRow'),
      height: gl.getUniformLocation(p, 'uHeight'),
    };
    gl.useProgram(p);
    gl.uniform1i(gl.getUniformLocation(p, 'uCells'), 0);
    gl.uniform1i(gl.getUniformLocation(p, 'uGlyphs'), 1);
    gl.uniform1f(gl.getUniformLocation(p, 'uTop'), ATLAS_LEVELS - 1);
    gl.uniform3f(gl.getUniformLocation(p, 'uBg'), BG_RGB[0] / 255, BG_RGB[1] / 255, BG_RGB[2] / 255);
    gl.uniform3fv(gl.getUniformLocation(p, 'uTones'), toneData);
    gl.activeTexture(gl.TEXTURE0);
    cellTexture = makeTexture(gl.RGBA8UI, gl.RGBA_INTEGER);
    gl.activeTexture(gl.TEXTURE1);
    glyphTexture = makeTexture(gl.RGBA, gl.RGBA);
    texCols = 1;
    texRows = 1;
    viewW = -1;
    viewH = -1;
    if (currentCell) uploadGlyphs(currentCell);
    return true;
  }

  // A GPU reset (driver update, sleep, plugging in a projector) loses every GPU
  // resource. preventDefault() asks the browser to give the context back; we then rebuild.
  const onLost = (event: Event): void => {
    event.preventDefault();
    lost = true;
    program = null;
    uniforms = null;
    cellTexture = null;
    glyphTexture = null;
    glyphsReady = false;
  };
  const onRestored = (): void => {
    lost = false;
    setup();
  };

  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  if (gl.isContextLost()) {
    lost = true; // handed a lost context (e.g. right after a GPU reset): wait for 'restored'
  } else if (!setup()) {
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
    return null;
  }

  return {
    kind: 'webgl2',

    setCell(cell) {
      currentCell = cell;
      if (!lost) uploadGlyphs(cell);
    },

    draw(field, ox, oy) {
      if (lost || !program || !uniforms || !glyphsReady) return 0;
      const W = canvas.width;
      const H = canvas.height;
      if (W !== viewW || H !== viewH) {
        gl.viewport(0, 0, W, H);
        viewW = W;
        viewH = H;
      }
      gl.useProgram(program);

      const cols = Math.max(0, field.cols);
      const rows = Math.max(0, field.rows);
      const n = cols * rows;
      let drawn = 0;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, cellTexture);
      if (n > 0) {
        if (cells.length !== n * 4) cells = new Uint8Array(n * 4);
        drawn = packCells(field, cells, n);
        if (cols !== texCols || rows !== texRows) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8UI, cols, rows, 0, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, cells);
          texCols = cols;
          texRows = rows;
        } else {
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, cells);
        }
      }
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, glyphTexture);
      gl.uniform2i(uniforms.grid, n > 0 ? cols : 0, n > 0 ? rows : 0);
      gl.uniform2i(uniforms.origin, ox, oy);
      gl.uniform1i(uniforms.height, H);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return drawn;
    },

    destroy() {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      if (!gl.isContextLost()) {
        gl.deleteTexture(cellTexture);
        gl.deleteTexture(glyphTexture);
        gl.deleteProgram(program);
      }
      program = null;
      uniforms = null;
      cellTexture = null;
      glyphTexture = null;
      glyphsReady = false;
      cells = new Uint8Array(4);
    },
  };
}

/* ─── Back-end 2: Canvas 2D — one drawImage per glyph ────────────────────── */

function createCanvas2DBackend(canvas: HTMLCanvasElement): GlyphBackend | null {
  let context: CanvasRenderingContext2D | null = null;
  try {
    // Opaque canvas: the browser never has to blend it with the page beneath.
    context = canvas.getContext('2d', { alpha: false });
  } catch {
    context = null;
  }
  if (!context) return null;
  const ctx = context;
  let atlas: GlyphAtlas | null = null;
  /** tone byte → tone × levels: index of that tone's first band (unknown tones draw as INK) */
  const toneBand = new Int32Array(256);

  return {
    kind: 'canvas2d',

    setCell(cell) {
      atlas?.release();
      atlas = buildGlyphAtlas(cell);
      const levels = atlas ? atlas.levels : 0;
      for (let b = 0; b < 256; b++) toneBand[b] = TONE_INDEX[b] * levels;
    },

    draw(field, ox, oy) {
      const W = canvas.width;
      const H = canvas.height;
      ctx.fillStyle = BG_COLOR;
      ctx.fillRect(0, 0, W, H);
      const a = atlas;
      const cols = field.cols;
      const rows = field.rows;
      if (!a || cols < 1 || rows < 1) return 0;
      ctx.imageSmoothingEnabled = false;

      const src = a.source;
      const tileX = a.tileX;
      const tileY = a.tileY;
      const bandY = a.bandY;
      const cw = a.cellW;
      const ch = a.cellH;
      const top = a.levels - 1;
      const glyph = field.glyph;
      const intensity = field.intensity;
      const tone = field.tone;

      // Only cells that overlap the canvas.
      const c0 = ox < 0 ? Math.min(cols, Math.floor(-ox / cw)) : 0;
      const c1 = Math.min(cols, Math.ceil((W - ox) / cw));
      const r0 = oy < 0 ? Math.min(rows, Math.floor(-oy / ch)) : 0;
      const r1 = Math.min(rows, Math.ceil((H - oy) / ch));

      let drawn = 0;
      for (let r = r0; r < r1; r++) {
        const dy = oy + r * ch;
        let i = r * cols + c0;
        let dx = ox + c0 * cw;
        for (let c = c0; c < c1; c++, i++, dx += cw) {
          const code = glyph[i];
          if (code === 0 || code === 32) continue;
          const v = intensity[i];
          if (!(v >= MIN_INTENSITY)) continue; // also rejects NaN
          const level = v < 1 ? (v * top + 0.5) | 0 : top; // round(v·(L−1)), clamped to L−1
          if (level === 0) continue; // level 0 is the background colour: invisible
          const k = code < 256 ? code : QUESTION;
          ctx.drawImage(src, tileX[k], tileY[k] + bandY[toneBand[tone[i]] + level], cw, ch, dx, dy, cw, ch);
          drawn++;
        }
      }
      return drawn;
    },

    destroy() {
      atlas?.release();
      atlas = null;
    },
  };
}

/** No usable context at all (should not happen in a browser): draw nothing, never throw. */
function createNullBackend(): GlyphBackend {
  return { kind: 'none', setCell() {}, draw: () => 0, destroy() {} };
}

/* ─── The renderer ───────────────────────────────────────────────────────── */

export function createAsciiRenderer(canvas: HTMLCanvasElement, glowCanvas?: HTMLCanvasElement | null): AsciiRendererAPI {
  const backend = createWebGLBackend(canvas) ?? createCanvas2DBackend(canvas) ?? createNullBackend();
  canvas.dataset.renderer = backend.kind; // visible in DevTools / QA scripts

  const glowEl = glowCanvas ?? null;
  const gctx = glowEl ? glowEl.getContext('2d', { alpha: false }) : null;

  let destroyed = false;
  let dpr = 1;
  let cell: GlyphCell | null = null;
  let meter: Surface | null = null;
  let metrics: RendererMetrics = cssMetrics(NOMINAL_CELL, NOMINAL_FONT_PX, 1);
  const ramps = new Map<string, GlyphRamp>();

  /* ── glow state ── */
  /** char code → glow weight derived from its measured ink coverage */
  const glowWeight = new Float32Array(256).fill(1);
  /** per tone: r, g, b already multiplied by strength × tone gain */
  const glowRgb = new Float32Array(TONE_COUNT * 3);
  let glowStrength = 0;
  let glowImage: ImageData | null = null;
  let glowWords: Uint32Array | null = null;
  let glowCols = 0;
  let glowRows = 0;
  /** the pixel buffer still holds light from the previous frame */
  let glowLit = false;
  /** the canvas content is stale (resized / re-enabled): upload even if dark */
  let glowStale = true;
  /** last geometry written to the glow element's style (CSS px) */
  let styleLeft = Number.NaN;
  let styleTop = Number.NaN;
  let styleWidth = Number.NaN;
  let styleHeight = Number.NaN;

  /* ── configure: font → cell → glyph images ── */

  function configure(fontSize: number, nextDpr: number): RendererMetrics {
    if (destroyed) return metrics;
    const css = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : NOMINAL_FONT_PX;
    dpr = Number.isFinite(nextDpr) && nextDpr > 0 ? nextDpr : 1;

    // Everything below happens in DEVICE pixels, so every glyph is rasterised 1:1.
    meter ??= createSurface(1, 1);
    const measured = meter ? measureGlyphCell(meter.ctx, css * dpr) : { ...NOMINAL_CELL, fontPx: css * dpr };
    cell = measured;
    backend.setCell(measured);

    ramps.clear();
    updateGlowWeights(measured);
    styleLeft = Number.NaN; // the cell size changed: re-place the glow layer on the next draw

    metrics = cssMetrics(measured, css, dpr);
    return metrics;
  }

  function resize(cssWidth: number, cssHeight: number, nextDpr: number): void {
    if (destroyed) return;
    const d = Number.isFinite(nextDpr) && nextDpr > 0 ? nextDpr : dpr;
    const w = toDevicePx(cssWidth, d);
    const h = toDevicePx(cssHeight, d);
    // Assigning width/height clears the canvas and resets its state, so only do it on a real change.
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
  }

  /* ── draw ── */

  function draw(field: GlyphField, originX: number, originY: number): number {
    if (destroyed) return 0;
    // The grid origin snapped to a whole device pixel; every cell is a whole number of pixels from it.
    const ox = Math.round(finiteOr(originX, 0) * dpr);
    const oy = Math.round(finiteOr(originY, 0) * dpr);
    const drawn = backend.draw(field, ox, oy);
    if (glowStrength > 0) drawGlow(field, ox, oy);
    return drawn;
  }

  /* ── glow layer ── */

  function updateGlowWeights(c: GlyphCell): void {
    if (!gctx) return;
    const coverage = measureGlyphCoverage(GLYPH_CHARSET, c.fontPx, c.cellW, c.cellH);
    for (let code = 0; code < 256; code++) {
      glowWeight[code] = GLOW_INK_FLOOR + (1 - GLOW_INK_FLOOR) * coverage[GLYPH_COLUMN[code]];
    }
  }

  function setGlow(strength: number): void {
    if (destroyed || !glowEl || !gctx) return;
    const s = Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : 0;
    if (s === glowStrength) return;
    const wasOn = glowStrength > 0;
    glowStrength = s;
    for (let t = 0; t < TONE_COUNT; t++) {
      const gain = s * (GLOW_TONE_GAIN[t] ?? 1);
      glowRgb[t * 3] = TONE_RGB[t][0] * gain;
      glowRgb[t * 3 + 1] = TONE_RGB[t][1] * gain;
      glowRgb[t * 3 + 2] = TONE_RGB[t][2] * gain;
    }
    if (s === 0) {
      glowEl.style.display = 'none';
    } else if (!wasOn) {
      glowEl.style.display = '';
      glowStale = true;
    }
  }

  /**
   * Prepare the glow buffer for this frame: one pixel per cell, all black.
   * (Re)allocates only when the grid size changes and rewrites the element's
   * placement only when the grid moved. Returns the RGBA bytes to write into.
   */
  function beginGlow(cols: number, rows: number, ox: number, oy: number, cw: number, ch: number): Uint8ClampedArray | null {
    if (!glowEl || !gctx) return null;
    let image = glowImage;
    let words = glowWords;
    if (!image || !words || cols !== glowCols || rows !== glowRows) {
      glowEl.width = cols;
      glowEl.height = rows;
      image = gctx.createImageData(cols, rows);
      words = new Uint32Array(image.data.buffer);
      words.fill(OPAQUE_BLACK);
      glowImage = image;
      glowWords = words;
      glowCols = cols;
      glowRows = rows;
      glowLit = false;
      glowStale = true;
    }

    // Place the layer exactly over the grid, in CSS px (the browser stretches it: 1 pixel → 1 cell).
    const left = ox / dpr;
    const top = oy / dpr;
    const width = (cols * cw) / dpr;
    const height = (rows * ch) / dpr;
    if (left !== styleLeft || top !== styleTop || width !== styleWidth || height !== styleHeight) {
      const s = glowEl.style;
      s.left = `${left}px`;
      s.top = `${top}px`;
      s.width = `${width}px`;
      s.height = `${height}px`;
      const blur = Math.min(GLOW_BLUR_MAX, Math.max(GLOW_BLUR_MIN, (GLOW_BLUR_PER_CELL * cw) / dpr));
      s.filter = `blur(${Math.round(blur * 10) / 10}px)`;
      styleLeft = left;
      styleTop = top;
      styleWidth = width;
      styleHeight = height;
    }

    if (glowLit) words.fill(OPAQUE_BLACK);
    return image.data;
  }

  function drawGlow(field: GlyphField, ox: number, oy: number): void {
    const c = cell;
    const cols = field.cols;
    const rows = field.rows;
    if (!c || cols < 1 || rows < 1) return;
    const px = beginGlow(cols, rows, ox, oy, c.cellW, c.cellH);
    if (!px || !gctx || !glowImage) return;

    const glyph = field.glyph;
    const intensity = field.intensity;
    const tone = field.tone;
    const n = cols * rows;
    let lit = false;
    for (let i = 0; i < n; i++) {
      const v = intensity[i];
      if (!(v > GLOW_KNEE)) continue; // most cells stop here
      const code = glyph[i];
      if (code === 0 || code === 32) continue;
      // u ∈ (0, 1] above the knee; squaring keeps the halo on the crests only.
      const u = v < 1 ? (v - GLOW_KNEE) * GLOW_SPAN_INV : 1;
      const g = u * u * glowWeight[code < 256 ? code : QUESTION];
      const t = TONE_INDEX[tone[i]] * 3;
      const p = i << 2;
      px[p] = glowRgb[t] * g;
      px[p + 1] = glowRgb[t + 1] * g;
      px[p + 2] = glowRgb[t + 2] * g;
      lit = true;
    }
    // Upload when there is light now, or when last frame's light must be cleared.
    if (lit || glowLit || glowStale) gctx.putImageData(glowImage, 0, 0);
    glowLit = lit;
    glowStale = false;
  }

  /* ── calibrated ramps ── */

  function ramp(candidates: string): GlyphRamp {
    const key = typeof candidates === 'string' ? candidates : RAMPS.classic;
    const cached = ramps.get(key);
    if (cached) return cached;
    // Measured at the current DEVICE metrics: exactly the pixels the atlas draws.
    const c = cell ?? NOMINAL_CELL;
    const built = buildRamp(key, measureGlyphCoverage(key, c.fontPx, c.cellW, c.cellH));
    if (ramps.size >= RAMP_CACHE_LIMIT) ramps.clear();
    ramps.set(key, built);
    return built;
  }

  /* ── teardown ── */

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    backend.destroy();
    releaseSurface(meter);
    meter = null;
    cell = null;
    ramps.clear();
    glowImage = null;
    glowWords = null;
    if (glowEl) {
      glowEl.width = 0;
      glowEl.height = 0;
      for (const prop of GLOW_STYLE_PROPS) glowEl.style.removeProperty(prop);
    }
    canvas.width = 0;
    canvas.height = 0;
    delete canvas.dataset.renderer;
  }

  if (glowEl && gctx) {
    const s = glowEl.style;
    s.mixBlendMode = 'screen';
    s.opacity = GLOW_OPACITY;
    s.imageRendering = 'auto';
    s.pointerEvents = 'none';
    setGlow(1);
  }

  return {
    configure,
    resize,
    draw,
    ramp,
    setGlow,
    get metrics(): RendererMetrics {
      return metrics;
    },
    destroy,
  };
}
