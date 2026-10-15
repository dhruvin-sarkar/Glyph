import type { ParamValues } from '../engine/types';

/* ═══════════════════════════════════════════════════════════════════════════
 *  WAVEFIELD mathematics — pure functions, no DOM.
 *
 *      f(x, y, t) = A·sin(k₁·r − ω t) + A·sin(k₂·r − ω t) + Σᵢ ρᵢ(x, y, t)
 *
 *      ρᵢ(x, y, t) = B·sᵢ·e^{−τ/T}·sin(k_r(d − c_r τ))·e^{−((d − c_r τ)/σ)²}
 *                    d = |r − pᵢ|  (distance to the ripple's centre pᵢ)
 *                    τ = t − tᵢ    (age of the ripple)
 *
 *  r = (x, y) in world units (see engine/coords.ts). |k₁| = |k₂| = k and
 *  ω = c·k, so every crest travels at the same speed c (non-dispersive).
 *  The field is drawn through  n = ½ + ½·tanh(f / F₀)  with a FIXED F₀ = 1.5.
 *
 *  CONTRACT: the equation UI imports `deriveWaveConstants` and the fields of
 *  `WaveConstants`, `normalizeField`, `NORMALIZE_SCALE`, `WAVE1_HEADING_DEG`,
 *  `RIPPLE` and `rippleValue`. Extend freely; never rename or remove.
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ─── 1. The two plane waves ──────────────────────────────────────────────── */

/** Heading of wave 1 in degrees, counter-clockwise from +x. */
export const WAVE1_HEADING_DEG = 18;

/** F₀ in n = ½ + ½·tanh(f / F₀). Fixed (not A-dependent) so amplitude visibly changes contrast. */
export const NORMALIZE_SCALE = 1.5;

export interface WaveConstants {
  /** amplitude of wave 1 */
  A1: number;
  /** amplitude of wave 2 (0 when the second wave is switched off) */
  A2: number;
  /** wave vector of wave 1, rad per world unit */
  k1x: number;
  k1y: number;
  /** wave vector of wave 2, rad per world unit */
  k2x: number;
  k2y: number;
  /** angular frequencies, rad/s (ω = c·k) */
  omega1: number;
  omega2: number;
  /** headings of the two waves, degrees CCW from +x */
  phi1Deg: number;
  phi2Deg: number;
  /** raw inputs, echoed for display */
  A: number;
  k: number;
  c: number;
  thetaDeg: number;
  second: boolean;
  /** cursor-ripple strength multiplier */
  B: number;
  /** the common angular frequency ω = c·k, rad/s */
  omega: number;
  /** wavelength λ = 2π / k, world units */
  wavelength: number;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Translate UI parameters into the constants of the equation. Used by the simulation AND the equation display. */
export function deriveWaveConstants(p: Readonly<ParamValues>): WaveConstants {
  const A = num(p.amplitude, 1);
  const k = num(p.frequency, 9);
  const c = num(p.speed, 0.35);
  const thetaDeg = num(p.angle, 70);
  const second = p.second !== false;
  const B = num(p.disturb, 1);

  const phi1Deg = WAVE1_HEADING_DEG;
  const phi2Deg = WAVE1_HEADING_DEG + thetaDeg;
  const phi1 = (phi1Deg * Math.PI) / 180;
  const phi2 = (phi2Deg * Math.PI) / 180;
  const omega = c * k;

  return {
    A1: A,
    A2: second ? A : 0,
    k1x: k * Math.cos(phi1),
    k1y: k * Math.sin(phi1),
    k2x: k * Math.cos(phi2),
    k2y: k * Math.sin(phi2),
    omega1: omega,
    omega2: omega,
    phi1Deg,
    phi2Deg,
    A,
    k,
    c,
    thetaDeg,
    second,
    B,
    omega,
    wavelength: k > 0 ? (2 * Math.PI) / k : Infinity,
  };
}

/** The two plane waves alone (no ripples) — reference implementation for tests and probes. */
export function planeWaves(wc: WaveConstants, x: number, y: number, t: number): number {
  return (
    wc.A1 * Math.sin(wc.k1x * x + wc.k1y * y - wc.omega1 * t) +
    wc.A2 * Math.sin(wc.k2x * x + wc.k2y * y - wc.omega2 * t)
  );
}

/* ─── 2. From value to glyph ──────────────────────────────────────────────── */

/** Map a raw field value to a normalised intensity n ∈ (0, 1):  n = ½ + ½·tanh(f / F₀). */
export function normalizeField(f: number): number {
  return 0.5 + 0.5 * Math.tanh(f / NORMALIZE_SCALE);
}

/**
 * The contrast curve that turns n into the ink coverage n′ of the glyph drawn —
 * built like light on water (the Phong model): a soft "diffuse" part that gives
 * the whole sea a fine texture, plus a sharp "specular" part that only lights up
 * the very tops of the crests:
 *
 *      s  = (n − n₀) / (1 − n₀)            clamped to [0, 1]
 *      n′ = D·s + (1 − D)·s^P
 *
 * Deep troughs (n ≤ n₀) draw nothing, calm water draws '-' and ':', the crests
 * '*' and '#', and only a crest lifted higher by a ripple reaches '@'.
 * Both terms rise with s, so the mapping is monotonic: higher f → denser glyph.
 */
export const SHADING = {
  /** n₀: normalised values at or below this draw nothing (the deepest troughs) */
  trough: 0.12,
  /** D: weight of the soft part (the texture of calm water) */
  soft: 0.34,
  /** P: exponent of the sharp part (larger = thinner, brighter crests) */
  sharp: 7,
  /** b₀: brightness of the faintest glyph that is drawn */
  floor: 0.08,
  /** β: brightness exponent (< 1 lifts the calm water a little, so it glows faintly) */
  lift: 0.75,
} as const;

/** n′ = contrast-shaped coverage ∈ [0, 1] (see `SHADING`). */
export function contrastCurve(n: number): number {
  const s = (n - SHADING.trough) / (1 - SHADING.trough);
  if (s <= 0) return 0;
  if (s >= 1) return 1;
  return SHADING.soft * s + (1 - SHADING.soft) * Math.pow(s, SHADING.sharp);
}

/** Brightness of a drawn glyph:  b = b₀ + (1 − b₀)·n′^β. */
export function glyphBrightness(nPrime: number): number {
  const v = nPrime <= 0 ? 0 : nPrime >= 1 ? 1 : Math.pow(nPrime, SHADING.lift);
  return SHADING.floor + (1 - SHADING.floor) * v;
}

/* ─── 3. Cursor ripples ───────────────────────────────────────────────────── */

/**
 * Constants of a ripple packet ρ. A ring of radius c_r·τ travels outwards; its
 * cross-section is a sine of wave number k_r under a Gaussian envelope of
 * width σ, and the whole packet fades as e^{−τ/T}.
 */
export const RIPPLE = {
  /** k_r — radial wave number, rad per world unit (ring spacing 2π/k_r) */
  kr: 30,
  /** c_r — speed of the ring, world units per second */
  cr: 0.5,
  /** T — decay time: the packet's amplitude falls by 1/e every T seconds */
  T: 2,
  /** σ — width of the Gaussian envelope, world units */
  sigma: 0.12,
  /** most ripples alive at once (the ring buffer's size) */
  max: 20,
  /** only cells with |d − c_r τ| < band·σ are evaluated (e^{−9} ≈ 0.0001 beyond) */
  band: 3,
} as const;

/** Radius of the ring after τ seconds:  R = c_r·τ. */
export function rippleRadius(tau: number): number {
  return RIPPLE.cr * Math.max(0, tau);
}

/** Amplitude of a ripple after τ seconds:  B·s·e^{−τ/T}  (0 before it is born). */
export function rippleAmplitude(tau: number, B = 1, s = 1): number {
  return tau < 0 ? 0 : B * s * Math.exp(-tau / RIPPLE.T);
}

/** Cross-section of the packet at signed distance u = d − c_r·τ from the ring:  sin(k_r u)·e^{−(u/σ)²}. */
export function rippleProfile(u: number): number {
  const q = u / RIPPLE.sigma;
  return Math.sin(RIPPLE.kr * u) * Math.exp(-q * q);
}

/**
 * One ripple ρ at distance d from its centre, τ seconds after it was born:
 *   ρ = B·s·e^{−τ/T}·sin(k_r(d − c_r τ))·e^{−((d − c_r τ)/σ)²}
 */
export function rippleValue(d: number, tau: number, B = 1, s = 1): number {
  if (tau < 0) return 0;
  return rippleAmplitude(tau, B, s) * rippleProfile(d - RIPPLE.cr * tau);
}

/**
 * The profile is the same for every ripple, so the simulation samples it once
 * into a table and interpolates (one table read instead of a sin and an exp
 * per cell). `values[i]` = profile(−reach + i/scale).
 */
export interface RippleProfileTable {
  readonly values: Float32Array;
  /** band half-width, world units (= band·σ) */
  readonly reach: number;
  /** samples per world unit */
  readonly scale: number;
}

export function buildRippleProfileTable(samples = 512): RippleProfileTable {
  const n = Math.max(16, Math.floor(samples));
  const reach = RIPPLE.band * RIPPLE.sigma;
  const du = (2 * reach) / n;
  // n + 1 samples span [−reach, reach]; one guard sample makes interpolation at the edge safe.
  const values = new Float32Array(n + 2);
  for (let i = 0; i < values.length; i++) values[i] = rippleProfile(-reach + i * du);
  return { values, reach, scale: 1 / du };
}

/** Linear interpolation in the profile table; 0 outside the band. */
export function sampleRippleProfile(table: RippleProfileTable, u: number): number {
  const pos = (u + table.reach) * table.scale;
  if (!(pos >= 0) || pos >= table.values.length - 2) return 0;
  const i = pos | 0;
  const v = table.values;
  return v[i] + (v[i + 1] - v[i]) * (pos - i);
}

/* ─── 4. Fast evaluation of the plane waves ───────────────────────────────── */

/**
 * TOP-DOWN VIEW — separable form.  For one wave the phase splits into a column
 * part and a row part:  k·r − ωt = (k_x·x) + (k_y·y − ωt) = a + b, and
 *
 *      sin(a + b) = sin a·cos b + cos a·sin b.
 *
 * sin a, cos a depend only on the column → cached (rebuilt only when k, θ or the
 * grid change). sin b, cos b depend only on the row and time → 4 calls per row
 * per frame. Each cell then costs a few multiply-adds instead of two sin() calls.
 */
export interface ColumnTerms {
  readonly sin1: Float64Array;
  readonly cos1: Float64Array;
  readonly sin2: Float64Array;
  readonly cos2: Float64Array;
}

/** sin/cos of k₁ₓ·x and k₂ₓ·x for every column x. Reuses `out` when its length matches. */
export function buildColumnTerms(wc: WaveConstants, xs: ArrayLike<number>, out?: ColumnTerms | null): ColumnTerms {
  const n = xs.length;
  const t: ColumnTerms =
    out && out.sin1.length === n
      ? out
      : { sin1: new Float64Array(n), cos1: new Float64Array(n), sin2: new Float64Array(n), cos2: new Float64Array(n) };
  for (let c = 0; c < n; c++) {
    const a1 = wc.k1x * xs[c];
    const a2 = wc.k2x * xs[c];
    t.sin1[c] = Math.sin(a1);
    t.cos1[c] = Math.cos(a1);
    t.sin2[c] = Math.sin(a2);
    t.cos2[c] = Math.cos(a2);
  }
  return t;
}

/** Both plane waves along the row at height y, for every cached column, written to out[offset + c]. */
export function planeWavesRowSeparable(
  wc: WaveConstants,
  terms: ColumnTerms,
  y: number,
  t: number,
  out: Float32Array | Float64Array,
  offset: number,
): void {
  const b1 = wc.k1y * y - wc.omega1 * t;
  const b2 = wc.k2y * y - wc.omega2 * t;
  // amplitude folded into the row terms: A·sin(a + b) = sin a·(A cos b) + cos a·(A sin b)
  const S1 = wc.A1 * Math.sin(b1);
  const C1 = wc.A1 * Math.cos(b1);
  const S2 = wc.A2 * Math.sin(b2);
  const C2 = wc.A2 * Math.cos(b2);
  const { sin1, cos1, sin2, cos2 } = terms;
  const n = sin1.length;
  for (let c = 0; c < n; c++) {
    out[offset + c] = sin1[c] * C1 + cos1[c] * S1 + sin2[c] * C2 + cos2[c] * S2;
  }
}

/**
 * HORIZON VIEW — rotation recurrence.  In perspective every screen row is a
 * straight line on the plane, x = x₀ + i·Δx at a fixed y, so along the row the
 * phase grows LINEARLY:  φ(i) = α·i + β  with α = kₓ·Δx and β = kₓx₀ + k_y·y − ωt.
 * Starting from (sin β, cos β), each step to the right rotates by δ = α:
 *
 *      (s, c) ← (s·cos δ + c·sin δ,  c·cos δ − s·sin δ)
 *
 * (the angle-addition formulas again) — 4 trig calls per row, none per cell.
 * `a1`, `a2` override the amplitudes (the renderer passes anti-aliased ones).
 * If `beat` is given it also receives cos(φ₁ − φ₂) = c₁c₂ + s₁s₂ per cell: the
 * interference term of the local wave energy (see `localWaveEnergy`).
 */
export function planeWavesRowRecurrence(
  wc: WaveConstants,
  x0: number,
  dx: number,
  y: number,
  t: number,
  out: Float32Array | Float64Array,
  offset: number,
  count: number,
  a1: number = wc.A1,
  a2: number = wc.A2,
  beat: Float32Array | Float64Array | null = null,
): void {
  const beta1 = wc.k1x * x0 + wc.k1y * y - wc.omega1 * t;
  const beta2 = wc.k2x * x0 + wc.k2y * y - wc.omega2 * t;
  const d1 = wc.k1x * dx;
  const d2 = wc.k2x * dx;
  const cd1 = Math.cos(d1);
  const sd1 = Math.sin(d1);
  const cd2 = Math.cos(d2);
  const sd2 = Math.sin(d2);
  let s1 = Math.sin(beta1);
  let c1 = Math.cos(beta1);
  let s2 = Math.sin(beta2);
  let c2 = Math.cos(beta2);
  for (let i = 0; i < count; i++) {
    out[offset + i] = a1 * s1 + a2 * s2;
    if (beat) beat[offset + i] = c1 * c2 + s1 * s2;
    const n1 = s1 * cd1 + c1 * sd1;
    c1 = c1 * cd1 - s1 * sd1;
    s1 = n1;
    const n2 = s2 * cd2 + c2 * sd2;
    c2 = c2 * cd2 - s2 * sd2;
    s2 = n2;
  }
}

/**
 * Local strength of the swell. Averaged over one crest-to-crest cycle, f² is
 *
 *      E = ½(A₁² + A₂²) + A₁A₂·cos(φ₁ − φ₂)
 *
 * where φ₁ − φ₂ = (k₁ − k₂)·r does NOT depend on t: the two waves reinforce
 * along fixed lanes and cancel between them (interference). √(2E) is the height
 * the crests reach there — 2A in a lane, 0 on a node line when A₁ = A₂.
 */
export function localWaveEnergy(wc: WaveConstants, x: number, y: number): number {
  const dphi = (wc.k1x - wc.k2x) * x + (wc.k1y - wc.k2y) * y;
  return 0.5 * (wc.A1 * wc.A1 + wc.A2 * wc.A2) + wc.A1 * wc.A2 * Math.cos(dphi);
}

/* ─── 5. Projection: the plane seen by a camera ───────────────────────────── */

/**
 * HORIZON VIEW — a camera at height h looks level across the water; the horizon
 * sits at y_h on screen. A screen point (x_s, y_s) below the horizon is traced
 * back to the plane by inverse perspective:
 *
 *      depth  Z = h·f / (y_h − y_s),      X = x_s·Z / f
 *
 * (all in world units). Near rows (large y_h − y_s) see the water close up;
 * rows near the horizon see it far away, compressed into fine texture.
 */
export const HORIZON = {
  /** horizon height as a fraction of the stage height, measured from the top */
  frac: 0.4,
  /** focal length f, world units */
  f: 2.4,
  /** camera height h above the water, world units */
  h: 0.62,
  /** fog length: brightness falls by 1/e every `fog` world units beyond the nearest row */
  fog: 9,
  /** extra light along the horizon (a soft band `glowRows` rows tall) */
  glow: 0.5,
  glowRows: 2.4,
  /** haze: where blurring has flattened the waves, their calm level sinks by up to this much */
  haze: 0.5,
  /** where single crests are too small to draw, glyphs show the swell's strength √(2E) times this */
  shimmer: 0.45,
} as const;

/** Screen y (world units, +y up) of the horizon in the level view:  y_h = 1 − 2·frac. */
export const HORIZON_Y = 1 - 2 * HORIZON.frac;

/**
 * Heading of the horizon camera, degrees CCW from +x, for crossing angle θ:
 * it looks back along the bisector of the two wave directions (φ₁ + θ/2 + 180°),
 * so both wave trains roll TOWARDS the viewer, symmetrically, at ±θ/2.
 */
export function horizonHeadingDeg(thetaDeg: number): number {
  return WAVE1_HEADING_DEG + thetaDeg / 2 + 180;
}

/**
 * One camera covers both projections. `tilt` 0 looks straight down (pitch 90°,
 * height = f, heading +y, so 1 screen unit = 1 plane unit: the top-down map);
 * `tilt` 1 is the level horizon camera above, turned to `headingDeg`. In between,
 * pitch β, heading ψ, principal-point shift p and height H blend smoothly, so
 * switching views is a real camera move.
 *
 * Camera frame: X to the right of the view, Y along it. The plane point
 * (x, y) = X·r̂ + Y·f̂ with f̂ = (cos ψ, sin ψ) and r̂ = (sin ψ, −cos ψ) — a pure
 * rotation, so distances (and the equation) are unchanged.
 */
export interface Camera {
  tilt: number;
  /** pitch below the horizontal, radians */
  beta: number;
  sinB: number;
  cosB: number;
  /** heading ψ of the view direction in the plane, radians CCW from +x */
  yaw: number;
  sinY: number;
  cosY: number;
  /** principal-point shift: screen y of the optical axis, world units */
  p: number;
  /** camera height above the plane */
  H: number;
  /** focal length */
  F: number;
  /** camera-frame Y offset that keeps the plane origin under the screen centre */
  yc: number;
  /** screen y of the horizon (+Infinity while it is above the screen) */
  horizonY: number;
}

export function makeCamera(tilt: number, headingDeg: number = horizonHeadingDeg(70), out?: Camera): Camera {
  const e = tilt <= 0 ? 0 : tilt >= 1 ? 1 : tilt;
  const F = HORIZON.f;
  const beta = (Math.PI / 2) * (1 - e);
  // exact values at the top-down end keep the map an exact identity
  const sinB = e === 0 ? 1 : e === 1 ? 0 : Math.sin(beta);
  const cosB = e === 0 ? 0 : e === 1 ? 1 : Math.cos(beta);
  const yaw = ((90 + (headingDeg - 90) * e) * Math.PI) / 180;
  const sinY = e === 0 ? 1 : Math.sin(yaw);
  const cosY = e === 0 ? 0 : Math.cos(yaw);
  const p = HORIZON_Y * e;
  const H = F + (HORIZON.h - F) * e;
  // Shift along the view so the ray through the screen centre lands on the origin.
  const syc = -p / F;
  const tc = H / (sinB - syc * cosB);
  const yc = -tc * (cosB + syc * sinB);
  const cam: Camera = out ?? {
    tilt: 0,
    beta: 0,
    sinB: 1,
    cosB: 0,
    yaw: Math.PI / 2,
    sinY: 1,
    cosY: 0,
    p: 0,
    H: F,
    F,
    yc: 0,
    horizonY: Infinity,
  };
  cam.tilt = e;
  cam.beta = beta;
  cam.sinB = sinB;
  cam.cosB = cosB;
  cam.yaw = yaw;
  cam.sinY = sinY;
  cam.cosY = cosY;
  cam.p = p;
  cam.H = H;
  cam.F = F;
  cam.yc = yc;
  cam.horizonY = cosB > 1e-9 ? p + (F * sinB) / cosB : Infinity;
  return cam;
}

export interface PlaneHit {
  /** camera-frame coordinates of the point seen (X across the view, Y along it) */
  X: number;
  Y: number;
  /** plane coordinates of the same point */
  x: number;
  y: number;
  /** ray parameter: the point is t·(ray direction) from the camera; X = (x_s/f)·t */
  t: number;
}

/**
 * Trace screen point (x_s, y_s) (world units, +y up) back to the plane.
 * Ray direction in the camera frame (looking along +Y, pitched down by β):
 *   d = (s_x,  cos β + s_y sin β,  −sin β + s_y cos β),   s_x = x_s/f,  s_y = (y_s − p)/f
 * It meets the plane z = 0 at t = H / (sin β − s_y cos β). Returns false at or above the horizon.
 * For tilt 1 this is exactly Z = h·f/(y_h − y_s), X = x_s·Z/f (with Y = Z + y_c).
 */
export function screenToPlane(cam: Camera, xs: number, ys: number, out: PlaneHit): boolean {
  const sx = xs / cam.F;
  const sy = (ys - cam.p) / cam.F;
  const den = cam.sinB - sy * cam.cosB;
  if (!(den > 1e-9)) return false;
  const t = cam.H / den;
  const X = sx * t;
  const Y = cam.yc + t * (cam.cosB + sy * cam.sinB);
  out.t = t;
  out.X = X;
  out.Y = Y;
  out.x = X * cam.sinY + Y * cam.cosY;
  out.y = -X * cam.cosY + Y * cam.sinY;
  return true;
}

/** Plane point → camera frame (the inverse rotation). */
export function planeToCamera(cam: Camera, x: number, y: number, out: PlaneHit): PlaneHit {
  out.x = x;
  out.y = y;
  out.X = x * cam.sinY - y * cam.cosY;
  out.Y = x * cam.cosY + y * cam.sinY;
  return out;
}

/** Camera frame → plane point. */
export function cameraToPlane(cam: Camera, X: number, Y: number, out: PlaneHit): PlaneHit {
  out.X = X;
  out.Y = Y;
  out.x = X * cam.sinY + Y * cam.cosY;
  out.y = -X * cam.cosY + Y * cam.sinY;
  return out;
}

/**
 * The same two waves described in the camera frame: only the wave vectors
 * rotate (k·r is unchanged by a rotation of both k and r).
 */
export function wavesInCameraFrame(wc: WaveConstants, cam: Camera, out?: WaveConstants): WaveConstants {
  const o: WaveConstants = out ?? { ...wc };
  if (out) Object.assign(o, wc);
  o.k1x = wc.k1x * cam.sinY - wc.k1y * cam.cosY;
  o.k1y = wc.k1x * cam.cosY + wc.k1y * cam.sinY;
  o.k2x = wc.k2x * cam.sinY - wc.k2y * cam.cosY;
  o.k2y = wc.k2x * cam.cosY + wc.k2y * cam.sinY;
  return o;
}

/* ─── 6. Adding ripples to a grid, cheaply ────────────────────────────────── */

/**
 * A grid whose row r is a straight line of the plane, written in the camera
 * frame (X across the view, Y along it):
 *   X = x0[r] + c·dx[r],   Y = y[r]      (c = 0 … cols−1).
 * Both projections produce this shape: top-down, every row shares x0 and dx
 * (and the camera frame IS the plane frame); in perspective they grow with
 * depth. valid[r] = 0 marks sky rows.
 */
export interface RowGrid {
  cols: number;
  rows: number;
  x0: Float64Array;
  dx: Float64Array;
  y: Float64Array;
  valid: Uint8Array;
}

/**
 * Anti-aliasing in perspective. A glyph far away covers a big patch of water and
 * can show only one value, so each glyph shows the wave blurred by a Gaussian
 * half a cell wide. Blurring a sine whose phase changes by Δφ across the cell
 * multiplies its amplitude by e^{−Δφ²/8}: waves much larger than a glyph keep
 * their full height, waves near or below the glyph size fade smoothly to their
 * average (0) instead of turning into flickering noise.
 */
export const AA_DIVISOR = 8;

/** Amplitude kept after the half-cell Gaussian blur, for a squared phase change Δφ² per cell. */
export function footprintGain(dphi2: number): number {
  return Math.exp(-dphi2 / AA_DIVISOR);
}

/**
 * Optional anti-aliasing for ripples (see `AA_DIVISOR`); for a ring the phase
 * change across a cell is k_r·w, w = the cell's footprint along the ring's radius.
 */
export interface RippleFilter {
  /** 0 = off (exact values), 1 = full averaging */
  strength: number;
  /** screen x (world units) of every column centre */
  colX: Float64Array;
  /** per row: Y distance between the cell's top and bottom edge (Infinity if it straddles the horizon) */
  footY: Float64Array;
  /** per row: Δt/f between the cell's top and bottom edge (X shifts by x_s·footTX per row) */
  footTX: Float64Array;
}

/**
 * Add one ripple (centre (px, py) in the grid's frame, ring radius `radius`,
 * amplitude `amp` = B·s·e^{−τ/T}) into `out` (row-major, cols × rows).
 * Only cells inside the ring's band |d − R| < band·σ are touched: rows outside
 * the band are rejected with squared distances (no sqrt), and inside a row only
 * the band's one or two column spans are visited — the quiet hole in the middle
 * of the ring is skipped. Returns the number of cells evaluated.
 */
export function accumulateRipple(
  out: Float32Array,
  grid: RowGrid,
  px: number,
  py: number,
  radius: number,
  amp: number,
  table: RippleProfileTable,
  filter?: RippleFilter | null,
): number {
  const { cols, rows, x0, dx, y, valid } = grid;
  const reach = table.reach;
  const rOut = radius + reach;
  const rOut2 = rOut * rOut;
  const rIn = radius - reach;
  const rIn2 = rIn > 0 ? rIn * rIn : 0;
  const vals = table.values;
  const scale = table.scale;
  const shift = reach - radius; // table position = (d − R + reach)·scale = (d + shift)·scale
  const aa = filter && filter.strength > 0 ? filter : null;
  const K = aa ? ((RIPPLE.kr * RIPPLE.kr) / AA_DIVISOR) * aa.strength : 0;
  const colX = aa ? aa.colX : null;
  let evaluated = 0;

  for (let r = 0; r < rows; r++) {
    if (valid[r] === 0) continue;
    const dz = y[r] - py;
    const dz2 = dz * dz;
    if (dz2 >= rOut2) continue; // the whole row misses the band
    const ox = x0[r];
    const sx = dx[r];
    if (!(sx > 0)) continue;
    const fy = aa ? aa.footY[r] : 0;
    const ftx = aa ? aa.footTX[r] : 0;
    if (!(fy < Infinity)) continue; // the cell straddles the horizon: everything averages out

    // Columns where the row is inside the outer circle d = R + reach …
    const half = Math.sqrt(rOut2 - dz2);
    const c0 = Math.max(0, Math.ceil((px - half - ox) / sx));
    const c1 = Math.min(cols - 1, Math.floor((px + half - ox) / sx));
    if (c0 > c1) continue;
    // … minus the columns strictly inside the inner circle d = R − reach (the quiet hole).
    let holeA = c1 + 1;
    let holeB = c1;
    if (rIn2 > dz2) {
      const hole = Math.sqrt(rIn2 - dz2);
      holeA = Math.floor((px - hole - ox) / sx) + 1;
      holeB = Math.ceil((px + hole - ox) / sx) - 1;
      if (holeA > holeB) {
        holeA = c1 + 1; // the hole falls between two columns: nothing to skip
        holeB = c1;
      }
    }
    const base = r * cols;

    // Two spans: [c0, holeA − 1] and [holeB + 1, c1] (just [c0, c1] when there is no hole).
    for (let span = 0; span < 2; span++) {
      const from = span === 0 ? c0 : Math.max(c0, holeB + 1);
      const to = span === 0 ? Math.min(c1, holeA - 1) : c1;
      if (span === 1 && holeA > holeB) break;
      for (let c = from; c <= to; c++) {
        const ddx = ox + c * sx - px;
        const d2 = ddx * ddx + dz2;
        if (d2 >= rOut2 || d2 < rIn2) continue;
        const pos = (Math.sqrt(d2) + shift) * scale;
        const i = pos | 0;
        let v = vals[i] + (vals[i + 1] - vals[i]) * (pos - i);
        if (colX) {
          // radial component of one column step and of one row step of the cell's footprint
          const along = ddx * sx;
          const across = ddx * colX[c] * ftx + dz * fy;
          const q = (K * (along * along + across * across)) / Math.max(d2, 1e-12);
          if (q >= 12) continue;
          v *= Math.exp(-q);
        }
        out[base + c] += amp * v;
        evaluated++;
      }
    }
  }
  return evaluated;
}
