import { memo, useMemo, type ReactNode } from 'react';
import type { ExperimentId } from '../../engine/types';
import { deriveWaveConstants, NORMALIZE_SCALE, WAVE1_HEADING_DEG } from '../../math/waves';
import { deriveFieldConstants, spiralRate, V_MAX } from '../../math/vectorField';
import { deriveBandConstants } from '../../math/mobius';
import { useGlyphStore } from '../../state/store';
import { useLiveStore } from '../../state/live';
import type { ValueKey } from '../../content/explanations';
import { Num, Unit } from './Eq';
import { DASH, MINUS, fmt, laneSpacing, lapTurnText, spiralPitchDeg, wavePeriod, wavelength } from './format';
import { ProbeVar, ProbeVector } from './live';
import { InlineMath } from './MathText';
import { paramText } from './params';

/* ═══════════════════════════════════════════════════════════════════════════
 *  Live values for THE MATH drawer: the variables table (02) and the {slots}
 *  of the copy. Every number comes from the same derive*() functions the
 *  experiments run, so the label always shows what the simulation computes.
 *  The record types are keyed by VALUE_KEYS, so a missing value is a type error.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** A live number (mint) that flashes when one of its parameters changes. */
function live(mode: ExperimentId, text: string, keys: readonly string[], unit?: string): ReactNode {
  return (
    <>
      <Num keys={keys} mode={mode}>
        {text}
      </Num>
      {unit && <Unit>{unit}</Unit>}
    </>
  );
}

/** A fixed number (ink). */
function constant(text: string, unit?: string): ReactNode {
  return (
    <>
      <Num>{text}</Num>
      {unit && <Unit>{unit}</Unit>}
    </>
  );
}

/** A value that does not exist for the current parameters (e.g. g/s when s = 0). */
function none(reason: string): ReactNode {
  return (
    <>
      <span className="text-muted">{DASH}</span>
      <span className="ml-[0.5em] font-sans text-[0.92em] text-muted">{reason}</span>
    </>
  );
}

/** "|F| = 1.234" — the probe's own label and value, dashed while the probe belongs to another experiment. */
const ProbeReading = memo(function ProbeReading({ mode, decimals }: { mode: ExperimentId; decimals: number }) {
  const label = useLiveStore((s) => (s.stats.mode === mode && !s.stats.transitioning ? s.probe?.valueLabel : undefined));
  const value = useLiveStore((s) => (s.stats.mode === mode && !s.stats.transitioning ? s.probe?.value : undefined));
  if (value === undefined) return <span className="text-muted">{DASH}</span>;
  return (
    <span className="whitespace-nowrap">
      {label && (
        <span className="mr-[0.4em] text-muted">
          <InlineMath src={label} /> =
        </span>
      )}
      <span className="tabular text-mint">{fmt(value, decimals)}</span>
    </span>
  );
});

const A_KEYS = ['amplitude'];
const K_KEYS = ['frequency'];
const W_KEYS = ['speed', 'frequency'];

function useWaveValues(): Record<ValueKey<'waves'>, ReactNode> {
  const params = useGlyphStore((s) => s.params.waves);
  return useMemo(() => {
    const m = 'waves';
    const wc = deriveWaveConstants(params);
    const lanes = wc.second ? laneSpacing(wc.k, wc.thetaDeg) : Infinity;
    const period = wavePeriod(wc.omega1);
    return {
      f: <ProbeReading mode={m} decimals={3} />,
      A: (
        <>
          {live(m, fmt(wc.A1, 2), A_KEYS)}
          {!wc.second && (
            <span className="ml-[0.6em] text-muted">
              <InlineMath src="A_2 = 0" />
            </span>
          )}
        </>
      ),
      k: live(m, paramText(m, 'frequency', wc.k), K_KEYS, 'rad/u'),
      lambda: live(m, fmt(wavelength(wc.k), 2), K_KEYS, 'u'),
      c: live(m, paramText(m, 'speed', wc.c), ['speed'], 'u/s'),
      omega: live(m, fmt(wc.omega1, 2), W_KEYS, 'rad/s'),
      theta: live(m, `${paramText(m, 'angle', wc.thetaDeg)}°`, ['angle']),
      phi: (
        <>
          {constant(`${fmt(wc.phi1Deg, 0)}°`)}
          <span className="mr-[0.3em] text-muted">,</span>
          {live(m, `${fmt(wc.phi2Deg, 0)}°`, ['angle'])}
        </>
      ),
      phi1: constant(`${fmt(WAVE1_HEADING_DEG, 0)}°`),
      t: <ProbeVar name="t" decimals={2} unit=" s" />,
      B: live(m, paramText(m, 'disturb', wc.B), ['disturb']),
      lanes: Number.isFinite(lanes)
        ? live(m, fmt(lanes, 2), ['frequency', 'angle', 'second'], 'u')
        : none(wc.second ? 'parallel waves: no lanes' : 'one wave: no lanes'),
      period: Number.isFinite(period) ? live(m, fmt(period, 2), W_KEYS, 's') : none('frozen: c = 0'),
      F0: constant(fmt(NORMALIZE_SCALE, 1)),
    };
  }, [params]);
}

const SG_KEYS = ['strength', 'swirl'];

function useAttractorValues(): Record<ValueKey<'attractor'>, ReactNode> {
  const params = useGlyphStore((s) => s.params.attractor);
  return useMemo(() => {
    const m = 'attractor';
    const fc = deriveFieldConstants(params);
    const ratio = spiralRate(fc);
    const pitch = spiralPitchDeg(fc.s, fc.g);
    return {
      F: <ProbeReading mode={m} decimals={3} />,
      a: (
        <span className="font-mono">
          <ProbeVector x="ax" y="ay" />
        </span>
      ),
      s: live(m, paramText(m, 'swirl', fc.s), ['swirl']),
      g: live(m, paramText(m, 'strength', fc.g), ['strength']),
      eps: live(m, paramText(m, 'softening', fc.eps), ['softening']),
      ratio: Number.isFinite(ratio) ? live(m, fmt(ratio, 2), SG_KEYS) : none('s = 0: straight inflow'),
      pitch: Number.isFinite(pitch) ? live(m, `${fmt(pitch, 1)}°`, SG_KEYS) : none('no flow'),
      vmax: constant(fmt(V_MAX, 1), 'u/s'),
      N: live(m, paramText(m, 'count', fc.N), ['count']),
      core: live(m, fmt(Math.sqrt(fc.eps), 3), ['softening'], 'u'),
    };
  }, [params]);
}

function useTopologyValues(): Record<ValueKey<'topology'>, ReactNode> {
  const params = useGlyphStore((s) => s.params.topology);
  return useMemo(() => {
    const m = 'topology';
    const bc = deriveBandConstants(params);
    const w = fmt(bc.w, 2);
    return {
      u: (
        <span className="text-ink/80">
          <InlineMath src="[0, 2π)" />
        </span>
      ),
      v: (
        <span className="whitespace-nowrap font-mono">
          [
          <Num keys={['width']} mode={m}>
            {MINUS + w}
          </Num>
          <span className="mr-[0.24em]">,</span>
          <Num keys={['width']} mode={m}>
            {w}
          </Num>
          ]
        </span>
      ),
      R: constant(fmt(bc.R, 0)),
      w: live(m, paramText(m, 'width', bc.w), ['width']),
      n: live(m, paramText(m, 'twists', bc.n), ['twists']),
      turn: live(m, lapTurnText(bc.n), ['twists'], 'per lap'),
      chi: constant(String(bc.euler)),
      edge: live(m, bc.edgeName, ['twists']),
    };
  }, [params]);
}

/** All live values of `mode` (the three hooks always run, so hook order never changes). */
export function useExperimentValues(mode: ExperimentId): Readonly<Record<string, ReactNode>> {
  const waves = useWaveValues();
  const attractor = useAttractorValues();
  const topology = useTopologyValues();
  return mode === 'waves' ? waves : mode === 'attractor' ? attractor : topology;
}
