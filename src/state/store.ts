import { create } from 'zustand';
import type { ExperimentId, ParamValue, ParamValues } from '../engine/types';
import { EXPERIMENT_ORDER } from '../engine/types';
import { defaultParams, getParamDef, sanitizeParam } from '../experiments/registry';

/**
 * App state — changes only on user input (never per frame).
 * The engine is driven from here by StageCanvas via `useGlyphStore.subscribe`.
 * Components must select narrowly: `const mode = useGlyphStore((s) => s.mode)`.
 */
export interface GlyphState {
  /** active experiment */
  mode: ExperimentId;
  /** current parameters of every experiment (kept when switching away) */
  params: Record<ExperimentId, ParamValues>;
  paused: boolean;
  /** adaptive quality (engine lowers glyph density when FPS drops) */
  adaptive: boolean;
  panelOpen: boolean;
  mathOpen: boolean;
  /** presentation mode — all chrome hidden, only the field */
  uiHidden: boolean;
  shortcutsOpen: boolean;
  /** the giant hero title has condensed into a compact chapter heading */
  heroCollapsed: boolean;
  /** exhibition auto-tour is running */
  touring: boolean;
  /** incremented to ask the engine to reset the active simulation */
  resetNonce: number;
  /** most recent parameter change (equation displays flash the matching value) */
  lastChange: { mode: ExperimentId; key: string; at: number } | null;

  setMode: (mode: ExperimentId) => void;
  /** step through experiments in dock order (wraps) */
  cycleMode: (direction?: 1 | -1) => void;
  setParam: (mode: ExperimentId, key: string, value: ParamValue) => void;
  /** merge several values at once (presets, auto tour) */
  applyPreset: (mode: ExperimentId, values: Partial<ParamValues>) => void;
  /** params → defaults AND simulation reset ("reset to a visually beautiful default") */
  resetExperiment: (mode?: ExperimentId) => void;
  /** simulation reset only (camera, particles, ripples) */
  resetSimulation: () => void;
  setPaused: (paused: boolean) => void;
  togglePaused: () => void;
  setAdaptive: (adaptive: boolean) => void;
  setPanelOpen: (open: boolean) => void;
  togglePanel: () => void;
  setMathOpen: (open: boolean) => void;
  toggleMath: () => void;
  setUiHidden: (hidden: boolean) => void;
  toggleUi: () => void;
  setShortcutsOpen: (open: boolean) => void;
  setHeroCollapsed: (collapsed: boolean) => void;
  setTouring: (touring: boolean) => void;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function initialParams(): Record<ExperimentId, ParamValues> {
  return {
    waves: defaultParams('waves'),
    attractor: defaultParams('attractor'),
    topology: defaultParams('topology'),
  };
}

export const useGlyphStore = create<GlyphState>()((set, get) => ({
  mode: 'waves',
  params: initialParams(),
  paused: false,
  adaptive: true,
  panelOpen: true,
  mathOpen: false,
  uiHidden: false,
  shortcutsOpen: false,
  heroCollapsed: false,
  touring: false,
  resetNonce: 0,
  lastChange: null,

  setMode: (mode) =>
    set((s) => (s.mode === mode ? s : { mode, heroCollapsed: s.heroCollapsed || mode !== 'waves' })),

  cycleMode: (direction = 1) => {
    const i = EXPERIMENT_ORDER.indexOf(get().mode);
    const next = EXPERIMENT_ORDER[(i + direction + EXPERIMENT_ORDER.length) % EXPERIMENT_ORDER.length];
    get().setMode(next);
  },

  setParam: (mode, key, value) => {
    const def = getParamDef(mode, key);
    if (!def) return;
    const clean = sanitizeParam(def, value);
    set((s) => {
      if (s.params[mode][key] === clean) return s;
      return {
        params: { ...s.params, [mode]: { ...s.params[mode], [key]: clean } },
        lastChange: { mode, key, at: now() },
      };
    });
  },

  applyPreset: (mode, values) =>
    set((s) => {
      const next: ParamValues = { ...s.params[mode] };
      let lastKey: string | null = null;
      for (const [key, value] of Object.entries(values)) {
        const def = getParamDef(mode, key);
        if (!def || value === undefined) continue;
        next[key] = sanitizeParam(def, value);
        lastKey = key;
      }
      return {
        params: { ...s.params, [mode]: next },
        lastChange: lastKey ? { mode, key: lastKey, at: now() } : s.lastChange,
      };
    }),

  resetExperiment: (mode) => {
    const target = mode ?? get().mode;
    set((s) => ({
      params: { ...s.params, [target]: defaultParams(target) },
      resetNonce: target === s.mode ? s.resetNonce + 1 : s.resetNonce,
      lastChange: null,
    }));
  },

  resetSimulation: () => set((s) => ({ resetNonce: s.resetNonce + 1 })),

  setPaused: (paused) => set({ paused }),
  togglePaused: () => set((s) => ({ paused: !s.paused })),
  setAdaptive: (adaptive) => set({ adaptive }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  setMathOpen: (mathOpen) => set({ mathOpen }),
  toggleMath: () => set((s) => ({ mathOpen: !s.mathOpen })),
  setUiHidden: (uiHidden) => set({ uiHidden }),
  toggleUi: () => set((s) => ({ uiHidden: !s.uiHidden })),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setHeroCollapsed: (heroCollapsed) => set({ heroCollapsed }),
  setTouring: (touring) => set({ touring }),
}));
