import type { ParamValues } from '../engine/types';
import { clampSpeed } from './integrate';

/* ═══════════════════════════════════════════════════════════════════════════
 *  ATTRACTOR mathematics — pure functions, no DOM.
 *
 *      F(x, y) = Σⱼ wⱼ · [ s·(−Δy, Δx) − g·(Δx, Δy) ] / (Δx² + Δy² + ε)
 *      with Δ = p − aⱼ, and particles obey dp/dt = F(p).
 *
 *  s·(−Δy, Δx)/(r²+ε)  — rotational part (a point vortex): pushes sideways.
 *  −g·(Δx, Δy)/(r²+ε)  — radial part (a point sink): pulls inward.
 *  Together the stream lines are logarithmic spirals  r = r₀·e^{−(g/s)·θ}.
 *  ε ("softening") removes the division by zero at the centre.
 *
 *  Why a log spiral? In polar coordinates around one attractor both parts
 *  share the factor 1/(r²+ε):
 *      dr/dt = −g·r/(r²+ε)        dθ/dt = s/(r²+ε)
 *  Dividing, the factor cancels:  dθ/dr = −(s/g)/r  ⇒  θ = −(s/g)·ln r + C,
 *  i.e. r = r₀·e^{−(g/s)θ} — EXACTLY, for any ε. (The speed clamp scales
 *  both parts equally, so it keeps the spiral too.)
 *
 *  Several attractors simply ADD (superposition): the field of a set of
 *  attractors is the sum of their single fields.
 *
 *  CONTRACT: the equation UI imports `deriveFieldConstants` and the fields of
 *  `FieldConstants`. Extend freely; never rename or remove.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Hard speed limit (world units per second) applied after evaluating F — keeps the core stable. */
export const V_MAX = 3.2;

/** Capture radius (world units) at the reference softening — closer than this to a core, a particle is respawned. */
export const R_CAPTURE = 0.035;
/** Reference softening ε (the default) at which the capture radius equals `R_CAPTURE`. */
export const EPS_REF = 0.008;
/** Seconds a click ("temporary") attractor lives; its weight eases 1 → 0 over this time. */
export const TEMP_LIFETIME = 6;
/** At most this many temporary attractors at once (a new click replaces the oldest). */
export const MAX_TEMP_ATTRACTORS = 3;
/** Capacity of an `AttractorSet`: the main attractor a₀ plus the temporaries. */
export const MAX_ATTRACTORS = 1 + MAX_TEMP_ATTRACTORS;

export interface FieldConstants {
  /** swirl strength (rotational term), + = counter-clockwise */
  s: number;
  /** attraction strength (inward radial term) */
  g: number;
  /** softening ε, world units² */
  eps: number;
  /** speed clamp */
  vmax: number;
  /** particle count */
  N: number;
  trails: boolean;
  showField: boolean;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Translate UI parameters into the constants of the field. Used by the simulation AND the equation display. */
export function deriveFieldConstants(p: Readonly<ParamValues>): FieldConstants {
  return {
    s: num(p.swirl, 0.65),
    g: num(p.strength, 0.22),
    eps: Math.max(1e-5, num(p.softening, 0.008)),
    vmax: V_MAX,
    N: Math.max(0, Math.round(num(p.count, 5000))),
    trails: p.trails !== false,
    showField: p.field === true,
  };
}

/** Reusable 2-vector accumulator (avoid allocations in hot loops). */
export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Add one attractor's contribution, weighted by w, to `out` at point (x, y).
 * `swirlSign` lets temporary attractors spin the opposite way (−1).
 */
export function addAttractorVelocity(
  fc: FieldConstants,
  ax: number,
  ay: number,
  w: number,
  swirlSign: number,
  x: number,
  y: number,
  out: Vec2,
): void {
  const dx = x - ax;
  const dy = y - ay;
  const inv = w / (dx * dx + dy * dy + fc.eps);
  const s = fc.s * swirlSign;
  out.x += (-s * dy - fc.g * dx) * inv;
  out.y += (s * dx - fc.g * dy) * inv;
}

/** Growth rate of the logarithmic spiral r = r₀·e^{−(g/s)θ}; Infinity when s = 0 (straight inflow). */
export function spiralRate(fc: Pick<FieldConstants, 's' | 'g'>): number {
  return fc.s === 0 ? Infinity : fc.g / fc.s;
}

/* ─── Derived lengths ─────────────────────────────────────────────────────── */

/**
 * Capture radius r_c = 0.035·max(1, √(ε/0.008)). A larger ε softens a larger
 * core, so the capture disc grows with it and particles never pile up inside.
 */
export function captureRadius(eps: number): number {
  return R_CAPTURE * Math.max(1, Math.sqrt(Math.max(0, eps) / EPS_REF));
}

/**
 * Softening length √ε. Far outside it the field falls off like 1/r; inside it
 * the field fades linearly to 0 at the centre. Drawn as the dotted core ring.
 */
export function softeningRadius(eps: number): number {
  return Math.sqrt(Math.max(0, eps));
}

/**
 * Strongest field ONE attractor (w = 1) can produce:  |F|max = √(s² + g²) / (2√ε),
 * reached on the circle r = √ε.  (|F| = √(s²+g²)·r/(r²+ε), and r/(r²+ε) peaks at
 * r = √ε.)  Finite for every ε > 0 — that is exactly what the softening buys.
 */
export function peakFieldStrength(fc: Pick<FieldConstants, 's' | 'g' | 'eps'>): number {
  return Math.sqrt(fc.s * fc.s + fc.g * fc.g) / (2 * Math.sqrt(fc.eps));
}

/**
 * Weight of a temporary attractor `age` seconds after its click:
 *   w(τ) = ½·(1 + cos(π·τ/T))  — eases smoothly from 1 to 0 over T seconds.
 */
export function tempWeight(age: number, lifetime: number = TEMP_LIFETIME): number {
  if (age <= 0) return 1;
  if (age >= lifetime) return 0;
  return 0.5 * (1 + Math.cos((Math.PI * age) / lifetime));
}

/* ─── Sets of attractors (superposition) ──────────────────────────────────── */

/**
 * A packed list of point attractors (struct-of-arrays) so the field can be
 * evaluated thousands of times per frame without allocating.
 * Slot 0 is the main attractor a₀ by convention.
 */
export interface AttractorSet {
  /** attractors in use */
  count: number;
  /** positions aⱼ, world units */
  readonly x: Float64Array;
  readonly y: Float64Array;
  /** weights wⱼ */
  readonly w: Float64Array;
  /** +1 swirls with s, −1 swirls the opposite way (temporary attractors) */
  readonly spin: Float64Array;
}

export function createAttractorSet(capacity: number = MAX_ATTRACTORS): AttractorSet {
  const n = Math.max(1, Math.floor(capacity));
  return {
    count: 0,
    x: new Float64Array(n),
    y: new Float64Array(n),
    w: new Float64Array(n),
    spin: new Float64Array(n),
  };
}

/** Append an attractor; ignored when the set is full. */
export function pushAttractor(set: AttractorSet, x: number, y: number, w: number, spin: number): void {
  const j = set.count;
  if (j >= set.x.length) return;
  set.x[j] = x;
  set.y[j] = y;
  set.w[j] = w;
  set.spin[j] = spin;
  set.count = j + 1;
}

/**
 * The raw field F(p) at (x, y): the plain SUM of every attractor's
 * contribution (superposition). Written into `out`; allocation-free.
 */
export function fieldAt(fc: FieldConstants, set: AttractorSet, x: number, y: number, out: Vec2): void {
  out.x = 0;
  out.y = 0;
  for (let j = 0; j < set.count; j++) {
    addAttractorVelocity(fc, set.x[j], set.y[j], set.w[j], set.spin[j], x, y, out);
  }
}

/**
 * The velocity that is actually integrated: dp/dt = F(p), with its length
 * clamped to fc.vmax (direction kept). Returns true when the clamp acted.
 */
export function velocityAt(fc: FieldConstants, set: AttractorSet, x: number, y: number, out: Vec2): boolean {
  fieldAt(fc, set, x, y, out);
  return clampSpeed(out, fc.vmax);
}

/* ─── Compiled field (the simulation's fast path) ─────────────────────────── */

/**
 * The same field, "compiled" for fast repeated evaluation: the products
 * kₛ = wⱼ·s·spinⱼ and k_g = wⱼ·g are worked out ONCE per frame instead of at
 * every one of the ~10⁵ samples per frame. Mathematically identical to
 * `velocityAt` (the unit tests check this).
 */
export interface FieldKernel {
  count: number;
  eps: number;
  vmax: number;
  readonly ax: Float64Array;
  readonly ay: Float64Array;
  /** wⱼ·s·spinⱼ */
  readonly ks: Float64Array;
  /** wⱼ·g */
  readonly kg: Float64Array;
}

export function createFieldKernel(capacity: number = MAX_ATTRACTORS): FieldKernel {
  const n = Math.max(1, Math.floor(capacity));
  return {
    count: 0,
    eps: EPS_REF,
    vmax: V_MAX,
    ax: new Float64Array(n),
    ay: new Float64Array(n),
    ks: new Float64Array(n),
    kg: new Float64Array(n),
  };
}

/** Precompute the per-attractor constants of this frame's field into `kernel`. */
export function compileField(fc: FieldConstants, set: AttractorSet, kernel: FieldKernel): void {
  const n = Math.min(set.count, kernel.ax.length);
  for (let j = 0; j < n; j++) {
    kernel.ax[j] = set.x[j];
    kernel.ay[j] = set.y[j];
    kernel.ks[j] = set.w[j] * fc.s * set.spin[j];
    kernel.kg[j] = set.w[j] * fc.g;
  }
  kernel.count = n;
  kernel.eps = fc.eps;
  kernel.vmax = fc.vmax;
}

/** dp/dt from a compiled field: F(p) summed in registers, then the speed clamp. */
export function kernelVelocity(k: FieldKernel, x: number, y: number, out: Vec2): void {
  let fx = 0;
  let fy = 0;
  for (let j = 0; j < k.count; j++) {
    const dx = x - k.ax[j];
    const dy = y - k.ay[j];
    const inv = 1 / (dx * dx + dy * dy + k.eps);
    const ks = k.ks[j];
    const kg = k.kg[j];
    fx += (-ks * dy - kg * dx) * inv;
    fy += (ks * dx - kg * dy) * inv;
  }
  const vmax = k.vmax;
  const m2 = fx * fx + fy * fy;
  if (m2 > vmax * vmax) {
    const scale = vmax / Math.sqrt(m2);
    fx *= scale;
    fy *= scale;
  }
  out.x = fx;
  out.y = fy;
}

/* ─── Direction → glyph ───────────────────────────────────────────────────── */

/** tan 22.5° = √2 − 1: the boundary between a "horizontal" and a "diagonal" sector. */
const TAN_22_5 = Math.SQRT2 - 1;

/**
 * Quantise a direction of motion into 8 sectors of 45°, measured in WORLD
 * coordinates (+y UP), counter-clockwise from +x: sector k is centred on k·45°.
 * Same result as  round(atan2(vy, vx) / 45°) mod 8,  using only comparisons.
 */
export function directionSector(vx: number, vy: number): number {
  const ax = vx < 0 ? -vx : vx;
  const ay = vy < 0 ? -vy : vy;
  if (ay <= ax * TAN_22_5) return vx >= 0 ? 0 : 4; // mostly horizontal
  if (ax <= ay * TAN_22_5) return vy >= 0 ? 2 : 6; // mostly vertical
  if (vx >= 0) return vy >= 0 ? 1 : 7; // diagonal: up-right / down-right
  return vy >= 0 ? 3 : 5; // diagonal: up-left / down-left
}

/**
 * Line glyph of each sector. A line has no arrow head, so opposite sectors
 * share a glyph: 0 '-' (east) · 1 '/' (north-east) · 2 '|' · 3 '\' · 4 '-' …
 * World y points UP, so a particle moving up-and-right ON SCREEN has vx > 0,
 * vy > 0 → sector 1 → '/', exactly the stroke the eye expects.
 */
export const SECTOR_GLYPHS = '-/|\\-/|\\';

/* ─── Idle choreography of the main attractor ─────────────────────────────── */

/**
 * a₀'s idle path, a slow Lissajous curve:  x = 0.45·aspect·sin(0.21 t),  y = 0.42·sin(0.29 t + 1.1).
 * The frequency ratio 21 : 29 is far from a simple fraction, so the curve takes
 * minutes to repeat. The x amplitude keeps the whole vortex on stage.
 */
export const IDLE_PATH = { ampX: 0.45, ampY: 0.42, freqX: 0.21, freqY: 0.29, phaseY: 1.1 } as const;

/** Point of the idle Lissajous path at time t (world units; `aspect` = stage width / height; see IDLE_PATH). */
export function idlePath(t: number, aspect: number, out: Vec2): void {
  out.x = IDLE_PATH.ampX * aspect * Math.sin(IDLE_PATH.freqX * t);
  out.y = IDLE_PATH.ampY * Math.sin(IDLE_PATH.freqY * t + IDLE_PATH.phaseY);
}
