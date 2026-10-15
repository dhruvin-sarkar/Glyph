import type { Experiment, FrameContext, GlyphField, GlyphRamp, ParamValues, ProbeReadout } from '../engine/types';
import { RAMPS, Tone } from '../engine/types';
import { columnWorldX, pxPerUnit, rowWorldY, stageToWorldX, stageToWorldY, worldAspect } from '../engine/coords';
import {
  MAX_TEMP_ATTRACTORS,
  SECTOR_GLYPHS,
  TEMP_LIFETIME,
  captureRadius,
  compileField,
  createAttractorSet,
  createFieldKernel,
  deriveFieldConstants,
  directionSector,
  fieldAt,
  idlePath,
  kernelVelocity,
  pushAttractor,
  softeningRadius,
  tempWeight,
  velocityAt,
  type FieldConstants,
  type Vec2,
} from '../math/vectorField';
import { createRK4Scratch, rk4Step, springStep, substepCount, type Spring2, type VectorFn } from '../math/integrate';

/* ═══════════════════════════════════════════════════════════════════════════
 *  EXPERIMENT 02 · ATTRACTOR — a living constellation of glyph-particles.
 *
 *      F(p) = Σⱼ wⱼ · [ s·(−Δy, Δx) − g·(Δx, Δy) ] / (|Δ|² + ε),   Δ = p − aⱼ
 *      dp/dt = F(p)   (speed clamped to vmax)
 *
 *  Pipeline per frame:
 *   1. attractors — a₀ chases the pointer on a critically damped spring (or
 *      glides along a Lissajous path when idle); clicks add counter-rotating
 *      attractors whose weight eases 1 → 0.
 *   2. particles — every particle is advanced with RK4 (math/integrate.ts),
 *      sub-stepped so a single step never moves more than 0.02 world units.
 *      Captured, off-stage and expired particles are respawned at random.
 *   3. exposure — each particle deposits energy into the cells it crosses, and
 *      the buffer decays like e^{−t/0.45 s}: a long-exposure photograph.
 *   4. glyphs — trail energy → calibrated soft ramp; particle heads → a line
 *      glyph of their direction of motion; cores and the probe on top.
 *
 *  Memory: particles live in preallocated typed arrays (structure of arrays),
 *  so the hot loops allocate nothing.
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ─── Tunables ────────────────────────────────────────────────────────────── */

/** Size of the particle pool (the `count` slider's maximum). */
const MAX_PARTICLES = 12000;
/** Particles spawn over the stage enlarged by 8 %, so streams pour in from beyond the edges. */
const SPAWN_MARGIN = 1.08;
/** …and are recycled once they leave the stage enlarged by 14 %. */
const CULL_MARGIN = 1.14;
const LIFE_MIN = 4;
const LIFE_MAX = 10;
/** Seconds to fade a particle in after it spawns, and out before its life ends. */
const FADE_IN = 0.35;
const FADE_OUT = 0.6;
/** Fade-out given to surplus particles when the count is lowered. */
const RETIRE_FADE = 0.5;
/** New particles (count raised, or after a reset) appear staggered over this many seconds. */
const GROW_STAGGER = 0.6;
/** Longest distance (world units) a single RK4 step may cover — sub-stepping keeps it below this. */
const MAX_STEP_LEN = 0.02;
const MAX_SUBSTEPS = 6;
/** Temporary attractors stop capturing particles once their weight drops below this. */
const CAPTURE_MIN_W = 0.25;

/** Trail energy decays as e^{−t/τ}: long exposure with trails on, a brief afterglow with trails off. */
const TRAIL_TAU = 0.45;
const PERSIST_TAU = 0.12;
/** Trail samples per cell width when a fast particle crosses several cells in one step. */
const DEPOSIT_SPACING = 0.75;
/** Energy below which a trail cell is skipped (and flushed to 0 by the decay). */
const TRAIL_FLOOR = 0.012;
/** Exposure scale E₀ in v = 1 − e^{−E/E₀}, at the default particle count. */
const TRAIL_E0 = 4.4;
const TRAIL_E0_PERSIST = 4;
const TRAIL_I0 = 0.05;
const TRAIL_I1 = 0.26;
/**
 * Trails use only the airy end of the soft ramp (' ·.:'): a stippled exposure
 * beneath the particles. Heavier glyphs ('-', '=', '#') would compete with the
 * direction strokes — and a '-' would falsely read as horizontal motion.
 */
const TRAIL_RAMP_TOP = 0.2;

/** Head brightness = alpha·(I0 + I1·speed/vmax)·(LUM_HEAD + (1 − LUM_HEAD)·b). */
const HEAD_I0 = 0.1;
const HEAD_I1 = 0.9;
/**
 * Every particle has a random luminosity b ∈ [0, 1). Heads vary gently with b;
 * trail exposure goes like b³, so — as in a long-exposure photo of the night sky,
 * where only the bright stars leave streaks — a minority draws distinct spiral
 * trails instead of everyone smearing into one haze.
 */
const LUM_HEAD = 0.55;
/** Below this fraction of vmax a particle has no clear direction → '·'. */
const SLOW_FRACTION = 0.012;
/** MINT: particles faster than this fraction of vmax, within MINT radius of the main core. */
const MINT_SPEED = 0.82;
const MINT_R_MIN = 0.08;
const MINT_R_SOFT = 1.6;
/** ICE: particles near a temporary attractor (within ICE_RADIUS) whose pull beats a₀'s by ICE_DOMINANCE×. */
const ICE_RADIUS = 0.2;
const ICE_DOMINANCE = 1.5;

/** Critically damped spring of the main core: natural frequency ω (rad/s). Settles in ~0.25–0.4 s. */
const CORE_OMEGA = 12;
/** Pointer idle this long (s) → the core returns to its Lissajous path. */
const IDLE_AFTER = 3;
/** Time constant (s) of the blend between "follow pointer" and "idle path". */
const FOLLOW_TAU = 0.35;
/** After a reset the idle path's amplitude eases in over this many seconds (the core starts centred). */
const PATH_INTRO = 4;

/** Probe trail: up to 60 positions, recorded every 0.03 world units of travel. */
const HIST_LEN = 60;
const HIST_SPACING = 0.03;
/** Preferred distance from a₀ when choosing a new probe particle (a long spiral ahead of it). */
const PICK_RADIUS = 1.05;
const PICK_SAMPLES = 240;

/** Vector-field lattice: one quiver glyph every 6 columns × 3 rows. */
const QUIVER_COLS = 6;
const QUIVER_ROWS = 3;
/** With the field shown, particles and trails step back a little so the lattice of F reads first. */
const FIELD_FOCUS_DIM = 0.72;

/**
 * Seconds simulated before the first frame, so the experiment opens fully formed.
 * Only the starting picture depends on it, so it uses 3× longer RK4 steps: a
 * one-off cost of roughly two frames, absorbed by the engine's scramble-in.
 */
const PREWARM_TIME = 0.9;
const PREWARM_DT = 1 / 15;
const PREWARM_STEP_LEN = 0.06;
/** Expanding ring that answers a click, seconds. */
const RIPPLE_TIME = 0.9;
const RIPPLE_RADIUS = 0.3;

const SEED = 0x2f6e2b1;
const LUT_SIZE = 64;

/* ─── Glyph codes ─────────────────────────────────────────────────────────── */

const SECTOR_CODES = Uint16Array.from(SECTOR_GLYPHS, (ch) => ch.charCodeAt(0));
/** One grid step in each sector's direction (rows count DOWN, so "north" is −1). */
const SECTOR_DC = Int8Array.of(1, 1, 0, -1, -1, -1, 0, 1);
const SECTOR_DR = Int8Array.of(0, -1, -1, -1, 0, 1, 1, 1);
const SPACE = 32;
const DOT = '·'.charCodeAt(0);
const CORE = '@'.charCodeAt(0);

/** Opacity envelope of a particle: fade in after spawn, fade out before its life ends. */
function alphaOf(a: number, life: number): number {
  if (a <= 0) return 0;
  const fadeIn = a < FADE_IN ? a / FADE_IN : 1;
  const rest = life - a;
  const fadeOut = rest < FADE_OUT ? rest / FADE_OUT : 1;
  return fadeIn < fadeOut ? fadeIn : fadeOut;
}

/** Number → display string with a true minus sign (U+2212) and no "−0.000". */
function fmt(v: number, digits = 3): string {
  const s = Math.abs(v).toFixed(digits);
  return v < 0 && Number(s) !== 0 ? `−${s}` : s;
}

export function createAttractor(): Experiment {
  /* ── parameters ───────────────────────────────────────────────────────── */
  let fc: FieldConstants = deriveFieldConstants({});
  let targetN = Math.min(MAX_PARTICLES, fc.N);
  let rCapture = captureRadius(fc.eps);
  let coreR = softeningRadius(fc.eps);
  /** count was raised: retired slots below the new count must be refilled */
  let reviveHoles = false;

  /* ── grid geometry (resize) ───────────────────────────────────────────── */
  let ready = false;
  let cols = 0;
  let rows = 0;
  let cells = 0;
  let aspect = 1;
  // world → fractional grid:  col = x·colScale + colOffset,  row = rowOffset − y·rowScale
  // (the minus sign is the y-flip: world y points up, grid rows count down)
  let colScale = 1;
  let colOffset = 0;
  let rowScale = 1;
  let rowOffset = 0;
  /** width of one cell in world units */
  let cellWorld = 0.015;
  /** world x of every column centre / world y of every row centre (quiver lattice) */
  let colX: Float32Array = new Float32Array(0);
  let rowY: Float32Array = new Float32Array(0);

  /* ── particles: structure of arrays, preallocated for the maximum count ── */
  const px = new Float64Array(MAX_PARTICLES);
  const py = new Float64Array(MAX_PARTICLES);
  const vx = new Float32Array(MAX_PARTICLES);
  const vy = new Float32Array(MAX_PARTICLES);
  const speed = new Float32Array(MAX_PARTICLES);
  const age = new Float32Array(MAX_PARTICLES);
  const life = new Float32Array(MAX_PARTICLES);
  /** luminosity b ∈ [0, 1) */
  const lum = new Float32Array(MAX_PARTICLES);
  const sector = new Uint8Array(MAX_PARTICLES);
  const alive = new Uint8Array(MAX_PARTICLES);
  const steps = new Uint32Array(MAX_PARTICLES);
  const serial = new Uint16Array(MAX_PARTICLES);
  /** slots [0, active) are in use (some may be retired holes) */
  let active = 0;
  let serialCounter = 0;
  let needsSpawn = true;
  let firstSpawn = true;

  /* ── attractors ───────────────────────────────────────────────────────── */
  const core: Spring2 = { x: 0, y: 0, vx: 0, vy: 0 };
  /** 0 = gliding on the idle path, 1 = following the pointer */
  let follow = 0;
  /** amplitude of the idle path (eases in after a reset so the core starts centred) */
  let pathAmp = 0;
  /** experiment-local simulation time, s */
  let clock = 0;
  const tempX = new Float64Array(MAX_TEMP_ATTRACTORS);
  const tempY = new Float64Array(MAX_TEMP_ATTRACTORS);
  const tempAge = new Float64Array(MAX_TEMP_ATTRACTORS);
  const tempUsed = new Uint8Array(MAX_TEMP_ATTRACTORS);
  /** this frame's attractors: slot 0 = a₀, then the live temporaries */
  const sources = createAttractorSet();
  /** the same field with its per-attractor constants precomputed (hot path) */
  const kernel = createFieldKernel();

  /* ── trail exposure buffer ────────────────────────────────────────────── */
  let trail = new Float32Array(0);
  /** last direction glyph that crossed each cell (afterglow when trails are off) */
  let trailGlyph = new Uint16Array(0);
  const trailLut = new Uint16Array(LUT_SIZE);
  let lutRamp: GlyphRamp | null = null;

  /* ── probe: one tracked particle and its recent path ──────────────────── */
  let tracked = -1;
  const hist = new Float64Array(HIST_LEN * 2);
  let histCount = 0;
  let histHead = 0;

  /* ── scratch (reused every step — no allocation in the loops) ─────────── */
  const scratch = createRK4Scratch();
  const next: Vec2 = { x: 0, y: 0 };
  const tmp: Vec2 = { x: 0, y: 0 };
  let rngState = SEED;

  /** dp/dt — the clamped field of this frame's attractors (compiled: see math/vectorField.ts). */
  const deriv: VectorFn = (x, y, out) => {
    kernelVelocity(kernel, x, y, out);
  };

  /** Seeded fast RNG (mulberry32): uniform in [0, 1). */
  function rand(): number {
    rngState = (rngState + 0x6d2b79f5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /* ─── Geometry ──────────────────────────────────────────────────────────── */

  function configureGrid(ctx: FrameContext): void {
    if (!(ctx.cellW > 0 && ctx.cellH > 0 && ctx.cols > 0 && ctx.rows > 0)) {
      ready = false;
      return;
    }
    const oldCols = cols;
    const oldRows = rows;
    const oldTrail = trail;
    const oldGlyph = trailGlyph;
    const oldColScale = colScale;
    const oldColOffset = colOffset;
    const oldRowScale = rowScale;
    const oldRowOffset = rowOffset;

    cols = ctx.cols | 0;
    rows = ctx.rows | 0;
    cells = cols * rows;
    aspect = worldAspect(ctx);
    const ppu = pxPerUnit(ctx);
    // stage px = W/2 + x·ppu (and H/2 − y·ppu); grid col = (px − originX)/cellW
    colScale = ppu / ctx.cellW;
    colOffset = (ctx.width / 2 - ctx.originX) / ctx.cellW;
    rowScale = ppu / ctx.cellH;
    rowOffset = (ctx.height / 2 - ctx.originY) / ctx.cellH;
    cellWorld = ctx.cellW / ppu;
    colX = columnWorldX(ctx, colX);
    rowY = rowWorldY(ctx, rowY);

    if (oldCols !== cols || oldRows !== rows || trail.length !== cells) {
      trail = new Float32Array(cells);
      trailGlyph = new Uint16Array(cells);
      // Carry the exposure across a grid change (adaptive quality, window
      // resize): sample the old buffer at each new cell's world position.
      if (oldTrail.length === oldCols * oldRows && oldTrail.length > 0) {
        for (let r = 0; r < rows; r++) {
          const orow = Math.floor(oldRowOffset - rowY[r] * oldRowScale);
          if (orow < 0 || orow >= oldRows) continue;
          for (let c = 0; c < cols; c++) {
            const ocol = Math.floor(colX[c] * oldColScale + oldColOffset);
            if (ocol < 0 || ocol >= oldCols) continue;
            const o = orow * oldCols + ocol;
            trail[r * cols + c] = oldTrail[o];
            trailGlyph[r * cols + c] = oldGlyph[o];
          }
        }
      }
    }
    ready = true;
  }

  /* ─── Attractors ────────────────────────────────────────────────────────── */

  function steerCore(ctx: FrameContext, dt: number): void {
    const p = ctx.pointer;
    const engaged = p.inside && p.idleTime < IDLE_AFTER;
    // blend weight between the idle path (0) and the pointer (1)
    follow += ((engaged ? 1 : 0) - follow) * (1 - Math.exp(-dt / FOLLOW_TAU));
    pathAmp = Math.min(1, pathAmp + dt / PATH_INTRO);
    const amp = pathAmp * pathAmp * (3 - 2 * pathAmp); // smoothstep
    idlePath(clock, aspect, tmp);
    let tx = tmp.x * amp;
    let ty = tmp.y * amp;
    if (follow > 1e-4) {
      const wx = stageToWorldX(p.x, ctx);
      const wy = stageToWorldY(p.y, ctx);
      tx += (wx - tx) * follow;
      ty += (wy - ty) * follow;
    }
    springStep(core, tx, ty, CORE_OMEGA, dt);
  }

  /** A click drops a counter-rotating attractor; with three alive, the oldest is replaced. */
  function addTemp(x: number, y: number): void {
    let slot = -1;
    let oldest = -1;
    for (let k = 0; k < MAX_TEMP_ATTRACTORS; k++) {
      if (tempUsed[k] === 0) {
        slot = k;
        break;
      }
      if (oldest < 0 || tempAge[k] > tempAge[oldest]) oldest = k;
    }
    if (slot < 0) slot = oldest;
    tempX[slot] = x;
    tempY[slot] = y;
    tempAge[slot] = 0;
    tempUsed[slot] = 1;
  }

  function ageTemps(dt: number): void {
    for (let k = 0; k < MAX_TEMP_ATTRACTORS; k++) {
      if (tempUsed[k] === 0) continue;
      tempAge[k] += dt;
      if (tempAge[k] >= TEMP_LIFETIME) tempUsed[k] = 0;
    }
  }

  /** Superposition: this frame's field is a₀ (w = 1, swirl +s) plus every temporary (w(τ), swirl −s). */
  function buildSources(): void {
    sources.count = 0;
    pushAttractor(sources, core.x, core.y, 1, 1);
    for (let k = 0; k < MAX_TEMP_ATTRACTORS; k++) {
      if (tempUsed[k] === 1) pushAttractor(sources, tempX[k], tempY[k], tempWeight(tempAge[k]), -1);
    }
    compileField(fc, sources, kernel);
  }

  function isCaptured(x: number, y: number, rc2: number): boolean {
    for (let j = 0; j < sources.count; j++) {
      if (sources.w[j] < CAPTURE_MIN_W) continue;
      const dx = x - sources.x[j];
      const dy = y - sources.y[j];
      if (dx * dx + dy * dy < rc2) return true;
    }
    return false;
  }

  /* ─── Particles ─────────────────────────────────────────────────────────── */

  function setMotion(i: number, mx: number, my: number): void {
    vx[i] = mx;
    vy[i] = my;
    speed[i] = Math.sqrt(mx * mx + my * my);
    sector[i] = directionSector(mx, my);
  }

  /** Respawn slot i uniformly over the enlarged stage; age = ageFraction·life + ageOffset. */
  function spawn(i: number, ageFraction: number, ageOffset: number): void {
    const keepOut = 4 * rCapture * rCapture; // not inside (twice) a capture radius
    let x = 0;
    let y = 0;
    for (let attempt = 0; attempt < 4; attempt++) {
      x = (rand() * 2 - 1) * aspect * SPAWN_MARGIN;
      y = (rand() * 2 - 1) * SPAWN_MARGIN;
      if (!isCaptured(x, y, keepOut)) break;
    }
    px[i] = x;
    py[i] = y;
    const L = LIFE_MIN + (LIFE_MAX - LIFE_MIN) * rand();
    life[i] = L;
    age[i] = ageFraction * L + ageOffset;
    lum[i] = rand();
    steps[i] = 0;
    serialCounter = (serialCounter + 1) % 10000;
    serial[i] = serialCounter;
    alive[i] = 1;
    velocityAt(fc, sources, x, y, tmp);
    setMotion(i, tmp.x, tmp.y);
  }

  /** A particle was captured, left the stage or expired: respawn it — or retire it if the count shrank. */
  function recycle(i: number): void {
    if (i === tracked) dropTracked();
    if (i >= targetN) {
      alive[i] = 0;
      return;
    }
    spawn(i, 0, 0);
  }

  function populate(): void {
    buildSources();
    active = targetN;
    for (let i = 0; i < active; i++) {
      // the first population gets random ages (deaths stay staggered); a reset fades everyone in
      if (firstSpawn) spawn(i, rand(), 0);
      else spawn(i, 0, -rand() * GROW_STAGGER);
    }
    for (let i = active; i < MAX_PARTICLES; i++) alive[i] = 0;
  }

  /**
   * Follow the `count` parameter without a visible reset: new particles fade in
   * staggered; surplus ones (slots ≥ N) get a short fade-out in `integrate` and
   * are retired. While paused no time passes, so changes apply at once.
   */
  function adjustPopulation(paused: boolean): void {
    const newAge = paused ? FADE_IN : 0;
    if (reviveHoles) {
      reviveHoles = false;
      const n = Math.min(active, targetN);
      for (let i = 0; i < n; i++) {
        if (alive[i] === 0) spawn(i, 0, paused ? newAge : -rand() * GROW_STAGGER);
      }
    }
    if (active < targetN) {
      for (let i = active; i < targetN; i++) spawn(i, 0, paused ? newAge : -rand() * GROW_STAGGER);
      active = targetN;
    } else if (paused && active > targetN) {
      for (let i = targetN; i < active; i++) {
        if (i === tracked) dropTracked();
        alive[i] = 0;
      }
    }
    while (active > targetN && alive[active - 1] === 0) active--;
  }

  /** Lay energy along the segment (x0,y0)→(x1,y1), sampled finely enough that no cell is skipped. */
  function deposit(x0: number, y0: number, x1: number, y1: number, gain: number, code: number): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (!(len > 0)) return;
    let m = Math.ceil(len / (DEPOSIT_SPACING * cellWorld));
    if (m > 4) m = 4;
    // energy ∝ distance travelled in cell widths → trail brightness measures particle FLUX
    const e = (gain * len) / (cellWorld * m);
    for (let s = 1; s <= m; s++) {
      const t = s / m;
      const c = Math.floor((x0 + dx * t) * colScale + colOffset);
      const r = Math.floor(rowOffset - (y0 + dy * t) * rowScale);
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
      const idx = r * cols + c;
      trail[idx] += e;
      trailGlyph[idx] = code;
    }
  }

  function decayTrails(dt: number): void {
    const k = Math.exp(-dt / (fc.trails ? TRAIL_TAU : PERSIST_TAU));
    for (let i = 0; i < cells; i++) {
      const e = trail[i] * k;
      trail[i] = e < 1e-4 ? 0 : e; // flush tiny values (avoids denormals)
    }
  }

  /** Advance every particle by dt with sub-stepped RK4; deposit trails; recycle the captured / lost / expired. */
  function integrate(dt: number, maxStepLen: number): void {
    const n = active;
    const xLim = aspect * CULL_MARGIN;
    const yLim = CULL_MARGIN;
    const rc2 = rCapture * rCapture;
    const vmaxInv = 1 / fc.vmax;
    const v = scratch.v;
    for (let i = 0; i < n; i++) {
      if (alive[i] === 0) continue;
      const a = age[i] + dt;
      age[i] = a;
      if (i >= targetN && life[i] > a + RETIRE_FADE) life[i] = a + RETIRE_FADE; // count lowered: fade out
      if (a >= life[i]) {
        recycle(i);
        continue;
      }
      // exposure gain: luminosity b³, brighter when fast; fading particles deposit less
      const b = lum[i];
      const gain = alphaOf(a, life[i]) * b * b * b * speed[i] * vmaxInv;
      // sub-stepping: each RK4 step covers at most MAX_STEP_LEN world units
      const sub = substepCount(speed[i], dt, maxStepLen, MAX_SUBSTEPS);
      const h = dt / sub;
      let x = px[i];
      let y = py[i];
      let captured = false;
      for (let k = 0; k < sub; k++) {
        rk4Step(deriv, x, y, h, next, scratch);
        if (gain > 0) deposit(x, y, next.x, next.y, gain, SECTOR_CODES[directionSector(v.x, v.y)]);
        x = next.x;
        y = next.y;
        if (isCaptured(x, y, rc2)) {
          captured = true;
          break;
        }
      }
      if (captured || x < -xLim || x > xLim || y < -yLim || y > yLim) {
        recycle(i);
        continue;
      }
      px[i] = x;
      py[i] = y;
      steps[i] += sub;
      setMotion(i, v.x, v.y);
    }
  }

  function prewarm(): void {
    const frames = Math.round(PREWARM_TIME / PREWARM_DT);
    for (let f = 0; f < frames; f++) {
      decayTrails(PREWARM_DT);
      integrate(PREWARM_DT, PREWARM_STEP_LEN);
    }
  }

  /* ─── Probe particle ────────────────────────────────────────────────────── */

  function dropTracked(): void {
    // the probe particle was made ageless; hand it back its mortality
    if (tracked >= 0 && alive[tracked] === 1 && !Number.isFinite(life[tracked])) {
      life[tracked] = age[tracked] + FADE_OUT;
    }
    tracked = -1;
    histCount = 0;
    histHead = 0;
  }

  function pushHistory(x: number, y: number): void {
    hist[histHead * 2] = x;
    hist[histHead * 2 + 1] = y;
    histHead = (histHead + 1) % HIST_LEN;
    if (histCount < HIST_LEN) histCount++;
  }

  /** Choose a fully visible particle about PICK_RADIUS from a₀: a long spiral lies ahead of it. */
  function pickTracked(): void {
    const n = Math.min(active, targetN);
    if (n <= 0) return;
    const xIn = aspect * 0.86;
    const start = Math.floor(rand() * n);
    let best = -1;
    let bestScore = -Infinity;
    const samples = Math.min(n, PICK_SAMPLES);
    for (let k = 0; k < samples; k++) {
      const i = (start + k) % n;
      if (alive[i] === 0 || age[i] < FADE_IN || life[i] - age[i] < FADE_OUT * 2) continue;
      const x = px[i];
      const y = py[i];
      if (x < -xIn || x > xIn || y < -0.86 || y > 0.86) continue;
      const dx = x - core.x;
      const dy = y - core.y;
      const score = -Math.abs(Math.sqrt(dx * dx + dy * dy) - PICK_RADIUS);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) return;
    tracked = best;
    // the probe particle does not age out: it rides the field until captured or it leaves the stage
    life[best] = Infinity;
    histCount = 0;
    histHead = 0;
    pushHistory(px[best], py[best]);
  }

  function ensureTracked(): void {
    if (tracked >= 0 && (alive[tracked] === 0 || tracked >= targetN)) dropTracked();
    if (tracked < 0) pickTracked();
  }

  function recordHistory(): void {
    if (tracked < 0) return;
    const x = px[tracked];
    const y = py[tracked];
    const last = (histHead - 1 + HIST_LEN) % HIST_LEN;
    const dx = x - hist[last * 2];
    const dy = y - hist[last * 2 + 1];
    if (histCount === 0 || dx * dx + dy * dy >= HIST_SPACING * HIST_SPACING) pushHistory(x, y);
  }

  /* ─── Drawing ───────────────────────────────────────────────────────────── */

  function refreshLut(ctx: FrameContext): void {
    const ramp = ctx.ramp(RAMPS.soft);
    if (ramp === lutRamp) return;
    lutRamp = ramp;
    for (let k = 0; k < LUT_SIZE; k++) trailLut[k] = ramp.codeFor(k / (LUT_SIZE - 1));
  }

  /** Write a cell unconditionally (markers, probe). */
  function put(field: GlyphField, c: number, r: number, code: number, inten: number, tone: number): void {
    if (c < 0 || r < 0 || c >= cols || r >= rows) return;
    const idx = r * cols + c;
    field.glyph[idx] = code;
    field.intensity[idx] = inten;
    field.tone[idx] = tone;
  }

  /**
   * Quiver plot of F on a sparse lattice. Each sample is a tiny arrow: the
   * direction stroke is the head and a dim '·' one cell upstream is the tail,
   * so the lattice shows which WAY F points, not just its orientation.
   */
  function drawQuiver(field: GlyphField): void {
    const G = field.glyph;
    const I = field.intensity;
    const T = field.tone;
    const c0 = ((cols - 1) % QUIVER_COLS) >> 1;
    const r0 = ((rows - 1) % QUIVER_ROWS) >> 1;
    for (let r = r0; r < rows; r += QUIVER_ROWS) {
      const y = rowY[r];
      for (let c = c0; c < cols; c += QUIVER_COLS) {
        fieldAt(fc, sources, colX[c], y, tmp);
        const m = Math.sqrt(tmp.x * tmp.x + tmp.y * tmp.y);
        if (!(m > 1e-6)) continue;
        const k = directionSector(tmp.x, tmp.y);
        const inten = 0.34 + 0.22 * (1 - Math.exp(-m / 0.7));
        const idx = r * cols + c;
        G[idx] = SECTOR_CODES[k];
        I[idx] = inten;
        T[idx] = Tone.MUTED;
        const tc = c - SECTOR_DC[k];
        const tr = r - SECTOR_DR[k];
        if (tc < 0 || tr < 0 || tc >= cols || tr >= rows) continue;
        const t = tr * cols + tc;
        G[t] = DOT;
        I[t] = inten * 0.6;
        T[t] = Tone.MUTED;
      }
    }
  }

  /** Exposure scale: grows like √N so more particles read brighter, but never wash out. */
  function exposure(): number {
    const base = fc.trails ? TRAIL_E0 : TRAIL_E0_PERSIST;
    return base * Math.sqrt(Math.max(0.1, targetN / 5000));
  }

  function drawTrails(field: GlyphField): void {
    const G = field.glyph;
    const I = field.intensity;
    const T = field.tone;
    const inv = 1 / exposure();
    const top = (LUT_SIZE - 1) * TRAIL_RAMP_TOP;
    const on = fc.trails;
    const dim = fc.showField ? FIELD_FOCUS_DIM : 1;
    for (let i = 0; i < cells; i++) {
      const e = trail[i];
      if (e < TRAIL_FLOOR) continue;
      // film-like response: saturates gracefully where streams converge
      const v = 1 - Math.exp(-e * inv);
      let code: number;
      let inten: number;
      if (on) {
        code = trailLut[(v * top + 0.5) | 0];
        inten = (TRAIL_I0 + TRAIL_I1 * v) * dim;
      } else {
        // trails off: a brief afterglow of the direction glyphs keeps motion legible
        if (v < 0.06) continue;
        code = trailGlyph[i];
        inten = (0.06 + 0.42 * v) * dim;
      }
      if (code === SPACE || code === 0 || inten < I[i]) continue;
      G[i] = code;
      I[i] = inten;
      T[i] = Tone.INK;
    }
  }

  function drawHeads(field: GlyphField): void {
    const G = field.glyph;
    const I = field.intensity;
    const T = field.tone;
    const vmaxInv = 1 / fc.vmax;
    const mintR = Math.max(MINT_R_MIN, MINT_R_SOFT * coreR);
    const mintR2 = mintR * mintR;
    const iceR2 = ICE_RADIUS * ICE_RADIUS;
    const nSrc = sources.count;
    const eps = fc.eps;
    const cx = core.x;
    const cy = core.y;
    const dim = fc.showField ? FIELD_FOCUS_DIM : 1;
    for (let i = 0; i < active; i++) {
      if (alive[i] === 0) continue;
      const alpha = alphaOf(age[i], life[i]) * dim;
      if (alpha <= 0.02) continue;
      const x = px[i];
      const y = py[i];
      const c = Math.floor(x * colScale + colOffset);
      const r = Math.floor(rowOffset - y * rowScale);
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
      const sp = speed[i] * vmaxInv;
      let inten = alpha * (HEAD_I0 + HEAD_I1 * sp) * (LUM_HEAD + (1 - LUM_HEAD) * lum[i]);
      let tone: number = Tone.INK;
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (sp > MINT_SPEED && d2 < mintR2) {
        // the fastest particles, deep in the main core
        tone = Tone.MINT;
        inten = Math.max(inten, 0.92 * alpha);
      } else if (nSrc > 1) {
        // ICE: a temporary attractor clearly out-pulls a₀ here  (wⱼ/(rⱼ²+ε) > 1.5/(r₀²+ε))
        const main = ICE_DOMINANCE / (d2 + eps);
        for (let j = 1; j < nSrc; j++) {
          const ex = x - sources.x[j];
          const ey = y - sources.y[j];
          const e2 = ex * ex + ey * ey;
          if (e2 < iceR2 && sources.w[j] / (e2 + eps) > main) {
            tone = Tone.ICE;
            break;
          }
        }
      }
      const idx = r * cols + c;
      if (inten < I[idx]) continue;
      G[idx] = sp < SLOW_FRACTION ? DOT : SECTOR_CODES[sector[i]];
      I[idx] = inten;
      T[idx] = tone;
    }
  }

  /** Dotted ring of `code` at world radius `radius` around (wx, wy). */
  function drawRing(
    field: GlyphField,
    wx: number,
    wy: number,
    radius: number,
    code: number,
    inten: number,
    tone: number,
  ): void {
    const A = radius * colScale; // semi-axes in cells (cells are taller than wide)
    const B = radius * rowScale;
    const perimeter = 2 * Math.PI * Math.sqrt((A * A + B * B) / 2);
    const n = Math.max(8, Math.min(120, Math.round(perimeter * 0.55)));
    const c0 = wx * colScale + colOffset;
    const r0 = rowOffset - wy * rowScale;
    for (let k = 0; k < n; k++) {
      const th = (k / n) * Math.PI * 2;
      put(field, Math.floor(c0 + A * Math.cos(th)), Math.floor(r0 - B * Math.sin(th)), code, inten, tone);
    }
  }

  function cellOf(wx: number, wy: number, out: Vec2): void {
    out.x = Math.floor(wx * colScale + colOffset);
    out.y = Math.floor(rowOffset - wy * rowScale);
  }

  function drawProbe(field: GlyphField): void {
    if (tracked < 0) return;
    for (let k = 0; k < histCount; k++) {
      const slot = (histHead - histCount + k + HIST_LEN) % HIST_LEN;
      cellOf(hist[slot * 2], hist[slot * 2 + 1], tmp);
      put(field, tmp.x, tmp.y, DOT, 0.22 + (0.58 * (k + 1)) / histCount, Tone.MINT);
    }
    cellOf(px[tracked], py[tracked], tmp);
    const slow = speed[tracked] < SLOW_FRACTION * fc.vmax;
    put(field, tmp.x, tmp.y, slow ? DOT : SECTOR_CODES[sector[tracked]], 1, Tone.MINT);
  }

  function drawMarkers(field: GlyphField): void {
    // temporary attractors: ICE core, a ring that loosens as the weight fades, and a ripple on drop
    for (let k = 0; k < MAX_TEMP_ATTRACTORS; k++) {
      if (tempUsed[k] === 0) continue;
      const a = tempAge[k];
      const w = tempWeight(a);
      const x = tempX[k];
      const y = tempY[k];
      if (a < RIPPLE_TIME) {
        const u = a / RIPPLE_TIME;
        const grow = 1 - (1 - u) * (1 - u); // ease-out
        drawRing(field, x, y, coreR + RIPPLE_RADIUS * grow, DOT, 0.55 * (1 - u), Tone.ICE);
      }
      drawRing(field, x, y, coreR * (1 + 0.8 * (1 - w)), DOT, 0.2 + 0.45 * w, Tone.ICE);
      cellOf(x, y, tmp);
      put(field, tmp.x, tmp.y, CORE, 0.4 + 0.6 * w, Tone.ICE);
    }
    // main core: '@' inside a dotted ring of radius √ε — the softening length
    drawRing(field, core.x, core.y, coreR, DOT, 0.62, Tone.MINT);
    cellOf(core.x, core.y, tmp);
    put(field, tmp.x, tmp.y, CORE, 1, Tone.MINT);
  }

  /* ─── Experiment API ────────────────────────────────────────────────────── */

  return {
    id: 'attractor',

    resize(ctx: FrameContext): void {
      configureGrid(ctx);
    },

    setParams(params: Readonly<ParamValues>): void {
      fc = deriveFieldConstants(params);
      const n = Math.min(MAX_PARTICLES, fc.N);
      if (n > targetN) reviveHoles = true;
      targetN = n;
      rCapture = captureRadius(fc.eps);
      coreR = softeningRadius(fc.eps);
    },

    update(ctx: FrameContext): void {
      if (!ready) return;
      if (needsSpawn) {
        needsSpawn = false;
        populate();
        if (firstSpawn) {
          firstSpawn = false;
          prewarm();
        }
      }
      // clicks drop temporary attractors (also while paused)
      const clicks = ctx.pointer.clicks;
      for (let k = 0; k < clicks.length; k++) {
        addTemp(stageToWorldX(clicks[k].x, ctx), stageToWorldY(clicks[k].y, ctx));
      }
      const dt = ctx.dt;
      adjustPopulation(dt <= 0);
      if (dt > 0) {
        clock += dt;
        steerCore(ctx, dt);
        ageTemps(dt);
        buildSources();
        decayTrails(dt);
        integrate(dt, MAX_STEP_LEN);
        recordHistory();
      } else {
        buildSources();
      }
      ensureTracked();
    },

    render(field: GlyphField, ctx: FrameContext): void {
      if (field.cols !== cols || field.rows !== rows) configureGrid(ctx);
      if (!ready || needsSpawn || field.cols !== cols || field.rows !== rows) return;
      refreshLut(ctx);
      (globalThis as unknown as { __ATTR_DEBUG__?: Float32Array }).__ATTR_DEBUG__ = trail; // TEMP-TUNING
      const mask = (globalThis as unknown as { __ATTR_LAYERS__?: number }).__ATTR_LAYERS__ ?? 31; // TEMP-TUNING
      if (fc.showField && mask & 1) drawQuiver(field);
      if (mask & 2) drawTrails(field);
      if (mask & 4) drawHeads(field);
      if (mask & 8) drawProbe(field);
      if (mask & 16) drawMarkers(field);
    },

    reset(): void {
      rngState = SEED;
      needsSpawn = true;
      dropTracked();
      core.x = 0;
      core.y = 0;
      core.vx = 0;
      core.vy = 0;
      pathAmp = 0;
      clock = 0;
      tempUsed.fill(0);
      trail.fill(0);
      trailGlyph.fill(0);
      serialCounter = 0;
    },

    probe(): ProbeReadout | null {
      if (!ready || needsSpawn) return null;
      ensureTracked();
      const i = tracked;
      if (i < 0) return null;
      const x = px[i];
      const y = py[i];
      fieldAt(fc, sources, x, y, tmp); // the raw equation value F(p), before the speed clamp
      const fx = tmp.x;
      const fy = tmp.y;
      const fm = Math.sqrt(fx * fx + fy * fy);
      const dx = x - core.x;
      const dy = y - core.y;
      const sp = speed[i] / fc.vmax;
      const slow = sp < SLOW_FRACTION;
      return {
        heading: `PARTICLE #${String(serial[i]).padStart(4, '0')}`,
        rows: [
          { label: 'p', value: `(${fmt(x)}, ${fmt(y)})` },
          { label: 'F(p)', value: `(${fmt(fx)}, ${fmt(fy)})` },
          { label: '|F|', value: fmt(fm), tone: 'mint' },
          { label: 'r', value: fmt(Math.sqrt(dx * dx + dy * dy)) },
          { label: 'steps', value: steps[i].toLocaleString('en-US'), tone: 'muted' },
        ],
        value: fm,
        valueLabel: '|F|',
        intensity: Math.min(1, HEAD_I0 + HEAD_I1 * Math.sqrt(sp)),
        glyph: slow ? '·' : SECTOR_GLYPHS[sector[i]],
        vars: { ax: core.x, ay: core.y, t: clock },
      };
    },

    dispose(): void {
      ready = false;
      needsSpawn = true;
      firstSpawn = true;
      tracked = -1;
      active = 0;
      trail = new Float32Array(0);
      trailGlyph = new Uint16Array(0);
      lutRamp = null;
    },
  };
}
