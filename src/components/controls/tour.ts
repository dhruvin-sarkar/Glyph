import type { ParamValue, ParamValues } from '../../engine/types';

/* ═══════════════════════════════════════════════════════════════════════════
 *  Exhibition auto-tour (docs/SPEC.md §8) — the pure clock and preset logic.
 *  AutoTour.tsx feeds it wall time and turns its signals into store actions.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** No input for this long starts the tour. */
export const TOUR_IDLE_MS = 90_000;
/** Time spent on each experiment while touring. */
export const TOUR_STEP_MS = 25_000;
/** How often the clock is ticked. */
export const TOUR_TICK_MS = 250;
/** The most a single tick may count — a laptop waking from sleep must not skip ahead. */
export const TOUR_MAX_TICK_MS = 1_000;

export interface TourClock {
  /** visible time without input, while not touring */
  idleMs: number;
  /** visible time on the current tour stop, while touring */
  stepMs: number;
}

export type TourSignal = 'none' | 'start' | 'step';

export function createTourClock(): TourClock {
  return { idleMs: 0, stepMs: 0 };
}

/** Any visitor input: both clocks start again from zero. */
export function noteActivity(clock: TourClock): void {
  clock.idleMs = 0;
  clock.stepMs = 0;
}

/**
 * Advance the clock by `dtMs` of *visible* wall time (the caller skips hidden
 * tabs) and say what the tour should do now:
 *   'start' — the idle threshold was crossed: begin touring;
 *   'step'  — the current stop has had its time: move to the next experiment.
 */
export function tickTourClock(clock: TourClock, dtMs: number, touring: boolean): TourSignal {
  const dt = Math.min(Math.max(Number.isFinite(dtMs) ? dtMs : 0, 0), TOUR_MAX_TICK_MS);
  if (!touring) {
    clock.stepMs = 0;
    clock.idleMs += dt;
    if (clock.idleMs >= TOUR_IDLE_MS) {
      clock.idleMs = 0;
      return 'start';
    }
    return 'none';
  }
  clock.idleMs = 0;
  clock.stepMs += dt;
  if (clock.stepMs >= TOUR_STEP_MS) {
    clock.stepMs = 0;
    return 'step';
  }
  return 'none';
}

/** Deterministic rotation: the k-th tour visit to an experiment shows preset k mod n. */
export function pickPreset<T>(presets: readonly T[], visit: number): T | null {
  const n = presets.length;
  if (n === 0) return null;
  const k = Math.floor(Number.isFinite(visit) ? visit : 0);
  return presets[((k % n) + n) % n];
}

/**
 * The values applied at a tour stop: the experiment's curated defaults with the
 * preset merged on top. Starting from the defaults means a stop always looks the
 * way the preset was designed, whatever the last visitor left behind; with no
 * preset available the stop simply shows the defaults.
 */
export function tourValues(
  defaults: Readonly<ParamValues>,
  preset: { values: Partial<ParamValues> } | null,
): ParamValues {
  const out: ParamValues = { ...defaults };
  if (!preset) return out;
  for (const [key, value] of Object.entries(preset.values) as Array<[string, ParamValue | undefined]>) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}
