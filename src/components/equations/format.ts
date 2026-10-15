import type { WaveConstants } from '../../math/waves';
import type { FieldConstants } from '../../math/vectorField';
import type { BandConstants } from '../../math/mobius';

/* ═══════════════════════════════════════════════════════════════════════════
 *  Number + equation formatting for the exhibit labels. Pure (no React, no DOM)
 *  so it is unit-tested. Every number a visitor reads passes through here:
 *  negatives use the true minus sign U+2212, and a value that rounds to zero
 *  is never shown as "−0.00".
 * ═══════════════════════════════════════════════════════════════════════════ */

/** U+2212 MINUS SIGN — the only minus used for numbers in UI text. */
export const MINUS = '−';
/** Shown where a value does not exist (e.g. g/s when s = 0). */
export const DASH = '—';

/** True when `value` prints as zero at `decimals` places. */
export function roundsToZero(value: number, decimals: number): boolean {
  return Number(Math.abs(value).toFixed(decimals)) === 0;
}

/** |value| with fixed decimals. */
export function fmtAbs(value: number, decimals: number): string {
  return Number.isFinite(value) ? Math.abs(value).toFixed(decimals) : DASH;
}

/** Fixed decimals with a true minus sign; never "−0.00"; a dash for ±∞ / NaN. */
export function fmt(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return DASH;
  const text = Math.abs(value).toFixed(decimals);
  return value < 0 && !roundsToZero(value, decimals) ? MINUS + text : text;
}

/** Replace ASCII hyphen-minus signs in front of digits with U+2212 (defensive, for engine strings). */
export function trueMinus(text: string): string {
  return text.replace(/(^|[^\w.])-(?=\d|\.\d)/g, `$1${MINUS}`);
}

export type Sign = '+' | typeof MINUS;

/**
 * A coefficient that follows another term of a sum, split into the operator
 * and its magnitude — the sign normalisation of the equation display:
 *   value −0.21 → { sign: '−', abs: '0.21' }   so "… + −0.21x" reads "… − 0.21x".
 * `zeroSign` keeps the written structure when the value rounds to zero
 * (the time term of a wave is always "− ωt", even when ω = 0).
 */
export function signedPart(value: number, decimals: number, zeroSign: Sign = '+'): { sign: Sign; abs: string } {
  if (roundsToZero(value, decimals)) return { sign: zeroSign, abs: fmtAbs(0, decimals) };
  return { sign: value < 0 ? MINUS : '+', abs: fmtAbs(value, decimals) };
}

/** The first term of a sum: a unary minus only when the value is really negative. */
export function leadingPart(value: number, decimals: number): { negative: boolean; abs: string } {
  return { negative: value < 0 && !roundsToZero(value, decimals), abs: fmtAbs(value, decimals) };
}

/* ─── Derived quantities (shown live in THE MATH drawer) ─────────────────── */

const TAU = Math.PI * 2;

/** Wavelength λ = 2π / k (crest-to-crest distance). */
export function wavelength(k: number): number {
  return k > 0 ? TAU / k : Infinity;
}

/** Period T = 2π / ω — the time between two crests passing a point. ∞ when ω = 0. */
export function wavePeriod(omega: number): number {
  return omega > 0 ? TAU / omega : Infinity;
}

/**
 * Spacing of the calm "lanes" of a two-wave interference pattern.
 *   sin a + sin b = 2·sin((a+b)/2)·cos((a−b)/2)
 * so f = 2A·sin(K·r − ωt)·cos(q·r) with q = (k₁ − k₂)/2 and |q| = k·sin(θ/2).
 * cos(q·r) = 0 on fixed parallel lines π/|q| apart: f = 0 there at all times.
 * Infinite (no lanes) when θ = 0.
 */
export function laneSpacing(k: number, thetaDeg: number): number {
  const q = k * Math.sin(((thetaDeg * Math.PI) / 180) / 2);
  return q > 1e-9 ? Math.PI / q : Infinity;
}

/**
 * Pitch angle of the logarithmic spiral, in degrees.
 * Radial speed g/r and sideways speed |s|/r have the same ratio everywhere, so
 * every stream line crosses every circle at the same angle α = arctan(g / |s|).
 * 0° = circles (g = 0), 90° = straight inflow (s = 0). NaN when the field is zero.
 */
export function spiralPitchDeg(s: number, g: number): number {
  if (s === 0 && g === 0) return NaN;
  return (Math.atan2(g, Math.abs(s)) * 180) / Math.PI;
}

/* ─── Möbius twist angle ─────────────────────────────────────────────────── */

/**
 * The cross-section's tilt n·u/2, written in lowest terms:
 *   n = 0 → 0,   even n = 2m → m·u,   odd n → n·u/2.
 * The surviving "/2" for odd n is the Möbius flip: after one lap (u = 2π) the
 * segment has turned an odd multiple of π and comes back upside down.
 */
export type TwistAngle = { kind: 'zero' } | { kind: 'whole'; m: number } | { kind: 'half'; n: number };

export function twistAngle(n: number): TwistAngle {
  const k = Math.max(0, Math.round(n));
  if (k === 0) return { kind: 'zero' };
  return k % 2 === 0 ? { kind: 'whole', m: k / 2 } : { kind: 'half', n: k };
}

export function twistAngleText(n: number): string {
  const a = twistAngle(n);
  switch (a.kind) {
    case 'zero':
      return '0';
    case 'whole':
      return a.m === 1 ? 'u' : `${a.m}u`;
    case 'half':
      return a.n === 1 ? 'u/2' : `${a.n}u/2`;
  }
}

/** Total turn of the cross-section after one lap: n·π. */
export function lapTurnText(n: number): string {
  const k = Math.max(0, Math.round(n));
  return k === 0 ? '0' : k === 1 ? 'π' : `${k}π`;
}

/* ─── Plain-text equations (screen-reader labels; also pin the formatting in tests) ─── */

const D = 2; // decimals of derived wave numbers

function waveTermText(A: number, kx: number, ky: number, omega: number): string {
  const x = leadingPart(kx, D);
  const y = signedPart(ky, D);
  const t = signedPart(-omega, D, MINUS);
  return `${fmt(A, 2)}·sin(${x.negative ? MINUS : ''}${x.abs}x ${y.sign} ${y.abs}y ${t.sign} ${t.abs}t)`;
}

/** f(x, y, t) with every constant substituted, exactly as the simulation evaluates it. */
export function waveEquationText(wc: WaveConstants): string {
  return (
    `f(x, y, t) = ${waveTermText(wc.A1, wc.k1x, wc.k1y, wc.omega1)}` +
    ` + ${waveTermText(wc.A2, wc.k2x, wc.k2y, wc.omega2)} + Σᵢ ρᵢ`
  );
}

/** F(x, y) for one attractor, with s, g and ε substituted. */
export function attractorEquationText(fc: Pick<FieldConstants, 's' | 'g' | 'eps'>): string {
  const s = leadingPart(fc.s, 2);
  const g = signedPart(-fc.g, 2, MINUS);
  return (
    `F(x, y) = [${s.negative ? MINUS : ''}${s.abs}·(${MINUS}Δy, Δx) ${g.sign} ${g.abs}·(Δx, Δy)]` +
    ` / (Δx² + Δy² + ${fmt(fc.eps, 3)})`
  );
}

function trigText(fn: 'cos' | 'sin', angle: string): string {
  return angle === '0' || angle === 'u' ? `${fn} ${angle}` : `${fn}(${angle})`;
}

/** The band r(u, v) with n substituted, line by line, plus its domain. */
export function topologyEquationLines(bc: Pick<BandConstants, 'n' | 'w' | 'R'>): string[] {
  const angle = twistAngleText(bc.n);
  const w = fmt(bc.w, 2);
  return [
    `x(u, v) = (R + v·${trigText('cos', angle)})·cos u`,
    `y(u, v) = (R + v·${trigText('cos', angle)})·sin u`,
    `z(u, v) = v·${trigText('sin', angle)}`,
    `u ∈ [0, 2π),  v ∈ [${MINUS}${w}, ${w}],  R = ${fmt(bc.R, 0)}`,
  ];
}
