/* ═══════════════════════════════════════════════════════════════════════════
 *  GLYPHFIELD · ENGINE CONTRACT
 *
 *  The shared vocabulary between the ASCII engine (src/engine), the
 *  mathematical experiments (src/experiments + src/math) and the React UI
 *  (src/components). Every module codes against this file.
 *
 *      Equation  →  Computation  →  Character field  →  Visual design
 *      (math/*)     (experiments)    (GlyphField)        (AsciiRenderer → canvas)
 *
 *  Change policy: additive only. Never rename or remove a member.
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ─── Experiments ─────────────────────────────────────────────────────────── */

export type ExperimentId = 'waves' | 'attractor' | 'topology';

export const EXPERIMENT_ORDER: readonly ExperimentId[] = ['waves', 'attractor', 'topology'];

/* ─── Colour ──────────────────────────────────────────────────────────────── */

/**
 * Colour channel a glyph is drawn with. Most of the field is INK; accents are
 * rare and deliberate (≲ 5 % of drawn glyphs).
 */
export const Tone = {
  /** #E9EDF2 — primary glyph colour */
  INK: 0,
  /** #B9F5D0 — primary accent: live, active, highest energy */
  MINT: 1,
  /** #A8C7FF — secondary accent: the "second" thing (second wave, second edge…) */
  ICE: 2,
  /** #788696 — structure: reference geometry, quiver fields, scaffolding */
  MUTED: 3,
} as const;
export type Tone = (typeof Tone)[keyof typeof Tone];

export const TONE_COUNT = 4;
/** Indexed by Tone. */
export const TONE_COLORS: readonly string[] = ['#E9EDF2', '#B9F5D0', '#A8C7FF', '#788696'];
export const BG_COLOR = '#060A10';

/* ─── Glyphs ──────────────────────────────────────────────────────────────── */

/** Every glyph the atlas pre-renders. Experiments must only emit characters from this set. */
export const GLYPH_CHARSET =
  ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~·°×±÷';

/** Candidate ramps (nominal order). The engine calibrates them by *measured* ink coverage. */
export const RAMPS = {
  /** the classic ten-step ramp from the brief */
  classic: ' .:-=+*#%@',
  /** the donut.c luminance ramp — good for shaded 3D surfaces */
  shade: ' .,-~:;=!*#$@',
  /** long, fine-grained ramp for smooth gradients */
  fine: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  /** soft, airy ramp for particles and trails */
  soft: ' ·.:-=+*#',
} as const;

/** Font used for the ASCII field (bundled locally via @fontsource — no network). */
export const GLYPH_FONT_FAMILY = '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';
export const GLYPH_FONT_WEIGHT = 500;

/**
 * The character field every experiment writes into each frame.
 * Flat, row-major typed arrays: index = row * cols + col.
 */
export interface GlyphField {
  readonly cols: number;
  readonly rows: number;
  /** UTF-16 char code per cell. 0 or 32 (space) = empty, not drawn. */
  readonly glyph: Uint16Array;
  /** Brightness 0..1 per cell. Cells below ~0.02 are skipped by the renderer. */
  readonly intensity: Float32Array;
  /** Tone index per cell (see `Tone`). */
  readonly tone: Uint8Array;
  /** Zero all cells. The engine calls this before every `render()`. */
  clear(): void;
  /** Row-major index of an (integer) cell. */
  index(col: number, row: number): number;
  /** Bounds-checked write; out-of-range cells are ignored. */
  set(col: number, row: number, charCode: number, intensity: number, tone?: Tone): void;
  /** Bounds-checked write that only lands if `intensity` ≥ the cell's current intensity (splatting). */
  plot(col: number, row: number, charCode: number, intensity: number, tone?: Tone): void;
}

/** Calibrated luminance ramp: characters sorted by measured ink coverage. */
export interface GlyphRamp {
  /** characters from emptiest (space) to densest */
  readonly chars: string;
  /** char codes, same order as `chars` */
  readonly codes: Uint16Array;
  /** measured ink coverage per char, normalised so the densest char = 1 and space = 0 */
  readonly coverage: Float32Array;
  /** Map a normalised value v ∈ [0,1] to the char code whose coverage is closest (0 → space). */
  codeFor(v: number): number;
  /** Same mapping, returning the index into `chars`. */
  indexFor(v: number): number;
}

/* ─── Input ───────────────────────────────────────────────────────────────── */

export interface StageClick {
  /** stage CSS px */
  x: number;
  y: number;
  /** fractional grid coordinates */
  col: number;
  row: number;
}

/** Read-only pointer state, snapshotted once per frame by the engine. */
export interface PointerSnapshot {
  /** stage CSS px (last known position, even when outside) */
  x: number;
  y: number;
  /** fractional grid coordinates of (x, y) */
  col: number;
  row: number;
  /** movement since the previous frame, CSS px */
  dx: number;
  dy: number;
  /** smoothed velocity, CSS px / s */
  vx: number;
  vy: number;
  /** |v|, CSS px / s */
  speed: number;
  /** pointer is over the stage (false when over UI chrome or outside the window) */
  inside: boolean;
  /** primary button / touch held */
  down: boolean;
  /** went down during this frame */
  pressed: boolean;
  /** released during this frame */
  released: boolean;
  /** held and moved > 4 CSS px since the press */
  dragging: boolean;
  /** completed clicks (press + release, < 6 px travel, < 450 ms) during this frame */
  clicks: readonly StageClick[];
  /** wheel delta accumulated during this frame (CSS px, positive = scroll down) */
  wheel: number;
  /** seconds since the last pointer activity on the stage (Infinity if none yet) */
  idleTime: number;
  /** last input came from touch or pen */
  isTouch: boolean;
}

/* ─── Frame context ───────────────────────────────────────────────────────── */

export interface FrameContext {
  /** grid size in cells */
  cols: number;
  rows: number;
  /** cell size in CSS px (pixel-snapped) */
  cellW: number;
  cellH: number;
  /** stage size in CSS px */
  width: number;
  height: number;
  /** CSS px offset of cell (0,0)'s top-left corner — the grid is centred in the stage */
  originX: number;
  originY: number;
  /** simulation time in seconds — frozen while paused */
  time: number;
  /** simulation delta in seconds — 0 while paused, otherwise clamped to ≤ 1/20 */
  dt: number;
  /** wall-clock delta in seconds — never frozen (use for UI-ish motion such as drag inertia) */
  realDt: number;
  paused: boolean;
  reducedMotion: boolean;
  pointer: PointerSnapshot;
  /** Calibrated ramp for a candidate string (cached). Defaults to RAMPS.classic. */
  ramp(candidates?: string): GlyphRamp;
  /** frame counter since the engine started */
  frame: number;
}

/* ─── Parameters ──────────────────────────────────────────────────────────── */

export type ParamValue = number | boolean | string;
export type ParamValues = Record<string, ParamValue>;

interface ParamBase {
  /** stable key used in the store, the equation display and presets */
  id: string;
  /** UI label, sentence case (e.g. "Crossing angle") */
  label: string;
  /** one short sentence: what this does to the design */
  description?: string;
}

export interface RangeParam extends ParamBase {
  kind: 'range';
  min: number;
  max: number;
  step: number;
  default: number;
  /** math symbol shown beside the label, e.g. "A", "k", "θ" */
  symbol?: string;
  /** short unit shown after the value, e.g. "°", "u/s" */
  unit?: string;
  /** decimals shown in the UI (default: inferred from step) */
  decimals?: number;
  /** "steps" renders an integer range as a row of notches (e.g. half-twists 0…7) */
  ui?: 'slider' | 'steps';
}

export interface ToggleParam extends ParamBase {
  kind: 'toggle';
  default: boolean;
}

export interface SelectParam extends ParamBase {
  kind: 'select';
  options: ReadonlyArray<{ value: string; label: string }>;
  default: string;
}

export type ParamDef = RangeParam | ToggleParam | SelectParam;

export interface ExperimentMeta {
  id: ExperimentId;
  /** "01" | "02" | "03" */
  index: string;
  /** display name, e.g. "WAVEFIELD" */
  name: string;
  /** short dock label, e.g. "WAVES" */
  dockLabel: string;
  /** one-line description */
  subtitle: string;
  /** uppercase interaction hint, e.g. "MOVE TO DISTURB · CLICK TO PULSE" */
  hint: string;
  params: readonly ParamDef[];
}

/* ─── Live readouts (equation card) ───────────────────────────────────────── */

export type ReadoutTone = 'ink' | 'mint' | 'ice' | 'muted';

export interface ProbeRow {
  label: string;
  value: string;
  tone?: ReadoutTone;
}

/**
 * A live peek into the computation at one point — the bridge that lets a
 * visitor see Equation → Computation → Character for a single cell.
 */
export interface ProbeReadout {
  /** short heading, e.g. "AT CURSOR", "PARTICLE #0417", "SURFACE" */
  heading: string;
  /** ordered key/value rows */
  rows: ProbeRow[];
  /** raw computed value at the probe point (e.g. f(x,y,t), |F|, N·L) */
  value?: number;
  /** label for `value`, e.g. "f(x,y,t)", "|F|", "N·L" */
  valueLabel?: string;
  /** normalised intensity 0..1 that the value mapped to */
  intensity?: number;
  /** the glyph finally drawn at the probe cell */
  glyph?: string;
  /** named live variables an equation display may show, e.g. { t, ax, ay } */
  vars?: Record<string, number>;
  /** invariant facts (topology), e.g. [{ label: "SIDES", value: "1" }] */
  facts?: ProbeRow[];
}

/* ─── Experiment ──────────────────────────────────────────────────────────── */

/**
 * Lifecycle (driven by the engine):
 *   factory() → setParams(all) → resize(ctx) → [update(ctx) → field.clear() → render(field, ctx)]*
 *   resize(ctx) again whenever the grid changes; setParams on every UI change;
 *   probe(ctx) ~8×/s; reset() on user reset; dispose() on engine teardown.
 * Instances are created lazily and kept while inactive (inactive ones get no calls).
 * Experiments never touch the DOM.
 */
export interface Experiment {
  readonly id: ExperimentId;
  /** Allocate / re-allocate buffers for the current grid. Called before the first update and on every grid change. */
  resize(ctx: FrameContext): void;
  /** Receive the complete current parameter set. Must be cheap (no heavy rebuilds unless a geometric param changed). */
  setParams(params: Readonly<ParamValues>): void;
  /** Advance the simulation by ctx.dt (which may be 0 while paused). */
  update(ctx: FrameContext): void;
  /** Write this frame into the (already cleared) field. */
  render(field: GlyphField, ctx: FrameContext): void;
  /** Reset simulation / camera state to its beautiful default (params are reset separately by the UI). */
  reset(): void;
  /** Optional live readout for the equation card. */
  probe?(ctx: FrameContext): ProbeReadout | null;
  /** Optional preferred cell-size multiplier (1 = engine default, < 1 = denser). Read every frame. */
  cellScale?(): number;
  /** Release resources. */
  dispose?(): void;
}

export type ExperimentFactory = () => Experiment;

/* ─── Renderer ────────────────────────────────────────────────────────────── */

export interface RendererMetrics {
  /** cell size in CSS px — pixel-snapped so cellW·dpr and cellH·dpr are integers */
  cellW: number;
  cellH: number;
  /** glyph font size in CSS px */
  fontSize: number;
  dpr: number;
}

export interface AsciiRendererAPI {
  /** Measure the font at `fontSize` CSS px and (re)build the glyph atlas. Fonts must already be loaded. */
  configure(fontSize: number, dpr: number): RendererMetrics;
  /** Size the backing store(s) to the stage (CSS px) at the given device-pixel ratio. */
  resize(cssWidth: number, cssHeight: number, dpr: number): void;
  /** Clear to BG_COLOR and draw every non-empty cell. Returns the number of glyphs drawn. */
  draw(field: GlyphField, originX: number, originY: number): number;
  /** Calibrated ramp for a candidate string (cached per string; rebuilt after configure). */
  ramp(candidates: string): GlyphRamp;
  /** Glow layer strength 0..1 (0 disables the glow canvas). */
  setGlow(strength: number): void;
  readonly metrics: RendererMetrics;
  destroy(): void;
}

/* ─── Engine ──────────────────────────────────────────────────────────────── */

export interface EngineStats {
  /** smoothed frames per second */
  fps: number;
  /** smoothed total frame time, ms */
  frameMs: number;
  /** glyphs drawn in the last frame */
  glyphs: number;
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  /** adaptive quality 0.6…1 (1 = full density) */
  quality: number;
  /** simulation time, s */
  time: number;
  mode: ExperimentId;
  paused: boolean;
  transitioning: boolean;
  /** fonts loaded and first frame drawn */
  ready: boolean;
}

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  /** optional low-resolution glow canvas layered above `canvas` */
  glowCanvas?: HTMLCanvasElement | null;
  factories: Record<ExperimentId, ExperimentFactory>;
  mode: ExperimentId;
  params: Record<ExperimentId, ParamValues>;
  paused?: boolean;
  adaptive?: boolean;
  reducedMotion?: boolean;
  /** ~4×/s */
  onStats?: (stats: EngineStats) => void;
  /** ~8×/s */
  onProbe?: (probe: ProbeReadout | null) => void;
}

export interface EngineAPI {
  /** Switch experiment with the glyph-scramble transition. */
  setMode(id: ExperimentId): void;
  setParams(id: ExperimentId, params: Readonly<ParamValues>): void;
  setPaused(paused: boolean): void;
  setAdaptive(enabled: boolean): void;
  setReducedMotion(reduced: boolean): void;
  /** Reset the active experiment's simulation state (camera, particles, ripples). */
  resetSimulation(): void;
  /** Stop the loop, remove listeners, release canvases. Idempotent. */
  destroy(): void;
}
