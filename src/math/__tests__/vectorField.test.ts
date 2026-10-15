import { describe, expect, it } from 'vitest';
import {
  EPS_REF,
  R_CAPTURE,
  SECTOR_GLYPHS,
  TEMP_LIFETIME,
  V_MAX,
  addAttractorVelocity,
  captureRadius,
  compileField,
  createAttractorSet,
  createFieldKernel,
  deriveFieldConstants,
  directionSector,
  fieldAt,
  kernelVelocity,
  peakFieldStrength,
  pushAttractor,
  spiralRate,
  tempWeight,
  velocityAt,
  type AttractorSet,
  type FieldConstants,
  type Vec2,
} from '../vectorField';
import {
  clampSpeed,
  createRK4Scratch,
  eulerStep,
  rk4Step,
  springStep,
  substepCount,
  type Spring2,
  type VectorFn,
} from '../integrate';
import { attractorMeta } from '../../experiments/attractor.params';
import type { ParamValues } from '../../engine/types';

/* Small deterministic RNG so every run tests the same points. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function constants(s: number, g: number, eps: number): FieldConstants {
  return deriveFieldConstants({ swirl: s, strength: g, softening: eps });
}

function singleAttractor(ax: number, ay: number, w = 1, spin = 1): AttractorSet {
  const set = createAttractorSet();
  pushAttractor(set, ax, ay, w, spin);
  return set;
}

/** dp/dt with the clamp — what the experiment integrates. */
function velocityFn(fc: FieldConstants, set: AttractorSet): VectorFn {
  return (x, y, out) => {
    velocityAt(fc, set, x, y, out);
  };
}

describe('integrate · RK4 on a pure vortex (g = 0)', () => {
  it('keeps the orbit radius constant over 1000 steps (|Δr| < 1e−3)', () => {
    const fc = constants(0.65, 0, 1e-5);
    const set = singleAttractor(0, 0);
    const f = velocityFn(fc, set);
    const scratch = createRK4Scratch();
    const p: Vec2 = { x: 0.5, y: 0 };
    const h = 1 / 60;
    let maxDrift = 0;
    for (let i = 0; i < 1000; i++) {
      rk4Step(f, p.x, p.y, h, p, scratch);
      maxDrift = Math.max(maxDrift, Math.abs(Math.hypot(p.x, p.y) - 0.5));
    }
    expect(maxDrift).toBeLessThan(1e-3);
    // …and it really went round: 1000 steps at ω = s/r² ≈ 2.6 rad/s is ~7 laps
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(0.5, 3);
  });

  it('is far more accurate than Euler, which spirals outward on the same orbit', () => {
    const fc = constants(0.65, 0, 1e-5);
    const f = velocityFn(fc, singleAttractor(0, 0));
    const scratch = createRK4Scratch();
    const k: Vec2 = { x: 0, y: 0 };
    const rk: Vec2 = { x: 0.5, y: 0 };
    const eu: Vec2 = { x: 0.5, y: 0 };
    const h = 1 / 60;
    for (let i = 0; i < 1000; i++) {
      rk4Step(f, rk.x, rk.y, h, rk, scratch);
      eulerStep(f, eu.x, eu.y, h, eu, k);
    }
    const rkDrift = Math.abs(Math.hypot(rk.x, rk.y) - 0.5);
    const euDrift = Math.abs(Math.hypot(eu.x, eu.y) - 0.5);
    expect(euDrift).toBeGreaterThan(0.1);
    expect(rkDrift * 1000).toBeLessThan(euDrift);
  });
});

describe('vectorField · pure sink (s = 0)', () => {
  it('points every velocity straight at the attractor', () => {
    const fc = constants(0, 0.4, 0.008);
    const ax = 0.3;
    const ay = -0.2;
    const set = singleAttractor(ax, ay);
    const rand = rng(7);
    const v: Vec2 = { x: 0, y: 0 };
    for (let i = 0; i < 500; i++) {
      const x = (rand() * 2 - 1) * 1.8;
      const y = rand() * 2 - 1;
      fieldAt(fc, set, x, y, v);
      const dx = x - ax;
      const dy = y - ay;
      const r = Math.hypot(dx, dy);
      const m = Math.hypot(v.x, v.y);
      if (r < 1e-9) continue;
      // radially inward: unit velocity = −unit displacement
      expect(v.x / m).toBeCloseTo(-dx / r, 12);
      expect(v.y / m).toBeCloseTo(-dy / r, 12);
      // magnitude g·r/(r²+ε)
      expect(m).toBeCloseTo((fc.g * r) / (r * r + fc.eps), 12);
    }
  });
});

describe('vectorField · logarithmic spiral (s, g > 0)', () => {
  it('an integrated trajectory satisfies θ = −(s/g)·ln r + C (slope within 1 %)', () => {
    const fc = constants(0.65, 0.22, 0.008);
    const ax = 0.1;
    const ay = -0.2;
    const f = velocityFn(fc, singleAttractor(ax, ay));
    const scratch = createRK4Scratch();
    const p: Vec2 = { x: ax + 0.9, y: ay };
    const h = 1 / 240;

    // least-squares fit of θ against ln r along the path
    let n = 0;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    let theta = 0;
    let prevAngle = Math.atan2(p.y - ay, p.x - ax);
    for (let i = 0; i < 20000; i++) {
      rk4Step(f, p.x, p.y, h, p, scratch);
      const r = Math.hypot(p.x - ax, p.y - ay);
      if (r < 0.06) break;
      const angle = Math.atan2(p.y - ay, p.x - ax);
      let d = angle - prevAngle; // unwrap: accumulate the smallest angle change
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      theta += d;
      prevAngle = angle;
      const lr = Math.log(r);
      n++;
      sx += lr;
      sy += theta;
      sxx += lr * lr;
      sxy += lr * theta;
    }
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const expected = -fc.s / fc.g;
    expect(n).toBeGreaterThan(100);
    expect(theta).toBeGreaterThan(2 * Math.PI); // at least one full turn was tested
    expect(Math.abs(slope / expected - 1)).toBeLessThan(0.01);
    // spiralRate is g/s: r = r₀·e^{−(g/s)θ}  ⇔  dθ/d(ln r) = −1/spiralRate
    expect(-1 / spiralRate(fc)).toBeCloseTo(expected, 12);
  });

  it('spiralRate is Infinity for straight inflow (s = 0)', () => {
    expect(spiralRate({ s: 0, g: 0.3 })).toBe(Infinity);
  });
});

describe('vectorField · superposition', () => {
  it('the field of two attractors is the sum of the single fields', () => {
    const fc = constants(0.8, 0.3, 0.01);
    const both = createAttractorSet();
    pushAttractor(both, -0.4, 0.1, 1, 1);
    pushAttractor(both, 0.5, -0.3, 0.6, -1); // a fading, counter-rotating click attractor
    const a = singleAttractor(-0.4, 0.1, 1, 1);
    const b = singleAttractor(0.5, -0.3, 0.6, -1);
    const rand = rng(11);
    const sum: Vec2 = { x: 0, y: 0 };
    const fa: Vec2 = { x: 0, y: 0 };
    const fb: Vec2 = { x: 0, y: 0 };
    for (let i = 0; i < 300; i++) {
      const x = (rand() * 2 - 1) * 1.7;
      const y = rand() * 2 - 1;
      fieldAt(fc, both, x, y, sum);
      fieldAt(fc, a, x, y, fa);
      fieldAt(fc, b, x, y, fb);
      expect(sum.x).toBeCloseTo(fa.x + fb.x, 10);
      expect(sum.y).toBeCloseTo(fa.y + fb.y, 10);
    }
  });

  it('the compiled kernel (fast path) gives exactly velocityAt, clamp included', () => {
    const rand = rng(23);
    const kernel = createFieldKernel();
    const a: Vec2 = { x: 0, y: 0 };
    const b: Vec2 = { x: 0, y: 0 };
    for (const [s, g, eps] of [
      [0.65, 0.22, 0.008],
      [-1.5, 1.2, 0.001],
      [0, 0.4, 0.05],
      [1.1, 0, 0.002],
    ]) {
      const fc = constants(s, g, eps);
      const set = createAttractorSet();
      pushAttractor(set, 0.1, -0.2, 1, 1);
      pushAttractor(set, -0.6, 0.3, 0.8, -1);
      pushAttractor(set, 0.9, 0.5, 0.15, -1);
      compileField(fc, set, kernel);
      for (let i = 0; i < 400; i++) {
        const x = (rand() * 2 - 1) * 1.8;
        const y = rand() * 2 - 1;
        velocityAt(fc, set, x, y, a);
        kernelVelocity(kernel, x, y, b);
        expect(b.x).toBeCloseTo(a.x, 12);
        expect(b.y).toBeCloseTo(a.y, 12);
      }
    }
  });

  it('fieldAt agrees with summing addAttractorVelocity by hand', () => {
    const fc = constants(-0.5, 0.7, 0.004);
    const set = createAttractorSet();
    pushAttractor(set, 0, 0, 1, 1);
    pushAttractor(set, 0.2, 0.2, 0.3, -1);
    const out: Vec2 = { x: 0, y: 0 };
    const manual: Vec2 = { x: 0, y: 0 };
    fieldAt(fc, set, 0.31, -0.17, out);
    addAttractorVelocity(fc, 0, 0, 1, 1, 0.31, -0.17, manual);
    addAttractorVelocity(fc, 0.2, 0.2, 0.3, -1, 0.31, -0.17, manual);
    expect(out.x).toBeCloseTo(manual.x, 14);
    expect(out.y).toBeCloseTo(manual.y, 14);
  });
});

describe('integrate · speed clamp', () => {
  it('|dp/dt| ≤ vmax everywhere, and the clamp keeps the direction', () => {
    const fc = constants(1.5, 1.2, 0.001); // strongest settings: |F| peaks far above vmax
    expect(peakFieldStrength(fc)).toBeGreaterThan(V_MAX);
    const set = singleAttractor(0, 0);
    const raw: Vec2 = { x: 0, y: 0 };
    const v: Vec2 = { x: 0, y: 0 };
    let clampedSeen = 0;
    for (let i = -60; i <= 60; i++) {
      for (let j = -60; j <= 60; j++) {
        const x = i * 0.005;
        const y = j * 0.005;
        fieldAt(fc, set, x, y, raw);
        const clamped = velocityAt(fc, set, x, y, v);
        const speed = Math.hypot(v.x, v.y);
        expect(speed).toBeLessThanOrEqual(fc.vmax * (1 + 1e-12));
        if (clamped) {
          clampedSeen++;
          expect(speed).toBeCloseTo(fc.vmax, 10);
          // same direction: cross product 0, dot product positive
          expect(raw.x * v.y - raw.y * v.x).toBeCloseTo(0, 9);
          expect(raw.x * v.x + raw.y * v.y).toBeGreaterThan(0);
        } else {
          expect(v.x).toBe(raw.x);
          expect(v.y).toBe(raw.y);
        }
      }
    }
    expect(clampedSeen).toBeGreaterThan(0);
  });

  it('an RK4 step of size h never moves farther than vmax·h', () => {
    const fc = constants(1.5, 1.2, 0.001);
    const f = velocityFn(fc, singleAttractor(0, 0));
    const scratch = createRK4Scratch();
    const out: Vec2 = { x: 0, y: 0 };
    const h = 1 / 20;
    const rand = rng(3);
    for (let i = 0; i < 400; i++) {
      const x = (rand() * 2 - 1) * 0.3;
      const y = (rand() * 2 - 1) * 0.3;
      rk4Step(f, x, y, h, out, scratch);
      expect(Math.hypot(out.x - x, out.y - y)).toBeLessThanOrEqual(fc.vmax * h * (1 + 1e-12));
      expect(Math.hypot(scratch.v.x, scratch.v.y)).toBeLessThanOrEqual(fc.vmax * (1 + 1e-12));
    }
  });

  it('clampSpeed leaves slow vectors untouched', () => {
    const v: Vec2 = { x: 0.3, y: -0.4 };
    expect(clampSpeed(v, 1)).toBe(false);
    expect(v).toEqual({ x: 0.3, y: -0.4 });
    const w: Vec2 = { x: 3, y: 4 };
    expect(clampSpeed(w, 1)).toBe(true);
    expect(w.x).toBeCloseTo(0.6, 12);
    expect(w.y).toBeCloseTo(0.8, 12);
  });
});

describe('vectorField · softening ε', () => {
  it('ε > 0 keeps F finite at the attractor itself', () => {
    for (const eps of [1e-5, 0.001, 0.008, 0.05]) {
      const fc = constants(0.65, 0.22, eps);
      const set = singleAttractor(0.25, -0.1);
      const v: Vec2 = { x: 0, y: 0 };
      fieldAt(fc, set, 0.25, -0.1, v); // exactly on top: Δ = 0
      expect(Number.isFinite(v.x)).toBe(true);
      expect(Number.isFinite(v.y)).toBe(true);
      expect(Math.hypot(v.x, v.y)).toBe(0);
    }
  });

  it('|F| never exceeds √(s²+g²)/(2√ε), and reaches it on the circle r = √ε', () => {
    const fc = constants(0.65, 0.22, 0.008);
    const set = singleAttractor(0, 0);
    const peak = peakFieldStrength(fc);
    const v: Vec2 = { x: 0, y: 0 };
    let maxSeen = 0;
    for (let k = 0; k <= 4000; k++) {
      const r = (k / 4000) * 0.5;
      const a = k * 0.7;
      fieldAt(fc, set, r * Math.cos(a), r * Math.sin(a), v);
      const m = Math.hypot(v.x, v.y);
      expect(Number.isFinite(m)).toBe(true);
      expect(m).toBeLessThanOrEqual(peak * (1 + 1e-12));
      maxSeen = Math.max(maxSeen, m);
    }
    expect(maxSeen / peak).toBeGreaterThan(0.999);
    const re = Math.sqrt(fc.eps);
    fieldAt(fc, set, re, 0, v);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(peak, 10);
  });

  it('captureRadius = 0.035·max(1, √(ε/0.008))', () => {
    expect(captureRadius(EPS_REF)).toBeCloseTo(R_CAPTURE, 12);
    expect(captureRadius(0.001)).toBeCloseTo(R_CAPTURE, 12);
    expect(captureRadius(0.05)).toBeCloseTo(R_CAPTURE * 2.5, 12);
  });
});

describe('vectorField · direction glyphs', () => {
  it('directionSector equals round(atan2(vy, vx)/45°) mod 8 away from sector borders', () => {
    for (let deg = -179; deg < 180; deg += 1) {
      const fromBorder = Math.abs((((deg + 22.5) % 45) + 45) % 45);
      if (fromBorder < 0.5 || fromBorder > 44.5) continue;
      const a = (deg * Math.PI) / 180;
      const vx = Math.cos(a) * 1.7;
      const vy = Math.sin(a) * 1.7;
      const expected = Math.round(Math.atan2(vy, vx) / (Math.PI / 4)) & 7;
      expect(directionSector(vx, vy)).toBe(expected);
    }
  });

  it('maps screen motion to the stroke the eye expects (world y up, screen y down)', () => {
    // screen velocity (sx, sy) with +sy = DOWN → world velocity (sx, −sy)
    const glyphForScreen = (sx: number, sy: number) => SECTOR_GLYPHS[directionSector(sx, -sy)];
    expect(glyphForScreen(1, -1)).toBe('/'); // up-right on screen
    expect(glyphForScreen(-1, 1)).toBe('/'); // down-left
    expect(glyphForScreen(1, 1)).toBe('\\'); // down-right
    expect(glyphForScreen(-1, -1)).toBe('\\'); // up-left
    expect(glyphForScreen(1, 0)).toBe('-');
    expect(glyphForScreen(0, 1)).toBe('|');
  });
});

describe('vectorField · parameters and temporaries', () => {
  it('fallback constants match the parameter-schema defaults', () => {
    const defaults: ParamValues = {};
    for (const def of attractorMeta.params) defaults[def.id] = def.default;
    expect(deriveFieldConstants(defaults)).toEqual(deriveFieldConstants({}));
  });

  it('a temporary attractor weight eases 1 → 0 over its lifetime, monotonically', () => {
    expect(tempWeight(0)).toBe(1);
    expect(tempWeight(TEMP_LIFETIME / 2)).toBeCloseTo(0.5, 12);
    expect(tempWeight(TEMP_LIFETIME)).toBe(0);
    let prev = 1;
    for (let t = 0; t <= TEMP_LIFETIME; t += 0.05) {
      const w = tempWeight(t);
      expect(w).toBeLessThanOrEqual(prev + 1e-15);
      prev = w;
    }
  });
});

describe('integrate · helpers', () => {
  it('substepCount keeps each step shorter than maxLen, within bounds', () => {
    expect(substepCount(0, 1 / 60, 0.02, 6)).toBe(1);
    expect(substepCount(3.2, 1 / 60, 0.02, 6)).toBe(3);
    expect(substepCount(3.2, 1 / 20, 0.02, 6)).toBe(6);
    expect(substepCount(Number.NaN, 1 / 60, 0.02, 6)).toBe(1);
  });

  it('springStep is the exact solution: two half steps equal one full step', () => {
    const a: Spring2 = { x: 0.4, y: -0.3, vx: 1.2, vy: 0.5 };
    const b: Spring2 = { ...a };
    springStep(a, 1, 0.5, 12, 0.1);
    springStep(b, 1, 0.5, 12, 0.05);
    springStep(b, 1, 0.5, 12, 0.05);
    expect(b.x).toBeCloseTo(a.x, 12);
    expect(b.y).toBeCloseTo(a.y, 12);
    expect(b.vx).toBeCloseTo(a.vx, 12);
    expect(b.vy).toBeCloseTo(a.vy, 12);
  });

  it('a critically damped spring released from rest approaches its target without overshoot', () => {
    const s: Spring2 = { x: 0, y: 0, vx: 0, vy: 0 };
    let prevGap = 1;
    for (let i = 0; i < 120; i++) {
      springStep(s, 1, 0, 12, 1 / 60);
      const gap = 1 - s.x;
      expect(gap).toBeGreaterThanOrEqual(0);
      expect(gap).toBeLessThanOrEqual(prevGap);
      prevGap = gap;
    }
    expect(prevGap).toBeLessThan(1e-6);
  });
});
