import { create } from 'zustand';
import type { EngineStats, ProbeReadout } from '../engine/types';

/**
 * High-frequency engine readouts, kept OUT of the main store so that UI which
 * only cares about params/mode never re-renders on stats ticks.
 * Written by StageCanvas (stats ~4×/s, probe ~8×/s). Always select narrowly:
 *   const fps = useLiveStore((s) => s.stats.fps);
 */
export const INITIAL_STATS: EngineStats = {
  fps: 0,
  frameMs: 0,
  glyphs: 0,
  cols: 0,
  rows: 0,
  cellW: 0,
  cellH: 0,
  quality: 1,
  time: 0,
  mode: 'waves',
  paused: false,
  transitioning: false,
  ready: false,
};

export interface LiveState {
  stats: EngineStats;
  probe: ProbeReadout | null;
  setStats: (stats: EngineStats) => void;
  setProbe: (probe: ProbeReadout | null) => void;
}

export const useLiveStore = create<LiveState>()((set) => ({
  stats: INITIAL_STATS,
  probe: null,
  setStats: (stats) => set({ stats }),
  setProbe: (probe) => set({ probe }),
}));
