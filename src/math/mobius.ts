import type { ParamValues } from '../engine/types';

/* ═══════════════════════════════════════════════════════════════════════════
 *  TOPOLOGY mathematics — pure functions, no DOM.
 *
 *      r(u, v) = ( (R + v·cos(nu/2))·cos u,
 *                  (R + v·cos(nu/2))·sin u,
 *                   v·sin(nu/2) )            u ∈ [0, 2π),  v ∈ [−w, w]
 *
 *  n = number of half-twists. The cross-section segment turns by n·u/2, so
 *  after one lap it has turned by n·π. A segment only lines up with itself
 *  after a turn of a whole multiple of π — so n must be an INTEGER, and:
 *    • odd n  → the end glues to the start flipped: (2π, v) ≡ (0, −v)
 *               → ONE side, ONE edge, non-orientable (a Möbius band)
 *    • even n → (2π, v) ≡ (0, v) → two sides, two edges, orientable
 *  The edge is the torus knot/link T(2, n): unknot, Hopf link, trefoil, …
 *
 *  Calculus used by the renderer (c = cos(nu/2), s = sin(nu/2), a = R + v·c):
 *      r_u = ( −(n/2)·v·s·cos u − a·sin u,  −(n/2)·v·s·sin u + a·cos u,  (n/2)·v·c )
 *      r_v = (  c·cos u,                      c·sin u,                     s        )
 *      N   = r_u × r_v = ( a·s·cos u − (n/2)·v·sin u,  a·s·sin u + (n/2)·v·cos u,  −a·c )
 *  r_u · r_v = 0 everywhere, so |N| = |r_u|·|r_v| = √(a² + (n·v/2)²) > 0: the
 *  surface is smooth (never pinched) because a ≥ R − w > 0.
 *  Each cross-section u = const is a STRAIGHT segment (the band is a ruled
 *  surface), so a renderer can interpolate positions along v exactly.
 *
 *  CONTRACT: the equation UI imports `deriveBandConstants`, `BandConstants`,
 *  `edgeCurveName`, `BAND_R`, `MAX_TWISTS` and `bandPoint`. Extend freely;
 *  never rename or remove.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Main radius R (world units of the 3D scene). */
export const BAND_R = 1;
export const MAX_TWISTS = 7;

/** Largest half-width the maths accepts: keeps a = R + v·cos(nu/2) > 0 (no pinch at the axis). */
export const MAX_HALF_WIDTH = 0.95 * BAND_R;

export interface BandConstants {
  /** half-twists (integer 0…7) */
  n: number;
  R: number;
  /** half-width: v ∈ [−w, w] */
  w: number;
  sides: 1 | 2;
  edges: 1 | 2;
  orientable: boolean;
  /** Euler characteristic — 0 for every twisted band (annulus and Möbius alike) */
  euler: 0;
  /** name of the edge curve, the torus knot/link T(2, n) */
  edgeName: string;
  /** linking number of the two edge circles for even n (= n/2); null for odd n (one edge) */
  linking: number | null;
}

const EDGE_NAMES = [
  'two unlinked circles',
  'unknot',
  'Hopf link',
  'trefoil knot',
  'Solomon link',
  'cinquefoil knot',
  'T(2,6) torus link',
  'septafoil knot',
] as const;

/** Name of the edge curve T(2, n) of a band with n half-twists. */
export function edgeCurveName(n: number): string {
  const i = Math.max(0, Math.min(MAX_TWISTS, Math.round(n)));
  return EDGE_NAMES[i];
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Translate UI parameters into band constants + topological invariants. */
export function deriveBandConstants(p: Readonly<ParamValues>): BandConstants {
  const n = Math.max(0, Math.min(MAX_TWISTS, Math.round(num(p.twists, 1))));
  const odd = n % 2 === 1;
  return {
    n,
    R: BAND_R,
    w: Math.min(MAX_HALF_WIDTH, Math.max(0.05, num(p.width, 0.42))),
    sides: odd ? 1 : 2,
    edges: odd ? 1 : 2,
    orientable: !odd,
    euler: 0,
    edgeName: edgeCurveName(n),
    linking: odd ? null : n / 2,
  };
}

/** Surface point r(u, v) written into out[0..2] (no allocation). */
export function bandPoint(n: number, R: number, u: number, v: number, out: Float64Array | number[]): void {
  const half = (n * u) / 2;
  const a = R + v * Math.cos(half);
  out[0] = a * Math.cos(u);
  out[1] = a * Math.sin(u);
  out[2] = v * Math.sin(half);
}

/* ─── Calculus on the surface ─────────────────────────────────────────────── */

/** Writable xyz storage accepted by the helpers below. */
export type Vec3Out = Float64Array | Float32Array | number[];

/**
 * The two tangent vectors (partial derivatives) at (u, v):
 *   r_u = ∂r/∂u — direction of travel around the loop;
 *   r_v = ∂r/∂v — direction across the strip (a unit vector: the cross-section is straight).
 */
export function bandPartials(n: number, R: number, u: number, v: number, outU: Vec3Out, outV: Vec3Out): void {
  const h = n / 2;
  const c = Math.cos(h * u);
  const s = Math.sin(h * u);
  const cu = Math.cos(u);
  const su = Math.sin(u);
  const a = R + v * c;
  outU[0] = -h * v * s * cu - a * su;
  outU[1] = -h * v * s * su + a * cu;
  outU[2] = h * v * c;
  outV[0] = c * cu;
  outV[1] = c * su;
  outV[2] = s;
}

/**
 * Surface normal N = r_u × r_v (NOT normalised), expanded into closed form:
 *   N = ( a·s·cos u − (n/2)·v·sin u,  a·s·sin u + (n/2)·v·cos u,  −a·c ).
 * On odd n it flips across the seam — N(2π, v) = −N(0, −v) — which is exactly
 * why no consistent "outside" exists: the band is non-orientable.
 */
export function bandNormal(n: number, R: number, u: number, v: number, out: Vec3Out): void {
  const h = n / 2;
  const c = Math.cos(h * u);
  const s = Math.sin(h * u);
  const cu = Math.cos(u);
  const su = Math.sin(u);
  const a = R + v * c;
  out[0] = a * s * cu - h * v * su;
  out[1] = a * s * su + h * v * cu;
  out[2] = -a * c;
}

/** |N| = |r_u × r_v| = √(a² + (n·v/2)²) — the local area stretch of the parametrisation. */
export function bandNormalLength(n: number, R: number, u: number, v: number): number {
  const a = R + v * Math.cos((n * u) / 2);
  const hv = (n * v) / 2;
  return Math.sqrt(a * a + hv * hv);
}

/** Unit normal N̂ = N / |N|. */
export function bandUnitNormal(n: number, R: number, u: number, v: number, out: Vec3Out): void {
  bandNormal(n, R, u, v, out);
  const inv = 1 / bandNormalLength(n, R, u, v);
  out[0] *= inv;
  out[1] *= inv;
  out[2] *= inv;
}

/**
 * Count the edges by WALKING along one: start at r(0, +w) and follow v = +w
 * once around the loop (u: 0 → 2π), then look where you landed.
 *   • back on r(0, +w)   → that edge closed by itself; v = −w is a second edge → 2
 *   • on r(0, −w)        → you crossed onto the "other" edge: it is all ONE curve → 1
 *   • on neither         → the band does not close up at all (non-integer n) → 0
 */
export function traceBoundaryComponents(n: number, R: number = BAND_R, w = 0.42, tolerance = 1e-9): 0 | 1 | 2 {
  const end = [0, 0, 0];
  const start = [0, 0, 0];
  const opposite = [0, 0, 0];
  bandPoint(n, R, 2 * Math.PI, w, end);
  bandPoint(n, R, 0, w, start);
  bandPoint(n, R, 0, -w, opposite);
  const dStart = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
  const dOpposite = Math.hypot(end[0] - opposite[0], end[1] - opposite[1], end[2] - opposite[2]);
  if (dStart <= tolerance) return 2;
  if (dOpposite <= tolerance) return 1;
  return 0;
}

/* ─── Sampling (for the software renderer) ────────────────────────────────── */

/** Sample flag: the sample lies on the edge |v| = w. */
export const SAMPLE_BOUNDARY = 1;
/** Sample flag: the sample lies on the seam u = 0 / u = 2π, where the strip is glued. */
export const SAMPLE_SEAM = 2;

/**
 * Preallocated surface samples. Arrays only grow (never shrink), so after the
 * first few rebuilds `sampleBand` allocates nothing — read the counts, not the
 * array lengths.
 */
export class BandSamples {
  /** the band these samples describe */
  n = 0;
  R = BAND_R;
  w = 0;

  /**
   * Grid resolution: `nu` columns over the CLOSED interval u ∈ [0, 2π] (the first and
   * last column are the same cross-section seen from either side of the seam — on odd n
   * with v mirrored and the normal flipped) × `nv` rows over v ∈ [−w, w].
   */
  nu = 0;
  nv = 0;
  /** nu·nv — grid sample (i, j) lives at index k = i·nv + j */
  gridCount = 0;
  /** xyz per grid sample */
  positions = new Float32Array(0);
  /** unit normal N̂ (xyz) per grid sample */
  normals = new Float32Array(0);
  u = new Float32Array(0);
  v = new Float32Array(0);
  /** SAMPLE_BOUNDARY | SAMPLE_SEAM bits */
  flags = new Uint8Array(0);

  /** dense samples along the edge |v| = w */
  boundaryCount = 0;
  /** number of edge curves: 1 for odd n, 2 for even n */
  boundaryComponents: 1 | 2 = 1;
  /** first sample index of each edge component */
  readonly boundaryStart = new Int32Array(2);
  /** sample count of each edge component (each one is a closed loop) */
  readonly boundaryLength = new Int32Array(2);
  /** xyz per edge sample */
  boundaryPositions = new Float32Array(0);
  /** unit normal (xyz) per edge sample */
  boundaryNormals = new Float32Array(0);
  /** canonical surface coordinates of each edge sample: u ∈ [0, 2π), v = ±w */
  boundaryU = new Float32Array(0);
  boundaryV = new Float32Array(0);
  /** curve parameter: odd n → s ∈ [0, 4π) along the single edge r(s, w); even n → s = u ∈ [0, 2π) */
  boundaryS = new Float32Array(0);
  /** boundary-component id: odd n → 0; even n → 0 for v = +w, 1 for v = −w */
  boundaryComponent = new Uint8Array(0);

  /** Grow the arrays when needed (never shrinks). */
  reserve(gridCount: number, boundaryCount: number): void {
    if (this.u.length < gridCount) {
      this.positions = new Float32Array(gridCount * 3);
      this.normals = new Float32Array(gridCount * 3);
      this.u = new Float32Array(gridCount);
      this.v = new Float32Array(gridCount);
      this.flags = new Uint8Array(gridCount);
    }
    if (this.boundaryU.length < boundaryCount) {
      this.boundaryPositions = new Float32Array(boundaryCount * 3);
      this.boundaryNormals = new Float32Array(boundaryCount * 3);
      this.boundaryU = new Float32Array(boundaryCount);
      this.boundaryV = new Float32Array(boundaryCount);
      this.boundaryS = new Float32Array(boundaryCount);
      this.boundaryComponent = new Uint8Array(boundaryCount);
    }
  }
}

/** Position + unit normal at (u, v) into packed arrays at sample k. */
function writeSample(n: number, R: number, u: number, v: number, pos: Float32Array, nrm: Float32Array, k: number): void {
  const h = n / 2;
  const c = Math.cos(h * u);
  const s = Math.sin(h * u);
  const cu = Math.cos(u);
  const su = Math.sin(u);
  const a = R + v * c;
  const hv = h * v;
  const inv = 1 / Math.sqrt(a * a + hv * hv);
  const i3 = k * 3;
  pos[i3] = a * cu;
  pos[i3 + 1] = a * su;
  pos[i3 + 2] = v * s;
  nrm[i3] = (a * s * cu - hv * su) * inv;
  nrm[i3 + 1] = (a * s * su + hv * cu) * inv;
  nrm[i3 + 2] = -a * c * inv;
}

/**
 * Fill `out` with an nu × nv grid of surface samples (positions, unit normals,
 * u, v, flags) plus `nb` dense edge samples carrying a boundary-component id.
 *
 *   odd n  → ONE edge: the curve s ↦ r(s, +w) for s ∈ [0, 4π). It needs two laps to
 *            close, because r(2π + t, w) = r(t, −w): the "top" and "bottom" rims are
 *            the same curve.
 *   even n → TWO edges: v = +w (component 0) and v = −w (component 1), one lap each.
 *
 * `n` should be an integer (use deriveBandConstants); nb is rounded to a multiple of
 * the number of edge components.
 */
export function sampleBand(
  out: BandSamples,
  n: number,
  R: number,
  w: number,
  nu: number,
  nv: number,
  nb: number,
): BandSamples {
  const NU = Math.max(2, Math.floor(nu));
  const NV = Math.max(2, Math.floor(nv));
  const odd = Math.abs(Math.round(n)) % 2 === 1;
  const comps: 1 | 2 = odd ? 1 : 2;
  const perComponent = Math.max(3, Math.floor(Math.max(0, nb) / comps));
  const NB = perComponent * comps;
  const TAU = Math.PI * 2;
  const h = n / 2;

  out.reserve(NU * NV, NB);
  out.n = n;
  out.R = R;
  out.w = w;
  out.nu = NU;
  out.nv = NV;
  out.gridCount = NU * NV;

  const pos = out.positions;
  const nrm = out.normals;
  const U = out.u;
  const V = out.v;
  const flags = out.flags;

  for (let i = 0; i < NU; i++) {
    const u = i === NU - 1 ? TAU : (TAU * i) / (NU - 1);
    // per-column trigonometry, shared by the whole cross-section
    const c = Math.cos(h * u);
    const s = Math.sin(h * u);
    const cu = Math.cos(u);
    const su = Math.sin(u);
    const seam = i === 0 || i === NU - 1 ? SAMPLE_SEAM : 0;
    for (let j = 0; j < NV; j++) {
      const v = j === NV - 1 ? w : -w + (2 * w * j) / (NV - 1);
      const k = i * NV + j;
      const a = R + v * c;
      const hv = h * v;
      const inv = 1 / Math.sqrt(a * a + hv * hv);
      const i3 = k * 3;
      pos[i3] = a * cu;
      pos[i3 + 1] = a * su;
      pos[i3 + 2] = v * s;
      nrm[i3] = (a * s * cu - hv * su) * inv;
      nrm[i3 + 1] = (a * s * su + hv * cu) * inv;
      nrm[i3 + 2] = -a * c * inv;
      U[k] = u;
      V[k] = v;
      flags[k] = seam | (j === 0 || j === NV - 1 ? SAMPLE_BOUNDARY : 0);
    }
  }

  out.boundaryCount = NB;
  out.boundaryComponents = comps;
  const bPos = out.boundaryPositions;
  const bNrm = out.boundaryNormals;
  const bU = out.boundaryU;
  const bV = out.boundaryV;
  const bS = out.boundaryS;
  const bC = out.boundaryComponent;

  if (odd) {
    out.boundaryStart[0] = 0;
    out.boundaryLength[0] = NB;
    out.boundaryStart[1] = NB;
    out.boundaryLength[1] = 0;
    for (let k = 0; k < NB; k++) {
      const s = (2 * TAU * k) / NB; // s ∈ [0, 4π): first lap on v = +w, second lap on v = −w
      const firstLap = s < TAU;
      const u = firstLap ? s : s - TAU;
      const v = firstLap ? w : -w;
      writeSample(n, R, u, v, bPos, bNrm, k);
      bU[k] = u;
      bV[k] = v;
      bS[k] = s;
      bC[k] = 0;
    }
  } else {
    for (let comp = 0; comp < 2; comp++) {
      const start = comp * perComponent;
      const v = comp === 0 ? w : -w;
      out.boundaryStart[comp] = start;
      out.boundaryLength[comp] = perComponent;
      for (let q = 0; q < perComponent; q++) {
        const k = start + q;
        const u = (TAU * q) / perComponent;
        writeSample(n, R, u, v, bPos, bNrm, k);
        bU[k] = u;
        bV[k] = v;
        bS[k] = u;
        bC[k] = comp;
      }
    }
  }
  return out;
}
