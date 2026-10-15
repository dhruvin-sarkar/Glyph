import type { ExperimentId, ParamValues } from '../engine/types';

/* "Try this" presets (THE MATH drawer, section 04) — also used by the auto tour.
 * CONTRACT: keep this shape — AutoTour imports PRESETS.
 *
 * Presets are merged into the current parameters (useGlyphStore.applyPreset),
 * so each one sets every value its effect depends on: "Standing wave" turns the
 * second wave back on, "Pure vortex" restores a swirl after "Pure sink" zeroed it.
 * Labels and descriptions are plain text (no maths markup). */
export interface Preset {
  id: string;
  /** short uppercase-able label, e.g. "Standing wave" */
  label: string;
  /** one sentence: what to notice */
  description: string;
  /** values to merge via useGlyphStore.applyPreset (ids must exist in the experiment's params) */
  values: Partial<ParamValues>;
}

export const PRESETS: Record<ExperimentId, Preset[]> = {
  waves: [
    {
      id: 'standing-wave',
      label: 'Standing wave',
      description: 'Notice the nodes: the waves meet head-on, so the pattern breathes in place instead of travelling.',
      values: { angle: 180, second: true },
    },
    {
      id: 'single-wave',
      label: 'Single wave',
      description: 'Notice the plain sine wave: with the second wave off, only parallel crests remain.',
      values: { second: false },
    },
    {
      id: 'beats',
      label: 'Beats',
      description: 'Notice the broad calm lanes: two almost-parallel waves drift in and out of step.',
      values: { angle: 8, frequency: 18, second: true },
    },
    {
      id: 'storm',
      label: 'Storm',
      description: 'Notice the contrast: a big amplitude drives crests to the densest glyphs and troughs to blank.',
      values: { amplitude: 1.8, frequency: 14, speed: 0.6 },
    },
    {
      id: 'calm-sea',
      label: 'Calm sea',
      description: 'Notice the soft contrast: a small amplitude keeps every cell in the middle of the ramp.',
      values: { amplitude: 0.45, frequency: 6, speed: 0.2 },
    },
    {
      id: 'lattice',
      label: 'Lattice',
      description: 'Notice the grid: seen from above, waves crossing at 90 degrees weave a moving checkerboard.',
      values: { view: 'plane', angle: 90, second: true },
    },
  ],
  attractor: [
    {
      id: 'pure-vortex',
      label: 'Pure vortex',
      description: 'Notice the orbits: with no inward pull, every particle circles forever.',
      values: { strength: 0, swirl: 0.65 },
    },
    {
      id: 'pure-sink',
      label: 'Pure sink',
      description: 'Notice the straight inflow: with no swirl, every path points at the core.',
      values: { swirl: 0, strength: 0.6 },
    },
    {
      id: 'galaxy',
      label: 'Galaxy',
      description: 'Notice the many-turned arms: a small pull against a strong swirl winds long logarithmic spirals.',
      values: { strength: 0.12, swirl: 1.1 },
    },
    {
      id: 'reverse-spin',
      label: 'Reverse spin',
      description: 'Notice the flip: a negative swirl turns the whole flow clockwise.',
      values: { swirl: -0.65 },
    },
    {
      id: 'wide-core',
      label: 'Wide core',
      description: 'Notice the calm eye: a larger softening more than doubles the radius of the core.',
      values: { softening: 0.04 },
    },
    {
      id: 'show-field',
      label: 'Show the field',
      description: 'Notice the arrows: the field is defined everywhere, not just where particles happen to be.',
      values: { field: true },
    },
  ],
  topology: [
    {
      id: 'ordinary-band',
      label: 'Ordinary band',
      description: 'Notice two sides and two separate edges: an ordinary, orientable ring.',
      values: { twists: 0 },
    },
    {
      id: 'mobius-strip',
      label: 'Möbius strip',
      description: 'Notice the single edge: follow it and you travel around the loop twice.',
      values: { twists: 1 },
    },
    {
      id: 'full-twist',
      label: 'Full twist',
      description: 'Notice it is two-sided again, and its two edges are now linked like a chain.',
      values: { twists: 2 },
    },
    {
      id: 'trefoil-edge',
      label: 'Trefoil edge',
      description: 'Notice the edge: three half-twists tie the boundary into a trefoil knot.',
      values: { twists: 3, edges: true },
    },
    {
      id: 'paint-test',
      label: 'Paint test',
      description: 'Notice the seam: the colours swap where the strip meets itself, because there is no back.',
      values: { twists: 1, sides: true },
    },
    {
      id: 'wide-ribbon',
      label: 'Wide ribbon',
      description: 'Notice that only the shape changes: same sides, same edges, same knot.',
      values: { width: 0.8 },
    },
  ],
};
