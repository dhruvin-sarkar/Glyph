import { useEffect, useRef } from 'react';
import { createEngine } from '../engine/Engine';
import { EXPERIMENT_ORDER } from '../engine/types';
import type { EngineAPI } from '../engine/types';
import { FACTORIES, META_BY_ID } from '../experiments/registry';
import { prefersReducedMotion, useReducedMotion } from '../hooks/useReducedMotion';
import { useLiveStore } from '../state/live';
import { useGlyphStore } from '../state/store';

/**
 * The stage: a full-bleed canvas owned by the engine, plus the low-resolution
 * glow layer above it. React renders this almost never; the engine draws every
 * frame on its own and talks to React only through two stores:
 *
 *   store → engine   useGlyphStore.subscribe — mode, params, paused, adaptive, reset
 *   engine → store   useLiveStore — stats ≈ 4×/s, probe ≈ 8×/s
 */
export default function StageCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glowRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<EngineAPI | null>(null);
  const mode = useGlyphStore((s) => s.mode);
  const reducedMotion = useReducedMotion();
  const meta = META_BY_ID[mode];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const initial = useGlyphStore.getState();
    const engine = createEngine({
      canvas,
      glowCanvas: glowRef.current,
      factories: FACTORIES,
      mode: initial.mode,
      params: initial.params,
      paused: initial.paused,
      adaptive: initial.adaptive,
      reducedMotion: prefersReducedMotion(),
      onStats: (stats) => useLiveStore.getState().setStats(stats),
      onProbe: (probe) => useLiveStore.getState().setProbe(probe),
    });
    engineRef.current = engine;

    // Push only what changed, outside React rendering. Params go first so a
    // reset that also restored defaults (resetExperiment) resets the new values.
    const unsubscribe = useGlyphStore.subscribe((state, prev) => {
      if (state.params !== prev.params) {
        for (const id of EXPERIMENT_ORDER) {
          if (state.params[id] !== prev.params[id]) engine.setParams(id, state.params[id]);
        }
      }
      if (state.mode !== prev.mode) engine.setMode(state.mode);
      if (state.paused !== prev.paused) engine.setPaused(state.paused);
      if (state.adaptive !== prev.adaptive) engine.setAdaptive(state.adaptive);
      if (state.resetNonce !== prev.resetNonce) engine.resetSimulation();
    });

    return () => {
      unsubscribe();
      engine.destroy();
      engineRef.current = null;
      useLiveStore.getState().setProbe(null);
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setReducedMotion(reducedMotion);
  }, [reducedMotion]);

  return (
    <>
      <canvas
        ref={canvasRef}
        data-glyph-stage=""
        role="img"
        aria-label={`${meta.name} — ${meta.subtitle}`}
        className="fixed inset-0 z-0 block h-full w-full touch-none select-none outline-none [@media(pointer:fine)]:cursor-none"
      />
      {/* Phosphor halo: the renderer sizes, blurs and blends this layer itself. */}
      <canvas ref={glowRef} aria-hidden="true" className="pointer-events-none fixed z-[1]" />
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {`Experiment ${meta.index}: ${meta.name}`}
      </p>
    </>
  );
}
