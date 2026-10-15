import { useRef } from 'react';
import { AnimatePresence, motion, type Variants } from 'motion/react';
import { useGlyphStore } from '../state/store';
import { useLiveStore } from '../state/live';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useElementAnimation, useIntroReady } from '../hooks/useScrambleText';
import ScrambleText from './ui/ScrambleText';
import { cx } from './ui/primitives';

/* TopBar (docs/SPEC.md §7) — brand mark · GLYPHFIELD / MATH ODYSSEY on the left, the
 * study's subtitle in the centre, and the instrument's status on the right:
 * AUTO TOUR (while touring) · LIVE / PAUSED · simulation clock · EST. 2026. */

const EASE_EXPO = [0.16, 1, 0.3, 1] as const;

/** Bar: fades in while settling 8 px down. Items: staggered opacity (custom = delay, s). */
const BAR: Variants = {
  hidden: { opacity: 0, y: -8 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.9, ease: EASE_EXPO } },
};
const ITEM: Variants = {
  hidden: { opacity: 0 },
  shown: (delay: number = 0) => ({ opacity: 1, transition: { delay, duration: 0.8, ease: EASE_EXPO } }),
};
const BAR_REDUCED: Variants = {
  hidden: { opacity: 0 },
  shown: { opacity: 1, transition: { duration: 0.15 } },
};
const ITEM_REDUCED: Variants = {
  hidden: { opacity: 0 },
  shown: { opacity: 1, transition: { duration: 0.15 } },
};

/* Brand mark: the favicon's 3 × 3 dot grid whose middle row has become a sine wave —
 * pixels turning into an equation. The wave draws itself in when the engine is ready. */
const MARK_DOTS: ReadonlyArray<readonly [number, number]> = [
  [4, 4],
  [10, 4],
  [16, 4],
  [4, 16],
  [10, 16],
  [16, 16],
];
/** One period of a sine across the mark: two cubic half-waves (control points at ⅓ and ⅔). */
const MARK_WAVE = 'M2 10c2.67-5 5.33-5 8 0s5.33 5 8 0';

function BrandMark({ draw, reduced }: Readonly<{ draw: boolean; reduced: boolean }>) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="shrink-0 overflow-visible">
      <g className="fill-ink/30">
        {MARK_DOTS.map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r={1} />
        ))}
      </g>
      <motion.path
        d={MARK_WAVE}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        className="text-mint"
        initial={false}
        animate={{ pathLength: draw ? 1 : 0, opacity: draw ? 1 : 0 }}
        transition={
          reduced
            ? { duration: 0.15 }
            : { pathLength: { delay: 0.2, duration: 1.2, ease: EASE_EXPO }, opacity: { delay: 0.2, duration: 0.2 } }
        }
      />
    </svg>
  );
}

/* LIVE indicator: a mint dot breathing out a soft halo (compositor-driven Web Animation:
 * no JavaScript per frame). Paused → a still, muted dot. */
const HALO_KEYFRAMES: Keyframe[] = [
  { transform: 'scale(1)', opacity: 0.55 },
  { transform: 'scale(3.4)', opacity: 0 },
];
const HALO_TIMING: KeyframeAnimationOptions = {
  duration: 2400,
  iterations: Infinity,
  easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
};

function LiveIndicator({ paused, reduced }: Readonly<{ paused: boolean; reduced: boolean }>) {
  const haloRef = useRef<HTMLSpanElement>(null);
  useElementAnimation(haloRef, HALO_KEYFRAMES, HALO_TIMING, !paused && !reduced);

  return (
    <span role="status" className="flex items-center gap-2.5">
      <span aria-hidden="true" className="relative flex h-1.5 w-1.5">
        <span ref={haloRef} className="absolute inset-0 rounded-full bg-mint opacity-0" />
        <span
          className={cx(
            'relative h-1.5 w-1.5 rounded-full transition-colors duration-500',
            paused ? 'bg-muted' : 'bg-mint shadow-[0_0_8px_rgb(185_245_208_/_0.55)]',
          )}
        />
      </span>
      {/* The invisible "PAUSED" reserves the wider word so nothing shifts when the state flips. */}
      <span aria-hidden="true" className="micro hidden leading-none md:inline-grid">
        <span className="invisible col-start-1 row-start-1">Paused</span>
        <ScrambleText
          text={paused ? 'Paused' : 'Live'}
          duration={380}
          className={cx('col-start-1 row-start-1 transition-colors duration-500', paused ? 'text-muted' : 'text-ink')}
        />
      </span>
      <span className="sr-only">{paused ? 'Simulation paused' : 'Simulation live'}</span>
    </span>
  );
}

/** Simulation time t as T+MM:SS.s — integer maths on tenths, so no float formatting drift. */
function formatClock(tenths: number): string {
  const t = Math.max(0, tenths);
  const minutes = Math.floor(t / 600);
  const withinMinute = t - minutes * 600;
  const seconds = Math.floor(withinMinute / 10);
  const tenth = withinMinute % 10;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenth}`;
}

/** Ticks with the engine's stats (~4 Hz) and freezes while paused — time is just another variable. */
function SimClock() {
  const tenths = useLiveStore((s) => Math.floor(s.stats.time * 10));
  return (
    <span
      title="Simulation time t"
      className="hidden items-baseline gap-[0.4em] font-mono text-[11px] leading-none tracking-[0.06em] xl:inline-flex"
    >
      <span className="text-faint">T+</span>
      <span className="tabular text-ink/80">{formatClock(tenths)}</span>
    </span>
  );
}

function TourChip({ reduced }: Readonly<{ reduced: boolean }>) {
  const hidden = reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9 };
  return (
    <motion.span
      initial={hidden}
      animate={{ opacity: 1, scale: 1 }}
      exit={hidden}
      transition={{ duration: reduced ? 0.15 : 0.5, ease: EASE_EXPO }}
      className="micro flex h-6 items-center rounded-full border border-mint/30 bg-mint/[0.06] px-2.5 leading-none text-mint"
    >
      Auto tour
    </motion.span>
  );
}

export default function TopBar() {
  const ready = useIntroReady();
  const reduced = useReducedMotion();
  const touring = useGlyphStore((s) => s.touring);
  const paused = useGlyphStore((s) => s.paused);
  const item = reduced ? ITEM_REDUCED : ITEM;

  return (
    <motion.header
      className="pointer-events-none absolute inset-x-0 top-0 flex h-[var(--topbar-h)] items-center px-[var(--gutter)]"
      initial={false}
      animate={ready ? 'shown' : 'hidden'}
      variants={reduced ? BAR_REDUCED : BAR}
    >
      <motion.div variants={item} custom={0} className="flex min-w-0 items-center gap-3">
        <BrandMark draw={ready} reduced={reduced} />
        <p className="flex items-baseline whitespace-nowrap font-mono text-[11px] font-medium uppercase leading-none tracking-[0.24em]">
          {/* keyed on `ready` so the wordmark decodes as the bar arrives */}
          <ScrambleText key={ready ? 'on' : 'off'} text="GLYPHFIELD" duration={900} className="text-ink" />
          <span aria-hidden="true" className="hidden px-[0.75em] text-faint md:inline">
            /
          </span>
          <span className="hidden text-muted md:inline">Math Odyssey</span>
        </p>
      </motion.div>

      <motion.p
        variants={item}
        custom={0.1}
        className="micro absolute left-1/2 hidden -translate-x-1/2 whitespace-nowrap text-muted min-[1100px]:block"
      >
        An interactive study of mathematical motion
      </motion.p>

      <motion.div variants={item} custom={0.18} className="ml-auto flex items-center gap-5 whitespace-nowrap">
        <AnimatePresence initial={false}>{touring ? <TourChip key="tour" reduced={reduced} /> : null}</AnimatePresence>
        <LiveIndicator paused={paused} reduced={reduced} />
        <SimClock />
        <span className="micro hidden leading-none text-muted md:inline">Est. 2026</span>
      </motion.div>
    </motion.header>
  );
}
