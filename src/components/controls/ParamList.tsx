import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef } from 'react';
import { AnimatePresence, motion, type Variants } from 'motion/react';
import type { ExperimentId } from '../../engine/types';
import { META_BY_ID } from '../../experiments/registry';
import { prefersReducedMotion, useReducedMotion } from '../../hooks/useReducedMotion';
import { Hairline, MicroLabel } from '../ui/primitives';
import ParamRow from './ParamRow';
import { splitParams } from './model';
import { EASE_EXPO } from './motion';
import '../../styles/controls.css';

const FLIP_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)';

function listVariants(reduced: boolean): Variants {
  return {
    hidden: { opacity: 1, x: 0 },
    visible: {
      opacity: 1,
      x: 0,
      transition: reduced ? { duration: 0 } : { staggerChildren: 0.035, delayChildren: 0.02 },
    },
    exit: { opacity: 0, x: reduced ? 0 : -6, transition: { duration: reduced ? 0.1 : 0.14, ease: 'easeIn' } },
  };
}

function itemVariants(reduced: boolean): Variants {
  return {
    hidden: { opacity: 0, x: reduced ? 0 : 10 },
    visible: { opacity: 1, x: 0, transition: { duration: reduced ? 0.15 : 0.45, ease: EASE_EXPO } },
  };
}

/**
 * The scrolling body of the panel. Rows are keyed by experiment: switching
 * experiments fades the old rows out, then slides the new ones in, while the
 * body's height glides between the two (a FLIP animation — measure First and
 * Last, then Invert and Play — so the glass panel never jumps).
 */
export default function ParamList({ mode }: { mode: ExperimentId }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sizerRef = useRef<HTMLDivElement>(null);
  const fromHeight = useRef<number | null>(null);
  const flip = useRef<Animation | null>(null);

  // First: the instant the mode changes the outgoing rows are still mounted — note their height.
  useLayoutEffect(() => {
    const el = sizerRef.current;
    if (el) fromHeight.current = el.getBoundingClientRect().height;
  }, [mode]);

  // Last → Invert → Play: called by the incoming rows on mount, before the browser paints.
  const onRowsMounted = useCallback(() => {
    const el = sizerRef.current;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    const from = fromHeight.current;
    fromHeight.current = null;
    if (!el || from === null || prefersReducedMotion() || typeof el.animate !== 'function') return;
    flip.current?.cancel();
    const to = el.getBoundingClientRect().height;
    if (Math.abs(to - from) < 1) return;
    el.style.overflow = 'hidden';
    const anim = el.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 420, easing: FLIP_EASING });
    flip.current = anim;
    const settle = () => {
      if (flip.current !== anim) return;
      flip.current = null;
      el.style.overflow = '';
    };
    anim.onfinish = settle;
    anim.oncancel = settle;
  }, []);

  useEffect(
    () => () => {
      flip.current?.cancel();
      flip.current = null;
    },
    [],
  );

  return (
    <div ref={scrollRef} className="gf-param-list gf-scroll min-h-0">
      <div ref={sizerRef}>
        <AnimatePresence mode="wait">
          <ModeParams key={mode} mode={mode} onMounted={onRowsMounted} />
        </AnimatePresence>
      </div>
    </div>
  );
}

function ModeParams({ mode, onMounted }: { mode: ExperimentId; onMounted: () => void }) {
  const reduced = useReducedMotion();
  const equationLabelId = useId();
  const displayLabelId = useId();
  const { equation, display } = useMemo(() => splitParams(mode, META_BY_ID[mode].params), [mode]);
  const list = useMemo(() => listVariants(reduced), [reduced]);
  const item = useMemo(() => itemVariants(reduced), [reduced]);

  useLayoutEffect(() => {
    onMounted();
  }, [onMounted]);

  return (
    <motion.div variants={list} initial="hidden" animate="visible" exit="exit">
      <div role="group" aria-labelledby={equationLabelId}>
        <motion.div variants={item} className="gf-group-heading">
          <MicroLabel id={equationLabelId}>Equation</MicroLabel>
          <Hairline className="min-w-0 flex-1" />
        </motion.div>
        {equation.map((def) => (
          <motion.div key={def.id} variants={item}>
            <ParamRow mode={mode} def={def} />
          </motion.div>
        ))}
      </div>

      {display.length > 0 ? (
        <div role="group" aria-labelledby={displayLabelId}>
          <motion.div variants={item} className="gf-group-heading gf-group-heading-display">
            <MicroLabel id={displayLabelId}>Display</MicroLabel>
            <Hairline className="min-w-0 flex-1" />
          </motion.div>
          {display.map((def) => (
            <motion.div key={def.id} variants={item}>
              <ParamRow mode={mode} def={def} />
            </motion.div>
          ))}
        </div>
      ) : null}
    </motion.div>
  );
}
