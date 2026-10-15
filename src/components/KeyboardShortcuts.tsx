import { useEffect } from 'react';
import { EXPERIMENT_ORDER } from '../engine/types';
import { useGlyphStore } from '../state/store';
import {
  isSpaceKey,
  isTextEntry,
  ownsArrowKeys,
  resolveShortcut,
  type ShortcutAction,
} from './controls/shortcuts';

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};
type FullscreenRoot = HTMLElement & { webkitRequestFullscreen?: () => void };

const ignore = (): void => {};

/** F — enter or leave fullscreen on the whole page (Safari still needs the webkit prefix). */
function toggleFullscreen(): void {
  const doc = document as FullscreenDocument;
  const root = document.documentElement as FullscreenRoot;
  try {
    if (doc.fullscreenElement ?? doc.webkitFullscreenElement) {
      if (typeof doc.exitFullscreen === 'function') void Promise.resolve(doc.exitFullscreen()).catch(ignore);
      else doc.webkitExitFullscreen?.();
    } else if (typeof root.requestFullscreen === 'function') {
      void Promise.resolve(root.requestFullscreen({ navigationUI: 'hide' })).catch(ignore);
    } else {
      root.webkitRequestFullscreen?.();
    }
  } catch {
    // Fullscreen can be refused (iframe policy, kiosk browser, iPhone): the key then does nothing.
  }
}

function perform(action: ShortcutAction): void {
  const s = useGlyphStore.getState();
  switch (action.kind) {
    case 'pause':
      s.togglePaused();
      break;
    case 'mode': {
      const id = EXPERIMENT_ORDER[action.index];
      if (id) s.setMode(id);
      break;
    }
    case 'cycle':
      s.cycleMode(action.direction);
      break;
    case 'reset':
      s.resetExperiment();
      break;
    case 'math':
      if (s.shortcutsOpen) s.setShortcutsOpen(false);
      s.toggleMath();
      break;
    case 'panel':
      // In presentation mode P brings the interface back with the panel open.
      if (s.uiHidden) {
        s.setUiHidden(false);
        s.setPanelOpen(true);
      } else {
        s.togglePanel();
      }
      break;
    case 'ui':
      s.toggleUi();
      break;
    case 'fullscreen':
      toggleFullscreen();
      break;
    case 'shortcuts':
      s.setShortcutsOpen(!s.shortcutsOpen);
      break;
    case 'escape':
      break;
  }
}

/**
 * Esc closes one layer per press, top-most first: the shortcuts overlay, then
 * THE MATH drawer, then presentation mode. Returns true if something closed.
 */
function escapeOneLayer(e: KeyboardEvent): boolean {
  const s = useGlyphStore.getState();
  if (s.shortcutsOpen) {
    s.setShortcutsOpen(false);
    // The drawer must not hear this same Esc and close too.
    e.stopPropagation();
    return true;
  }
  if (s.mathOpen) {
    s.setMathOpen(false);
    return true;
  }
  if (s.uiHidden) {
    s.setUiHidden(false);
    return true;
  }
  return false;
}

const targetOf = (e: KeyboardEvent): Element | null => (e.target instanceof Element ? e.target : null);

/**
 * The global keyboard map (SPEC §8). Renders nothing.
 * One capture-phase listener on window sees every key before any focused
 * control, which is how Space can pause the field without "clicking" the
 * button that happens to have focus. Never re-renders: it reads the store
 * imperatively.
 */
export default function KeyboardShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented) return;
      const target = targetOf(e);
      if (isTextEntry(target)) return; // typing always wins
      if (isSpaceKey(e) && target?.closest('summary')) return;
      const action = resolveShortcut(e);
      if (!action) return;
      // Sliders, radio groups and tab lists keep their own arrow keys.
      if (action.kind === 'cycle' && ownsArrowKeys(target)) return;

      if (action.kind === 'escape') {
        if (!e.repeat && escapeOneLayer(e)) e.preventDefault();
        return;
      }

      // Handled: no page scroll, no button activation, no find-as-you-type.
      e.preventDefault();
      if (e.repeat) return; // holding a key never machine-guns an action
      perform(action);
    };

    // Firefox activates a focused button on Space *keyup*: swallow that too.
    const onKeyUp = (e: KeyboardEvent) => {
      if (!isSpaceKey(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = targetOf(e);
      if (isTextEntry(target) || target?.closest('summary')) return;
      e.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, []);

  return null;
}
