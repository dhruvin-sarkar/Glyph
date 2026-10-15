import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { AnimatePresence, motion, useDragControls, type PanInfo } from 'motion/react';
import { ChevronDown, Keyboard, Minus, Plus, SlidersHorizontal } from 'lucide-react';
import type { ExperimentId } from '../engine/types';
import { META_BY_ID } from '../experiments/registry';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useLiveStore } from '../state/live';
import { useGlyphStore } from '../state/store';
import ScrambleText from './ui/ScrambleText';
import { IconButton, MicroLabel, cx } from './ui/primitives';
import PanelFooter from './controls/PanelFooter';
import ParamList from './controls/ParamList';
import { EASE_EXPO } from './controls/motion';
import { MOBILE_QUERY, useMediaQuery } from './controls/useMediaQuery';
import '../styles/controls.css';

/** If the engine never reports `ready` (e.g. no canvas support) the controls still appear. */
const ENTRANCE_FALLBACK_MS = 3200;

/**
 * PARAMETERS — the instrument panel (SPEC §6–8).
 *  · desktop/tablet: a glass panel top-right that minimises into a pill;
 *  · phones (< 768 px): a sheet that rises from a PARAMETERS pill above the dock,
 *    closed by default.
 */
export default function ParameterPanel() {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const open = useGlyphStore((s) => s.panelOpen);
  const visible = useEntranceGate();

  // The store defaults to "open" for desktop; a phone starts with the sheet closed.
  // A layout effect runs before paint, so the sheet never flashes open.
  useLayoutEffect(() => {
    if (isMobile) useGlyphStore.getState().setPanelOpen(false);
  }, [isMobile]);

  if (!visible) return null;
  return isMobile ? <MobilePanel open={open} /> : <DesktopPanel open={open} />;
}

/** True once the engine has drawn its first frame (or after a fallback delay) — and then forever. */
function useEntranceGate(): boolean {
  const ready = useLiveStore((s) => s.stats.ready);
  const [latched, setLatched] = useState(false);
  useEffect(() => {
    if (latched) return;
    if (ready) {
      setLatched(true);
      return;
    }
    const timer = window.setTimeout(() => setLatched(true), ENTRANCE_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [ready, latched]);
  return latched || ready;
}

/**
 * Keyboard continuity when the panel and its pill swap places: if focus was
 * inside the element that disappears, it lands on the element that appears
 * (the pill, or the panel's minimise button). Toggling with the P key moves
 * nothing — focus is never stolen.
 */
function useFocusHandoff() {
  const armed = useRef(false);
  const arm = useCallback((from: Element | null) => {
    armed.current = from !== null && from.contains(document.activeElement);
  }, []);
  const receive = useCallback((el: HTMLElement | null) => {
    if (!el || !armed.current) return;
    armed.current = false;
    const target = el instanceof HTMLButtonElement ? el : el.querySelector<HTMLElement>('[data-gf-autofocus]');
    target?.focus({ preventScroll: true });
  }, []);
  return { arm, receive };
}

/* ─── Desktop / tablet ──────────────────────────────────────────────────── */

function DesktopPanel({ open }: { open: boolean }) {
  const reduced = useReducedMotion();
  const { arm, receive } = useFocusHandoff();

  const minimise = (e: MouseEvent<HTMLButtonElement>) => {
    arm(e.currentTarget.closest('section'));
    useGlyphStore.getState().setPanelOpen(false);
  };
  const expand = (e: MouseEvent<HTMLButtonElement>) => {
    arm(e.currentTarget);
    useGlyphStore.getState().setPanelOpen(true);
  };

  return (
    <motion.div
      className="gf-panel-anchor"
      initial={{ opacity: 0, y: reduced ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? { duration: 0.15 } : { duration: 0.9, delay: 0.35, ease: EASE_EXPO }}
    >
      <AnimatePresence initial={false}>
        {open ? (
          <motion.section
            key="panel"
            ref={receive}
            aria-label="Parameters"
            className="gf-panel glass pointer-events-auto absolute right-0 top-0 flex w-full flex-col overflow-hidden rounded-[18px]"
            initial={{ opacity: 0, scale: reduced ? 1 : 0.97, y: reduced ? 0 : -6 }}
            animate={{
              opacity: 1,
              scale: 1,
              y: 0,
              transition: reduced ? { duration: 0.15 } : { duration: 0.5, ease: EASE_EXPO },
            }}
            exit={{
              opacity: 0,
              scale: reduced ? 1 : 0.97,
              y: reduced ? 0 : -6,
              pointerEvents: 'none',
              transition: { duration: reduced ? 0.12 : 0.22, ease: EASE_EXPO },
            }}
          >
            <PanelSurface variant="panel" onMinimise={minimise} />
          </motion.section>
        ) : (
          <motion.button
            key="pill"
            ref={receive}
            type="button"
            aria-label="Show parameters"
            aria-keyshortcuts="P"
            title="Show parameters (P)"
            onClick={expand}
            className={cx(
              'gf-pill glass pointer-events-auto absolute right-0 top-0 inline-flex h-9 items-center gap-2.5 rounded-full pl-4 pr-3',
              'text-ink/80 transition-colors duration-200 ease-expo hover:text-ink',
            )}
            initial={{ opacity: 0, scale: reduced ? 1 : 0.9 }}
            animate={{
              opacity: 1,
              scale: 1,
              transition: reduced ? { duration: 0.15 } : { duration: 0.45, delay: 0.08, ease: EASE_EXPO },
            }}
            exit={{ opacity: 0, scale: reduced ? 1 : 0.9, pointerEvents: 'none', transition: { duration: 0.14 } }}
          >
            <span className="micro">Parameters</span>
            <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ─── Phone: bottom sheet ───────────────────────────────────────────────── */

/** Drag distance / flick speed past which the sheet closes. */
const SHEET_CLOSE_OFFSET = 72;
const SHEET_CLOSE_VELOCITY = 520;

function MobilePanel({ open }: { open: boolean }) {
  const reduced = useReducedMotion();
  const drag = useDragControls();
  const { arm, receive } = useFocusHandoff();

  const close = (e: MouseEvent<HTMLButtonElement>) => {
    arm(e.currentTarget.closest('section'));
    useGlyphStore.getState().setPanelOpen(false);
  };
  const show = (e: MouseEvent<HTMLButtonElement>) => {
    arm(e.currentTarget);
    useGlyphStore.getState().setPanelOpen(true);
  };
  const onDragEnd = (_event: globalThis.MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (info.offset.y > SHEET_CLOSE_OFFSET || info.velocity.y > SHEET_CLOSE_VELOCITY) {
      useGlyphStore.getState().setPanelOpen(false);
    }
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.section
          key="sheet"
          ref={receive}
          aria-label="Parameters"
          className="gf-sheet glass pointer-events-auto flex flex-col overflow-hidden"
          drag="y"
          dragListener={false}
          dragControls={drag}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0.04, bottom: 0.65 }}
          dragMomentum={false}
          onDragEnd={onDragEnd}
          initial={{ opacity: 0, y: reduced ? 0 : 28 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: reduced ? { duration: 0.15 } : { duration: 0.5, ease: EASE_EXPO },
          }}
          exit={{
            opacity: 0,
            y: reduced ? 0 : 36,
            pointerEvents: 'none',
            transition: { duration: reduced ? 0.12 : 0.24, ease: EASE_EXPO },
          }}
        >
          {/* drag handle: pull the sheet down to dismiss it */}
          <div className="gf-sheet-handle" aria-hidden="true" onPointerDown={(e) => drag.start(e)} />
          <PanelSurface variant="sheet" onMinimise={close} />
        </motion.section>
      ) : (
        <motion.button
          key="pill"
          ref={receive}
          type="button"
          aria-label="Show parameters"
          onClick={show}
          className="gf-sheet-pill glass pointer-events-auto inline-flex h-9 items-center gap-2 rounded-full pl-3.5 pr-4 text-ink/85"
          initial={{ opacity: 0, y: reduced ? 0 : 8 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: reduced ? { duration: 0.15 } : { duration: 0.6, delay: 0.3, ease: EASE_EXPO },
          }}
          exit={{ opacity: 0, pointerEvents: 'none', transition: { duration: 0.12 } }}
        >
          <SlidersHorizontal size={14} strokeWidth={1.5} aria-hidden="true" />
          <span className="micro">Parameters</span>
        </motion.button>
      )}
    </AnimatePresence>
  );
}

/* ─── Shared surface: header · rows · footer ────────────────────────────── */

type SurfaceVariant = 'panel' | 'sheet';

function PanelSurface({
  variant,
  onMinimise,
}: {
  variant: SurfaceVariant;
  onMinimise: (e: MouseEvent<HTMLButtonElement>) => void;
}) {
  const mode = useGlyphStore((s) => s.mode);
  return (
    <>
      <PanelHeader mode={mode} variant={variant} onMinimise={onMinimise} />
      <ParamList mode={mode} />
      <PanelFooter compact={variant === 'sheet'} />
    </>
  );
}

function PanelHeader({
  mode,
  variant,
  onMinimise,
}: {
  mode: ExperimentId;
  variant: SurfaceVariant;
  onMinimise: (e: MouseEvent<HTMLButtonElement>) => void;
}) {
  const meta = META_BY_ID[mode];
  const sheet = variant === 'sheet';
  return (
    <header
      className={cx('gf-panel-header shrink-0 border-b border-line', sheet && 'gf-panel-header-sheet')}
    >
      <div className="min-w-0">
        <MicroLabel>Parameters</MicroLabel>
        <p className="gf-panel-title">
          <span className="gf-panel-index font-mono tabular">{meta.index}</span>
          <span aria-hidden="true" className="text-faint">
            /
          </span>
          <ScrambleText text={meta.name} className="truncate" duration={520} />
        </p>
      </div>
      <div className="gf-panel-header-actions">
        {sheet ? null : (
          <IconButton
            size="md"
            label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
            onClick={() => useGlyphStore.getState().setShortcutsOpen(true)}
          >
            <Keyboard size={14} strokeWidth={1.5} aria-hidden="true" />
          </IconButton>
        )}
        <IconButton
          size="md"
          label={sheet ? 'Close parameters' : 'Minimise parameters'}
          title={sheet ? 'Close parameters' : 'Minimise parameters (P)'}
          aria-keyshortcuts="P"
          data-gf-autofocus=""
          onClick={onMinimise}
        >
          {sheet ? (
            <ChevronDown size={15} strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <Minus size={14} strokeWidth={1.5} aria-hidden="true" />
          )}
        </IconButton>
      </div>
    </header>
  );
}
