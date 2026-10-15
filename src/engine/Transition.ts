import { Tone } from './types';
import type { GlyphField } from './types';

/* ═══════════════════════════════════════════════════════════════════════════
 *  GLYPHFIELD · GLYPH-SCRAMBLE TRANSITION
 *
 *  Switching experiments is itself a little piece of mathematics.
 *
 *  Every cell i gets an ORDER oᵢ ∈ [0, 1] — when it takes part in the effect:
 *      oᵢ = normalise( 0.66·dᵢ + 0.34·noise(xᵢ, yᵢ) )
 *  dᵢ = distance of the cell from the stage centre (0 at the centre, 1 in the
 *  corners) and noise = smooth 2-D value noise, so the front is a ring that
 *  radiates outward with an organic, ragged edge. The orders are computed
 *  ONCE per transition (fresh random seed each time); every frame then costs
 *  one comparison per cell.
 *
 *    OUT (≈ 320 ms)  cell i dissolves at p = 0.68·oᵢ: it turns into random
 *                    glyphs from SCRAMBLE_CHARS whose intensity fades as (1 − a)².
 *    switch          the engine activates the next experiment.
 *    IN  (≈ 650 ms)  cell i resolves at p = 0.02 + 0.88·oᵢ. Just before that it
 *                    flickers as a MINT scramble glyph; afterwards it shows the
 *                    real field with a brief brightness "pop". Cells the front
 *                    has not reached yet stay dark. First load: 1.4 s.
 *    reduced motion  a plain intensity fade (100 ms out + 100 ms in).
 *
 *  Retargeting: a new switch requested mid-IN plays the IN BACKWARDS from
 *  exactly where it is (seamless), then continues to the new target; changing
 *  your mind again mid-rewind turns it forward again. Nothing can get stuck:
 *  every phase ends after a fixed, finite duration.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Glyphs used for the scramble (all inside GLYPH_CHARSET). */
export const SCRAMBLE_CHARS = '!<>-_\\/[]{}=+*^?#%01';
const SCRAMBLE = Uint16Array.from(SCRAMBLE_CHARS, (ch) => ch.charCodeAt(0));
const SCRAMBLE_COUNT = SCRAMBLE.length;

/** Phase durations in seconds of wall-clock time. */
export const TRANSITION_DURATIONS = {
  out: 0.32,
  in: 0.65,
  firstIn: 1.4,
  fadeOut: 0.1,
  fadeIn: 0.1,
  firstFadeIn: 0.2,
} as const;

export type TransitionPhase = 'idle' | 'out' | 'in';
/** 'scramble' = the full glyph effect; 'fade' = reduced-motion intensity fade. */
export type TransitionStyle = 'scramble' | 'fade';

/* Choreography, in units of phase progress p ∈ [0, 1]. */
/** OUT: cell i starts to dissolve at p = OUT_SPREAD·oᵢ … */
const OUT_SPREAD = 0.68;
/** … and is completely dark OUT_FADE later (0.68 + 0.32 = 1). */
const OUT_FADE = 0.32;
/** IN: cell i resolves at p = IN_START + IN_SPREAD·oᵢ (the outermost at 0.90). */
const IN_START = 0.02;
const IN_SPREAD = 0.88;
/** IN: a cell flickers for this much progress before it resolves. */
const IN_WINDOW = 0.15;
const IN_WINDOW_FIRST = 0.22;
/** IN: brightness pop after resolving (0.90 + 0.08 < 1, so it always settles). */
const IN_POP = 0.08;
/** IN easing p = 1 − (1 − x)^k: the front leaves the centre fast and slows near the edges. */
const IN_EASE = 1.5;
/** Scramble glyphs change about this many times per second. */
const FLICKER_HZ = 22;
/** Value-noise frequencies in CSS px⁻¹ (blobs ≈ 140 px with ≈ 52 px detail). */
const NOISE_COARSE = 1 / 140;
const NOISE_FINE = 1 / 52;
/** Share of noise in the order (the rest is distance from the centre). */
const NOISE_WEIGHT = 0.34;

/** Marsaglia's xorshift32: three shifts and three XORs per number (period 2³² − 1). */
export class XorShift32 {
  private s: number;

  constructor(seed = 0x9e3779b9) {
    this.s = seed | 0 || 0x9e3779b9; // the state must never be 0
  }

  /** Next unsigned 32-bit integer. */
  nextU32(): number {
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x;
    return x >>> 0;
  }

  /** Next float in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }
}

/** Integer hash (lowbias32): scrambles the bits of x into an unsigned 32-bit value. */
export function hash32(v: number): number {
  let x = v | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Pseudo-random value in [0, 1) at an integer lattice point. */
function lattice(ix: number, iy: number, seed: number): number {
  return hash32(Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ seed) / 4294967296;
}

/**
 * Smooth 2-D value noise in [0, 1): random values on the integer lattice,
 * blended with the smoothstep weight u = 3f² − 2f³ (bilinear in u).
 */
function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = lattice(ix, iy, seed);
  const b = lattice(ix + 1, iy, seed);
  const c = lattice(ix, iy + 1, seed);
  const d = lattice(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function smooth01(x: number): number {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}

export class GlyphTransition {
  private phaseValue: TransitionPhase = 'idle';
  private styleValue: TransitionStyle = 'scramble';
  private elapsed = 0;
  private duration = 1;
  /** seconds since the transition began — drives the flicker, survives rewinds */
  private clock = 0;
  /** an IN being played backwards (a retarget mid-decode) */
  private rewinding = false;
  /** decode progress at which the rewind started */
  private rewindFrom = 0;
  private window = IN_WINDOW;
  private seed = 1;
  private readonly rng = new XorShift32(0x2545f491);

  /** per-cell order oᵢ ∈ [0, 1] and a random byte ("salt"); grow-only buffers */
  private order = new Float32Array(0);
  private salt = new Uint8Array(0);
  private orderDirty = true;
  private orderCols = -1;
  private orderRows = -1;
  private orderCellW = 0;
  private orderCellH = 0;

  get phase(): TransitionPhase {
    return this.phaseValue;
  }

  get style(): TransitionStyle {
    return this.styleValue;
  }

  get active(): boolean {
    return this.phaseValue !== 'idle';
  }

  /** True while an interrupted IN is being played backwards. */
  get isRewinding(): boolean {
    return this.phaseValue === 'out' && this.rewinding;
  }

  /** Decode progress (IN, rewind) or dissolve progress (OUT), in [0, 1]. */
  get progress(): number {
    const x = clamp01(this.elapsed / this.duration);
    if (this.phaseValue === 'in') return 1 - Math.pow(1 - x, IN_EASE);
    if (this.rewinding) return this.rewindFrom * (1 - x);
    return x;
  }

  /** Begin dissolving the visible field. */
  startOut(style: TransitionStyle): void {
    this.phaseValue = 'out';
    this.styleValue = style;
    this.rewinding = false;
    this.elapsed = 0;
    this.clock = 0;
    this.duration = style === 'fade' ? TRANSITION_DURATIONS.fadeOut : TRANSITION_DURATIONS.out;
    this.reseed();
  }

  /** Begin decoding the (new) field; `firstLoad` = the long reveal out of darkness. */
  startIn(style: TransitionStyle, firstLoad = false): void {
    this.phaseValue = 'in';
    this.styleValue = style;
    this.rewinding = false;
    this.elapsed = 0;
    this.clock = 0;
    this.window = firstLoad ? IN_WINDOW_FIRST : IN_WINDOW;
    const D = TRANSITION_DURATIONS;
    this.duration = style === 'fade' ? (firstLoad ? D.firstFadeIn : D.fadeIn) : firstLoad ? D.firstIn : D.in;
    this.reseed();
  }

  /**
   * Retarget mid-decode: play the IN backwards from exactly where it is. It
   * becomes the OUT phase, so it ends with `advance()` returning true.
   */
  rewind(): boolean {
    if (this.phaseValue !== 'in') return false;
    const p = this.progress;
    this.phaseValue = 'out';
    this.rewinding = true;
    this.rewindFrom = p;
    this.elapsed = 0;
    const full = this.styleValue === 'fade' ? TRANSITION_DURATIONS.fadeOut : TRANSITION_DURATIONS.out;
    this.duration = Math.max(0.06, full * p); // a barely-started IN rewinds almost instantly
    return true;
  }

  /** Changed back mid-rewind: decode forward again from the current point. */
  resume(): boolean {
    if (!this.isRewinding) return false;
    const p = this.progress;
    this.phaseValue = 'in';
    this.rewinding = false;
    this.duration = this.styleValue === 'fade' ? TRANSITION_DURATIONS.fadeIn : TRANSITION_DURATIONS.in;
    // invert the ease p = 1 − (1 − x)^k  ⇒  x = 1 − (1 − p)^(1/k)
    this.elapsed = (1 - Math.pow(1 - p, 1 / IN_EASE)) * this.duration;
    return true;
  }

  /** Advance by wall-clock seconds. Returns true exactly once: when an OUT has finished. */
  advance(dt: number): boolean {
    if (this.phaseValue === 'idle') return false;
    if (dt > 0) {
      this.elapsed += dt;
      this.clock += dt;
    }
    if (this.elapsed < this.duration) return false;
    const finishedOut = this.phaseValue === 'out';
    this.phaseValue = 'idle';
    this.rewinding = false;
    return finishedOut;
  }

  /** Stop immediately (engine teardown). */
  cancel(): void {
    this.phaseValue = 'idle';
    this.rewinding = false;
  }

  /** Transform this frame's field in place. `cellW`/`cellH` keep the front circular on screen. */
  apply(field: GlyphField, cellW: number, cellH: number): void {
    if (this.phaseValue === 'idle') return;
    const cols = field.cols;
    const rows = field.rows;
    const n = cols * rows;
    if (n <= 0) return;
    const p = this.progress;
    const decoding = this.phaseValue === 'in' || this.rewinding;

    if (this.styleValue === 'fade') {
      // Reduced motion: no glyph changes, no movement — only brightness.
      const f = decoding ? smooth01(p) : 1 - smooth01(p);
      const intensity = field.intensity;
      for (let i = 0; i < n; i++) intensity[i] *= f;
      return;
    }

    if (
      this.orderDirty ||
      cols !== this.orderCols ||
      rows !== this.orderRows ||
      cellW !== this.orderCellW ||
      cellH !== this.orderCellH
    ) {
      this.buildOrder(cols, rows, cellW, cellH);
    }
    if (decoding) this.decode(field, n, p);
    else this.dissolve(field, n, p);
  }

  private reseed(): void {
    this.seed = this.rng.nextU32() | 1;
    this.orderDirty = true;
  }

  /** Precompute oᵢ for every cell (once per transition — or if the grid changes mid-way). */
  private buildOrder(cols: number, rows: number, cellW: number, cellH: number): void {
    const n = cols * rows;
    if (this.order.length < n) {
      this.order = new Float32Array(n);
      this.salt = new Uint8Array(n);
    }
    const order = this.order;
    const salt = this.salt;
    const seed = this.seed;
    const seed2 = seed ^ 0x5bd1e995;
    const cw = cellW > 0 ? cellW : 1;
    const ch = cellH > 0 ? cellH : 1;
    const cx = (cols * cw) / 2;
    const cy = (rows * ch) / 2;
    const maxD = Math.hypot(cx, cy) || 1;
    let lo = Infinity;
    let hi = -Infinity;
    for (let r = 0; r < rows; r++) {
      const py = (r + 0.5) * ch;
      const dy = py - cy;
      for (let c = 0; c < cols; c++) {
        const px = (c + 0.5) * cw;
        const dx = px - cx;
        const d = Math.sqrt(dx * dx + dy * dy) / maxD;
        const noise =
          0.65 * valueNoise(px * NOISE_COARSE, py * NOISE_COARSE, seed) +
          0.35 * valueNoise(px * NOISE_FINE, py * NOISE_FINE, seed2);
        const v = (1 - NOISE_WEIGHT) * d + NOISE_WEIGHT * noise;
        const i = r * cols + c;
        order[i] = v;
        salt[i] = hash32(i ^ seed) & 255;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    // Normalise to exactly [0, 1]: the first cell moves at p = 0, the last right on schedule.
    const inv = hi > lo ? 1 / (hi - lo) : 0;
    for (let i = 0; i < n; i++) order[i] = (order[i] - lo) * inv;
    this.orderDirty = false;
    this.orderCols = cols;
    this.orderRows = rows;
    this.orderCellW = cellW;
    this.orderCellH = cellH;
  }

  /** IN (and its rewind): darkness → flickering MINT scramble → the real field. */
  private decode(field: GlyphField, n: number, p: number): void {
    const glyph = field.glyph;
    const intensity = field.intensity;
    const tone = field.tone;
    const order = this.order;
    const salt = this.salt;
    const win = this.window;
    const invWin = 1 / win;
    const tickBase = this.clock * FLICKER_HZ;
    const seed = this.seed;
    for (let i = 0; i < n; i++) {
      const t = IN_START + IN_SPREAD * order[i]; // this cell resolves at p = t
      if (p >= t) {
        const k = (p - t) / IN_POP;
        if (k < 1) {
          const v = intensity[i] * (1 + 0.6 * (1 - k)); // the "lock-in" pop
          intensity[i] = v > 1 ? 1 : v;
        }
        continue;
      }
      const lead = t - p; // how far ahead of the front this cell still is
      const s = salt[i];
      const i0 = intensity[i];
      // Lit cells scramble at a brightness that follows the real field; empty
      // cells add only a sparse shimmer (≈ 9 %), so the ring traces the content.
      const base = i0 > 0.02 ? 0.3 + 0.7 * i0 : s < 24 ? 0.2 : 0;
      if (lead >= win || base === 0) {
        glyph[i] = 0;
        intensity[i] = 0;
        continue;
      }
      const tick = (tickBase + (s & 15) * 0.0625) | 0; // each cell flickers on its own phase
      glyph[i] = SCRAMBLE[hash32(Math.imul(i, 0x9e3779b1) ^ Math.imul(tick, 0x85ebca77) ^ seed) % SCRAMBLE_COUNT];
      intensity[i] = base * (1 - 0.7 * lead * invWin); // brightest right at the front
      tone[i] = (s & 7) === 0 ? Tone.INK : Tone.MINT;
    }
  }

  /** OUT: the field burns away into scramble glyphs that fade as (1 − a)². */
  private dissolve(field: GlyphField, n: number, p: number): void {
    const glyph = field.glyph;
    const intensity = field.intensity;
    const tone = field.tone;
    const order = this.order;
    const salt = this.salt;
    const invFade = 1 / OUT_FADE;
    const tickBase = this.clock * FLICKER_HZ;
    const seed = this.seed;
    for (let i = 0; i < n; i++) {
      const t = OUT_SPREAD * order[i];
      if (p <= t) continue; // the front has not arrived: the old field, untouched
      const a = (p - t) * invFade; // 0 → 1 as this cell burns out
      const s = salt[i];
      const i0 = intensity[i];
      const base = i0 > 0.02 ? 0.25 + 0.75 * i0 : s < 32 ? 0.22 : 0;
      if (a >= 1 || base === 0) {
        glyph[i] = 0;
        intensity[i] = 0;
        continue;
      }
      const tick = (tickBase + (s & 15) * 0.0625) | 0;
      glyph[i] = SCRAMBLE[hash32(Math.imul(i, 0x9e3779b1) ^ Math.imul(tick, 0x85ebca77) ^ seed) % SCRAMBLE_COUNT];
      const e = 1 - a;
      intensity[i] = base * e * e;
      // a few mint sparks on the leading edge, a muted tail behind it
      tone[i] = a < 0.15 && (s & 3) === 0 ? Tone.MINT : a > 0.55 ? Tone.MUTED : Tone.INK;
    }
  }
}
