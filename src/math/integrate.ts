import type { Vec2 } from './vectorField';

/* ═══════════════════════════════════════════════════════════════════════════
 *  INTEGRATION — turning a velocity field into motion. Pure, allocation-free.
 *
 *  Each particle obeys the differential equation  dp/dt = F(p):  the field
 *  IS the velocity. For moving, superposed attractors there is no formula
 *  for p(t), so we march it forward in small time steps h.
 *
 *  Euler (the obvious idea):   p ← p + h·F(p)
 *    follows the tangent, so on a curved orbit it always steps OUTWARD:
 *    a circling particle slowly spirals away. Error per step ∝ h².
 *
 *  Classical Runge–Kutta, RK4 — samples the field four times per step:
 *    k₁ = F(p)
 *    k₂ = F(p + ½h·k₁)        (peek half a step ahead along k₁)
 *    k₃ = F(p + ½h·k₂)        (peek again with the better slope)
 *    k₄ = F(p + h·k₃)         (peek a whole step ahead)
 *    p ← p + (h/6)·(k₁ + 2k₂ + 2k₃ + k₄)
 *  — a weighted average of slopes, like Simpson's rule. Error per step ∝ h⁵,
 *  so circular orbits stay circular (see the unit tests).
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Right-hand side of an autonomous 2-D ODE dp/dt = f(p): writes f(x, y) into `out`. */
export type VectorFn = (x: number, y: number, out: Vec2) => void;

/** Preallocated slope vectors for `rk4Step` (one per integrator, reused every step). */
export interface RK4Scratch {
  readonly k1: Vec2;
  readonly k2: Vec2;
  readonly k3: Vec2;
  readonly k4: Vec2;
  /** effective velocity of the most recent step: (k₁ + 2k₂ + 2k₃ + k₄)/6 */
  readonly v: Vec2;
}

export function createRK4Scratch(): RK4Scratch {
  return {
    k1: { x: 0, y: 0 },
    k2: { x: 0, y: 0 },
    k3: { x: 0, y: 0 },
    k4: { x: 0, y: 0 },
    v: { x: 0, y: 0 },
  };
}

/**
 * One classical RK4 step of size h for dp/dt = f(p), starting at (x, y).
 * Writes the new position into `out` and the step's effective velocity into
 * `s.v`. Allocation-free: all slopes live in the preallocated scratch.
 */
export function rk4Step(f: VectorFn, x: number, y: number, h: number, out: Vec2, s: RK4Scratch): void {
  const k1 = s.k1;
  const k2 = s.k2;
  const k3 = s.k3;
  const k4 = s.k4;
  const hh = 0.5 * h;
  f(x, y, k1);
  f(x + hh * k1.x, y + hh * k1.y, k2);
  f(x + hh * k2.x, y + hh * k2.y, k3);
  f(x + h * k3.x, y + h * k3.y, k4);
  const vx = (k1.x + 2 * (k2.x + k3.x) + k4.x) / 6;
  const vy = (k1.y + 2 * (k2.y + k3.y) + k4.y) / 6;
  s.v.x = vx;
  s.v.y = vy;
  out.x = x + h * vx;
  out.y = y + h * vy;
}

/** One explicit Euler step (kept for comparison with RK4 — see the tests). `k` is scratch for the slope. */
export function eulerStep(f: VectorFn, x: number, y: number, h: number, out: Vec2, k: Vec2): void {
  f(x, y, k);
  out.x = x + h * k.x;
  out.y = y + h * k.y;
}

/**
 * Speed clamp: scale v so that |v| ≤ vmax, keeping its direction.
 * Returns true when it had to scale. Applied to every field sample, so each
 * RK4 slope kᵢ obeys |kᵢ| ≤ vmax — and therefore so does their weighted
 * average: a step never moves farther than vmax·h.
 */
export function clampSpeed(v: Vec2, vmax: number): boolean {
  const m2 = v.x * v.x + v.y * v.y;
  if (m2 <= vmax * vmax) return false;
  const k = vmax / Math.sqrt(m2);
  v.x *= k;
  v.y *= k;
  return true;
}

/**
 * Sub-stepping: the number of equal steps (1…maxSteps) that keeps every step
 * shorter than `maxLen` when moving at `speed` for `dt` seconds. Fast
 * particles near a core get several small steps; slow ones get one.
 */
export function substepCount(speed: number, dt: number, maxLen: number, maxSteps: number): number {
  const n = Math.ceil((speed * dt) / maxLen);
  if (!(n >= 1)) return 1; // also catches NaN
  return n > maxSteps ? maxSteps : n;
}

/* ─── Critically damped spring ───────────────────────────────────────────── */

/** Position and velocity of a 2-D spring-driven point. */
export interface Spring2 {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * Advance a critically damped spring   ẍ = −ω²·(x − x*) − 2ω·ẋ   toward a
 * fixed target x* by dt. With e = x − x* the equation has the exact solution
 *   e(t) = (e₀ + (v₀ + ω·e₀)·t)·e^{−ωt}
 *   ẋ(t) = (v₀ − ω·(v₀ + ω·e₀)·t)·e^{−ωt}
 * which we evaluate directly: no oscillation, and stable at any frame rate.
 */
export function springStep(s: Spring2, tx: number, ty: number, omega: number, dt: number): void {
  if (!(dt > 0)) return;
  const decay = Math.exp(-omega * dt);
  const ex = s.x - tx;
  const ey = s.y - ty;
  const bx = s.vx + omega * ex;
  const by = s.vy + omega * ey;
  s.x = tx + (ex + bx * dt) * decay;
  s.y = ty + (ey + by * dt) * decay;
  s.vx = (s.vx - omega * bx * dt) * decay;
  s.vy = (s.vy - omega * by * dt) * decay;
}
