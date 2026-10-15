import { useEffect, useRef } from 'react';
import { useGlyphStore } from '../state/store';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { cx } from './ui/primitives';

/* ═══════════════════════════════════════════════════════════════════════════
 *  CustomCursor (docs/SPEC.md §6, Cursor) — over the stage only, for a mouse:
 *  a 3 px mint dot exactly at the pointer and a 28 px hairline ring that follows
 *  it on a critically damped spring. The ring's ornament tells you what the
 *  field does with your hand:
 *      waves → plain ring · attractor → crosshair ticks · topology → rotation arcs
 *
 *  Everything is imperative: pointer events write `transform: translate3d(…)`
 *  through refs and a rAF loop that runs only while the ring is still moving.
 *  React re-renders only when the experiment changes (to swap the ornament).
 * ═══════════════════════════════════════════════════════════════════════════ */

const STAGE_SELECTOR = '[data-glyph-stage]';

/** SVG box (CSS px) centred on the pointer; the ring itself is 28 px across. */
const BOX = 56;
const HALF = BOX / 2;
const RING_RADIUS = 13.5;
const DOT = 3;

/**
 * Natural frequency ω of the ring's spring (rad/s). Following a moving pointer it trails by
 * ≈ 2/ω = 0.1 s; after a jump the remaining gap is (1 + ωt)·e^(−ωt) — under 1 % by t = 0.35 s.
 */
const OMEGA = 20;
/** The press "squeeze" responds a little faster than the position. */
const OMEGA_SCALE = 32;
const PRESS_SCALE = 0.75;

/** Presentation mode (H): the cursor fades out after this long without movement. */
const IDLE_HIDE_MS = 2200;

/** Hide the native cursor over the stage — only where a fine pointer can see ours. */
const HIDE_NATIVE_CURSOR = `@media (hover: hover) and (pointer: fine) { ${STAGE_SELECTOR} { cursor: none; } }`;

/* Ornaments, in the 56 × 56 box centred at (28, 28). */
/** Four ticks just outside the ring (r = 17…21): a reticle — "aim the attractor here". */
const CROSSHAIR = 'M28 7v4M28 45v4M7 28h4M45 28h4';
/**
 * A clockwise arc on r = 19 from θ = 80° to θ = 10°, plus an arrowhead aligned with the
 * tangent at its end; drawn twice (the copy rotated 180°) it reads as "drag to rotate".
 */
const ROTATION_ARC = 'M31.3 9.29A19 19 0 0 1 46.71 24.7M48.52 21.13 46.71 24.7 43.79 21.97';

/**
 * One step of a critically damped spring  x'' = −ω²(x − target) − 2ω·x',  solved exactly:
 * with e = x − target, e(t) = (e₀ + (v₀ + ω·e₀)·t)·e^(−ωt). Being the closed-form solution
 * (not an Euler step) it is frame-rate independent and can never overshoot or explode.
 * Writes the new position and velocity into `state` = [x, v].
 */
function dampTo(state: Float64Array, target: number, omega: number, dt: number): void {
  const e0 = state[0] - target;
  const v0 = state[1];
  const decay = Math.exp(-omega * dt);
  const k = (v0 + omega * e0) * dt;
  state[0] = target + (e0 + k) * decay;
  state[1] = (v0 - omega * k) * decay;
}

export default function CustomCursor() {
  const mode = useGlyphStore((s) => s.mode);
  const reduced = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<SVGSVGElement>(null);
  const dotRef = useRef<HTMLSpanElement>(null);
  const reducedRef = useRef(reduced);

  useEffect(() => {
    reducedRef.current = reduced;
  }, [reduced]);

  useEffect(() => {
    const root = rootRef.current;
    const ring = ringRef.current;
    const dot = dotRef.current;
    if (!root || !ring || !dot) return undefined;

    // Spring states [position, velocity] — allocated once, mutated in place.
    const sx = new Float64Array(2);
    const sy = new Float64Array(2);
    const ss = new Float64Array([1, 0]);
    let tx = 0;
    let ty = 0;
    let pressed = false;
    let overStage = false;
    let idleHidden = false;
    let raf = 0;
    let lastFrame = 0;

    // Presentation-mode idleness: one timer, re-armed lazily (not on every pointermove).
    let presenting = useGlyphStore.getState().uiHidden;
    let lastActivity = performance.now();
    let idleTimer = 0;

    // `closest()` only when the pointer's target element changes.
    let lastTarget: EventTarget | null = null;
    let lastTargetOnStage = false;

    const applyVisibility = () => {
      root.style.opacity = overStage && !idleHidden ? '1' : '0';
    };
    const writeRing = () => {
      ring.style.transform = `translate3d(${sx[0] - HALF}px, ${sy[0] - HALF}px, 0) scale(${ss[0]})`;
    };
    const writeDot = () => {
      dot.style.transform = `translate3d(${tx - DOT / 2}px, ${ty - DOT / 2}px, 0)`;
    };
    const snapRing = () => {
      sx[0] = tx;
      sx[1] = 0;
      sy[0] = ty;
      sy[1] = 0;
      writeRing();
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
      lastFrame = now;
      const scaleTarget = pressed ? PRESS_SCALE : 1;
      if (reducedRef.current) {
        // Reduced motion: no lag, no squeeze animation.
        sx[0] = tx;
        sy[0] = ty;
        sx[1] = sy[1] = ss[1] = 0;
        ss[0] = scaleTarget;
      } else {
        dampTo(sx, tx, OMEGA, dt);
        dampTo(sy, ty, OMEGA, dt);
        dampTo(ss, scaleTarget, OMEGA_SCALE, dt);
      }
      const settled =
        Math.abs(sx[0] - tx) < 0.05 &&
        Math.abs(sy[0] - ty) < 0.05 &&
        Math.abs(sx[1]) + Math.abs(sy[1]) < 0.5 &&
        Math.abs(ss[0] - scaleTarget) < 0.001;
      if (settled) {
        // Land exactly and stop: no rAF while the mouse rests.
        sx[0] = tx;
        sy[0] = ty;
        ss[0] = scaleTarget;
        sx[1] = sy[1] = ss[1] = 0;
        writeRing();
        raf = 0;
        return;
      }
      writeRing();
      raf = requestAnimationFrame(frame);
    };
    const kick = () => {
      if (raf !== 0) return;
      lastFrame = performance.now();
      raf = requestAnimationFrame(frame);
    };

    const idleCheck = () => {
      idleTimer = 0;
      if (!presenting) return;
      const remaining = IDLE_HIDE_MS - (performance.now() - lastActivity);
      if (remaining > 16) {
        idleTimer = window.setTimeout(idleCheck, remaining);
        return;
      }
      idleHidden = true;
      applyVisibility();
    };
    const noteActivity = () => {
      lastActivity = performance.now();
      if (idleHidden) {
        idleHidden = false;
        applyVisibility();
      }
      if (presenting && idleTimer === 0) idleTimer = window.setTimeout(idleCheck, IDLE_HIDE_MS);
    };

    const isOnStage = (target: EventTarget | null): boolean => {
      if (target !== lastTarget) {
        lastTarget = target;
        lastTargetOnStage = target instanceof Element && target.closest(STAGE_SELECTOR) !== null;
      }
      return lastTargetOnStage;
    };

    const hide = () => {
      overStage = false;
      pressed = false;
      applyVisibility();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') {
        hide();
        return;
      }
      tx = e.clientX;
      ty = e.clientY;
      writeDot();
      const onStage = isOnStage(e.target);
      // Re-appearing (from chrome or outside the window): start at the pointer, no fly-in.
      if (onStage && !overStage) snapRing();
      overStage = onStage;
      noteActivity();
      applyVisibility();
      if (overStage) kick();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') {
        hide();
        return;
      }
      if (!isOnStage(e.target)) return;
      pressed = true;
      noteActivity();
      kick();
    };
    const onPointerUp = () => {
      if (!pressed) return;
      pressed = false;
      kick();
    };
    // Leaving the window: `mouseout` with no element to go to.
    const onMouseOut = (e: MouseEvent) => {
      if (e.relatedTarget === null) hide();
    };

    const unsubscribe = useGlyphStore.subscribe((s) => {
      if (s.uiHidden === presenting) return;
      presenting = s.uiHidden;
      window.clearTimeout(idleTimer);
      idleTimer = 0;
      if (presenting) {
        lastActivity = performance.now();
        idleTimer = window.setTimeout(idleCheck, IDLE_HIDE_MS);
      } else if (idleHidden) {
        idleHidden = false;
        applyVisibility();
      }
    });
    if (presenting) idleTimer = window.setTimeout(idleCheck, IDLE_HIDE_MS);

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('pointercancel', onPointerUp, { passive: true });
    window.addEventListener('blur', hide);
    document.addEventListener('mouseout', onMouseOut);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('blur', hide);
      document.removeEventListener('mouseout', onMouseOut);
      unsubscribe();
      cancelAnimationFrame(raf);
      window.clearTimeout(idleTimer);
    };
  }, []);

  const ornament = (on: boolean) => cx('transition-opacity duration-300 ease-expo', on ? 'opacity-100' : 'opacity-0');

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden opacity-0 transition-opacity duration-200"
    >
      {/* React 19 hoists this into <head> once (deduplicated by href). */}
      <style href="glyphfield-custom-cursor" precedence="default">
        {HIDE_NATIVE_CURSOR}
      </style>
      <svg
        ref={ringRef}
        width={BOX}
        height={BOX}
        viewBox={`0 0 ${BOX} ${BOX}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="absolute left-0 top-0 text-ink/50 will-change-transform"
      >
        <circle cx={HALF} cy={HALF} r={RING_RADIUS} />
        <path d={CROSSHAIR} className={ornament(mode === 'attractor')} />
        <g className={ornament(mode === 'topology')}>
          <path d={ROTATION_ARC} />
          <path d={ROTATION_ARC} transform={`rotate(180 ${HALF} ${HALF})`} />
        </g>
      </svg>
      <span
        ref={dotRef}
        className="absolute left-0 top-0 h-[3px] w-[3px] rounded-full bg-mint shadow-[0_0_6px_rgb(185_245_208_/_0.7)] will-change-transform"
      />
    </div>
  );
}
