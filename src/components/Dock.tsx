import { useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Sigma } from 'lucide-react';
import { EXPERIMENTS } from '../experiments/registry';
import { useGlyphStore } from '../state/store';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useElementAnimation, useIntroReady } from '../hooks/useScrambleText';
import ScrambleText from './ui/ScrambleText';
import { cx } from './ui/primitives';

/* Dock (docs/SPEC.md §7) — the experiment switcher: a glass pill holding a tablist
 * (01 WAVES · 02 ATTRACTOR · 03 TOPOLOGY) and THE MATH toggle. The active tab is marked by a
 * mint capsule that springs between tabs (shared layout animation, stiffness 420 / damping 34).
 *
 * Responsive: the index numerals appear from 1440 px and the "THE MATH" label from 1366 px
 * (below that, Σ alone, still named for assistive tech), so the centred dock never meets the
 * equation card; below 768 px the dock spans the width. */

const EASE_EXPO = [0.16, 1, 0.3, 1] as const;
const CAPSULE_SPRING = { type: 'spring', stiffness: 420, damping: 34 } as const;
const INSTANT = { duration: 0 } as const;

/** Nominal auto-tour step (docs/SPEC.md §8: "cycle experiments every ~25 s"). */
const TOUR_STEP_MS = 25_000;
const TOUR_KEYFRAMES: Keyframe[] = [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }];
const TOUR_TIMING: KeyframeAnimationOptions = { duration: TOUR_STEP_MS, easing: 'linear', fill: 'forwards' };
const TOUR_START = { transform: 'scaleX(0)' } as const;

/** While touring, the pill's bottom hairline fills with mint over one tour step (remounted per experiment). */
function TourProgress({ reduced }: Readonly<{ reduced: boolean }>) {
  const fillRef = useRef<HTMLSpanElement>(null);
  useElementAnimation(fillRef, TOUR_KEYFRAMES, TOUR_TIMING, !reduced);
  return (
    <motion.span
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-7 -bottom-px h-px overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0.15 : 0.6 }}
    >
      <span
        ref={fillRef}
        className="block h-full w-full origin-left bg-linear-to-r from-mint/10 via-mint/60 to-mint"
        style={reduced ? undefined : TOUR_START}
      />
    </motion.span>
  );
}

export default function Dock() {
  const ready = useIntroReady();
  const reduced = useReducedMotion();
  const mode = useGlyphStore((s) => s.mode);
  const setMode = useGlyphStore((s) => s.setMode);
  const mathOpen = useGlyphStore((s) => s.mathOpen);
  const toggleMath = useGlyphStore((s) => s.toggleMath);
  const touring = useGlyphStore((s) => s.touring);

  const tabsRef = useRef<Array<HTMLButtonElement | null>>([]);
  // One counter per tab: bumping it remounts that label's ScrambleText, so it decodes once.
  const [hoverPulse, setHoverPulse] = useState<readonly number[]>(() => EXPERIMENTS.map(() => 0));
  const pulse = (index: number) => setHoverPulse((prev) => prev.map((n, i) => (i === index ? n + 1 : n)));

  /* Roving tabindex with automatic activation (WAI-ARIA tabs pattern): ←/→ wrap, Home/End jump.
   * Handled here and stopped, so the global ←/→ shortcuts don't switch a second time. */
  const onTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const count = EXPERIMENTS.length;
    const focused = tabsRef.current.findIndex((el) => el !== null && el === document.activeElement);
    const from = focused >= 0 ? focused : EXPERIMENTS.findIndex((m) => m.id === mode);
    let to: number;
    switch (e.key) {
      case 'ArrowRight':
        to = (from + 1) % count;
        break;
      case 'ArrowLeft':
        to = (from - 1 + count) % count;
        break;
      case 'Home':
        to = 0;
        break;
      case 'End':
        to = count - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    setMode(EXPERIMENTS[to].id);
    tabsRef.current[to]?.focus();
  };

  const shown = reduced ? { opacity: 1 } : { opacity: 1, y: 0 };
  const hidden = reduced ? { opacity: 0 } : { opacity: 0, y: 14 };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[var(--gutter)] flex justify-center px-[var(--gutter)]">
      <motion.div
        className="glass pointer-events-auto relative flex h-12 w-full items-center rounded-full p-1 md:w-auto"
        initial={false}
        animate={ready ? shown : hidden}
        transition={reduced ? { duration: 0.15 } : { delay: 0.28, duration: 0.9, ease: EASE_EXPO }}
      >
        <div
          role="tablist"
          aria-label="Experiments"
          aria-orientation="horizontal"
          onKeyDown={onTabKeyDown}
          className="flex min-w-0 flex-1 items-center gap-0.5 md:flex-none"
        >
          {EXPERIMENTS.map((meta, i) => {
            const active = meta.id === mode;
            return (
              <button
                key={meta.id}
                ref={(el) => {
                  tabsRef.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`gf-dock-tab-${meta.id}`}
                aria-selected={active}
                aria-keyshortcuts={String(i + 1)}
                tabIndex={active ? 0 : -1}
                onClick={() => setMode(meta.id)}
                onPointerEnter={(e) => {
                  if (e.pointerType === 'mouse') pulse(i);
                }}
                className={cx(
                  'group relative flex h-10 min-w-0 flex-1 items-center justify-center gap-2.5 rounded-full px-2.5',
                  'transition-colors duration-300 md:flex-none md:justify-start md:pl-[22px] md:pr-4',
                  !active && 'hover:bg-white/[0.04]',
                )}
              >
                {active ? (
                  <motion.span
                    layoutId="gf-dock-capsule"
                    transition={reduced ? INSTANT : CAPSULE_SPRING}
                    className="absolute inset-0 rounded-full border border-mint/30 bg-mint/10"
                  >
                    <span className="absolute left-[11px] top-1/2 hidden h-1 w-1 -translate-y-1/2 rounded-full bg-mint shadow-[0_0_6px_rgb(185_245_208_/_0.6)] md:block" />
                  </motion.span>
                ) : null}
                <span
                  className={cx(
                    'micro relative hidden leading-none tabular transition-colors duration-300 min-[1440px]:inline',
                    active ? 'text-mint/60' : 'text-muted group-hover:text-ink/60',
                  )}
                >
                  {meta.index}
                </span>
                {/* keyed on `ready` (decodes as the dock rises) and on hover (decodes once more) */}
                <ScrambleText
                  key={`${ready ? 'on' : 'off'}-${hoverPulse[i]}`}
                  text={meta.dockLabel}
                  duration={440}
                  className={cx(
                    'relative whitespace-nowrap font-mono text-[10px] font-medium uppercase leading-none tracking-widest md:text-[11px] md:tracking-[0.18em]',
                    'transition-colors duration-300',
                    active ? 'text-mint' : 'text-ink/60 group-hover:text-ink',
                  )}
                />
              </button>
            );
          })}
        </div>

        <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-line-strong md:mx-1.5" />

        <button
          type="button"
          onClick={toggleMath}
          aria-expanded={mathOpen}
          aria-keyshortcuts="M"
          className={cx(
            'relative flex h-10 shrink-0 items-center justify-center gap-2 rounded-full border px-3 min-[1366px]:px-3.5',
            'transition-[background-color,border-color,color] duration-300',
            mathOpen
              ? 'border-mint/30 bg-mint/10 text-mint'
              : 'border-transparent text-ink/70 hover:bg-white/[0.05] hover:text-ink',
          )}
        >
          <Sigma size={15} strokeWidth={1.5} aria-hidden="true" />
          <span className="micro leading-none max-[1366px]:sr-only">The math</span>
        </button>

        <AnimatePresence>{touring ? <TourProgress key={mode} reduced={reduced} /> : null}</AnimatePresence>
      </motion.div>
    </div>
  );
}
