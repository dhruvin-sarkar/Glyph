import type { Experiment, FrameContext, GlyphField, GlyphRamp, ParamValues, ProbeReadout } from '../engine/types';
import { RAMPS, Tone } from '../engine/types';
import type { GridGeometry } from '../engine/coords';
import { cellCenterX, cellCenterY, pxPerUnit, stageToWorldX, stageToWorldY, worldAspect } from '../engine/coords';
import {
  HORIZON,
  RIPPLE,
  accumulateRipple,
  buildColumnTerms,
  buildRippleProfileTable,
  cameraToPlane,
  contrastCurve,
  deriveWaveConstants,
  footprintGain,
  glyphBrightness,
  horizonHeadingDeg,
  makeCamera,
  normalizeField,
  planeToCamera,
  planeWaves,
  planeWavesRowRecurrence,
  planeWavesRowSeparable,
  rippleRadius,
  rippleValue,
  screenToPlane,
  wavesInCameraFrame,
} from '../math/waves';
import type { Camera, ColumnTerms, PlaneHit, RippleFilter, RowGrid, WaveConstants } from '../math/waves';

/* ═══════════════════════════════════════════════════════════════════════════
 *  01 · WAVEFIELD — docs/SPEC.md §4.1
 *
 *      f(x, y, t) = A·sin(k₁·r − ωt) + A·sin(k₂·r − ωt) + Σᵢ ρᵢ(x, y, t)
 *
 *  Every frame:
 *    1. ripples  — each live ripple adds its ring into `rippleBuf`, visiting only
 *                  the cells inside its band (math/waves.ts · accumulateRipple)
 *    2. waves    — the two plane waves fill `waveBuf` row by row: separable
 *                  sin(a+b) in the top-down view, a rotation recurrence in perspective
 *    3. shading  — f = wave + ripple → n = ½ + ½·tanh(f/1.5) → contrast curve n′ →
 *                  calibrated glyph + brightness. f → (glyph, brightness) depends on
 *                  nothing else, so it is tabulated once (2048 entries) and looked up.
 *    4. sky      — in the horizon view: a few dim, slowly twinkling stars.
 *
 *  The view switch is a real camera move (math/waves.ts · makeCamera): the
 *  top-down map tips away from you until it becomes the ocean.
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ─── Rendering ───────────────────────────────────────────────────────────── */

/** The shading table covers f ∈ [−F_LIMIT, F_LIMIT]; tanh(8 / 1.5) has saturated to 0.99995. */
const F_LIMIT = 8;
const LUT_SIZE = 2048;
const LUT_SCALE = LUT_SIZE / (2 * F_LIMIT);

/** Seconds for the camera move between the two projections. */
const VIEW_MOVE_SECONDS = 1.4;

/**
 * MINT marks a crest HIGHER than the two plane waves could ever reach on their
 * own (A₁ + A₂): only a ripple can lift it there. Rare by construction.
 */
const MINT_RIPPLE = 0.2;
const MINT_MARGIN = 0.05;

/* ─── Ripples ─────────────────────────────────────────────────────────────── */

/** Ripples fainter than this (B·s·e^{−τ/T}) are recycled. */
const CULL_AMPLITUDE = 0.02;
/** s of a click / press. */
const PRESS_STRENGTH = 1;
/** A moving pointer drops a small pulse every WAKE_SPACING screen units travelled … */
const WAKE_SPACING = 0.075;
/** … of strength WAKE_STRENGTH·min(1, speed / WAKE_SPEED_REF). */
const WAKE_STRENGTH = 0.34;
const WAKE_SPEED_REF = 1.6;
const WAKE_MIN = 0.04;
/** Dragging stirs harder. */
const DRAG_GAIN = 1.9;
const DRAG_MAX = 0.8;
const WAKE_PER_FRAME = 6;
/** Points farther than this along the camera ray are too close to the horizon to disturb visibly. */
const MAX_DISTURB_DEPTH = 40;

/* ─── Ghost (keeps the field alive when nobody is playing) ───────────────── */

const GHOST_IDLE_SECONDS = 4;
const GHOST_FIRST_DELAY = 0.8;
const GHOST_INTERVAL_MIN = 1.2;
const GHOST_INTERVAL_MAX = 2.0;
const GHOST_STRENGTH = 0.46;
const GHOST_SEED = 0x2545f491;

/* ─── Sky ─────────────────────────────────────────────────────────────────── */

const STAR_COUNT = 84;
const STAR_SEED = 0x9e3779b9;
const CHAR_DOT = 46; // '.'
const CHAR_MIDDOT = 183; // '·'

const EMPTY_F64 = new Float64Array(0);
const EMPTY_U8 = new Uint8Array(0);

type View = 'horizon' | 'plane';

/** Deterministic PRNG step (mulberry32): returns [new state, value in [0, 1)]. */
function mulberry(state: number): number {
  return (state + 0x6d2b79f5) >>> 0;
}
function mulberryValue(state: number): number {
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function smoothstep(x: number): number {
  const t = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return t * t * (3 - 2 * t);
}

/** 6t⁵ − 15t⁴ + 10t³ — starts and ends with zero velocity AND acceleration (a calm camera move). */
function smootherstep(x: number): number {
  const t = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return t * t * t * (t * (6 * t - 15) + 10);
}

/** Fixed decimals with a true minus sign (U+2212); never prints "−0.000". */
function fmt(v: number, decimals: number): string {
  const text = Math.abs(v).toFixed(decimals);
  return v < 0 && Number(text) !== 0 ? `−${text}` : text;
}

class Wavefield implements Experiment {
  readonly id = 'waves' as const;

  /* parameters — `wc` in plane coordinates, `wcCam` the same waves in the camera frame */
  private wc: WaveConstants = deriveWaveConstants({});
  private wcCam: WaveConstants = deriveWaveConstants({});
  private hasParams = false;

  /* camera: tilt is the linear progress 0 (top-down) → 1 (horizon); its eased value drives the camera */
  private tilt = 1;
  private tiltTarget = 1;
  private readonly cam: Camera = makeCamera(1);
  private builtTilt = Number.NaN;
  private tablesDirty = true;
  private termsDirty = true;

  /* grid */
  private cols = 0;
  private rows = 0;
  private readonly geom: GridGeometry = {
    width: 0,
    height: 0,
    cols: 0,
    rows: 0,
    cellW: 0,
    cellH: 0,
    originX: 0,
    originY: 0,
  };
  /** cell size and stage half-width in world units */
  private cellWu = 0;
  private cellHu = 0;
  private aspect = 1;
  /** screen (world units) x of each column centre / y of each row centre */
  private colX = EMPTY_F64;
  private rowYs = EMPTY_F64;

  /* per-row tables — rebuilt only when the camera, the grid or the parameters change */
  private readonly grid: RowGrid = { cols: 0, rows: 0, x0: EMPTY_F64, dx: EMPTY_F64, y: EMPTY_F64, valid: EMPTY_U8 };
  private readonly filter: RippleFilter = { strength: 0, colX: EMPTY_F64, footY: EMPTY_F64, footTX: EMPTY_F64 };
  private rowDist = EMPTY_F64;
  /** amplitudes after averaging over each row's footprint (= A₁, A₂ in the top-down view) */
  private rowA1 = EMPTY_F64;
  private rowA2 = EMPTY_F64;
  /** f above which a ripple-lifted crest turns MINT */
  private rowMint = EMPTY_F64;
  /** brightness multiplier: depth fog × horizon glow (1 in the top-down view) */
  private rowLight = new Float32Array(0);
  /** haze offset added to f before shading (0 in the top-down view) */
  private rowBias = EMPTY_F64;
  /**
   * Shimmer: weight of the swell strength √(2E) in rows whose crests are too
   * small to draw, with 2E = P + Q·cos(φ₁ − φ₂) (P = A₁² + A₂², Q = 2A₁A₂ × blur gain).
   */
  private rowShimmer = EMPTY_F64;
  private rowP = EMPTY_F64;
  private rowQ = EMPTY_F64;
  /**
   * Blur of the lanes, per cell: Δφ² = L + (M·x_s + N)², where x_s is the column's
   * screen x (lanes converge on the vanishing point, so they are finer at the sides).
   */
  private rowLaneL = EMPTY_F64;
  private rowLaneM = EMPTY_F64;
  private rowLaneN = EMPTY_F64;
  private terms: ColumnTerms | null = null;
  private termsK1 = Number.NaN;
  private termsK2 = Number.NaN;

  /* per-cell buffers */
  private waveBuf = new Float32Array(0);
  private rippleBuf = new Float32Array(0);
  /** cos(φ₁ − φ₂) per cell (perspective rows that shimmer) */
  private beatBuf = new Float32Array(0);

  /* f → glyph / brightness table, rebuilt when the calibrated ramp changes */
  private lutRamp: GlyphRamp | null = null;
  private readonly lutCode = new Uint16Array(LUT_SIZE);
  private readonly lutLight = new Float32Array(LUT_SIZE);
  private readonly profile = buildRippleProfileTable();

  /* ripple pool (struct of arrays); rs = 0 marks a free slot */
  private readonly rx = new Float64Array(RIPPLE.max);
  private readonly ry = new Float64Array(RIPPLE.max);
  private readonly rt = new Float64Array(RIPPLE.max);
  private readonly rs = new Float64Array(RIPPLE.max);

  /* pointer wake: screen point (world units) of the last wake pulse */
  private wakeArmed = false;
  private wakeX = 0;
  private wakeY = 0;

  /* ghost emitter */
  private ghostAwake = false;
  private ghostClock = 0;
  private ghostNext = GHOST_FIRST_DELAY;
  private ghostSeed = GHOST_SEED;
  private ghostX = 0;
  private ghostY = 0;

  /* probe target cell */
  private probeCol = 0;
  private probeRow = 0;
  private probeGhost = true;
  private lastField: GlyphField | null = null;

  /* stars: normalised positions are fixed; cells are recomputed on resize */
  private readonly starU = new Float32Array(STAR_COUNT);
  private readonly starV = new Float32Array(STAR_COUNT);
  private readonly starB = new Float32Array(STAR_COUNT);
  private readonly starW = new Float32Array(STAR_COUNT);
  private readonly starPhase = new Float32Array(STAR_COUNT);
  private readonly starCode = new Uint16Array(STAR_COUNT);
  private readonly starCol = new Int32Array(STAR_COUNT);
  private readonly starRow = new Int32Array(STAR_COUNT);

  /* scratch */
  private readonly hit: PlaneHit = { X: 0, Y: 0, x: 0, y: 0, t: 0 };
  private readonly hitTop: PlaneHit = { X: 0, Y: 0, x: 0, y: 0, t: 0 };
  private readonly hitBot: PlaneHit = { X: 0, Y: 0, x: 0, y: 0, t: 0 };

  constructor() {
    let seed = STAR_SEED;
    const next = (): number => {
      seed = mulberry(seed);
      return mulberryValue(seed);
    };
    for (let i = 0; i < STAR_COUNT; i++) {
      this.starU[i] = next();
      this.starV[i] = 0.02 + 0.36 * next();
      // mostly very faint, a few a little brighter
      this.starB[i] = 0.05 + 0.13 * Math.pow(next(), 3);
      // twinkle periods of 12–40 s: barely perceptible
      this.starW[i] = 0.16 + 0.36 * next();
      this.starPhase[i] = Math.PI * 2 * next();
      this.starCode[i] = next() < 0.72 ? CHAR_DOT : CHAR_MIDDOT;
    }
  }

  /* ─── Experiment lifecycle ────────────────────────────────────────────── */

  resize(ctx: FrameContext): void {
    const g = this.geom;
    g.width = ctx.width;
    g.height = ctx.height;
    g.cols = ctx.cols;
    g.rows = ctx.rows;
    g.cellW = ctx.cellW;
    g.cellH = ctx.cellH;
    g.originX = ctx.originX;
    g.originY = ctx.originY;

    const cols = Math.max(0, Math.floor(ctx.cols));
    const rows = Math.max(0, Math.floor(ctx.rows));
    if (cols !== this.cols) {
      this.colX = new Float64Array(cols);
      this.terms = null;
    }
    if (rows !== this.rows) {
      this.rowYs = new Float64Array(rows);
      this.grid.x0 = new Float64Array(rows);
      this.grid.dx = new Float64Array(rows);
      this.grid.y = new Float64Array(rows);
      this.grid.valid = new Uint8Array(rows);
      this.filter.footY = new Float64Array(rows);
      this.filter.footTX = new Float64Array(rows);
      this.rowDist = new Float64Array(rows);
      this.rowA1 = new Float64Array(rows);
      this.rowA2 = new Float64Array(rows);
      this.rowMint = new Float64Array(rows);
      this.rowLight = new Float32Array(rows);
      this.rowBias = new Float64Array(rows);
      this.rowShimmer = new Float64Array(rows);
      this.rowP = new Float64Array(rows);
      this.rowQ = new Float64Array(rows);
      this.rowLaneL = new Float64Array(rows);
      this.rowLaneM = new Float64Array(rows);
      this.rowLaneN = new Float64Array(rows);
    }
    if (cols * rows !== this.waveBuf.length) {
      this.waveBuf = new Float32Array(cols * rows);
      this.rippleBuf = new Float32Array(cols * rows);
      this.beatBuf = new Float32Array(cols * rows);
    }
    this.cols = cols;
    this.rows = rows;
    this.grid.cols = cols;
    this.grid.rows = rows;
    this.filter.colX = this.colX;

    const ppu = pxPerUnit(g);
    this.cellWu = ctx.cellW / ppu;
    this.cellHu = ctx.cellH / ppu;
    this.aspect = worldAspect(g);
    for (let c = 0; c < cols; c++) this.colX[c] = stageToWorldX(cellCenterX(c, g), g);
    for (let r = 0; r < rows; r++) this.rowYs[r] = stageToWorldY(cellCenterY(r, g), g);

    for (let i = 0; i < STAR_COUNT; i++) {
      this.starCol[i] = Math.min(cols - 1, Math.floor(this.starU[i] * cols));
      this.starRow[i] = Math.min(rows - 1, Math.floor(this.starV[i] * rows));
    }

    this.tablesDirty = true;
    this.termsDirty = true;
    this.lastField = null;
  }

  setParams(params: Readonly<ParamValues>): void {
    this.wc = deriveWaveConstants(params);
    // the camera heading, the rotated wave vectors and the anti-aliased amplitudes depend on A, k, θ, second
    this.tablesDirty = true;

    const view: View = params.view === 'plane' ? 'plane' : 'horizon';
    this.tiltTarget = view === 'horizon' ? 1 : 0;
    if (!this.hasParams) {
      this.tilt = this.tiltTarget; // first parameters: no camera move
      this.hasParams = true;
    }
  }

  update(ctx: FrameContext): void {
    this.syncGrid(ctx);
    if (this.cols === 0 || this.rows === 0) return;

    // 1 · Camera move between projections (wall-clock time, so it also plays while paused).
    if (this.tilt !== this.tiltTarget) {
      const step = ctx.reducedMotion ? 1 : ctx.realDt / VIEW_MOVE_SECONDS;
      this.tilt =
        this.tilt < this.tiltTarget ? Math.min(this.tiltTarget, this.tilt + step) : Math.max(this.tiltTarget, this.tilt - step);
    }
    const e = smootherstep(this.tilt);
    if (this.tablesDirty || e !== this.builtTilt) this.buildTables(e);

    // 2 · Ripples: forget the faint ones, then listen to the pointer (or the ghost).
    this.cullRipples(ctx.time, e);
    const active = this.handlePointer(ctx);
    this.runGhost(ctx, active, e);

    // 3 · Probe target: the cursor's cell, or the ghost's.
    const g = this.geom;
    let col: number;
    let row: number;
    if (active) {
      col = Math.floor(ctx.pointer.col);
      row = Math.floor(ctx.pointer.row);
    } else {
      col = Math.floor((this.ghostX - g.originX) / g.cellW);
      row = Math.floor((this.ghostY - g.originY) / g.cellH);
    }
    this.probeCol = Math.min(this.cols - 1, Math.max(0, col));
    this.probeRow = Math.min(this.rows - 1, Math.max(0, row));
    this.probeGhost = !active;
  }

  render(field: GlyphField, ctx: FrameContext): void {
    this.syncGrid(ctx);
    const { cols, rows } = this;
    if (cols === 0 || rows === 0 || field.cols !== cols || field.rows !== rows) return;
    const e = smootherstep(this.tilt);
    if (this.tablesDirty || e !== this.builtTilt) this.buildTables(e);
    this.refreshTable(ctx.ramp(RAMPS.classic));

    const time = ctx.time;
    const wc = this.wcCam; // the waves in the camera frame (= plane frame in the top-down view)
    const grid = this.grid;
    const valid = grid.valid;

    // 1 · Ripples → rippleBuf (band cells only). Centres are stored in plane
    //     coordinates and rotated into the camera frame of the grid.
    const ripple = this.rippleBuf;
    ripple.fill(0);
    if (wc.B > 0) {
      const filter = e > 0 ? this.filter : null;
      const centre = this.hit;
      for (let i = 0; i < RIPPLE.max; i++) {
        const s = this.rs[i];
        if (s <= 0) continue;
        const tau = time - this.rt[i];
        if (tau < 0) continue;
        const amp = wc.B * s * Math.exp(-tau / RIPPLE.T);
        planeToCamera(this.cam, this.rx[i], this.ry[i], centre);
        accumulateRipple(ripple, grid, centre.X, centre.Y, rippleRadius(tau), amp, this.profile, filter);
      }
    }

    // 2 · Plane waves → waveBuf.
    const wave = this.waveBuf;
    if (e === 0) {
      // Top-down: separable sin(a + b) with the column halves cached (rebuilt when k or θ change).
      if (this.termsDirty || !this.terms || wc.k1x !== this.termsK1 || wc.k2x !== this.termsK2) {
        this.terms = buildColumnTerms(wc, this.colX, this.terms);
        this.termsK1 = wc.k1x;
        this.termsK2 = wc.k2x;
        this.termsDirty = false;
      }
      for (let r = 0; r < rows; r++) planeWavesRowSeparable(wc, this.terms, grid.y[r], time, wave, r * cols);
    } else {
      // Perspective: each row is a line on the plane → rotation recurrence along it.
      for (let r = 0; r < rows; r++) {
        if (valid[r] === 0) continue;
        const beat = this.rowShimmer[r] > 0 ? this.beatBuf : null;
        planeWavesRowRecurrence(wc, grid.x0[r], grid.dx[r], grid.y[r], time, wave, r * cols, cols, this.rowA1[r], this.rowA2[r], beat);
      }
    }

    // 3 · Shading: f → table → glyph, brightness, tone.
    const glyph = field.glyph;
    const light = field.intensity;
    const tone = field.tone;
    const lutCode = this.lutCode;
    const lutLight = this.lutLight;
    const beat = this.beatBuf;
    const colX = this.colX;
    for (let r = 0; r < rows; r++) {
      if (valid[r] === 0) continue;
      const rowLight = this.rowLight[r];
      const mintAt = this.rowMint[r];
      const bias = this.rowBias[r];
      const shimmer = this.rowShimmer[r];
      const P = this.rowP[r];
      const Q = this.rowQ[r];
      const laneL = this.rowLaneL[r];
      const laneM = this.rowLaneM[r];
      const laneN = this.rowLaneN[r];
      const base = r * cols;
      for (let c = 0; c < cols; c++) {
        const i = base + c;
        const rip = ripple[i];
        const f = wave[i] + rip;
        let v = f + bias;
        if (shimmer > 0) {
          // Too far to draw single crests: show how strong the swell is here instead,
          // 2E = A₁² + A₂² + 2A₁A₂·cos(φ₁ − φ₂), with the lanes blurred over the cell.
          const m = laneM * colX[c] + laneN;
          const e2 = P + Q * footprintGain(laneL + m * m) * beat[i];
          if (e2 > 0) v += shimmer * Math.sqrt(e2);
        }
        let k = ((v + F_LIMIT) * LUT_SCALE) | 0;
        if (k < 0) k = 0;
        else if (k >= LUT_SIZE) k = LUT_SIZE - 1;
        const code = lutCode[k];
        if (code === 0) continue;
        const b = lutLight[k] * rowLight;
        glyph[i] = code;
        light[i] = b < 1 ? b : 1;
        if (rip > MINT_RIPPLE && f > mintAt) tone[i] = Tone.MINT;
      }
    }

    // 4 · Sky.
    if (e > 0) this.renderSky(field, time, e);
    this.lastField = field;
  }

  reset(): void {
    this.rs.fill(0);
    this.wakeArmed = false;
    this.ghostAwake = false;
    this.ghostClock = 0;
    this.ghostNext = GHOST_FIRST_DELAY;
    this.ghostSeed = GHOST_SEED;
  }

  probe(ctx: FrameContext): ProbeReadout | null {
    const { cols, rows } = this;
    if (cols === 0 || rows === 0) return null;
    const c = this.probeCol;
    const r = this.probeRow;
    const grid = this.grid;
    if (r >= rows || c >= cols || grid.valid[r] === 0) return null;

    // Exact evaluation of the equation at the probe cell's centre (no tables, no filtering),
    // back in plane coordinates.
    const p = cameraToPlane(this.cam, grid.x0[r] + c * grid.dx[r], grid.y[r], this.hitTop);
    const x = p.x;
    const y = p.y;
    const t = ctx.time;
    const wc = this.wc;
    let f = planeWaves(wc, x, y, t);
    for (let i = 0; i < RIPPLE.max; i++) {
      const s = this.rs[i];
      if (s <= 0) continue;
      f += rippleValue(Math.hypot(x - this.rx[i], y - this.ry[i]), t - this.rt[i], wc.B, s);
    }
    const n = normalizeField(f);

    const field = this.lastField;
    const code = field && field.cols === cols && field.rows === rows ? field.glyph[r * cols + c] : 0;
    const glyph = code > 32 ? String.fromCharCode(code) : ' ';

    return {
      heading: this.probeGhost ? 'GHOST' : 'AT CURSOR',
      rows: [
        { label: 'x', value: fmt(x, 3) },
        { label: 'y', value: fmt(y, 3) },
        { label: 't', value: `${fmt(t, 2)} s` },
        { label: 'f', value: fmt(f, 3), tone: 'mint' },
        { label: 'n', value: fmt(n, 3) },
        { label: 'glyph', value: glyph === ' ' ? 'space' : glyph },
      ],
      value: f,
      valueLabel: 'f(x,y,t)',
      intensity: n,
      glyph,
      vars: { t, x, y },
    };
  }

  dispose(): void {
    this.rs.fill(0);
    this.lastField = null;
    this.lutRamp = null;
    this.terms = null;
    this.waveBuf = new Float32Array(0);
    this.rippleBuf = new Float32Array(0);
  }

  /* ─── Grid & tables ───────────────────────────────────────────────────── */

  private syncGrid(ctx: FrameContext): void {
    const g = this.geom;
    if (
      ctx.cols !== g.cols ||
      ctx.rows !== g.rows ||
      ctx.width !== g.width ||
      ctx.height !== g.height ||
      ctx.cellW !== g.cellW ||
      ctx.cellH !== g.cellH ||
      ctx.originX !== g.originX ||
      ctx.originY !== g.originY
    ) {
      this.resize(ctx);
    }
  }

  /**
   * Per-row geometry for the current camera: which plane line each row shows,
   * how much water one cell covers (for anti-aliasing), depth fog and glow.
   */
  private buildTables(e: number): void {
    const cam = makeCamera(e, horizonHeadingDeg(this.wc.thetaDeg), this.cam);
    const wc = wavesInCameraFrame(this.wc, cam, this.wcCam);
    const { rows, grid, filter } = this;
    const F = cam.F;
    const halfCell = this.cellHu / 2;
    const xLeft = this.colX.length > 0 ? this.colX[0] : 0;
    const hit = this.hit;
    const top = this.hitTop;
    const bot = this.hitBot;

    let nearest = Infinity;
    for (let r = 0; r < rows; r++) {
      const ys = this.rowYs[r];
      if (!screenToPlane(cam, 0, ys, hit)) {
        grid.valid[r] = 0;
        filter.footY[r] = Infinity;
        filter.footTX[r] = 0;
        this.rowDist[r] = Infinity;
        continue;
      }
      grid.valid[r] = 1;
      grid.y[r] = hit.Y;
      // X = (x_s / f)·t: linear in the column, so the row is the line X = x0 + c·dx
      grid.x0[r] = (xLeft / F) * hit.t;
      grid.dx[r] = (this.cellWu / F) * hit.t;
      const sy = (ys - cam.p) / F;
      const dist = hit.t * Math.sqrt(1 + sy * sy);
      this.rowDist[r] = dist;
      if (dist < nearest) nearest = dist;
      // the patch of water one cell covers: trace its top and bottom edges
      if (screenToPlane(cam, 0, ys + halfCell, top) && screenToPlane(cam, 0, ys - halfCell, bot)) {
        filter.footY[r] = top.Y - bot.Y;
        filter.footTX[r] = (top.t - bot.t) / F;
      } else {
        filter.footY[r] = Infinity;
        filter.footTX[r] = 0;
      }
    }
    filter.strength = e;

    // Anti-aliasing (math/waves.ts · footprintGain): a glyph shows the wave blurred over
    // its own cell, which keeps e^{−Δφ²/8} of a sine whose phase changes by Δφ across
    // it. Far rows cover many crests → the sea calms into fine texture, never noise.
    const meanX2 = (this.aspect * this.aspect) / 3; // mean of x_s² across the row
    const glowW = HORIZON.glowRows * this.cellHu;
    const fullA = wc.A1 + wc.A2;
    for (let r = 0; r < rows; r++) {
      this.rowShimmer[r] = 0;
      this.rowP[r] = 0;
      this.rowQ[r] = 0;
      if (grid.valid[r] === 0) {
        this.rowA1[r] = 0;
        this.rowA2[r] = 0;
        this.rowLight[r] = 0;
        this.rowBias[r] = 0;
        this.rowMint[r] = Infinity;
        continue;
      }
      let a1 = wc.A1;
      let a2 = wc.A2;
      let light = 1;
      let bias = 0;
      let lanes = false;
      if (e > 0) {
        const fy = filter.footY[r];
        if (fy < Infinity) {
          const dx = grid.dx[r];
          const ftx = filter.footTX[r];
          const q1 = (wc.k1x * dx) ** 2 + (wc.k1y * fy) ** 2 + (wc.k1x * ftx) ** 2 * meanX2;
          const q2 = (wc.k2x * dx) ** 2 + (wc.k2y * fy) ** 2 + (wc.k2x * ftx) ** 2 * meanX2;
          a1 *= footprintGain(e * q1);
          a2 *= footprintGain(e * q2);
          // the lanes vary with (k₁ − k₂)·r — much more slowly than the crests
          const bx = wc.k1x - wc.k2x;
          const by = wc.k1y - wc.k2y;
          const se = Math.sqrt(e);
          this.rowLaneL[r] = e * (bx * dx) ** 2;
          this.rowLaneM[r] = se * bx * ftx;
          this.rowLaneN[r] = se * by * fy;
          lanes = true;
        } else {
          a1 = 0;
          a2 = 0;
        }
        // exponential depth fog (blended in with the tilt) …
        const fog = Math.exp(-(this.rowDist[r] - nearest) / HORIZON.fog);
        light = 1 - e * (1 - fog);
        // … and a soft glow along the horizon
        if (cam.horizonY < Infinity) {
          const u = (cam.horizonY - this.rowYs[r]) / glowW;
          light += e * HORIZON.glow * Math.exp(-u * u);
        }
        // the flatter the blurred sea, the further its calm level sinks into haze …
        const flat = fullA > 0 ? 1 - (a1 + a2) / fullA : 0;
        bias = -HORIZON.haze * e * flat;
        // … and the more its glyphs show the swell's strength √(2E) instead of single crests
        if (flat > 0.002) {
          this.rowShimmer[r] = HORIZON.shimmer * e * flat;
          this.rowP[r] = wc.A1 * wc.A1 + wc.A2 * wc.A2;
          this.rowQ[r] = lanes ? 2 * wc.A1 * wc.A2 : 0;
        }
      }
      this.rowA1[r] = a1;
      this.rowA2[r] = a2;
      this.rowLight[r] = light;
      this.rowBias[r] = bias;
      this.rowMint[r] = a1 + a2 + MINT_MARGIN;
    }

    this.builtTilt = e;
    this.tablesDirty = false;
  }

  /** f → glyph code and brightness, through n = ½ + ½·tanh(f/1.5) and the contrast curve. */
  private refreshTable(ramp: GlyphRamp): void {
    if (ramp === this.lutRamp) return;
    this.lutRamp = ramp;
    for (let i = 0; i < LUT_SIZE; i++) {
      const f = -F_LIMIT + (i + 0.5) / LUT_SCALE;
      const coverage = contrastCurve(normalizeField(f));
      const code = coverage > 0 ? ramp.codeFor(coverage) : 0;
      if (code === 0 || code === 32) {
        this.lutCode[i] = 0;
        this.lutLight[i] = 0;
      } else {
        this.lutCode[i] = code;
        this.lutLight[i] = glyphBrightness(coverage);
      }
    }
  }

  /* ─── Ripples ─────────────────────────────────────────────────────────── */

  /** Put a ripple in a free slot, or recycle the faintest one (the ring buffer never grows). */
  private emit(x: number, y: number, s: number, time: number): void {
    if (!(s > 0)) return;
    let slot = 0;
    let weakest = Infinity;
    for (let i = 0; i < RIPPLE.max; i++) {
      if (this.rs[i] <= 0) {
        slot = i;
        break;
      }
      const a = this.rs[i] * Math.exp(-(time - this.rt[i]) / RIPPLE.T);
      if (a < weakest) {
        weakest = a;
        slot = i;
      }
    }
    this.rx[slot] = x;
    this.ry[slot] = y;
    this.rt[slot] = time;
    this.rs[slot] = s;
  }

  private cullRipples(time: number, e: number): void {
    const B = this.wc.B;
    // top-down only: a ring whose quiet hole already covers the whole stage is gone
    const ax = this.aspect;
    const reach = this.profile.reach;
    for (let i = 0; i < RIPPLE.max; i++) {
      const s = this.rs[i];
      if (s <= 0) continue;
      const tau = time - this.rt[i];
      if (tau < 0 || B * s * Math.exp(-tau / RIPPLE.T) < CULL_AMPLITUDE) {
        this.rs[i] = 0;
        continue;
      }
      if (e === 0) {
        const fx = Math.abs(this.rx[i]) + ax;
        const fy = Math.abs(this.ry[i]) + 1;
        if (rippleRadius(tau) - reach > Math.hypot(fx, fy)) this.rs[i] = 0;
      }
    }
  }

  /** Screen point (world units) → the water under it, if it is on the plane and not lost at the horizon. */
  private screenToWater(xs: number, ys: number, out: PlaneHit): boolean {
    const cam = this.cam;
    if (cam.horizonY < Infinity && ys > cam.horizonY - this.cellHu) return false;
    return screenToPlane(cam, xs, ys, out) && out.t <= MAX_DISTURB_DEPTH;
  }

  /**
   * Press → strong pulse. Movement → small pulses spaced by distance travelled,
   * scaled by speed (a wake). Drag → stronger stirring. Returns true while the
   * visitor is actively playing (the ghost stays asleep).
   */
  private handlePointer(ctx: FrameContext): boolean {
    const p = ctx.pointer;
    if (!p.inside) {
      this.wakeArmed = false;
      return false;
    }
    const g = this.geom;
    const xs = stageToWorldX(p.x, g);
    const ys = stageToWorldY(p.y, g);
    const hit = this.hit;
    if (!this.screenToWater(xs, ys, hit)) {
      this.wakeArmed = false; // over the sky: nothing to disturb
      return false;
    }
    if (p.pressed) this.emit(hit.x, hit.y, PRESS_STRENGTH, ctx.time);

    if (!this.wakeArmed || ctx.dt === 0) {
      this.wakeX = xs;
      this.wakeY = ys;
      this.wakeArmed = true;
    } else {
      const spacing = p.dragging ? WAKE_SPACING * 0.8 : WAKE_SPACING;
      const ddx = xs - this.wakeX;
      const ddy = ys - this.wakeY;
      const dist = Math.hypot(ddx, ddy);
      if (dist >= spacing) {
        const speed = p.speed / pxPerUnit(g);
        let s = WAKE_STRENGTH * Math.min(1, speed / WAKE_SPEED_REF);
        if (p.dragging) s = Math.min(DRAG_MAX, s * DRAG_GAIN + 0.12);
        const steps = Math.floor(dist / spacing);
        const n = Math.min(steps, WAKE_PER_FRAME);
        // spread this frame's pulses evenly along the path just travelled
        const stride = steps > WAKE_PER_FRAME ? dist / n : spacing;
        const ux = ddx / dist;
        const uy = ddy / dist;
        if (s >= WAKE_MIN) {
          for (let k = 1; k <= n; k++) {
            if (this.screenToWater(this.wakeX + ux * stride * k, this.wakeY + uy * stride * k, hit)) {
              this.emit(hit.x, hit.y, s, ctx.time);
            }
          }
        }
        this.wakeX += ux * stride * n;
        this.wakeY += uy * stride * n;
      }
    }
    return p.idleTime < GHOST_IDLE_SECONDS;
  }

  /** When nobody plays, a ghost drifts on a slow Lissajous curve and lets gentle drops fall. */
  private runGhost(ctx: FrameContext, active: boolean, e: number): void {
    const g = this.geom;
    // ghost path in stage fractions — over the open water, clear of the UI panels
    const T = this.ghostClock;
    const u = 0.5 + 0.2 * Math.sin(0.093 * T + 0.7) + 0.05 * Math.sin(0.257 * T + 2.1);
    const vCentre = 0.56 + (0.73 - 0.56) * e;
    const vSwing = 0.18 + (0.09 - 0.18) * e;
    const v = vCentre + vSwing * Math.sin(0.147 * T + 0.3);
    this.ghostX = u * g.width;
    this.ghostY = v * g.height;

    if (active) {
      this.ghostAwake = false;
      return;
    }
    if (!this.ghostAwake) {
      this.ghostAwake = true;
      this.ghostNext = this.ghostClock + GHOST_FIRST_DELAY;
    }
    this.ghostClock += ctx.dt;
    if (ctx.dt > 0 && this.ghostClock >= this.ghostNext) {
      const hit = this.hit;
      if (this.screenToWater(stageToWorldX(this.ghostX, g), stageToWorldY(this.ghostY, g), hit)) {
        const gentle = ctx.reducedMotion ? 0.6 : 1;
        this.emit(hit.x, hit.y, GHOST_STRENGTH * (0.85 + 0.3 * this.ghostRandom()) * gentle, ctx.time);
      }
      const wait = GHOST_INTERVAL_MIN + (GHOST_INTERVAL_MAX - GHOST_INTERVAL_MIN) * this.ghostRandom();
      this.ghostNext = this.ghostClock + wait * (ctx.reducedMotion ? 1.4 : 1);
    }
  }

  private ghostRandom(): number {
    this.ghostSeed = mulberry(this.ghostSeed);
    return mulberryValue(this.ghostSeed);
  }

  /* ─── Sky ─────────────────────────────────────────────────────────────── */

  /** A quiet night sky: sparse, very dim dots with an extremely slow twinkle. */
  private renderSky(field: GlyphField, time: number, e: number): void {
    const horizonY = this.cam.horizonY;
    if (!(horizonY < 1)) return; // the horizon is still above the screen
    const { cols } = this;
    const glyph = field.glyph;
    const light = field.intensity;
    const valid = this.grid.valid;
    for (let i = 0; i < STAR_COUNT; i++) {
      const r = this.starRow[i];
      if (r < 0 || valid[r] !== 0) continue;
      const rowsAbove = (this.rowYs[r] - horizonY) / this.cellHu;
      if (rowsAbove < 2) continue;
      const fade = smoothstep((rowsAbove - 2) / 6) * e;
      const twinkle = 0.62 + 0.38 * Math.sin(this.starW[i] * time + this.starPhase[i]);
      const idx = r * cols + this.starCol[i];
      glyph[idx] = this.starCode[i];
      light[idx] = this.starB[i] * twinkle * fade;
    }
  }
}

/** Experiment 01 — WAVEFIELD. */
export function createWavefield(): Experiment {
  return new Wavefield();
}
