import { describe, expect, it } from 'vitest';
import {
  TOUR_IDLE_MS,
  TOUR_MAX_TICK_MS,
  TOUR_STEP_MS,
  createTourClock,
  noteActivity,
  pickPreset,
  tickTourClock,
  tourValues,
} from '../tour';

/** Tick the clock in 250 ms slices and collect the signals it emits. */
function run(ms: number, touring: () => boolean, clock = createTourClock()): string[] {
  const signals: string[] = [];
  for (let t = 0; t < ms; t += 250) {
    const s = tickTourClock(clock, 250, touring());
    if (s !== 'none') signals.push(s);
  }
  return signals;
}

describe('tour clock', () => {
  it('starts after 90 s without input, not before', () => {
    const clock = createTourClock();
    expect(run(TOUR_IDLE_MS - 250, () => false, clock)).toEqual([]);
    expect(tickTourClock(clock, 250, false)).toBe('start');
  });

  it('steps every 25 s while touring', () => {
    expect(run(TOUR_STEP_MS * 3, () => true)).toEqual(['step', 'step', 'step']);
  });

  it('restarts the idle countdown on activity', () => {
    const clock = createTourClock();
    run(TOUR_IDLE_MS - 1000, () => false, clock);
    noteActivity(clock);
    expect(run(TOUR_IDLE_MS - 1000, () => false, clock)).toEqual([]);
  });

  it('never jumps ahead after a long pause (sleep, hidden tab)', () => {
    const clock = createTourClock();
    expect(tickTourClock(clock, 10 * 60_000, false)).toBe('none');
    expect(clock.idleMs).toBe(TOUR_MAX_TICK_MS);
    expect(tickTourClock(clock, Number.NaN, false)).toBe('none');
    expect(tickTourClock(clock, -500, false)).toBe('none');
    expect(clock.idleMs).toBe(TOUR_MAX_TICK_MS);
  });
});

describe('preset rotation', () => {
  it('cycles deterministically and handles empty lists', () => {
    const list = ['a', 'b', 'c'];
    expect([0, 1, 2, 3, 4].map((k) => pickPreset(list, k))).toEqual(['a', 'b', 'c', 'a', 'b']);
    expect(pickPreset([], 3)).toBeNull();
  });

  it('merges a preset over the curated defaults', () => {
    const defaults = { amplitude: 1, frequency: 9, second: true };
    expect(tourValues(defaults, { values: { frequency: 14, second: undefined } })).toEqual({
      amplitude: 1,
      frequency: 14,
      second: true,
    });
    expect(tourValues(defaults, null)).toEqual(defaults);
  });
});
