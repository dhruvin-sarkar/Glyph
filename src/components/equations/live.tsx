import { memo } from 'react';
import type { ExperimentId, ProbeReadout } from '../../engine/types';
import { useLiveStore } from '../../state/live';
import { cx } from '../ui/primitives';
import { Sym } from './Eq';
import { DASH, fmt } from './format';
import { InlineMath } from './MathText';

/* ═══════════════════════════════════════════════════════════════════════════
 *  Live readouts driven by the engine probe (~8 Hz). Each component selects
 *  the narrowest slice it needs, so a probe tick re-renders only these leaves —
 *  never the typeset equations around them.
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The probe, plus whether it belongs to `mode`. Right after a switch the engine
 * may still report the previous experiment (stats arrive at ~4 Hz and the
 * scramble transition takes ~1 s); such a probe is `stale` and is shown dimmed.
 */
export function useProbeFor(mode: ExperimentId): { probe: ProbeReadout | null; stale: boolean } {
  const probe = useLiveStore((s) => s.probe);
  const stale = useLiveStore((s) => s.stats.mode !== mode || s.stats.transitioning);
  return { probe, stale };
}

/** One named probe variable, e.g. t (seconds) — mint, tabular. */
export const ProbeVar = memo(function ProbeVar({ name, decimals = 2, unit }: { name: string; decimals?: number; unit?: string }) {
  const v = useLiveStore((s) => s.probe?.vars?.[name]);
  return (
    <span className="tabular text-mint not-italic">
      {v === undefined ? DASH : fmt(v, decimals)}
      {unit && v !== undefined ? <span className="text-muted">{unit}</span> : null}
    </span>
  );
});

/** A probe vector "(x, y)" from two named variables, e.g. the attractor position (ax, ay). */
export const ProbeVector = memo(function ProbeVector({ x, y, decimals = 2 }: { x: string; y: string; decimals?: number }) {
  const vx = useLiveStore((s) => s.probe?.vars?.[x]);
  const vy = useLiveStore((s) => s.probe?.vars?.[y]);
  const has = vx !== undefined && vy !== undefined;
  return (
    <span className="not-italic">
      (
      <span className="tabular text-mint">{has ? fmt(vx, decimals) : DASH}</span>
      <span className="mr-[0.24em]">,</span>
      <span className="tabular text-mint">{has ? fmt(vy, decimals) : DASH}</span>)
    </span>
  );
});

/** The probe's computed value (f, |F|, N·L …) for `mode`, or a dash while stale. */
export const ProbeValue = memo(function ProbeValue({ mode, decimals = 3 }: { mode: ExperimentId; decimals?: number }) {
  const v = useLiveStore((s) => (s.stats.mode === mode && !s.stats.transitioning ? s.probe?.value : undefined));
  return <span className="tabular text-mint not-italic">{v === undefined ? DASH : fmt(v, decimals)}</span>;
});

/* ─── EQUATION → VALUE → INTENSITY → GLYPH ───────────────────────────────── */

function Connector() {
  return (
    <span aria-hidden="true" className="gf-pipeline-connector">
      <Sym name="arrow" className="mx-0 h-[9px] w-[13px]" />
    </span>
  );
}

function Caption({ children }: { children: string }) {
  return <span className="gf-pipeline-caption">{children}</span>;
}

export interface PipelineStripProps {
  mode?: ExperimentId;
  probe: ProbeReadout | null;
  stale: boolean;
  /** symbol for the normalised intensity, e.g. "n" */
  intensitySymbol: string;
  className?: string;
}

/**
 * The bridge from mathematics to typography at one cell: the expression that
 * was evaluated, its value, the normalised intensity, and the glyph drawn.
 */
export const PipelineStrip = memo(function PipelineStrip({ mode, probe, stale, intensitySymbol, className }: PipelineStripProps) {
  const p = stale ? null : probe;
  const value = p?.value;
  const intensity = p?.intensity;
  const glyph = p?.glyph;
  const blank = glyph === undefined || glyph === '' || glyph === ' ';
  const pct = intensity === undefined ? 0 : Math.round(Math.min(1, Math.max(0, intensity)) * 100);
  const mapping = mode === 'attractor'
    ? 'Speed sets the light level. Direction chooses the stroke.'
    : mode === 'topology'
      ? 'Light, depth and edge highlighting shape the character.'
      : 'Wave height is normalised, then shaped into light and ink.';

  return (
    <div
      className={cx(
        'gf-pipeline',
        'transition-opacity duration-300',
        stale && 'opacity-50',
        className,
      )}
      aria-label="From equation to glyph at the probe"
      role="group"
    >
      <div className="gf-pipeline-steps">
        <div className="gf-pipeline-cell">
          <Caption>Sample value</Caption>
          <span className="gf-pipeline-number tabular">{value === undefined ? DASH : fmt(value, 3)}</span>
          <span className="gf-pipeline-detail">{p?.valueLabel ? <InlineMath src={p.valueLabel} /> : 'No sample'}</span>
        </div>
        <Connector />
        <div className="gf-pipeline-cell">
          <Caption>Normalised</Caption>
          <span className="gf-pipeline-number tabular">{intensity === undefined ? DASH : fmt(intensity, 2)}</span>
          <span className="gf-pipeline-detail"><i>{intensitySymbol}</i> · 0 to 1</span>
          <span aria-hidden="true" className="gf-pipeline-meter"><span style={{ width: `${pct}%` }} /></span>
        </div>
        <Connector />
        <div className="gf-pipeline-cell gf-pipeline-glyph">
          <Caption>Character</Caption>
          <span className={cx('gf-pipeline-character', !blank && 'text-mint')}>
            {!p || glyph === undefined ? <><span aria-hidden="true">{DASH}</span><span className="sr-only">No sample</span></> : blank ? (
              <><span aria-hidden="true" className="gf-glyph-space" /><span className="sr-only">space</span></>
            ) : glyph}
          </span>
          <span className="gf-pipeline-detail">{!p || glyph === undefined ? 'No sample' : blank ? 'Space' : 'On the field'}</span>
        </div>
      </div>
      <p className="gf-pipeline-note">{mapping}</p>
    </div>
  );
});
