import type {
  Experiment,
  FrameContext,
  GlyphField,
  GlyphRamp,
  ParamValues,
  ProbeReadout,
  ProbeRow,
} from '../engine/types';
import { RAMPS, Tone } from '../engine/types';
import { BAND_R, BandSamples, deriveBandConstants, sampleBand, type BandConstants } from '../math/mobius';
import { rotationFromYawPitch } from '../math/linalg';

/* ═══════════════════════════════════════════════════════════════════════════
 *  EXPERIMENT 03 · TOPOLOGY — a software 3-D renderer that draws a twisted
 *  band out of glyphs (docs/SPEC.md §4.3). No WebGL, no Three.js: just maths.
 *
 *    1. SAMPLE   r(u, v) and its unit normal N̂ on an nu × nv grid — only when
 *                n or w change (math/mobius.ts · sampleBand).
 *    2. ROTATE   every sample with one 3×3 matrix built from yaw and pitch.
 *    3. PROJECT  perspective: screen = centre + f·(x, −y)/depth, then
 *                stage px → character cells (cells are ~2× taller than wide,
 *                so x and y are divided by different cell sizes — no squash).
 *    4. DICE     each little grid patch into enough sample points that
 *                neighbours land ≤ ⅓ cell apart (≈ 3 samples per cell along
 *                each direction) — so no cell inside the surface is missed at
 *                any glyph density or zoom (REYES-style "dicing").
 *    5. DEPTH    a z-buffer per cell keeps only the nearest sample.
 *    6. SHADE    lum = 0.07 + 0.8·|N·L| + 0.35·|N·H|²⁸, fogged by depth,
 *                → a glyph from the calibrated RAMPS.shade.
 *    7. EDGES    the boundary |v| = w is drawn on top (depth-tested): odd n →
 *                ONE mint curve; even n → two curves, mint and ice.
 * ═══════════════════════════════════════════════════════════════════════════ */

const TAU = Math.PI * 2;

/* ─── Camera ──────────────────────────────────────────────────────────────── */

/** Eye distance from the band's centre, world units. */
const CAMERA_DISTANCE = 4.2 * BAND_R;
/** At zoom 1 the band spans this fraction of the smaller stage side… */
const SCREEN_FILL = 0.7;
/** …measured on a fixed reference radius, so the width slider widens the strip instead of rescaling the scene. */
const FRAME_RADIUS = BAND_R + 0.42;
/** 3/4 view: the flat stretch (u ≈ 0) sweeps across the front-left while the strip stands up and flips on the right */
const DEFAULT_YAW = 3.42;
const DEFAULT_PITCH = 0.58;
const PITCH_LIMIT = 1.35;
const DRAG_RAD_PER_PX = 0.006;
const MAX_ANGULAR_SPEED = 9;
/** time constant of the drag-velocity estimate, s */
const VELOCITY_SMOOTHING = 0.05;
/** inertia: ω(t) = ω₀·e^(−t/τ) → about 1 % left after 2 s */
const INERTIA_TAU = 0.45;
const ZOOM_MIN = 0.65;
const ZOOM_MAX = 1.7;
/** zoom factor per CSS px of wheel travel: zoom ← zoom·e^(−k·Δ) */
const WHEEL_ZOOM = 0.0012;
const ZOOM_EASE = 10;
/** reset glides the camera home at this rate, 1/s */
const RETURN_EASE = 6;

/* ─── Sampling ────────────────────────────────────────────────────────────── */

/**
 * Samples per character cell along each direction of a patch. Why it never leaves holes:
 * neighbouring samples are ≤ 1/k cell apart along both patch directions, so every point of
 * the patch is within (1/k + 1/k)/2 = 1/k cell of a sample. A cell is a square of half-size
 * ½ around its centre, so any k ≥ 2 puts a sample inside every covered cell; 3 adds margin.
 */
const SAMPLES_PER_CELL = 3;
/** floor when the per-frame budget kicks in — 2 is the smallest value that still guarantees no holes */
const MIN_SAMPLES_PER_CELL = 2;
const SAMPLE_BUDGET = 320_000;
const EDGE_SAMPLES_PER_CELL = 3;

/* ─── Shading ─────────────────────────────────────────────────────────────── */

const AMBIENT = 0.07;
const DIFFUSE = 0.8;
const SPECULAR = 0.35; // shininess 28 = 16 + 8 + 4 → three squarings, no Math.pow
/** depth fog: lum ·= mix(1, FOG_FAR, depthNorm) */
const FOG_FAR = 0.4;
/** darkest surface value still gets a visible glyph */
const GLYPH_FLOOR = 0.07;
const INTENSITY_GAMMA = 0.85;
/**
 * Light direction in camera space (x right, y up, z toward the viewer): upper-left-front.
 * Mostly overhead, so stretches of the strip lying flat catch the light while stretches
 * standing on edge fall into shade — the twist reads as a light ↔ dark rhythm.
 */
const LIGHT = unit3(-0.38, 0.86, 0.34);
const LX = LIGHT[0];
const LY = LIGHT[1];
const LZ = LIGHT[2];

/* ─── Edges ───────────────────────────────────────────────────────────────── */

/** hidden-line tolerance, in cells of depth */
const EDGE_BIAS_CELLS = 2.5;
const EDGE_NEAR = 0.9;
const EDGE_FAR = 0.5;
/** line glyphs for the boundary, chosen by its on-screen direction: — / | \ */
const EDGE_H = '-'.charCodeAt(0);
const EDGE_RISE = '/'.charCodeAt(0);
const EDGE_V = '|'.charCodeAt(0);
const EDGE_FALL = '\\'.charCodeAt(0);
/** the travelling spark's head */
const EDGE_SPARK = '@'.charCodeAt(0);
/** tan(22.5°): below this slope a segment counts as horizontal (or, inverted, vertical) */
const TAN_22_5 = 0.41421356;
/** A spark travels along the edge: one lap of u per this many seconds. On odd n it needs two laps to come home. */
const TRACER_LAP_SECONDS = 6.5;
/** length of the spark's tail and lead, radians of u */
const TRACER_TAIL = 1.6;
const TRACER_LEAD = 0.1;
/** tail falloff: boost = e^(−k·distance behind the head) */
const TRACER_DECAY = 3;
const TRACER_GAIN = 0.55;
/** the head (white '@') is where boost exceeds this */
const TRACER_HEAD = 0.82;

/* ─── Twist change ────────────────────────────────────────────────────────── */

/** dissolve / flash when n changes (the geometry itself switches instantly — always a closed band) */
const TWIST_FX_SECONDS = 0.34;
/** width of the bright decode front, as a fraction of cells */
const FX_FRONT = 0.09;
/** fraction of the edge length drawn white-hot at the tracing front */
const FX_EDGE_FRONT = 0.03;

/** Brightness curve: intensity = lum^0.85 (256-entry lookup, built once). */
const INTENSITY_LUT = (() => {
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = Math.max(0.035, Math.pow(i / 255, INTENSITY_GAMMA));
  return lut;
})();

const SPACE = 32;
const DOT = 46;

function unit3(x: number, y: number, z: number): [number, number, number] {
  const len = Math.hypot(x, y, z);
  return [x / len, y / len, z / len];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Wrap an angle into (−π, π]. */
function wrapAngle(a: number): number {
  const w = a - TAU * Math.floor((a + Math.PI) / TAU);
  return w === -Math.PI ? Math.PI : w;
}

function easeOutCubic(t: number): number {
  const k = 1 - clamp(t, 0, 1);
  return 1 - k * k * k;
}

/** Deterministic hash of an integer → [0, 1). */
function hash01(x: number): number {
  let h = Math.imul(x | 0, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca77);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae3d);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Degrees with a true minus sign (U+2212). */
function formatDegrees(rad: number): string {
  const d = Math.round((rad * 180) / Math.PI);
  return d < 0 ? `−${-d}°` : `${d}°`;
}

class TopologyExperiment implements Experiment {
  readonly id = 'topology' as const;

  /* ── parameters ── */
  private band: BandConstants = deriveBandConstants({});
  private density = 1;
  private spin = 0.35;
  private autorotate = true;
  private showEdges = true;
  private paintSides = false;
  private hasParams = false;

  /* ── geometry: rebuilt only when n or w change ── */
  private readonly mesh = new BandSamples();
  private meshDirty = true;

  /* ── per-vertex scratch (refreshed every frame) ── */
  private vCol = new Float32Array(0);
  private vRow = new Float32Array(0);
  /** 1/depth — linear across the screen, so it can be interpolated and compared directly */
  private vInvZ = new Float32Array(0);
  private vNx = new Float32Array(0);
  private vNy = new Float32Array(0);
  private vNz = new Float32Array(0);
  /** projected patch size in cells along u and along v */
  private qLenU = new Float32Array(0);
  private qLenV = new Float32Array(0);
  private bCol = new Float32Array(0);
  private bRow = new Float32Array(0);
  private bInvZ = new Float32Array(0);

  /* ── character grid ── */
  private cols = 0;
  private rows = 0;
  private cells = 0;
  private cellW = 1;
  private cellH = 1;
  private width = 1;
  private height = 1;
  private originX = 0;
  private originY = 0;
  /** per column / row: (cell centre − projection centre) / focal — a ray direction */
  private colX = new Float32Array(0);
  private rowY = new Float32Array(0);

  /* ── per-cell buffers ── */
  /** z-buffer: 1/depth of the nearest surface sample (0 = empty) */
  private zbuf = new Float32Array(0);
  /** winning sample: grid index of its patch corner + its position (s, t) inside the patch */
  private winK = new Int32Array(0);
  private winS = new Float32Array(0);
  private winT = new Float32Array(0);
  /** 1/depth of the nearest visible edge sample */
  private edgeZ = new Float32Array(0);
  /** what was finally drawn (for the probe) */
  private outCode = new Uint16Array(0);
  private outInt = new Float32Array(0);

  /* ── camera ── */
  private yaw = DEFAULT_YAW;
  private pitch = DEFAULT_PITCH;
  private zoom = 1;
  private zoomTarget = 1;
  private velYaw = 0;
  private velPitch = 0;
  private dragging = false;
  private returning = false;
  private readonly rot = new Float64Array(9);
  private focal = 1;
  private centreX = 0;
  private centreY = 0;

  /* ── time-based effects ── */
  private tracerTime = 0;
  private fxTime = TWIST_FX_SECONDS;
  private fxSeed = 0x2f6b;
  private frame = 0;
  private reduced = false;

  /* ── glyph tables (rebuilt when the engine recalibrates its ramp) ── */
  private ramp: GlyphRamp | null = null;
  private readonly glyphLut = new Uint16Array(256);
  private scramble = new Uint16Array(0);

  private samplesDrawn = 0;

  /* ── Experiment lifecycle ─────────────────────────────────────────────── */

  resize(ctx: FrameContext): void {
    this.syncGrid(ctx);
  }

  setParams(params: Readonly<ParamValues>): void {
    const band = deriveBandConstants(params);
    const prev = this.band;
    if (band.n !== prev.n || band.w !== prev.w) this.meshDirty = true;
    if (this.hasParams && band.n !== prev.n) {
      // A new whole number of half-twists: the band is rebuilt at once (it is always closed);
      // a short dissolve + edge trace makes the change read as deliberate.
      this.fxTime = 0;
      this.fxSeed = (Math.imul(this.fxSeed, 1103515245) + 12345) | 0;
      this.tracerTime = 0;
    }
    this.band = band;
    this.density = clamp(num(params.density, 1), 0.3, 3);
    this.spin = num(params.spin, 0.35);
    this.autorotate = params.autorotate !== false;
    this.showEdges = params.edges !== false;
    this.paintSides = params.sides === true;
    this.hasParams = true;
  }

  update(ctx: FrameContext): void {
    const p = ctx.pointer;
    // Wall-clock time: dragging, inertia and zoom keep working while the simulation is paused.
    const rdt = Math.min(Math.max(ctx.realDt, 0), 0.1);
    this.frame = ctx.frame;
    this.reduced = ctx.reducedMotion;

    if (p.pressed && p.inside) {
      this.dragging = true;
      this.returning = false;
      this.velYaw = 0;
      this.velPitch = 0;
    }
    if (!p.down) this.dragging = false;

    if (this.dragging) {
      const dYaw = p.dx * DRAG_RAD_PER_PX;
      const dPitch = p.dy * DRAG_RAD_PER_PX;
      this.yaw += dYaw;
      this.pitch = clamp(this.pitch + dPitch, -PITCH_LIMIT, PITCH_LIMIT);
      if (rdt > 0) {
        const a = 1 - Math.exp(-rdt / VELOCITY_SMOOTHING);
        const wYaw = clamp(dYaw / rdt, -MAX_ANGULAR_SPEED, MAX_ANGULAR_SPEED);
        const wPitch = clamp(dPitch / rdt, -MAX_ANGULAR_SPEED, MAX_ANGULAR_SPEED);
        this.velYaw += (wYaw - this.velYaw) * a;
        this.velPitch += (wPitch - this.velPitch) * a;
      }
    } else {
      if (this.velYaw !== 0 || this.velPitch !== 0) {
        this.yaw += this.velYaw * rdt;
        const pitch = this.pitch + this.velPitch * rdt;
        this.pitch = clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT);
        if (pitch !== this.pitch) this.velPitch = 0;
        const decay = Math.exp(-rdt / INERTIA_TAU);
        this.velYaw = Math.abs(this.velYaw) < 1e-3 ? 0 : this.velYaw * decay;
        this.velPitch = Math.abs(this.velPitch) < 1e-3 ? 0 : this.velPitch * decay;
      }
      if (this.returning) {
        const k = 1 - Math.exp(-rdt * RETURN_EASE);
        const dYaw = wrapAngle(DEFAULT_YAW - this.yaw);
        const dPitch = DEFAULT_PITCH - this.pitch;
        this.yaw += dYaw * k;
        this.pitch += dPitch * k;
        if (Math.abs(dYaw) < 1e-3 && Math.abs(dPitch) < 1e-3) this.returning = false;
      } else if (this.autorotate) {
        // ctx.dt is 0 while paused → no auto-rotation, but drag + inertia above still work.
        this.yaw += this.spin * ctx.dt;
      }
    }

    if (p.wheel !== 0) {
      this.zoomTarget = clamp(this.zoomTarget * Math.exp(-p.wheel * WHEEL_ZOOM), ZOOM_MIN, ZOOM_MAX);
    }
    this.zoom += (this.zoomTarget - this.zoom) * (1 - Math.exp(-rdt * ZOOM_EASE));
    this.yaw = wrapAngle(this.yaw);

    this.tracerTime += ctx.dt;
    if (this.fxTime < TWIST_FX_SECONDS) this.fxTime += rdt;
  }

  render(field: GlyphField, ctx: FrameContext): void {
    this.syncGrid(ctx);
    if (this.cells === 0 || field.cols !== this.cols || field.rows !== this.rows) return;
    if (this.meshDirty) this.rebuildMesh();
    const ramp = ctx.ramp(RAMPS.shade);
    if (ramp !== this.ramp) this.buildGlyphTables(ramp);

    this.setupCamera();
    this.projectMesh();
    this.rasterize();
    this.shade(field);
    if (this.showEdges) this.drawEdges(field);
  }

  reset(): void {
    // Glide the camera home (≈ 0.6 s) instead of jumping; inertia stops at once.
    this.returning = true;
    this.dragging = false;
    this.velYaw = 0;
    this.velPitch = 0;
    this.zoomTarget = 1;
    this.tracerTime = 0;
  }

  cellScale(): number {
    return 1 / this.density;
  }

  probe(ctx: FrameContext): ProbeReadout | null {
    const b = this.band;
    const odd = b.edges === 1;
    const facts: ProbeRow[] = [
      { label: 'SIDES', value: String(b.sides), tone: odd ? 'mint' : 'ink' },
      { label: 'EDGES', value: String(b.edges), tone: odd ? 'mint' : 'ice' },
      { label: 'ORIENTABLE', value: b.orientable ? 'YES' : 'NO' },
      { label: 'EDGE CURVE', value: b.edgeName },
    ];
    if (b.linking !== null) facts.push({ label: 'LINKING', value: String(b.linking) });

    const yawFull = this.yaw < 0 ? this.yaw + TAU : this.yaw;
    const rows: ProbeRow[] = [
      { label: 'YAW', value: formatDegrees(yawFull) },
      { label: 'PITCH', value: formatDegrees(this.pitch) },
      { label: 'SAMPLES', value: this.samplesDrawn.toLocaleString('en-US') },
      { label: 'n', value: String(b.n) },
      { label: 'w', value: b.w.toFixed(2) },
    ];
    const vars: Record<string, number> = {
      n: b.n,
      w: b.w,
      R: b.R,
      yaw: (yawFull * 180) / Math.PI,
      pitch: (this.pitch * 180) / Math.PI,
      zoom: this.zoom,
    };

    const ci = this.cells > 0 && !this.meshDirty ? this.probeCell(ctx) : -1;
    if (ci < 0) return { heading: 'SURFACE', rows, facts, valueLabel: 'N·L', vars };

    // The surface under the probe: interpolate the winning sample's normal (camera space)
    // and its parameter coordinates (u, v), exactly as the shading pass did.
    const nv = this.mesh.nv;
    const k00 = this.winK[ci];
    const k10 = k00 + nv;
    const s = this.winS[ci];
    const t = this.winT[ci];
    const w11 = s * t;
    const w10 = s - w11;
    const w01 = t - w11;
    const w00 = 1 - s - t + w11;
    const nx = w00 * this.vNx[k00] + w10 * this.vNx[k10] + w01 * this.vNx[k00 + 1] + w11 * this.vNx[k10 + 1];
    const ny = w00 * this.vNy[k00] + w10 * this.vNy[k10] + w01 * this.vNy[k00 + 1] + w11 * this.vNy[k10 + 1];
    const nz = w00 * this.vNz[k00] + w10 * this.vNz[k10] + w01 * this.vNz[k00 + 1] + w11 * this.vNz[k10 + 1];
    const len = Math.hypot(nx, ny, nz) || 1;
    const nl = (nx * LX + ny * LY + nz * LZ) / len;

    const i = Math.floor(k00 / nv);
    const j = k00 - i * nv;
    const du = TAU / (this.mesh.nu - 1);
    const dv = (2 * this.mesh.w) / (nv - 1);
    vars.u = (i + s) * du;
    vars.v = -this.mesh.w + (j + t) * dv;
    vars.NL = nl;

    const code = this.outCode[ci];
    return {
      heading: 'SURFACE',
      rows,
      facts,
      value: nl,
      valueLabel: 'N·L',
      intensity: this.outInt[ci],
      glyph: code > SPACE ? String.fromCharCode(code) : ' ',
      vars,
    };
  }

  dispose(): void {
    this.zbuf = new Float32Array(0);
    this.winK = new Int32Array(0);
    this.winS = new Float32Array(0);
    this.winT = new Float32Array(0);
    this.edgeZ = new Float32Array(0);
    this.outCode = new Uint16Array(0);
    this.outInt = new Float32Array(0);
    this.cells = 0;
    this.cols = 0;
    this.rows = 0;
    this.meshDirty = true;
  }

  /* ── Grid & buffers ───────────────────────────────────────────────────── */

  /** Copy the grid geometry from the frame; (re)allocate per-cell buffers only when the cell count changes. */
  private syncGrid(ctx: FrameContext): void {
    this.cellW = Math.max(1e-3, ctx.cellW);
    this.cellH = Math.max(1e-3, ctx.cellH);
    this.width = Math.max(1, ctx.width);
    this.height = Math.max(1, ctx.height);
    this.originX = ctx.originX;
    this.originY = ctx.originY;
    const cols = Math.max(0, ctx.cols | 0);
    const rows = Math.max(0, ctx.rows | 0);
    if (cols === this.cols && rows === this.rows && this.zbuf.length === cols * rows) return;
    this.cols = cols;
    this.rows = rows;
    this.cells = cols * rows;
    const n = this.cells;
    this.zbuf = new Float32Array(n);
    this.winK = new Int32Array(n);
    this.winS = new Float32Array(n);
    this.winT = new Float32Array(n);
    this.edgeZ = new Float32Array(n);
    this.outCode = new Uint16Array(n);
    this.outInt = new Float32Array(n);
    this.colX = new Float32Array(cols);
    this.rowY = new Float32Array(rows);
  }

  /**
   * Resample the surface. The grid density follows the geometry, not the screen
   * (dicing adapts to the projected size every frame): more half-twists → the strip
   * turns faster along u → more columns; the normal swings more across the strip →
   * a few more rows. Positions along v are exact anyway — each cross-section is a
   * straight segment.
   */
  private rebuildMesh(): void {
    const { n, w } = this.band;
    const intervals = 192 + 48 * n;
    const nu = intervals + 1;
    const nv = 7 + n;
    // two edge samples per u-interval per lap (odd n: one 2-lap loop; even n: two 1-lap loops)
    sampleBand(this.mesh, n, BAND_R, w, nu, nv, 4 * intervals);

    const m = this.mesh;
    if (this.vCol.length < m.gridCount) {
      const g = m.gridCount;
      this.vCol = new Float32Array(g);
      this.vRow = new Float32Array(g);
      this.vInvZ = new Float32Array(g);
      this.vNx = new Float32Array(g);
      this.vNy = new Float32Array(g);
      this.vNz = new Float32Array(g);
    }
    const quads = (m.nu - 1) * (m.nv - 1);
    if (this.qLenU.length < quads) {
      this.qLenU = new Float32Array(quads);
      this.qLenV = new Float32Array(quads);
    }
    if (this.bCol.length < m.boundaryCount) {
      this.bCol = new Float32Array(m.boundaryCount);
      this.bRow = new Float32Array(m.boundaryCount);
      this.bInvZ = new Float32Array(m.boundaryCount);
    }
    this.meshDirty = false;
  }

  private buildGlyphTables(ramp: GlyphRamp): void {
    this.ramp = ramp;
    let lightest = DOT;
    for (let i = 0; i < ramp.codes.length; i++) {
      const c = ramp.codes[i];
      if (c !== SPACE && c !== 0) {
        lightest = c;
        break;
      }
    }
    for (let i = 0; i < 256; i++) {
      const code = ramp.codeFor(GLYPH_FLOOR + (1 - GLYPH_FLOOR) * (i / 255));
      this.glyphLut[i] = code === SPACE || code === 0 ? lightest : code;
    }
    // the denser half of the ramp flickers at the decode front of a twist change
    const dense = Array.from(ramp.codes.slice(ramp.codes.length >> 1)).filter((c) => c !== SPACE && c !== 0);
    this.scramble = Uint16Array.from(dense.length > 0 ? dense : [lightest]);
  }

  /* ── Camera & projection ──────────────────────────────────────────────── */

  private setupCamera(): void {
    rotationFromYawPitch(this.yaw, this.pitch, this.rot);
    const minSide = Math.min(this.width, this.height);
    // px per world unit at the eye distance, so that 2·FRAME_RADIUS spans SCREEN_FILL of the smaller side
    const pxPerUnit = (SCREEN_FILL * minSide) / (2 * FRAME_RADIUS);
    const F = pxPerUnit * CAMERA_DISTANCE * this.zoom;
    // Centre the band vertically: the near side of a tilted ring projects lower and larger
    // than the far side, so shift by the mean projected height of the nearest and farthest point.
    const D = CAMERA_DISTANCE;
    const sp = Math.sin(this.pitch);
    const cp = Math.cos(this.pitch);
    const yNear = (-FRAME_RADIUS * sp) / (D - FRAME_RADIUS * cp);
    const yFar = (FRAME_RADIUS * sp) / (D + FRAME_RADIUS * cp);
    this.focal = F;
    this.centreX = this.width / 2;
    this.centreY = this.height / 2 + 0.5 * (yNear + yFar) * F;

    const invF = 1 / F;
    for (let c = 0; c < this.cols; c++) {
      this.colX[c] = (this.originX + (c + 0.5) * this.cellW - this.centreX) * invF;
    }
    for (let r = 0; r < this.rows; r++) {
      this.rowY[r] = (this.centreY - (this.originY + (r + 0.5) * this.cellH)) * invF;
    }
  }

  /**
   * Rotate + project every sample. Camera space: x right, y up, z toward the viewer;
   * the eye sits at z = D, so depth = D − z and screen = centre + F·(x, −y)/depth.
   * Positions go straight to fractional cell coordinates.
   */
  private projectMesh(): void {
    const m = this.rot;
    const m0 = m[0], m1 = m[1], m2 = m[2];
    const m3 = m[3], m4 = m[4], m5 = m[5];
    const m6 = m[6], m7 = m[7], m8 = m[8];
    const D = CAMERA_DISTANCE;
    const ax = this.focal / this.cellW;
    const bx = (this.centreX - this.originX) / this.cellW;
    const ay = this.focal / this.cellH;
    const by = (this.centreY - this.originY) / this.cellH;

    const mesh = this.mesh;
    const P = mesh.positions;
    const N = mesh.normals;
    const vCol = this.vCol;
    const vRow = this.vRow;
    const vInvZ = this.vInvZ;
    const vNx = this.vNx;
    const vNy = this.vNy;
    const vNz = this.vNz;
    for (let k = 0, i3 = 0; k < mesh.gridCount; k++, i3 += 3) {
      const x = P[i3];
      const y = P[i3 + 1];
      const z = P[i3 + 2];
      const iz = 1 / (D - (m6 * x + m7 * y + m8 * z));
      vCol[k] = bx + ax * (m0 * x + m1 * y + m2 * z) * iz;
      vRow[k] = by - ay * (m3 * x + m4 * y + m5 * z) * iz;
      vInvZ[k] = iz;
      const nx = N[i3];
      const ny = N[i3 + 1];
      const nz = N[i3 + 2];
      vNx[k] = m0 * nx + m1 * ny + m2 * nz;
      vNy[k] = m3 * nx + m4 * ny + m5 * nz;
      vNz[k] = m6 * nx + m7 * ny + m8 * nz;
    }

    if (!this.showEdges) return;
    const B = mesh.boundaryPositions;
    const bCol = this.bCol;
    const bRow = this.bRow;
    const bInvZ = this.bInvZ;
    for (let k = 0, i3 = 0; k < mesh.boundaryCount; k++, i3 += 3) {
      const x = B[i3];
      const y = B[i3 + 1];
      const z = B[i3 + 2];
      const iz = 1 / (D - (m6 * x + m7 * y + m8 * z));
      bCol[k] = bx + ax * (m0 * x + m1 * y + m2 * z) * iz;
      bRow[k] = by - ay * (m3 * x + m4 * y + m5 * z) * iz;
      bInvZ[k] = iz;
    }
  }

  /* ── Rasterisation: dicing + z-buffer ─────────────────────────────────── */

  private rasterize(): void {
    const mesh = this.mesh;
    const nu = mesh.nu;
    const nv = mesh.nv;
    const cols = this.cols;
    const rows = this.rows;
    const vCol = this.vCol;
    const vRow = this.vRow;
    const vInvZ = this.vInvZ;
    const lenU = this.qLenU;
    const lenV = this.qLenV;
    const zb = this.zbuf;
    const wk = this.winK;
    const ws = this.winS;
    const wt = this.winT;
    zb.fill(0);

    // Pass 1 — projected size of every patch, in cells (Chebyshev length: max(|Δcol|, |Δrow|)).
    let estimate = 0;
    let q = 0;
    for (let i = 0; i < nu - 1; i++) {
      for (let j = 0; j < nv - 1; j++, q++) {
        const k00 = i * nv + j;
        const k01 = k00 + 1;
        const k10 = k00 + nv;
        const k11 = k10 + 1;
        const lu = Math.max(
          Math.abs(vCol[k10] - vCol[k00]),
          Math.abs(vRow[k10] - vRow[k00]),
          Math.abs(vCol[k11] - vCol[k01]),
          Math.abs(vRow[k11] - vRow[k01]),
        );
        const lv = Math.max(
          Math.abs(vCol[k01] - vCol[k00]),
          Math.abs(vRow[k01] - vRow[k00]),
          Math.abs(vCol[k11] - vCol[k10]),
          Math.abs(vRow[k11] - vRow[k10]),
        );
        lenU[q] = lu;
        lenV[q] = lv;
        estimate += (lu * SAMPLES_PER_CELL + 2) * (lv * SAMPLES_PER_CELL + 2);
      }
    }
    // Performance cap: thin the dicing evenly if a huge zoom × density would blow the budget.
    const spc =
      estimate > SAMPLE_BUDGET
        ? Math.max(MIN_SAMPLES_PER_CELL, SAMPLES_PER_CELL * Math.sqrt(SAMPLE_BUDGET / estimate))
        : SAMPLES_PER_CELL;

    // Pass 2 — dice each patch into (a+1)·(b+1) samples ≤ 1/spc cell apart and keep the nearest per cell.
    let drawn = 0;
    q = 0;
    for (let i = 0; i < nu - 1; i++) {
      for (let j = 0; j < nv - 1; j++, q++) {
        const k00 = i * nv + j;
        const k01 = k00 + 1;
        const k10 = k00 + nv;
        const k11 = k10 + 1;
        const c00 = vCol[k00], c10 = vCol[k10], c01 = vCol[k01], c11 = vCol[k11];
        const r00 = vRow[k00], r10 = vRow[k10], r01 = vRow[k01], r11 = vRow[k11];
        // Every sample of a bilinear patch lies inside the bounding box of its 4 corners.
        const minC = Math.min(c00, c10, c01, c11);
        const maxC = Math.max(c00, c10, c01, c11);
        const minR = Math.min(r00, r10, r01, r11);
        const maxR = Math.max(r00, r10, r01, r11);
        if (maxC < 0 || maxR < 0 || minC >= cols || minR >= rows) continue; // entirely off the grid
        const clip = minC < 0 || minR < 0 || maxC >= cols || maxR >= rows; // partly off → check each sample

        const z00 = vInvZ[k00], z10 = vInvZ[k10], z01 = vInvZ[k01], z11 = vInvZ[k11];
        const a = Math.max(1, Math.ceil(lenU[q] * spc));
        const b = Math.max(1, Math.ceil(lenV[q] * spc));
        const invA = 1 / a;
        const invB = 1 / b;
        for (let tb = 0; tb <= b; tb++) {
          const t = tb * invB;
          // walk the line between the two v-edges of the patch at this t
          const lc = c00 + (c01 - c00) * t;
          const lr = r00 + (r01 - r00) * t;
          const lz = z00 + (z01 - z00) * t;
          const dc = (c10 + (c11 - c10) * t - lc) * invA;
          const dr = (r10 + (r11 - r10) * t - lr) * invA;
          const dz = (z10 + (z11 - z10) * t - lz) * invA;
          let pc = lc;
          let pr = lr;
          let pz = lz;
          for (let sa = 0; sa <= a; sa++, pc += dc, pr += dr, pz += dz) {
            if (clip && (pc < 0 || pr < 0 || pc >= cols || pr >= rows)) continue;
            const ci = (pr | 0) * cols + (pc | 0);
            if (pz > zb[ci]) {
              // nearer than anything so far in this cell (larger 1/depth = closer)
              zb[ci] = pz;
              wk[ci] = k00;
              ws[ci] = sa * invA;
              wt[ci] = t;
            }
          }
        }
        drawn += (a + 1) * (b + 1);
      }
    }
    this.samplesDrawn = drawn;
  }

  /* ── Shading ──────────────────────────────────────────────────────────── */

  private shade(field: GlyphField): void {
    const cols = this.cols;
    const rows = this.rows;
    const nv = this.mesh.nv;
    const zb = this.zbuf;
    const wk = this.winK;
    const ws = this.winS;
    const wt = this.winT;
    const NX = this.vNx;
    const NY = this.vNy;
    const NZ = this.vNz;
    const colX = this.colX;
    const rowY = this.rowY;
    const glyph = field.glyph;
    const inten = field.intensity;
    const tone = field.tone;
    const outCode = this.outCode;
    const outInt = this.outInt;
    const lut = this.glyphLut;

    // depth fog over the band's own depth range [D − ρ, D + ρ]
    const rho = BAND_R + this.band.w;
    const zNear = CAMERA_DISTANCE - rho;
    const invRange = 1 / (2 * rho);
    const fogK = 1 - FOG_FAR;
    const sides = this.paintSides;

    // twist change: cells re-materialise in hashed order behind a flickering mint front
    const fxActive = this.fxTime < TWIST_FX_SECONDS;
    const fxP = fxActive ? this.fxTime / TWIST_FX_SECONDS : 1;
    const reveal = 0.16 + 0.86 * easeOutCubic(fxP);
    const flash = 1 - fxP;
    const seed = this.fxSeed;
    const reduced = this.reduced;
    const scramble = this.scramble;
    const frame = this.frame;

    for (let r = 0; r < rows; r++) {
      const ry = rowY[r];
      const base = r * cols;
      for (let c = 0; c < cols; c++) {
        const ci = base + c;
        const iz = zb[ci];
        if (iz === 0) continue;

        // Normal of the winning sample: bilinear blend of its patch corners, renormalised.
        const k00 = wk[ci];
        const k10 = k00 + nv;
        const s = ws[ci];
        const t = wt[ci];
        const w11 = s * t;
        const w10 = s - w11;
        const w01 = t - w11;
        const w00 = 1 - s - t + w11;
        let nx = w00 * NX[k00] + w10 * NX[k10] + w01 * NX[k00 + 1] + w11 * NX[k10 + 1];
        let ny = w00 * NY[k00] + w10 * NY[k10] + w01 * NY[k00 + 1] + w11 * NY[k10 + 1];
        let nz = w00 * NZ[k00] + w10 * NZ[k10] + w01 * NZ[k00 + 1] + w11 * NZ[k10 + 1];
        const nInv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
        nx *= nInv;
        ny *= nInv;
        nz *= nInv;

        // Unit vector from the surface to the eye. P = (x·d, y·d, D − d) for the cell's
        // ray (x, y) = (colX, rowY), so eye − P = d·(−x, −y, 1): it depends on the cell only.
        const vx0 = -colX[c];
        const vy0 = -ry;
        const vInv = 1 / Math.sqrt(vx0 * vx0 + vy0 * vy0 + 1);
        const vx = vx0 * vInv;
        const vy = vy0 * vInv;
        const vz = vInv;

        const nl = nx * LX + ny * LY + nz * LZ;
        const facing = nx * vx + ny * vy + nz * vz;
        // Blinn half-vector H = (L + V)/|L + V|; two-sided, so use |N·H|
        const hx = LX + vx;
        const hy = LY + vy;
        const hz = LZ + vz;
        let nh = (nx * hx + ny * hy + nz * hz) / Math.sqrt(hx * hx + hy * hy + hz * hz);
        if (nh < 0) nh = -nh;
        const p2 = nh * nh;
        const p4 = p2 * p2;
        const p8 = p4 * p4;
        let lum = AMBIENT + DIFFUSE * (nl < 0 ? -nl : nl) + SPECULAR * (p8 * p8 * p8 * p4); // |N·H|^28

        let fog = (1 / iz - zNear) * invRange;
        fog = fog < 0 ? 0 : fog > 1 ? 1 : fog;
        lum *= 1 - fogK * fog;
        if (lum > 1) lum = 1;

        const li = (lum * 255 + 0.5) | 0;
        let code = lut[li];
        let I = INTENSITY_LUT[li];
        // Paint sides: which side of the parametric normal faces us. On odd n this flips across u = 0.
        let tn: Tone = sides && facing < 0 ? Tone.ICE : Tone.INK;

        if (fxActive) {
          if (reduced) {
            I *= 0.3 + 0.7 * fxP;
          } else {
            const xi = hash01(ci ^ seed);
            if (xi > reveal) {
              outCode[ci] = SPACE;
              outInt[ci] = 0;
              continue;
            }
            if (reveal - xi < FX_FRONT) {
              code = scramble[(hash01(ci * 31 + frame) * scramble.length) | 0];
              tn = Tone.MINT;
              I = Math.min(1, I + 0.5);
            } else {
              I = Math.min(1, I * (1 + 0.7 * flash));
            }
          }
        }

        glyph[ci] = code;
        inten[ci] = I;
        tone[ci] = tn;
        outCode[ci] = code;
        outInt[ci] = I;
      }
    }
  }

  /* ── Edges ────────────────────────────────────────────────────────────── */

  /**
   * The boundary |v| = w, drawn as continuous polylines on top of the surface.
   * A segment between two edge samples is stepped ≤ ⅓ cell at a time; each step
   * is hidden if the surface in that cell is nearer by more than a small bias.
   */
  private drawEdges(field: GlyphField): void {
    const mesh = this.mesh;
    const cols = this.cols;
    const rows = this.rows;
    const zb = this.zbuf;
    const ez = this.edgeZ;
    const bCol = this.bCol;
    const bRow = this.bRow;
    const bInvZ = this.bInvZ;
    const glyph = field.glyph;
    const inten = field.intensity;
    const tone = field.tone;
    const outCode = this.outCode;
    const outInt = this.outInt;
    ez.fill(0);

    const rho = BAND_R + this.band.w;
    const zNear = CAMERA_DISTANCE - rho;
    const invRange = 1 / (2 * rho);
    // hidden-line bias: EDGE_BIAS_CELLS cells, measured in world units at the sample's depth
    const biasPerDepth = (EDGE_BIAS_CELLS * Math.min(this.cellW, this.cellH)) / this.focal;

    const comps = mesh.boundaryComponents;
    // The single Möbius edge needs TWO laps of u to come home; each edge of an even band needs one.
    const laps = comps === 1 ? 2 : 1;
    const span = laps * TAU;
    const tracer = !this.reduced;
    const head = tracer ? (this.tracerTime / (TRACER_LAP_SECONDS * laps)) % 1 : 0;
    const fxActive = this.fxTime < TWIST_FX_SECONDS;
    const reveal = fxActive ? easeOutCubic(this.fxTime / TWIST_FX_SECONDS) : 2;
    const cellW = this.cellW;
    const cellH = this.cellH;

    for (let comp = 0; comp < comps; comp++) {
      const start = mesh.boundaryStart[comp];
      const len = mesh.boundaryLength[comp];
      const baseTone: Tone = comp === 0 ? Tone.MINT : Tone.ICE;
      const invLen = 1 / len;
      for (let k = 0; k < len; k++) {
        const ia = start + k;
        const ib = k + 1 < len ? ia + 1 : start; // each edge component is a closed loop
        const c0 = bCol[ia];
        const r0 = bRow[ia];
        const z0 = bInvZ[ia];
        const dc = bCol[ib] - c0;
        const dr = bRow[ib] - r0;
        const dz = bInvZ[ib] - z0;
        const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dc), Math.abs(dr)) * EDGE_SAMPLES_PER_CELL));
        const invSteps = 1 / steps;
        // the segment's direction on screen (in px — cells are not square) picks the line glyph
        const sx = dc * cellW;
        const sy = dr * cellH;
        const ax = sx < 0 ? -sx : sx;
        const ay = sy < 0 ? -sy : sy;
        const line = ay < ax * TAN_22_5 ? EDGE_H : ax < ay * TAN_22_5 ? EDGE_V : sx * sy < 0 ? EDGE_RISE : EDGE_FALL;
        for (let st = 0; st < steps; st++) {
          const t = st * invSteps;
          const f = (k + t) * invLen; // fraction of the way along this edge curve
          if (f > reveal) continue; // twist change: the edge is being traced from the seam
          const pc = c0 + dc * t;
          const pr = r0 + dr * t;
          if (pc < 0 || pr < 0 || pc >= cols || pr >= rows) continue;
          const ci = (pr | 0) * cols + (pc | 0);
          const iz = z0 + dz * t;
          const zs = zb[ci];
          if (zs > 0) {
            const dEdge = 1 / iz;
            if (dEdge - 1 / zs > biasPerDepth * dEdge) continue; // behind the surface
          }
          if (iz <= ez[ci]) continue; // another edge sample is nearer
          ez[ci] = iz;

          let fog = (1 / iz - zNear) * invRange;
          fog = fog < 0 ? 0 : fog > 1 ? 1 : fog;
          let I = EDGE_NEAR + (EDGE_FAR - EDGE_NEAR) * fog;
          let tn: Tone = baseTone;
          let code = line;
          if (tracer) {
            // radians of u behind (or just ahead of) the travelling spark
            let behind = (head - f) * span;
            if (behind < 0) behind += span;
            let boost = 0;
            if (behind < TRACER_TAIL) boost = Math.exp(-TRACER_DECAY * behind);
            else if (span - behind < TRACER_LEAD) boost = 1 - (span - behind) / TRACER_LEAD;
            if (boost > 0) {
              I += TRACER_GAIN * boost;
              if (boost > TRACER_HEAD) {
                tn = Tone.INK;
                code = EDGE_SPARK;
              }
            }
          }
          if (fxActive && reveal - f < FX_EDGE_FRONT) {
            I = 1;
            tn = Tone.INK;
            code = EDGE_SPARK;
          }
          if (I > 1) I = 1;
          glyph[ci] = code;
          inten[ci] = I;
          tone[ci] = tn;
          outCode[ci] = code;
          outInt[ci] = I;
        }
      }
    }
  }

  /* ── Probe target ─────────────────────────────────────────────────────── */

  /** The pointer's cell if the surface is there, else the surface cell nearest the screen centre. */
  private probeCell(ctx: FrameContext): number {
    const p = ctx.pointer;
    const zb = this.zbuf;
    if (p.inside) {
      const c = Math.floor(p.col);
      const r = Math.floor(p.row);
      if (c >= 0 && r >= 0 && c < this.cols && r < this.rows) {
        const ci = r * this.cols + c;
        if (zb[ci] > 0) return ci;
      }
    }
    const cc = (this.width / 2 - this.originX) / this.cellW - 0.5;
    const rc = (this.height / 2 - this.originY) / this.cellH - 0.5;
    let best = -1;
    let bestD = Infinity;
    for (let r = 0; r < this.rows; r++) {
      const dy = (r - rc) * this.cellH;
      const base = r * this.cols;
      for (let c = 0; c < this.cols; c++) {
        if (zb[base + c] === 0) continue;
        const dx = (c - cc) * this.cellW;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = base + c;
        }
      }
    }
    return best;
  }
}

/** Experiment 03 — an interactive Möbius band rendered in glyphs. */
export function createTopology(): Experiment {
  return new TopologyExperiment();
}
