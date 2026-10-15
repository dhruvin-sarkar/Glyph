import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, type Transition, type Variants } from 'motion/react';
import type { ExperimentMeta } from '../engine/types';
import { EXPERIMENTS, META_BY_ID } from '../experiments/registry';
import { useGlyphStore } from '../state/store';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useElementAnimation, useIntroReady } from '../hooks/useScrambleText';
import ScrambleText from './ui/ScrambleText';
import { cx } from './ui/primitives';

/* ═══════════════════════════════════════════════════════════════════════════
 *  HeroTitle (docs/SPEC.md §6–7) — renders the page's single <h1>.
 *
 *  Expanded (first visit):                Condensed (after the first switch):
 *    ── MATH IN DESIGN — MATH ODYSSEY 2026    ── CHAPTER 02 / 03
 *    GLYPHFIELD ²⁰²⁶                          02 ATTRACTOR
 *    EQUATIONS INTO MOTION.                   A vector field steers thousands…
 *    An interactive study of …
 *    ▬ ▭ ▭  Every character is a pixel.
 *    ── 01 — WAVEFIELD
 *    Two travelling sine waves …
 *
 *  Condensing: the giant letters drop back into their clip mask, the intro copy fades,
 *  the chapter's large numeral + name rise in its place, and the subtitle — the one element
 *  both states share — glides up (a motion layout animation). Exiting pieces are "popped"
 *  out of the flow (AnimatePresence mode="popLayout") so the glide starts at once; they only
 *  use padding for spacing because popped elements are re-positioned by their border box.
 *  GLYPHFIELD itself lives on in the TopBar.
 * ═══════════════════════════════════════════════════════════════════════════ */

const WORD = 'GLYPHFIELD';

interface Letter {
  ch: string;
  /** position-qualified key: letters of a word never reorder */
  key: string;
}

/** U+00A0 no-break space: keeps a space letter from collapsing inside an inline-flex word. */
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

function toLetters(text: string): Letter[] {
  return Array.from(text, (ch, i) => ({ ch: ch === ' ' ? NO_BREAK_SPACE : ch, key: `${i}${ch}` }));
}

const WORD_LETTERS = toLetters(WORD);

/** The installation's thesis, shown one line at a time. */
const IDEAS = [
  'Every character is a pixel.',
  'Every motion is an equation.',
  'Every design is a mathematical system.',
] as const;
const IDEA_MS = 4500;

const CHAPTER_COUNT = String(EXPERIMENTS.length).padStart(2, '0');

const EASE_EXPO = [0.16, 1, 0.3, 1] as const;
const EASE_IN_OUT = [0.76, 0, 0.24, 1] as const;

/** Delay before a word rolls in when the experiment changes under the condensed heading (s). */
const ROLL_DELAY = 0.08;

type Phase = 'hidden' | 'shown';

/** Per-letter cue passed through motion's `custom`: index, first delay, stagger, exit direction. */
interface LetterCue {
  i: number;
  base: number;
  step: number;
  out: 'up' | 'down';
}

interface HeroMotion {
  /** fade + 10 px rise; custom = delay (s) */
  fade: Variants;
  /** hairline drawing in from the left; custom = delay (s) */
  rule: Variants;
  /** a letter rising out of its clip mask; custom = LetterCue */
  letter: Variants;
  /** keeps a block mounted until its letters have rolled away */
  hold: Variants;
  /** the shared subtitle gliding to its new place */
  glide: Transition;
}

function heroMotion(reduced: boolean): HeroMotion {
  if (reduced) {
    // Reduced motion: opacity only, ≤ 150 ms, no stagger, no glide (docs/SPEC.md §6, Motion).
    const fade: Variants = {
      hidden: { opacity: 0 },
      shown: { opacity: 1, transition: { duration: 0.15 } },
      exit: { opacity: 0, transition: { duration: 0.12 } },
    };
    return { fade, rule: fade, letter: fade, hold: fade, glide: { duration: 0 } };
  }
  return {
    fade: {
      hidden: { opacity: 0, y: 10 },
      shown: (delay: number = 0) => ({ opacity: 1, y: 0, transition: { delay, duration: 0.9, ease: EASE_EXPO } }),
      exit: { opacity: 0, y: -6, transition: { duration: 0.3, ease: EASE_IN_OUT } },
    },
    rule: {
      hidden: { scaleX: 0 },
      shown: (delay: number = 0) => ({ scaleX: 1, transition: { delay, duration: 1.1, ease: EASE_EXPO } }),
      exit: { scaleX: 0, transition: { duration: 0.3, ease: EASE_IN_OUT } },
    },
    letter: {
      hidden: { y: '112%', opacity: 0 },
      shown: (cue: LetterCue) => {
        const delay = cue.base + cue.i * cue.step;
        return {
          y: '0%',
          opacity: 1,
          transition: { y: { delay, duration: 0.95, ease: EASE_EXPO }, opacity: { delay, duration: 0.25 } },
        };
      },
      exit: (cue: LetterCue) => {
        const delay = cue.i * 0.018;
        return {
          y: cue.out === 'up' ? '-112%' : '112%',
          opacity: 0,
          transition: { y: { delay, duration: 0.5, ease: EASE_IN_OUT }, opacity: { delay: delay + 0.3, duration: 0.2 } },
        };
      },
    },
    hold: {
      hidden: { opacity: 1 },
      shown: { opacity: 1 },
      exit: { opacity: 0, transition: { delay: 0.5, duration: 0.2 } },
    },
    // Starts once the giant letters have mostly cleared, so the glide never crosses them.
    glide: { duration: 0.95, delay: 0.24, ease: EASE_IN_OUT },
  };
}

/* ─── The three-step thesis ───────────────────────────────────────────────── */

const TICK_KEYFRAMES: Keyframe[] = [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }];
const TICK_TIMING: KeyframeAnimationOptions = { duration: IDEA_MS, easing: 'linear', fill: 'forwards' };
const TICK_START = { transform: 'scaleX(0)' } as const;

/** The active tick fills over one caption's lifetime (composited Web Animation, restarted per step). */
function TickFill({ running }: Readonly<{ running: boolean }>) {
  const ref = useRef<HTMLSpanElement>(null);
  useElementAnimation(ref, TICK_KEYFRAMES, TICK_TIMING, running);
  return <span ref={ref} className="absolute inset-0 origin-left bg-mint" style={running ? TICK_START : undefined} />;
}

function IdeaCycle({ running, reduced }: Readonly<{ running: boolean; reduced: boolean }>) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!running) return undefined;
    const id = window.setInterval(() => setStep((s) => (s + 1) % IDEAS.length), IDEA_MS);
    return () => window.clearInterval(id);
  }, [running]);

  return (
    <div className="flex items-center gap-4">
      {/* assistive tech reads the whole thesis once instead of a line that keeps changing */}
      <p className="sr-only">{IDEAS.join(' ')}</p>
      <span aria-hidden="true" className="flex shrink-0 items-center gap-1">
        {IDEAS.map((idea, k) => (
          <span key={idea} className="relative h-px w-3.5 overflow-hidden bg-ink/15">
            {k < step ? <span className="absolute inset-0 bg-ink/45" /> : null}
            {k === step ? <TickFill running={running && !reduced} /> : null}
          </span>
        ))}
      </span>
      <span aria-hidden="true">
        <ScrambleText
          text={IDEAS[step]}
          duration={760}
          className="text-[15px] leading-snug tracking-[-0.005em] text-ink/85 max-md:text-[14px]"
        />
      </span>
    </div>
  );
}

/* ─── Condensed chapter heading ───────────────────────────────────────────── */

/**
 * A word that rises letter by letter out of a clip mask and, when its text changes, rolls:
 * the old word exits upward while the new one rises from below (like an odometer).
 * The mask clips only vertically, so the popped-out old word may be wider than the new one.
 */
function RollingWord({
  text,
  className,
  m,
  phase,
  enterDelay,
}: Readonly<{ text: string; className?: string; m: HeroMotion; phase: Phase; enterDelay: number }>) {
  // The first word waits for the giant title to clear; later words roll in at once.
  const [firstText] = useState(text);
  const [rolled, setRolled] = useState(false);
  if (!rolled && text !== firstText) setRolled(true);
  const base = rolled ? ROLL_DELAY : enterDelay;
  const letters = useMemo(() => toLetters(text), [text]);

  return (
    <span aria-hidden="true" className={cx('relative inline-flex [clip-path:inset(-0.06em_-4em_-0.14em_-4em)]', className)}>
      <AnimatePresence mode="popLayout" propagate>
        <motion.span key={text} className="inline-flex" initial="hidden" animate={phase} exit="exit">
          {letters.map((letter, i) => (
            <motion.span
              key={letter.key}
              className="inline-block"
              variants={m.letter}
              custom={{ i, base, step: 0.03, out: 'up' } satisfies LetterCue}
            >
              {letter.ch}
            </motion.span>
          ))}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function ChapterHeadline({ meta, phase, m }: Readonly<{ meta: ExperimentMeta; phase: Phase; m: HeroMotion }>) {
  return (
    <motion.div className="pt-4" initial="hidden" animate={phase} exit="exit" variants={m.hold}>
      <h2 className="flex items-baseline gap-[0.3em] font-sans text-[clamp(40px,4.4vw,64px)] font-[560] leading-[0.9] tracking-[-0.045em]">
        <span className="sr-only">{`${meta.index} — ${meta.name}`}</span>
        <RollingWord text={meta.index} className="tabular text-muted/55" m={m} phase={phase} enterDelay={0.3} />
        <RollingWord text={meta.name} className="text-ink" m={m} phase={phase} enterDelay={0.36} />
      </h2>
    </motion.div>
  );
}

/* ─── Hero ────────────────────────────────────────────────────────────────── */

export default function HeroTitle() {
  const ready = useIntroReady();
  const reduced = useReducedMotion();
  const collapsed = useGlyphStore((s) => s.heroCollapsed);
  const mode = useGlyphStore((s) => s.mode);
  const mathOpen = useGlyphStore((s) => s.mathOpen);
  const m = useMemo(() => heroMotion(reduced), [reduced]);
  const meta = META_BY_ID[mode];
  const phase: Phase = ready ? 'shown' : 'hidden';
  // Text keyed on this decodes as the hero enters rather than while it is still invisible.
  const introKey = ready ? 'on' : 'off';

  return (
    <div
      className={cx(
        'pointer-events-none absolute left-[var(--gutter)] top-[17vh] max-w-[min(62vw,1180px)]',
        'md:[@media(max-height:820px)]:top-[14vh]',
        'max-md:top-[calc(var(--topbar-h)_+_4vh)] max-md:max-w-[calc(100vw_-_2_*_var(--gutter))]',
        // THE MATH drawer slides over this corner: step aside rather than blur behind its glass
        'transition-opacity duration-500 ease-expo',
        mathOpen && 'opacity-0',
      )}
    >
      <motion.div initial={false} animate={phase} className="relative flex flex-col items-start">
        {/* Eyebrow — persists across both states; its text decodes when it changes. */}
        <div className="flex items-center gap-3">
          <motion.span aria-hidden="true" variants={m.rule} custom={0.08} className="h-px w-7 origin-left bg-mint" />
          <motion.span variants={m.fade} custom={0.04}>
            <ScrambleText
              key={introKey}
              text={collapsed ? `Chapter ${meta.index} / ${CHAPTER_COUNT}` : 'Math in Design — Math Odyssey 2026'}
              duration={collapsed ? 520 : 820}
              className="micro text-muted"
            />
          </motion.span>
        </div>

        {/* The page's single <h1>: always present; the giant word is its visual form while expanded. */}
        <h1 className="font-sans font-semibold text-ink">
          <span className="sr-only">{WORD}</span>
          <AnimatePresence mode="popLayout" initial={false}>
            {collapsed ? null : (
              <motion.span key="word" aria-hidden="true" initial="hidden" animate={phase} exit="exit" className="block pt-5">
                <span className="relative block w-max text-[clamp(44px,13vw,64px)] leading-[0.86] tracking-[-0.05em] md:text-[clamp(64px,10.5vw,188px)]">
                  {/* clip only below the baseline: letters rise out of (and later sink into) this edge */}
                  <span className="flex [clip-path:inset(-0.5em_-0.5em_-0.07em_-0.5em)]">
                    {WORD_LETTERS.map((letter, i) => (
                      <motion.span
                        key={letter.key}
                        className="inline-block"
                        variants={m.letter}
                        custom={{ i, base: 0.12, step: 0.04, out: 'down' } satisfies LetterCue}
                      >
                        {letter.ch}
                      </motion.span>
                    ))}
                  </span>
                  <motion.span
                    variants={m.fade}
                    custom={0.66}
                    className="absolute left-full top-[9%] ml-[1.2%] font-mono text-[11px] font-medium leading-none tracking-[0.2em] text-muted"
                  >
                    2026
                  </motion.span>
                </span>
              </motion.span>
            )}
          </AnimatePresence>
        </h1>

        <AnimatePresence mode="popLayout" initial={false}>
          {collapsed ? <ChapterHeadline key="headline" meta={meta} phase={phase} m={m} /> : null}
        </AnimatePresence>

        {/* Tagline, intro copy and the cycling thesis — the first-visit material. */}
        <AnimatePresence mode="popLayout" initial={false}>
          {collapsed ? null : (
            <motion.div
              key="intro"
              initial="hidden"
              animate={phase}
              exit="exit"
              className="flex flex-col items-start pt-6 max-md:pt-5"
            >
              <motion.p
                variants={m.fade}
                custom={0.46}
                className="font-mono text-[12.5px] font-medium uppercase leading-none tracking-[0.32em] text-mint max-md:text-[11px] max-md:tracking-[0.26em]"
              >
                Equations into motion.
              </motion.p>
              <motion.p
                variants={m.fade}
                custom={0.54}
                // On short screens the TopBar's centre line already says this — give the field the room.
                className="max-w-[38ch] pt-4 text-[17px] leading-[1.5] text-muted max-md:text-[15px] [@media(max-height:820px)_and_(min-width:1100px)]:hidden"
              >
                An interactive study of mathematics, movement, and form.
              </motion.p>
              <motion.div variants={m.fade} custom={0.62} className="pt-7 max-md:pt-5">
                <IdeaCycle running={ready} reduced={reduced} />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Chapter label (expanded only — condensed, the headline carries index and name). */}
        <AnimatePresence mode="popLayout" initial={false}>
          {collapsed ? null : (
            <motion.p
              key="chapter"
              initial="hidden"
              animate={phase}
              exit="exit"
              variants={m.fade}
              custom={0.7}
              className="flex items-center gap-3 pb-2.5 pt-9 font-mono text-[11px] font-medium uppercase leading-none tracking-[0.2em] max-md:pt-7"
            >
              <span aria-hidden="true" className="h-px w-6 bg-line-strong" />
              <span className="tabular text-mint">{meta.index}</span>
              <span aria-hidden="true" className="text-faint">
                —
              </span>
              <ScrambleText key={introKey} text={meta.name} delay={200} className="text-ink" />
            </motion.p>
          )}
        </AnimatePresence>

        {/* The subtitle: shared by both states, it glides to its new place (layout animation). */}
        <motion.div layout="position" transition={{ layout: m.glide }} className={collapsed ? 'mt-5' : 'mt-0'}>
          <motion.div variants={m.fade} custom={0.76}>
            <ScrambleText
              key={introKey}
              as="p"
              text={meta.subtitle}
              duration={760}
              delay={collapsed ? 260 : 0}
              className="max-w-[40ch] text-[15px] leading-[1.55] text-muted max-md:text-[14px]"
            />
          </motion.div>
        </motion.div>
      </motion.div>
    </div>
  );
}
