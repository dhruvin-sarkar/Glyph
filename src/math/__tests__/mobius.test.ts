import { describe, expect, it } from 'vitest';
import {
  BAND_R,
  BandSamples,
  MAX_TWISTS,
  SAMPLE_BOUNDARY,
  SAMPLE_SEAM,
  bandNormal,
  bandNormalLength,
  bandPartials,
  bandPoint,
  bandUnitNormal,
  deriveBandConstants,
  edgeCurveName,
  sampleBand,
  traceBoundaryComponents,
} from '../mobius';
import { createMat3, cross, dot, length3, normalize, rotationFromYawPitch, transformPoint } from '../linalg';

const TAU = Math.PI * 2;
const TWISTS = [0, 1, 2, 3, 4, 5, 6, 7];
const W = 0.42;
const V_SAMPLES = [-0.85, -0.42, -0.3, -0.07, 0, 0.13, 0.42, 0.85];
const U_SAMPLES = [0, 0.37, 1.1, 2.0, Math.PI, 3.9, 5.2, 6.0];

function maxDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

function point(n: number, u: number, v: number): number[] {
  const out = [0, 0, 0];
  bandPoint(n, BAND_R, u, v, out);
  return out;
}

function normal(n: number, u: number, v: number): number[] {
  const out = [0, 0, 0];
  bandNormal(n, BAND_R, u, v, out);
  return out;
}

describe('seam closure: the strip glues to itself after one lap', () => {
  it.each(TWISTS)('n = %i: r(2π, v) = r(0, ±v)', (n) => {
    const odd = n % 2 === 1;
    for (const v of V_SAMPLES) {
      // odd n: the cross-section has turned by an odd multiple of π → arrives upside down
      expect(maxDiff(point(n, TAU, v), point(n, 0, odd ? -v : v))).toBeLessThan(1e-9);
    }
  });

  it('a fractional twist does NOT close (why the slider snaps to integers)', () => {
    for (const n of [0.5, 1.5, 2.25, 6.8]) {
      expect(maxDiff(point(n, TAU, W), point(n, 0, W))).toBeGreaterThan(1e-3);
      expect(maxDiff(point(n, TAU, W), point(n, 0, -W))).toBeGreaterThan(1e-3);
    }
  });
});

describe('normal flip across the seam', () => {
  it.each(TWISTS)('n = %i', (n) => {
    const odd = n % 2 === 1;
    for (const v of V_SAMPLES) {
      const end = normal(n, TAU, v);
      if (odd) {
        // same point as (0, −v), but the normal arrives pointing the other way
        const start = normal(n, 0, -v);
        expect(maxDiff(end, start.map((x) => -x))).toBeLessThan(1e-9);
        // opposite, not equal: |N(2π, v) − N(0, −v)| = 2·|N|
        const gap = length3([end[0] - start[0], end[1] - start[1], end[2] - start[2]]);
        expect(gap).toBeCloseTo(2 * length3(end), 9);
        expect(gap).toBeGreaterThan(0.2);
      } else {
        expect(maxDiff(end, normal(n, 0, v))).toBeLessThan(1e-9);
      }
    }
  });
});

describe('analytic partial derivatives', () => {
  const h = 1e-5;

  it.each(TWISTS)('n = %i: r_u and r_v match central differences', (n) => {
    const ru = [0, 0, 0];
    const rv = [0, 0, 0];
    for (const u of U_SAMPLES) {
      for (const v of V_SAMPLES) {
        bandPartials(n, BAND_R, u, v, ru, rv);
        const pu1 = point(n, u + h, v);
        const pu0 = point(n, u - h, v);
        const pv1 = point(n, u, v + h);
        const pv0 = point(n, u, v - h);
        for (let a = 0; a < 3; a++) {
          expect(Math.abs(ru[a] - (pu1[a] - pu0[a]) / (2 * h))).toBeLessThan(1e-7);
          expect(Math.abs(rv[a] - (pv1[a] - pv0[a]) / (2 * h))).toBeLessThan(1e-7);
        }
      }
    }
  });

  it.each(TWISTS)('n = %i: N = r_u × r_v, r_u ⟂ r_v, |N| = √(a² + (nv/2)²)', (n) => {
    const ru = [0, 0, 0];
    const rv = [0, 0, 0];
    const c = [0, 0, 0];
    const unit = [0, 0, 0];
    for (const u of U_SAMPLES) {
      for (const v of V_SAMPLES) {
        bandPartials(n, BAND_R, u, v, ru, rv);
        cross(ru, rv, c);
        const N = normal(n, u, v);
        expect(maxDiff(N, c)).toBeLessThan(1e-12);
        expect(Math.abs(dot(ru, rv))).toBeLessThan(1e-12);
        expect(Math.abs(length3(rv) - 1)).toBeLessThan(1e-12);
        expect(Math.abs(length3(N) - bandNormalLength(n, BAND_R, u, v))).toBeLessThan(1e-12);
        bandUnitNormal(n, BAND_R, u, v, unit);
        expect(Math.abs(length3(unit) - 1)).toBeLessThan(1e-12);
        expect(dot(unit, N)).toBeGreaterThan(0);
      }
    }
  });

  it('the surface never pinches: |N| ≥ R − w > 0', () => {
    for (const n of TWISTS) {
      for (let k = 0; k < 64; k++) {
        const u = (TAU * k) / 64;
        expect(bandNormalLength(n, BAND_R, u, 0.85)).toBeGreaterThanOrEqual(BAND_R - 0.85 - 1e-12);
        expect(bandNormalLength(n, BAND_R, u, -0.85)).toBeGreaterThanOrEqual(BAND_R - 0.85 - 1e-12);
      }
    }
  });
});

describe('deriveBandConstants: topological invariants for n = 0…7', () => {
  const table = [
    { n: 0, sides: 2, edges: 2, orientable: true, linking: 0, edgeName: 'two unlinked circles' },
    { n: 1, sides: 1, edges: 1, orientable: false, linking: null, edgeName: 'unknot' },
    { n: 2, sides: 2, edges: 2, orientable: true, linking: 1, edgeName: 'Hopf link' },
    { n: 3, sides: 1, edges: 1, orientable: false, linking: null, edgeName: 'trefoil knot' },
    { n: 4, sides: 2, edges: 2, orientable: true, linking: 2, edgeName: 'Solomon link' },
    { n: 5, sides: 1, edges: 1, orientable: false, linking: null, edgeName: 'cinquefoil knot' },
    { n: 6, sides: 2, edges: 2, orientable: true, linking: 3, edgeName: 'T(2,6) torus link' },
    { n: 7, sides: 1, edges: 1, orientable: false, linking: null, edgeName: 'septafoil knot' },
  ] as const;

  it.each(table)('n = $n → $sides side(s), $edges edge(s), $edgeName', (row) => {
    const b = deriveBandConstants({ twists: row.n, width: W });
    expect(b.n).toBe(row.n);
    expect(b.R).toBe(BAND_R);
    expect(b.w).toBe(W);
    expect(b.sides).toBe(row.sides);
    expect(b.edges).toBe(row.edges);
    expect(b.orientable).toBe(row.orientable);
    expect(b.linking).toBe(row.linking);
    expect(b.edgeName).toBe(row.edgeName);
    expect(b.euler).toBe(0);
    expect(edgeCurveName(row.n)).toBe(row.edgeName);
  });

  it('snaps and clamps raw inputs', () => {
    expect(deriveBandConstants({ twists: 2.6 }).n).toBe(3);
    expect(deriveBandConstants({ twists: -4 }).n).toBe(0);
    expect(deriveBandConstants({ twists: 99 }).n).toBe(MAX_TWISTS);
    expect(deriveBandConstants({}).n).toBe(1);
    expect(deriveBandConstants({ width: 0 }).w).toBe(0.05);
    expect(deriveBandConstants({ width: 5 }).w).toBeLessThan(BAND_R);
    expect(deriveBandConstants({ twists: 'x' }).n).toBe(1);
  });
});

describe('edge components, found by walking along the edge', () => {
  it.each(TWISTS)('n = %i', (n) => {
    // start at r(0, +w) and follow v = +w all the way round (u: 0 → 2π)
    const landing = point(n, TAU, W);
    const backHome = maxDiff(landing, point(n, 0, W)) < 1e-9; // closed on its own → a second edge exists
    const crossedOver = maxDiff(landing, point(n, 0, -W)) < 1e-9; // arrived on the "other" rim → one edge
    expect(backHome).not.toBe(crossedOver);
    const components = backHome ? 2 : 1;

    expect(components).toBe(n % 2 === 1 ? 1 : 2);
    expect(traceBoundaryComponents(n, BAND_R, W)).toBe(components);
    expect(deriveBandConstants({ twists: n, width: W }).edges).toBe(components);
  });

  it('a non-integer twist leaves the edge open', () => {
    expect(traceBoundaryComponents(1.5)).toBe(0);
    expect(traceBoundaryComponents(2.25)).toBe(0);
  });
});

describe('linking number of the two edges (Gauss integral, even n)', () => {
  /** lk = (1/4π) ∮∮ (r₁ − r₂)·(dr₁ × dr₂) / |r₁ − r₂|³, midpoint rule on M segments per curve. */
  function gaussLinking(n: number, M: number): number {
    const a = new Float64Array(M * 3);
    const b = new Float64Array(M * 3);
    const p = [0, 0, 0];
    for (let k = 0; k < M; k++) {
      const u = (TAU * (k + 0.5)) / M;
      bandPoint(n, BAND_R, u, W, p);
      a.set(p, k * 3);
      bandPoint(n, BAND_R, u, -W, p);
      b.set(p, k * 3);
    }
    const da = [0, 0, 0];
    const db = [0, 0, 0];
    const c = [0, 0, 0];
    let sum = 0;
    for (let i = 0; i < M; i++) {
      const i1 = ((i + 1) % M) * 3;
      const i0 = ((i - 1 + M) % M) * 3;
      for (let q = 0; q < 3; q++) da[q] = (a[i1 + q] - a[i0 + q]) / 2;
      for (let j = 0; j < M; j++) {
        const j1 = ((j + 1) % M) * 3;
        const j0 = ((j - 1 + M) % M) * 3;
        for (let q = 0; q < 3; q++) db[q] = (b[j1 + q] - b[j0 + q]) / 2;
        const rx = a[i * 3] - b[j * 3];
        const ry = a[i * 3 + 1] - b[j * 3 + 1];
        const rz = a[i * 3 + 2] - b[j * 3 + 2];
        const r = Math.sqrt(rx * rx + ry * ry + rz * rz);
        cross(da, db, c);
        sum += (rx * c[0] + ry * c[1] + rz * c[2]) / (r * r * r);
      }
    }
    return sum / (4 * Math.PI);
  }

  it.each([0, 2, 4, 6])('n = %i → |lk| = n/2', (n) => {
    const lk = gaussLinking(n, 480);
    expect(Math.abs(Math.abs(lk) - n / 2)).toBeLessThan(0.02);
    expect(Math.abs(lk)).toBeCloseTo(deriveBandConstants({ twists: n }).linking ?? Number.NaN, 1);
  });
});

describe('sampleBand', () => {
  it.each(TWISTS)('n = %i: grid of positions, unit normals, u, v, flags', (n) => {
    const nu = 37;
    const nv = 9;
    const s = sampleBand(new BandSamples(), n, BAND_R, W, nu, nv, 240);
    expect(s.nu).toBe(nu);
    expect(s.nv).toBe(nv);
    expect(s.gridCount).toBe(nu * nv);

    const p = [0, 0, 0];
    const N = [0, 0, 0];
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const k = i * nv + j;
        const u = s.u[k];
        const v = s.v[k];
        expect(u).toBeCloseTo((TAU * i) / (nu - 1), 6);
        expect(v).toBeCloseTo(-W + (2 * W * j) / (nv - 1), 6);
        bandPoint(n, BAND_R, u, v, p);
        bandUnitNormal(n, BAND_R, u, v, N);
        expect(maxDiff(s.positions.subarray(k * 3, k * 3 + 3), p)).toBeLessThan(1e-6);
        expect(maxDiff(s.normals.subarray(k * 3, k * 3 + 3), N)).toBeLessThan(1e-6);
        expect(Math.abs(length3(s.normals, k * 3) - 1)).toBeLessThan(1e-6);
        const boundary = j === 0 || j === nv - 1;
        const seam = i === 0 || i === nu - 1;
        expect((s.flags[k] & SAMPLE_BOUNDARY) !== 0).toBe(boundary);
        expect((s.flags[k] & SAMPLE_SEAM) !== 0).toBe(seam);
      }
    }

    // the closing column (u = 2π) repeats the first one — mirrored in v on odd n, normals flipped
    const odd = n % 2 === 1;
    for (let j = 0; j < nv; j++) {
      const last = (nu - 1) * nv + j;
      const first = odd ? nv - 1 - j : j;
      expect(maxDiff(s.positions.subarray(last * 3, last * 3 + 3), s.positions.subarray(first * 3, first * 3 + 3))).toBeLessThan(1e-6);
      const sign = odd ? -1 : 1;
      for (let a = 0; a < 3; a++) {
        expect(Math.abs(s.normals[last * 3 + a] - sign * s.normals[first * 3 + a])).toBeLessThan(1e-6);
      }
    }
  });

  it.each(TWISTS)('n = %i: dense edge samples with component ids form closed loops', (n) => {
    const odd = n % 2 === 1;
    const nb = 400;
    const s = sampleBand(new BandSamples(), n, BAND_R, W, 65, 7, nb);
    expect(s.boundaryComponents).toBe(odd ? 1 : 2);
    expect(s.boundaryComponents).toBe(deriveBandConstants({ twists: n }).edges);
    expect(s.boundaryCount).toBe(nb);

    for (let comp = 0; comp < s.boundaryComponents; comp++) {
      const start = s.boundaryStart[comp];
      const len = s.boundaryLength[comp];
      expect(len).toBe(odd ? nb : nb / 2);
      let maxStep = 0;
      for (let q = 0; q < len; q++) {
        const k = start + q;
        expect(s.boundaryComponent[k]).toBe(comp);
        expect(Math.abs(Math.abs(s.boundaryV[k]) - W)).toBeLessThan(1e-6);
        if (!odd) expect(s.boundaryV[k]).toBeCloseTo(comp === 0 ? W : -W, 6);
        const next = start + ((q + 1) % len); // wraps: the loop must close
        const step = Math.hypot(
          s.boundaryPositions[next * 3] - s.boundaryPositions[k * 3],
          s.boundaryPositions[next * 3 + 1] - s.boundaryPositions[k * 3 + 1],
          s.boundaryPositions[next * 3 + 2] - s.boundaryPositions[k * 3 + 2],
        );
        maxStep = Math.max(maxStep, step);
      }
      // consecutive samples are close everywhere, including across the wrap-around
      const longestArc = Math.hypot(BAND_R + W, (n * W) / 2) * (TAU / (odd ? nb / 2 : nb / 2));
      expect(maxStep).toBeLessThan(longestArc * 1.01);
    }

    if (odd) {
      // one curve, parameter s ∈ [0, 4π): the second lap runs along v = −w
      expect(s.boundaryS[0]).toBe(0);
      expect(s.boundaryS[nb - 1]).toBeLessThan(2 * TAU);
      expect(s.boundaryV[0]).toBeCloseTo(W, 6);
      expect(s.boundaryV[nb - 1]).toBeCloseTo(-W, 6);
    }
  });

  it('reuses its buffers when the band changes', () => {
    const s = new BandSamples();
    sampleBand(s, 3, BAND_R, W, 200, 10, 800);
    const positions = s.positions;
    const boundary = s.boundaryPositions;
    sampleBand(s, 2, BAND_R, 0.3, 120, 8, 600);
    expect(s.positions).toBe(positions);
    expect(s.boundaryPositions).toBe(boundary);
    expect(s.gridCount).toBe(120 * 8);
    expect(s.boundaryComponents).toBe(2);
  });
});

describe('linalg', () => {
  it('rotationFromYawPitch is a proper rotation (orthonormal, det = +1)', () => {
    const m = createMat3();
    for (const yaw of [-2.4, -0.3, 0, 0.62, 1.9, 3.1]) {
      for (const pitch of [-1.35, -0.4, 0, 0.58, 1.35]) {
        rotationFromYawPitch(yaw, pitch, m);
        for (let r = 0; r < 3; r++) {
          expect(Math.abs(length3(m, r * 3) - 1)).toBeLessThan(1e-12);
          for (let q = r + 1; q < 3; q++) expect(Math.abs(dot(m, m, r * 3, q * 3))).toBeLessThan(1e-12);
        }
        const c = [0, 0, 0];
        cross(m, m, c, 3, 6);
        expect(dot(m, c)).toBeCloseTo(1, 12);
      }
    }
  });

  it('pitch is the eye elevation: π/2 looks straight down the band axis', () => {
    const m = rotationFromYawPitch(0.7, Math.PI / 2);
    const out = [0, 0, 0];
    transformPoint(m, 0, 0, 1, out);
    expect(maxDiff(out, [0, 0, 1])).toBeLessThan(1e-12); // the axis points at the viewer
    rotationFromYawPitch(0, 0, m);
    transformPoint(m, 0, 0, 1, out);
    expect(maxDiff(out, [0, 1, 0])).toBeLessThan(1e-12); // edge-on: the axis points up
    transformPoint(m, 0, -1, 0, out);
    expect(out[2]).toBeCloseTo(1, 12); // the near side of the ring (−y) comes toward the viewer
  });

  it('positive yaw moves the near side of the band to the right (drag right → turn right)', () => {
    const m = rotationFromYawPitch(0.01, 0.58);
    const out = [0, 0, 0];
    transformPoint(m, 0, -1, 0, out);
    expect(out[0]).toBeGreaterThan(0);
  });

  it('cross, dot and normalize', () => {
    const c = [0, 0, 0];
    cross([1, 0, 0], [0, 1, 0], c);
    expect(c).toEqual([0, 0, 1]);
    expect(dot([1, 2, 3], [4, -5, 6])).toBe(12);
    const v = new Float32Array([3, 0, 4]);
    expect(normalize(v)).toBe(5);
    expect(Math.abs(length3(v) - 1)).toBeLessThan(1e-6);
    const z = [0, 0, 0];
    expect(normalize(z)).toBe(0);
    expect(z).toEqual([0, 0, 0]);
    const aliased = [1, 2, 3];
    cross(aliased, [4, 5, 6], aliased);
    expect(aliased).toEqual([-3, 6, -3]);
  });
});
