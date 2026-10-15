import { useEffect, useRef, useState, type RefObject } from 'react';
import { useLiveStore } from '../state/live';
import { useReducedMotion } from './useReducedMotion';

/* ═══════════════════════════════════════════════════════════════════════════
 *  Text decode + shared choreography hooks for the installation chrome
 *  (docs/SPEC.md §6, Motion).
 *
 *  The decode makes the UI speak the field's language: a label never simply
 *  swaps — its characters flicker through technical glyphs and resolve
 *  left → right, the way the ASCII field decodes during a transition.
 *
 *  CONTRACT: keep `useScrambleText` and `ScrambleOptions` — other components
 *  import them. Everything else here is additive.
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface ScrambleOptions {
  /** total decode duration in ms (default ~600) */
  duration?: number;
  /** delay before decoding starts, ms */
  delay?: number;
  /** glyphs used while scrambling */
  charset?: string;
  /** render the final text immediately (e.g. reduced motion) */
  disabled?: boolean;
}

/** Glyphs a scrambling character flickers through (all covered by the bundled fonts). */
export const SCRAMBLE_CHARSET = '!<>-_\\/[]{}=+*^?#·:';

const DEFAULT_DURATION_MS = 600;

/** Chance that a scrambling cell picks a new glyph on a given frame (≈ every 3–4 frames at 60 fps). */
const REROLL_CHANCE = 0.28;

export type RandomSource = () => number;

/**
 * The per-character schedule of one decode. Built once per text change — never
 * per frame — so a running decode only reads typed arrays and concatenates.
 */
export interface ScramblePlan {
  /** characters (code points) of the text being replaced */
  readonly from: readonly string[];
  /** characters of the text being decoded */
  readonly to: readonly string[];
  /** number of character cells = max(from.length, to.length) — the length morphs */
  readonly cells: number;
  /** ms after the decode starts at which cell i stops showing its old character */
  readonly start: Float64Array;
  /** ms at which cell i settles on its new character (or disappears) */
  readonly end: Float64Array;
  /** glyph each cell currently flickers on (mutated while the decode runs) */
  readonly noise: string[];
  /** the scramble alphabet, split into code points */
  readonly glyphs: readonly string[];
}

/** U+00A0 no-break space (written by code point so it is visible in the source). */
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

function isBlank(ch: string): boolean {
  return ch === ' ' || ch === NO_BREAK_SPACE || ch === '\n' || ch === '\t';
}

function toGlyphs(charset: string): readonly string[] {
  const glyphs = Array.from(charset);
  return glyphs.length > 0 ? glyphs : Array.from(SCRAMBLE_CHARSET);
}

function pick(glyphs: readonly string[], random: RandomSource): string {
  return glyphs[Math.min(glyphs.length - 1, Math.floor(random() * glyphs.length))];
}

/**
 * Schedule a decode from `from` to `to` lasting `durationMs`.
 *
 * Cell i sits at p = i / (cells − 1) along the line. It starts scrambling at
 * ≈ 0.42·p·d and settles at ≈ (0.30 + 0.55·p)·d, each with a little random
 * jitter, so the text resolves as a ragged wave travelling left → right and the
 * last cell lands exactly at d. With `fromNoise` (first appearance) every cell
 * is already scrambling at t = 0 — the text materialises out of pure noise.
 */
export function planScramble(
  from: string,
  to: string,
  durationMs: number,
  fromNoise = false,
  charset: string = SCRAMBLE_CHARSET,
  random: RandomSource = Math.random,
): ScramblePlan {
  const a = Array.from(from);
  const b = Array.from(to);
  const glyphs = toGlyphs(charset);
  const cells = Math.max(a.length, b.length);
  const d = Math.max(0, durationMs);
  const start = new Float64Array(cells);
  const end = new Float64Array(cells);
  const noise = new Array<string>(cells);
  for (let i = 0; i < cells; i++) {
    const p = cells > 1 ? i / (cells - 1) : 0;
    start[i] = fromNoise ? 0 : d * (0.42 * p + 0.1 * random());
    end[i] = Math.min(d, d * (0.3 + 0.55 * p + 0.15 * random()));
    noise[i] = pick(glyphs, random);
  }
  return { from: a, to: b, cells, start, end, noise, glyphs };
}

/**
 * The text a decode shows `elapsedMs` after it started. Before its start a cell
 * shows its old character, between start and end a flickering glyph (blank
 * cells stay blank, so word shapes survive), after its end the new character —
 * or nothing, when the new text is shorter.
 */
export function renderScramble(plan: ScramblePlan, elapsedMs: number, random: RandomSource = Math.random): string {
  const { from, to, cells, start, end, noise, glyphs } = plan;
  let out = '';
  for (let i = 0; i < cells; i++) {
    const target = i < to.length ? to[i] : '';
    if (elapsedMs >= end[i]) {
      out += target;
      continue;
    }
    const old = i < from.length ? from[i] : '';
    if (elapsedMs < start[i]) {
      out += old;
      continue;
    }
    if (isBlank(target) || (target === '' && isBlank(old))) {
      out += target || old;
      continue;
    }
    if (random() < REROLL_CHANCE) noise[i] = pick(glyphs, random);
    out += noise[i];
  }
  return out;
}

/** A same-length string of scramble glyphs (blanks preserved): what a decode looks like at t = 0. */
export function scrambleNoise(text: string, charset: string = SCRAMBLE_CHARSET, random: RandomSource = Math.random): string {
  const glyphs = toGlyphs(charset);
  let out = '';
  for (const ch of text) out += isBlank(ch) ? ch : pick(glyphs, random);
  return out;
}

/**
 * Returns the text to display; re-runs a glyph "decode" animation whenever `text` changes.
 *
 * - First appearance: the text materialises from noise (same length → no reflow).
 * - Change: the old text dissolves and the new one resolves left → right; the
 *   length morphs between the two strings.
 * - `disabled` or prefers-reduced-motion → the final text, immediately.
 * - One rAF loop per running decode, at most one state update per frame, and
 *   nothing at all while idle. The loop is cancelled on change and on unmount.
 */
export function useScrambleText(text: string, options?: ScrambleOptions): string {
  const duration = Math.max(0, options?.duration ?? DEFAULT_DURATION_MS);
  const delay = Math.max(0, options?.delay ?? 0);
  const charset = options?.charset || SCRAMBLE_CHARSET;
  const reduced = useReducedMotion();
  const instant = options?.disabled === true || reduced || duration === 0;

  const [shown, setShown] = useState(() => (instant ? text : scrambleNoise(text, charset)));
  /** the string currently on screen — where the next decode starts from */
  const shownRef = useRef(shown);
  /** false until a decode has completed: the first one starts from pure noise */
  const settledRef = useRef(instant);

  useEffect(() => {
    if (instant) {
      shownRef.current = text;
      settledRef.current = true;
      return undefined;
    }
    const from = shownRef.current;
    if (from === text) {
      settledRef.current = true;
      setShown(text);
      return undefined;
    }

    const fromNoise = !settledRef.current;
    const plan = planScramble(from, text, duration, fromNoise, charset);
    const t0 = performance.now() + delay;
    let raf = 0;
    const frame = (now: number) => {
      const elapsed = now - t0;
      const done = elapsed >= duration;
      // While delayed, a first appearance keeps flickering; a change keeps the old text.
      const next = done ? text : renderScramble(plan, fromNoise ? Math.max(0, elapsed) : elapsed);
      if (next !== shownRef.current) {
        shownRef.current = next;
        setShown(next);
      }
      if (done) {
        settledRef.current = true;
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [text, instant, duration, delay, charset]);

  return instant ? text : shown;
}

/* ─── Shared choreography ─────────────────────────────────────────────────── */

/** How long the chrome waits for the engine before entering anyway (ms). */
export const INTRO_FALLBACK_MS = 1200;

/**
 * Entrance gate shared by the chrome: true once the engine reports `ready`
 * (fonts loaded + first frame drawn), or after `fallbackMs` so the UI can never
 * stay hidden. Latches: the chrome never re-hides if the engine is re-created
 * (React StrictMode, hot reload).
 */
export function useIntroReady(fallbackMs: number = INTRO_FALLBACK_MS): boolean {
  const engineReady = useLiveStore((s) => s.stats.ready);
  const [open, setOpen] = useState(engineReady);

  useEffect(() => {
    if (open) return undefined;
    if (engineReady) {
      setOpen(true);
      return undefined;
    }
    const id = window.setTimeout(() => setOpen(true), fallbackMs);
    return () => window.clearTimeout(id);
  }, [open, engineReady, fallbackMs]);

  return open || engineReady;
}

/**
 * Run a Web Animations API animation on `ref` while `enabled`. It is composited
 * by the browser (transform / opacity), so no JavaScript runs per frame; it is
 * cancelled when disabled or unmounted. Pass module-level keyframes/options.
 */
export function useElementAnimation(
  ref: RefObject<Element | null>,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
  enabled: boolean,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof el.animate !== 'function') return undefined;
    const animation = el.animate(keyframes, options);
    return () => animation.cancel();
  }, [ref, keyframes, options, enabled]);
}
