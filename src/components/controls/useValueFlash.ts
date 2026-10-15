import { useEffect, useRef, type RefObject } from 'react';

/* Mint = "the value that just changed" (SPEC §6). The flash holds mint for a
 * moment, then eases back to ink over ~600 ms. It runs on the Web Animations
 * API, so a slider dragged at 60 events/s costs no React state at all — each
 * new value simply restarts the animation. */
const FLASH_KEYFRAMES: Keyframe[] = [
  { color: '#B9F5D0', textShadow: '0 0 12px rgba(185, 245, 208, 0.55)', offset: 0 },
  { color: '#B9F5D0', textShadow: '0 0 10px rgba(185, 245, 208, 0.35)', offset: 0.3 },
  { color: '#E9EDF2', textShadow: '0 0 0 rgba(185, 245, 208, 0)', offset: 1 },
];
const FLASH_TIMING: KeyframeAnimationOptions = { duration: 620, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' };

/**
 * Attach the returned ref to the element showing `value`: it flashes mint every
 * time the value changes after mount (user input, presets, reset, auto tour) —
 * never on the first render, so remounting the panel is silent.
 */
export function useValueFlash<T extends HTMLElement = HTMLSpanElement>(value: unknown): RefObject<T | null> {
  const ref = useRef<T>(null);
  const previous = useRef(value);
  const animation = useRef<Animation | null>(null);

  useEffect(() => {
    if (Object.is(previous.current, value)) return;
    previous.current = value;
    const el = ref.current;
    if (!el || typeof el.animate !== 'function') return;
    animation.current?.cancel();
    animation.current = el.animate(FLASH_KEYFRAMES, FLASH_TIMING);
  }, [value]);

  useEffect(
    () => () => {
      animation.current?.cancel();
      animation.current = null;
    },
    [],
  );

  return ref;
}
