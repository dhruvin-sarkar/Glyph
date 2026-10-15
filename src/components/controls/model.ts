import type { ExperimentId, ParamDef, RangeParam } from '../../engine/types';

/* ═══════════════════════════════════════════════════════════════════════════
 *  Pure helpers behind the parameter instrument (no DOM, unit-tested).
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Position t ∈ [0, 1] of `value` along [min, max] (clamped; 0 for a degenerate range). */
export function rangeFraction(value: number, min: number, max: number): number {
  if (!(max > min) || !Number.isFinite(value)) return 0;
  const t = (value - min) / (max - min);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * The lit (mint) part of a slider track, as fractions [from, to] of its length.
 *
 * An ordinary slider lights from its minimum up to the value. A *bipolar* slider —
 * one whose range straddles zero, like the swirl s ∈ [−1.5, 1.5] — lights from ZERO
 * to the value instead, so the sign is visible: negative values grow leftwards
 * from the zero point, positive values rightwards.
 */
export function fillSpan(value: number, min: number, max: number): [number, number] {
  const t = rangeFraction(value, min, max);
  if (min < 0 && max > 0) {
    const zero = rangeFraction(0, min, max);
    return t < zero ? [t, zero] : [zero, t];
  }
  return [0, t];
}

/** Every allowed value of a stepped integer parameter, e.g. 0…7 half-twists. */
export function stepValues(def: Pick<RangeParam, 'min' | 'max' | 'step'>): number[] {
  const step = def.step > 0 ? def.step : 1;
  // + 1e-9 absorbs floating-point dust such as (0.3 − 0) / 0.1 = 2.9999999999999996
  const count = Math.floor((def.max - def.min) / step + 1e-9);
  const out: number[] = [];
  for (let i = 0; i <= count && i < 64; i++) out.push(Number((def.min + i * step).toFixed(6)));
  return out;
}

/** Units that hug their number (70°, 1.20×, 100%); every other unit is set after a gap (0.35 u/s). */
export function unitHugs(unit: string): boolean {
  return unit === '°' || unit === '×' || unit === '%';
}

/** Screen-reader text for a value: "70°", "0.35 u/s", "−0.65". */
export function valueText(formatted: string, unit?: string): string {
  if (!unit) return formatted;
  return unitHugs(unit) ? `${formatted}${unit}` : `${formatted} ${unit}`;
}

/* ─── Panel grouping ─────────────────────────────────────────────────────── */

/**
 * Which panel group a parameter lives in. The equation group holds the variables
 * that appear in the experiment's equation (A, k, c, θ, B · g, s, N, ε · n, w).
 * The display group holds toggles, selects, and ranges that only change how the
 * result is shown (glyph density, spin rate).
 */
export type ParamGroup = 'equation' | 'display';

const DISPLAY_RANGES: ReadonlySet<string> = new Set(['topology.density', 'topology.spin']);

export function paramGroup(mode: ExperimentId, def: ParamDef): ParamGroup {
  if (def.kind !== 'range') return 'display';
  return DISPLAY_RANGES.has(`${mode}.${def.id}`) ? 'display' : 'equation';
}

/** Split an experiment's parameters into the two panel groups, keeping schema order. */
export function splitParams(
  mode: ExperimentId,
  defs: readonly ParamDef[],
): { equation: ParamDef[]; display: ParamDef[] } {
  const equation: ParamDef[] = [];
  const display: ParamDef[] = [];
  for (const def of defs) (paramGroup(mode, def) === 'equation' ? equation : display).push(def);
  return { equation, display };
}

/** Percentage string for a CSS custom property (rounded to keep inline styles tidy). */
export function pct(t: number): string {
  return `${Math.round(t * 100000) / 1000}%`;
}
