import { useId, useState } from 'react';
import { motion } from 'motion/react';
import { Pause, Play, RotateCcw, Sigma, type LucideIcon } from 'lucide-react';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useLiveStore } from '../../state/live';
import { useGlyphStore } from '../../state/store';
import { cx } from '../ui/primitives';
import KeyCap from './KeyCap';
import Toggle from './Toggle';
import type { KeyToken } from './shortcuts';
import { EASE_EXPO } from './motion';
import { useValueFlash } from './useValueFlash';

/**
 * Panel footer: the three commands every visitor needs (pause, reset, the
 * maths) with their keys, then adaptive quality and the
 * density the engine is actually drawing at.
 * `compact` (the phone sheet) drops the key caps: there is no keyboard there.
 */
export default function PanelFooter({ compact = false }: { compact?: boolean }) {
  const paused = useGlyphStore((s) => s.paused);
  const mathOpen = useGlyphStore((s) => s.mathOpen);
  const resetNonce = useGlyphStore((s) => s.resetNonce);
  // Every reset (button or R key) spins the reset icon one turn backwards.
  const [baseNonce] = useState(resetNonce);

  return (
    <footer className="gf-panel-footer shrink-0 border-t border-line">
      <div className="gf-command-bar">
        <CommandTile
          icon={paused ? Play : Pause}
          label={paused ? 'Play' : 'Pause'}
          keyHint="Space"
          shortcut="Space"
          active={paused}
          compact={compact}
          onClick={() => useGlyphStore.getState().togglePaused()}
        />
        <CommandTile
          icon={RotateCcw}
          label="Reset"
          keyHint="R"
          shortcut="R"
          turns={resetNonce - baseNonce}
          compact={compact}
          onClick={() => useGlyphStore.getState().resetExperiment()}
        />
        <CommandTile
          icon={Sigma}
          label="The math"
          keyHint="M"
          shortcut="M"
          active={mathOpen}
          expanded={mathOpen}
          compact={compact}
          onClick={() => useGlyphStore.getState().toggleMath()}
        />
      </div>
      <SystemLine />
    </footer>
  );
}

interface CommandTileProps {
  icon: LucideIcon;
  label: string;
  /** aria-keyshortcuts value */
  shortcut: string;
  /** the key cap drawn on the tile */
  keyHint: KeyToken;
  active?: boolean;
  /** set for disclosure buttons (the maths drawer) */
  expanded?: boolean;
  /** completed counter-clockwise turns of the icon */
  turns?: number;
  compact: boolean;
  onClick: () => void;
}

function CommandTile({
  icon: Icon,
  label,
  shortcut,
  keyHint,
  active = false,
  expanded,
  turns = 0,
  compact,
  onClick,
}: CommandTileProps) {
  const reduced = useReducedMotion();
  return (
    <button
      type="button"
      aria-keyshortcuts={shortcut}
      aria-expanded={expanded}
      onClick={onClick}
      className={cx(
        'gf-command',
        compact && 'gf-command-compact',
        active && 'gf-command-active',
      )}
    >
      <span className={cx('flex items-center', !compact && 'w-full justify-between')}>
        <motion.span
          className="inline-flex"
          initial={false}
          animate={{ rotate: reduced ? 0 : turns * -360 }}
          transition={{ duration: 0.75, ease: EASE_EXPO }}
        >
          <Icon size={14} strokeWidth={1.5} aria-hidden="true" />
        </motion.span>
        {compact ? null : <KeyCap token={keyHint} />}
      </span>
      <span className="gf-command-label">{label}</span>
    </button>
  );
}

function SystemLine() {
  const adaptive = useGlyphStore((s) => s.adaptive);
  const quality = useLiveStore((s) => s.stats.quality);
  const percent = Math.round(Math.min(1, Math.max(0, Number.isFinite(quality) ? quality : 1)) * 100);
  const flashRef = useValueFlash<HTMLSpanElement>(percent);
  const toggleId = useId();
  const hintId = `${toggleId}-hint`;

  return (
    <div className="gf-system-line">
      <div className="min-w-0">
        <label htmlFor={toggleId} className="gf-system-label">Adaptive quality</label>
        <p id={hintId} className="gf-system-hint">Keeps the motion smooth.</p>
      </div>
      <Toggle id={toggleId} checked={adaptive} describedBy={hintId} onChange={(on) => useGlyphStore.getState().setAdaptive(on)} />
      <span
        className="gf-system-quality font-mono tabular"
        title="Glyph density the engine is drawing at"
      >
        <span ref={flashRef}>{percent}%</span>
        <span className="sr-only"> render quality</span>
      </span>
    </div>
  );
}
