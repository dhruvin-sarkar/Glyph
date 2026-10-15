import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown } from 'lucide-react';
import { EXPLANATIONS } from '../content/explanations';
import { META_BY_ID } from '../experiments/registry';
import { useLiveStore } from '../state/live';
import { useGlyphStore } from '../state/store';
import { useMediaQuery } from './controls/useMediaQuery';
import { AutoHeight } from './equations/AutoHeight';
import { MATH_DRAWER_ID } from './equations/ids';
import { LiveEquation } from './equations/LiveEquation';
import { InlineMath } from './equations/MathText';
import { ProbePanel } from './equations/ProbePanel';
import { BandFacts } from './equations/TopologyEquation';
import { Hairline, IconButton, Kbd, cx } from './ui/primitives';
import ScrambleText from './ui/ScrambleText';

/* ═══════════════════════════════════════════════════════════════════════════
 *  LIVE EQUATION — the exhibit label that sits on the field (SPEC §6–7).
 *
 *  ≥ 1280 px  full card (w ≤ 420): the substituted equation, then the PROBE —
 *             one sample's value, normalised level and character, live at 8 Hz.
 *  768–1279   compact (w ≤ 356): the equation only.
 *  narrow     when the card would reach the centred Dock it becomes a pill
 *             (container query on the space left of the Dock).
 *  < 768      hidden — THE MATH drawer carries the mathematics.
 *
 *  The space beside the Dock: 50vw − Dock/2 − gutter − 16 px, with the Dock
 *  width read from --dock-w (default 440 px, a conservative estimate).
 * ═══════════════════════════════════════════════════════════════════════════ */

const EASE = [0.16, 1, 0.3, 1] as const;
const PANEL_READING = {
  waves: 'Two travelling waves, plus the ripples you make.',
  attractor: 'Rotation and attraction guide each particle.',
  topology: 'Three coordinates shape one continuous surface.',
};

/** True once the engine reports `ready` (or after a grace period, so the label never stays hidden). */
function useChromeReady(graceMs = 2600): boolean {
  const ready = useLiveStore((s) => s.stats.ready);
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (ready) return;
    const id = window.setTimeout(() => setLate(true), graceMs);
    return () => window.clearTimeout(id);
  }, [ready, graceMs]);
  return ready || late;
}

function MathButton() {
  const open = useGlyphStore((s) => s.mathOpen);
  const toggleMath = useGlyphStore((s) => s.toggleMath);
  return (
    <button
      type="button"
      onClick={toggleMath}
      aria-expanded={open}
      aria-controls={MATH_DRAWER_ID}
      aria-keyshortcuts="M"
      title="The mathematics behind this experiment (M)"
      className={cx(
        'inline-flex h-8 items-center gap-2 rounded-full border pr-1.5 pl-3',
        'transition-[background-color,border-color,color] duration-200 ease-expo',
        open
          ? 'border-mint/40 bg-mint/10 text-mint'
          : 'border-line bg-white/[0.02] text-ink/80 hover:border-line-strong hover:bg-white/[0.06] hover:text-ink',
      )}
    >
      <span className="font-sans text-[12px] font-medium">Explore the math</span>
      <Kbd>M</Kbd>
    </button>
  );
}

export default function EquationCard() {
  const mode = useGlyphStore((s) => s.mode);
  const mathOpen = useGlyphStore((s) => s.mathOpen);
  const heroCollapsed = useGlyphStore((s) => s.heroCollapsed);
  const roomForSample = useMediaQuery('(min-height: 850px)');
  const toggleMath = useGlyphStore((s) => s.toggleMath);
  const show = useChromeReady();
  const [collapsed, setCollapsed] = useState(false);
  const meta = META_BY_ID[mode];
  const exp = EXPLANATIONS[mode];

  const enter = {
    initial: { opacity: 0, y: 14 },
    animate: show ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 },
    transition: { duration: 0.9, ease: EASE, delay: show ? 0.34 : 0 },
  };

  return (
    <div
      className={cx(
        '@container pointer-events-none absolute bottom-[var(--gutter)] left-[var(--gutter)] max-md:hidden',
        '[--eq-room:calc(50vw_-_var(--dock-w,440px)/2_-_var(--gutter)_-_16px)]',
        'w-[min(420px,var(--eq-room))] max-xl:w-[min(356px,var(--eq-room))]',
        !heroCollapsed && 'gf-equation-anchor--intro',
      )}
    >
      <motion.section
        {...enter}
        aria-label={`Live equation, experiment ${meta.index}: ${meta.name}`}
        className="gf-equation-card glass pointer-events-auto rounded-[20px] @max-[319px]:hidden"
      >
        <header className="flex items-center justify-between gap-2 pt-4 pr-4 pb-3 pl-5">
          <span className="flex min-w-0 items-center gap-2.5">
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-mint shadow-[0_0_10px_rgb(185_245_208/0.65)]" />
            <ScrambleText text={`THE EQUATION · ${meta.index}`} className="micro truncate text-muted" />
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <MathButton />
            <IconButton
              size="sm"
              label={collapsed ? 'Show the equation' : 'Hide the equation'}
              aria-expanded={!collapsed}
              onClick={() => setCollapsed((c) => !c)}
            >
              <ChevronDown
                size={14}
                strokeWidth={1.5}
                className={cx('transition-transform duration-300 ease-expo', collapsed && 'rotate-180')}
              />
            </IconButton>
          </span>
        </header>

        <AutoHeight open={!collapsed}>
          <div className="px-5 pb-5">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={mode}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.28, ease: EASE }}
              >
                <p className="gf-equation-reading">{PANEL_READING[mode]}</p>
                <div className="gf-equation-surface">
                  <LiveEquation mode={mode} details={heroCollapsed} className="text-[13px]" />
                </div>
                {mode === 'topology' && <BandFacts className="mt-3 max-xl:hidden" />}
              </motion.div>
            </AnimatePresence>

            <div className="max-xl:hidden [@media(max-height:700px)]:hidden">
              <Hairline className="my-3" />
              <ProbePanel key={heroCollapsed && roomForSample ? 'study' : 'intro'} mode={mode} intensitySymbol={exp.intensitySymbol} defaultOpen={heroCollapsed && roomForSample} />
            </div>
          </div>
        </AutoHeight>
      </motion.section>

      {/* Too little room beside the Dock: a one-line pill that opens THE MATH. */}
      <motion.button
        {...enter}
        type="button"
        onClick={toggleMath}
        aria-expanded={mathOpen}
        aria-controls={MATH_DRAWER_ID}
        aria-keyshortcuts="M"
        className={cx(
          'gf-equation-pill glass pointer-events-auto hidden h-10 max-w-full items-center gap-2.5 rounded-full pr-2 pl-3.5 @max-[319px]:inline-flex',
          'transition-colors duration-200 hover:border-line-strong',
        )}
      >
        <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-mint shadow-[0_0_10px_rgb(185_245_208/0.65)]" />
        <span className="truncate text-[12px] text-ink @max-[219px]:hidden">
          <InlineMath src={exp.symbol} />
        </span>
        <span className="micro shrink-0 text-ink/85">The math</span>
        <Kbd>M</Kbd>
      </motion.button>
    </div>
  );
}
