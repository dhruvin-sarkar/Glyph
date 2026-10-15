import { memo, useEffect, useState } from 'react';
import { measureGlyphCoverage } from '../../engine/GlyphRamp';
import { useLiveStore } from '../../state/live';
import { cx } from '../ui/primitives';
import { Sym } from './Eq';

/* ═══════════════════════════════════════════════════════════════════════════
 *  The calibrated ramp, made visible: every candidate character is rasterised
 *  (measureGlyphCoverage — the engine's own measurement), its ink counted, and
 *  the ramp sorted by that measured coverage. If measuring is impossible the
 *  nominal order is shown instead, and says so.
 * ═══════════════════════════════════════════════════════════════════════════ */

interface RampItem {
  ch: string;
  /** measured ink coverage, 0..1 (densest = 1) */
  coverage: number;
  /** position in the hand-written (nominal) ramp */
  nominal: number;
}

interface Calibration {
  items: RampItem[];
  measured: boolean;
}

/** Measurement size — large enough for a precise pixel count, cell proportions like the field's. */
const MEASURE_PX = 32;
const calibrations = new Map<string, Calibration>();

function nominalOrder(ramp: string): Calibration {
  const last = Math.max(1, ramp.length - 1);
  return { items: Array.from(ramp, (ch, i) => ({ ch, coverage: ch === ' ' ? 0 : i / last, nominal: i })), measured: false };
}

function calibrate(ramp: string): Calibration {
  try {
    const cov = measureGlyphCoverage(ramp, MEASURE_PX, Math.round(MEASURE_PX * 0.6), Math.round(MEASURE_PX * 1.2));
    if (cov.length !== ramp.length) return nominalOrder(ramp);
    let max = 0;
    for (const c of cov) {
      if (!Number.isFinite(c) || c < 0) return nominalOrder(ramp);
      if (c > max) max = c;
    }
    if (max <= 0) return nominalOrder(ramp);
    const items = Array.from(ramp, (ch, i) => ({ ch, coverage: cov[i] / max, nominal: i }));
    items.sort((a, b) => a.coverage - b.coverage || a.nominal - b.nominal);
    return { items, measured: true };
  } catch {
    return nominalOrder(ramp);
  }
}

function SpaceMark({ className }: { className?: string }) {
  return (
    <>
      <span aria-hidden="true" className={cx('inline-block h-[0.6em] w-[0.6em] rounded-[2px] border border-dashed border-faint', className)} />
      <span className="sr-only">space</span>
    </>
  );
}

export const RampCalibration = memo(function RampCalibration({ ramp, name }: { ramp: string; name: string }) {
  const [, setVersion] = useState(0);

  useEffect(() => {
    if (calibrations.has(ramp)) return;
    let alive = true;
    const run = (): void => {
      if (!alive) return;
      calibrations.set(ramp, calibrate(ramp));
      setVersion((v) => v + 1);
    };
    // measure with the exhibit font, not a fallback
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (fonts && typeof fonts.load === 'function') fonts.load(`500 ${MEASURE_PX}px "JetBrains Mono"`).then(run, run);
    else run();
    return () => {
      alive = false;
    };
  }, [ramp]);

  // the glyph currently drawn at the probe lights up on the ramp
  const probeGlyph = useLiveStore((s) => s.probe?.glyph);
  const cal = calibrations.get(ramp);
  const { items, measured } = cal ?? nominalOrder(ramp);
  const reordered = measured && items.some((it, i) => it.nominal !== i);

  return (
    <figure className={cx('transition-opacity duration-500', cal ? 'opacity-100' : 'opacity-40')}>
      <figcaption className="mb-3 flex items-baseline justify-between gap-3">
        <span className="micro text-muted">{name}</span>
        <span className="micro text-faint">{measured ? 'MEASURED IN THIS BROWSER' : 'NOMINAL ORDER'}</span>
      </figcaption>

      <ul className="flex items-end gap-[3px]" aria-label="Characters sorted by measured ink coverage">
        {items.map((it) => {
          const active = probeGlyph !== undefined && probeGlyph === it.ch && it.ch !== ' ';
          const pct = Math.round(it.coverage * 100);
          return (
            <li key={it.nominal} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <div className="relative h-12 w-full max-w-[24px] overflow-hidden rounded-[3px] bg-white/[0.04]">
                <div
                  className={cx('absolute inset-x-0 bottom-0 rounded-[3px] transition-colors duration-200', active ? 'bg-mint' : 'bg-ink/45')}
                  style={{ height: `${it.ch === ' ' ? 0 : Math.max(3, pct)}%` }}
                />
              </div>
              <div
                className={cx(
                  'grid h-8 w-full max-w-[30px] place-items-center rounded-[7px] border font-mono text-[17px] leading-none transition-colors duration-200',
                  active ? 'border-mint/40 bg-mint/10 text-mint' : 'border-transparent text-ink',
                )}
              >
                {it.ch === ' ' ? <SpaceMark /> : it.ch}
              </div>
              <span className="tabular font-mono text-[9.5px] text-muted">{pct}</span>
            </li>
          );
        })}
      </ul>

      <div aria-hidden="true" className="mt-2.5 flex items-center gap-2 text-faint">
        <span className="micro text-[9px]">LESS INK</span>
        <span className="h-px flex-1 bg-line" />
        <Sym name="arrow" className="mx-0" />
        <span className="micro text-[9px]">MORE INK</span>
      </div>

      {measured && (
        <dl className="mt-4 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1.5 font-mono text-[13px]">
          <dt className="micro text-muted">NOMINAL</dt>
          <dd className="flex gap-[0.45em] text-ink/70">
            {Array.from(ramp, (ch, i) => (
              <span key={i} className="inline-grid w-[0.6em] place-items-center">
                {ch === ' ' ? <SpaceMark /> : ch}
              </span>
            ))}
          </dd>
          <dt className="micro text-muted">MEASURED</dt>
          <dd className="flex gap-[0.45em]">
            {items.map((it, i) => (
              <span
                key={it.nominal}
                className={cx('inline-grid w-[0.6em] place-items-center', it.nominal !== i ? 'text-mint' : 'text-ink')}
              >
                {it.ch === ' ' ? <SpaceMark /> : it.ch}
              </span>
            ))}
          </dd>
        </dl>
      )}
      {measured && (
        <p className="mt-2 text-[12.5px] leading-snug text-muted">
          {reordered
            ? 'Mint characters moved: measuring the ink corrected the hand-written order.'
            : 'The hand-written order survived the measurement unchanged.'}
        </p>
      )}
    </figure>
  );
});
