import { useGlyphStore } from './state/store';
import { useLiveStore } from './state/live';

declare global {
  interface Window {
    /** QA handle — present in dev builds, or in any build opened with `?debug`. */
    __GLYPHFIELD__?: { store: typeof useGlyphStore; live: typeof useLiveStore };
  }
}

/** Expose the stores for automated visual QA (scripts/shoot.mjs). */
export function installDebugHandle(): void {
  if (typeof window === 'undefined') return;
  if (import.meta.env.DEV || new URLSearchParams(window.location.search).has('debug')) {
    window.__GLYPHFIELD__ = { store: useGlyphStore, live: useLiveStore };
  }
}
