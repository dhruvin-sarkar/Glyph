import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { META_BY_ID } from '../experiments/registry';
import { useLiveStore } from '../state/live';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useIntroReady } from '../hooks/useScrambleText';
import ScrambleText from './ui/ScrambleText';
import { cx } from './ui/primitives';

/* StatsReadout (docs/SPEC.md §7) — the instrument's own vital signs, bottom right:
 *     GLYPHS 14,388 · FPS 60 · MODE WAVES
 *     GRID 228×63 · Q 100% · t 12.4s
 * Each value is its own tiny component selecting ONE derived primitive from the live
 * store, so a stats tick (~4 Hz) re-renders only the numbers that actually changed. */

const EASE_EXPO = [0.16, 1, 0.3, 1] as const;
const VALUE = 'font-mono text-[11px] font-medium leading-none tracking-[0.04em] tabular';

const LABEL = 'micro leading-none text-muted';

function Stat({ label, labelClassName = LABEL, children }: Readonly<{ label: string; labelClassName?: string; children: ReactNode }>) {
  return (
    <span className="inline-flex items-baseline gap-[0.6em]">
      <span className={labelClassName}>{label}</span>
      {children}
    </span>
  );
}

function Sep() {
  return (
    <span aria-hidden="true" className="micro leading-none text-faint">
      ·
    </span>
  );
}

function GlyphCount() {
  const glyphs = useLiveStore((s) => s.stats.glyphs);
  return <span className={cx(VALUE, 'inline-block min-w-[6ch] text-right text-ink')}>{glyphs.toLocaleString('en-US')}</span>;
}

/** Colour encodes health: mint ≥ 55 fps, ink ≥ 40, muted below. */
function Fps() {
  const fps = useLiveStore((s) => Math.round(s.stats.fps));
  let tone = 'text-muted';
  if (fps >= 55) tone = 'text-mint';
  else if (fps >= 40) tone = 'text-ink';
  return (
    <span className={cx(VALUE, 'inline-block min-w-[3ch] text-right transition-colors duration-500', tone)}>
      {fps > 0 ? fps : '—'}
    </span>
  );
}

/** The experiment the engine is actually drawing — decodes in step with the field transition. */
function ModeName() {
  const mode = useLiveStore((s) => s.stats.mode);
  return <ScrambleText text={META_BY_ID[mode].dockLabel} duration={520} className={cx(VALUE, 'text-ink')} />;
}

function GridSize() {
  const cols = useLiveStore((s) => s.stats.cols);
  const rows = useLiveStore((s) => s.stats.rows);
  return <span className={cx(VALUE, 'text-ink')}>{cols > 0 ? `${cols}×${rows}` : '—'}</span>;
}

/** Adaptive quality: 100 % = full glyph density. */
function Quality() {
  const percent = useLiveStore((s) => Math.round(s.stats.quality * 100));
  return <span className={cx(VALUE, 'inline-block min-w-[4ch] text-right text-ink')}>{`${percent}%`}</span>;
}

function SimTime() {
  const tenths = useLiveStore((s) => Math.floor(s.stats.time * 10));
  return <span className={cx(VALUE, 'inline-block min-w-[6ch] text-right text-ink')}>{`${(tenths / 10).toFixed(1)}s`}</span>;
}

export default function StatsReadout() {
  const ready = useIntroReady();
  const reduced = useReducedMotion();

  const opacity = ready ? 1 : 0;
  const animate = reduced ? { opacity } : { opacity, y: ready ? 0 : 8 };

  return (
    <motion.div
      className="pointer-events-none absolute bottom-[var(--gutter)] right-[var(--gutter)] hidden flex-col items-end gap-2 whitespace-nowrap text-right md:flex"
      initial={false}
      animate={animate}
      transition={reduced ? { duration: 0.15 } : { delay: 0.4, duration: 0.9, ease: EASE_EXPO }}
    >
      {/* 768–1279 px: one line (the dock already names the mode) · ≥ 1280 px: the full readout */}
      <p className="flex items-baseline gap-[0.9em]">
        <Stat label="Glyphs">
          <GlyphCount />
        </Stat>
        <Sep />
        <Stat label="FPS">
          <Fps />
        </Stat>
        <span className="hidden items-baseline gap-[0.9em] xl:inline-flex">
          <Sep />
          <Stat label="Mode">
            <ModeName />
          </Stat>
        </span>
      </p>
      <p className="hidden items-baseline gap-[0.9em] xl:flex">
        <Stat label="Grid">
          <GridSize />
        </Stat>
        <Sep />
        <Stat label="Q">
          <Quality />
        </Stat>
        <Sep />
        {/* t is a mathematical variable: lowercase JetBrains Mono italic, like in the equations */}
        <Stat label="t" labelClassName="font-mono text-[11px] italic leading-none text-muted">
          <SimTime />
        </Stat>
      </p>
    </motion.div>
  );
}
