/// <reference types="node" />
// Visual harness: server-renders the equation card and THE MATH
// drawer for each experiment to static HTML in the scratchpad, for screenshot review.
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it } from 'vitest';
import type { ExperimentId, ProbeReadout } from '../../../engine/types';
import { useGlyphStore } from '../../../state/store';
import { INITIAL_STATS, useLiveStore } from '../../../state/live';
import EquationCard from '../../EquationCard';
import MathDrawer from '../../MathDrawer';

const OUT = join(tmpdir(), 'glyphfield-visual-harness');
mkdirSync(OUT, { recursive: true });

const PROBES: Record<ExperimentId, ProbeReadout> = {
  waves: {
    heading: 'AT CURSOR',
    rows: [
      { label: 'x', value: '0.214' },
      { label: 'y', value: '-0.301' },
      { label: 't', value: '12.43 s' },
      { label: 'f', value: '0.842', tone: 'mint' },
      { label: 'n', value: '0.754' },
      { label: 'glyph', value: '#' },
    ],
    value: 0.842,
    valueLabel: 'f(x,y,t)',
    intensity: 0.754,
    glyph: '#',
    vars: { t: 12.43 },
  },
  attractor: {
    heading: 'PARTICLE #0417',
    rows: [
      { label: 'p', value: '(0.41, −0.12)' },
      { label: 'F(p)', value: '(−0.83, 1.02)' },
      { label: '|F|', value: '1.315' },
      { label: 'steps', value: '18,204' },
    ],
    value: 1.315,
    valueLabel: '|F|',
    intensity: 0.41,
    glyph: '/',
    vars: { ax: 0.12, ay: -0.3, t: 8.2 },
  },
  topology: {
    heading: 'SURFACE',
    rows: [
      { label: 'yaw', value: '41°' },
      { label: 'pitch', value: '−18°' },
      { label: 'samples', value: '23,040' },
    ],
    value: 0.63,
    valueLabel: 'N·L',
    intensity: 0.72,
    glyph: '*',
    facts: [{ label: 'SIDES', value: '1' }],
  },
};

describe('visual harness', () => {
  for (const mode of ['waves', 'attractor', 'topology'] as const) {
    it(`renders ${mode}`, () => {
      // zustand serves getInitialState() to server renders: seed it directly
      Object.assign(useGlyphStore.getInitialState(), { mode, mathOpen: true });
      Object.assign(useLiveStore.getInitialState(), {
        stats: { ...INITIAL_STATS, mode, ready: true, cols: 230, rows: 65 },
        probe: PROBES[mode],
      });
      const card = renderToStaticMarkup(<EquationCard />);
      const drawer = renderToStaticMarkup(<MathDrawer />);
      writeFileSync(`${OUT}/ssr-${mode}-card.html`, card);
      writeFileSync(`${OUT}/ssr-${mode}-drawer.html`, drawer);
    });
  }
  it('renders variants', () => {
    Object.assign(useGlyphStore.getInitialState(), {
      mode: 'waves',
      params: {
        ...useGlyphStore.getInitialState().params,
        waves: { ...useGlyphStore.getInitialState().params.waves, second: false, angle: 170 },
        attractor: { ...useGlyphStore.getInitialState().params.attractor, swirl: 0 },
        topology: { ...useGlyphStore.getInitialState().params.topology, twists: 0 },
      },
    });
    for (const mode of ['waves', 'attractor', 'topology'] as const) {
      Object.assign(useGlyphStore.getInitialState(), { mode });
      Object.assign(useLiveStore.getInitialState(), { stats: { ...INITIAL_STATS, mode, ready: true }, probe: PROBES[mode] });
      writeFileSync(`${OUT}/ssr-${mode}-card-variant.html`, renderToStaticMarkup(<EquationCard />));
    }
  });
});
