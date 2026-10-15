import { useEffect } from 'react';
import type { ExperimentId } from '../engine/types';
import { PRESETS } from '../content/presets';
import { defaultParams } from '../experiments/registry';
import { useGlyphStore } from '../state/store';
import {
  TOUR_TICK_MS,
  createTourClock,
  noteActivity,
  pickPreset,
  tickTourClock,
  tourValues,
} from './controls/tour';

/** Pointer travel (CSS px) that counts as a visitor — filters synthetic and sub-pixel moves. */
const MOVE_THRESHOLD_PX = 3;

/**
 * Exhibition attract mode (SPEC §8). Renders nothing.
 * After 90 s without input: close the overlays, un-pause and start touring —
 * every 25 s the next experiment, with the next of its presets (applied over
 * the curated defaults). Any input ends the tour at once and leaves the
 * parameters where they are. The clock only runs while the page is visible.
 */
export default function AutoTour() {
  useEffect(() => {
    const clock = createTourClock();
    const visits: Record<ExperimentId, number> = { waves: 0, attractor: 0, topology: 0 };
    let last = performance.now();
    let lastX = Number.NaN;
    let lastY = Number.NaN;

    const onActivity = () => {
      noteActivity(clock);
      const s = useGlyphStore.getState();
      if (s.touring) s.setTouring(false);
    };

    const onPointerMove = (e: PointerEvent) => {
      // NaN on the first event makes the comparison false, so it always counts.
      if (Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY) < MOVE_THRESHOLD_PX) return;
      lastX = e.clientX;
      lastY = e.clientY;
      onActivity();
    };

    const begin = () => {
      const s = useGlyphStore.getState();
      s.setShortcutsOpen(false);
      s.setMathOpen(false);
      s.setPaused(false);
      s.setTouring(true);
    };

    const advance = () => {
      const s = useGlyphStore.getState();
      s.cycleMode(1);
      const mode = useGlyphStore.getState().mode;
      const preset = pickPreset(PRESETS[mode] ?? [], visits[mode]);
      visits[mode] += 1;
      s.applyPreset(mode, tourValues(defaultParams(mode), preset));
    };

    const tick = () => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      if (document.hidden) return; // hidden tab: the tour clock stands still
      const signal = tickTourClock(clock, dt, useGlyphStore.getState().touring);
      if (signal === 'start') begin();
      else if (signal === 'step') advance();
    };

    // Coming back to a visible page must not count the hidden time.
    const onVisibility = () => {
      last = performance.now();
    };

    const options: AddEventListenerOptions = { capture: true, passive: true };
    window.addEventListener('pointermove', onPointerMove, options);
    window.addEventListener('pointerdown', onActivity, options);
    window.addEventListener('keydown', onActivity, options);
    window.addEventListener('wheel', onActivity, options);
    window.addEventListener('touchstart', onActivity, options);
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(tick, TOUR_TICK_MS);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pointermove', onPointerMove, options);
      window.removeEventListener('pointerdown', onActivity, options);
      window.removeEventListener('keydown', onActivity, options);
      window.removeEventListener('wheel', onActivity, options);
      window.removeEventListener('touchstart', onActivity, options);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return null;
}
