import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { META_BY_ID } from '../experiments/registry';
import { useGlyphStore } from '../state/store';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useElementAnimation, useIntroReady } from '../hooks/useScrambleText';
import ScrambleText from './ui/ScrambleText';

/* InteractionHint (docs/SPEC.md §7) — one quiet line above the dock telling a visitor what
 * the field responds to. Shown on load and on every experiment change; once someone starts
 * playing with the stage it lingers HINT_LINGER_MS, then steps aside until the next change. */

const STAGE_SELECTOR = '[data-glyph-stage]';
const HINT_LINGER_MS = 6000;
const EASE_EXPO = [0.16, 1, 0.3, 1] as const;

/** A soft blink for the mint "listening" dot — composited, no JavaScript per frame. */
const BLINK_KEYFRAMES: Keyframe[] = [{ opacity: 1 }, { opacity: 0.18 }, { opacity: 1 }];
const BLINK_TIMING: KeyframeAnimationOptions = { duration: 1600, iterations: Infinity, easing: 'ease-in-out' };

export default function InteractionHint() {
  const ready = useIntroReady();
  const reduced = useReducedMotion();
  const mode = useGlyphStore((s) => s.mode);
  const mathOpen = useGlyphStore((s) => s.mathOpen);

  // Every mode change brings the hint back (React's "adjust state while rendering" pattern).
  const [hintMode, setHintMode] = useState(mode);
  const [dismissed, setDismissed] = useState(false);
  if (hintMode !== mode) {
    setHintMode(mode);
    setDismissed(false);
  }

  // Wait for the first pointer activity ON THE STAGE (not on chrome), then start the linger
  // timer. Listeners detach after that first event, so moving the mouse costs nothing.
  useEffect(() => {
    if (dismissed) return undefined;
    let timer = 0;
    const onActivity = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Element) || target.closest(STAGE_SELECTOR) === null) return;
      detach();
      timer = window.setTimeout(() => setDismissed(true), HINT_LINGER_MS);
    };
    const detach = () => {
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('pointermove', onActivity);
    };
    window.addEventListener('pointerdown', onActivity, { passive: true });
    window.addEventListener('pointermove', onActivity, { passive: true });
    return () => {
      detach();
      window.clearTimeout(timer);
    };
  }, [mode, dismissed]);

  const visible = ready && !dismissed && !mathOpen;
  const dotRef = useRef<HTMLSpanElement>(null);
  useElementAnimation(dotRef, BLINK_KEYFRAMES, BLINK_TIMING, visible && !reduced);

  const opacity = visible ? 1 : 0;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[calc(var(--gutter)_+_64px)] flex justify-center px-[var(--gutter)]">
      <motion.p
        className="micro flex max-w-full items-center gap-3 text-center leading-[1.6] text-muted"
        initial={false}
        animate={reduced ? { opacity } : { opacity, y: visible ? 0 : 6 }}
        transition={
          reduced ? { duration: 0.15 } : { duration: visible ? 0.9 : 0.7, delay: visible ? 0.5 : 0, ease: EASE_EXPO }
        }
      >
        <span
          ref={dotRef}
          aria-hidden="true"
          className="h-1 w-1 shrink-0 rounded-full bg-mint shadow-[0_0_6px_rgb(185_245_208_/_0.6)]"
        />
        <span>
          {/* keyed on `ready`: the first hint decodes as it fades in; later ones decode on change */}
          <ScrambleText key={ready ? 'on' : 'off'} text={META_BY_ID[mode].hint} duration={700} delay={220} />
          {/* keyboards only — touch screens have no space bar */}
          <span className="[@media(pointer:coarse)]:hidden">
            <span aria-hidden="true" className="text-faint">
              {' · '}
            </span>
            Space to pause
          </span>
        </span>
      </motion.p>
    </div>
  );
}
