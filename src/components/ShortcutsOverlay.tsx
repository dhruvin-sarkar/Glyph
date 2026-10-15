import { useEffect, useId, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useGlyphStore } from '../state/store';
import { IconButton, MicroLabel } from './ui/primitives';
import KeyCap from './controls/KeyCap';
import { SHORTCUTS } from './controls/shortcuts';
import { EASE_EXPO } from './controls/motion';
import '../styles/controls.css';

type CSSVars = CSSProperties & Record<`--${string}`, string | number>;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const NOTES = [
  'Double-click any slider to restore its default.',
  'Shift + arrow keys move a focused slider ten steps at a time.',
  'After 90 seconds without input the installation tours itself.',
];

/**
 * KEYBOARD — every shortcut on one glass card (SPEC §8). Opened with "?" or the
 * keyboard button; closed with Esc (KeyboardShortcuts), the backdrop or ×.
 * Focus moves into the card on open and returns to where it was on close.
 */
export default function ShortcutsOverlay() {
  const open = useGlyphStore((s) => s.shortcutsOpen);
  return <AnimatePresence>{open ? <ShortcutsDialog key="keyboard" /> : null}</AnimatePresence>;
}

function ShortcutsDialog() {
  const reduced = useReducedMotion();
  const cardRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = () => useGlyphStore.getState().setShortcutsOpen(false);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cardRef.current?.querySelector<HTMLElement>('[data-gf-autofocus]')?.focus({ preventScroll: true });
    return () => {
      if (previous && previous !== document.body && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  // Keep Tab inside the dialog while it is open.
  const trapFocus = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const card = cardRef.current;
    if (!card) return;
    const items = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !card.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !card.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };

  const rows: CSSVars = { '--rows': Math.ceil(SHORTCUTS.length / 2) };

  return (
    <motion.div
      className="fixed inset-0 z-40 flex items-center justify-center px-(--gutter) py-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0.12 : 0.28, ease: 'easeOut' }}
    >
      <div aria-hidden="true" className="absolute inset-0 bg-[#03060a]/60" onClick={close} />

      <motion.div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={trapFocus}
        className="glass gf-scrollbar relative max-h-full w-full max-w-[660px] overflow-y-auto overscroll-contain rounded-[18px] px-6 pb-6 pt-5 sm:px-7 sm:pb-7 sm:pt-6"
        initial={{ opacity: 0, y: reduced ? 0 : 14, scale: reduced ? 1 : 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: reduced ? 0 : 8, scale: reduced ? 1 : 0.99 }}
        transition={reduced ? { duration: 0.15 } : { duration: 0.5, ease: EASE_EXPO }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <MicroLabel id={titleId}>Keyboard</MicroLabel>
            <p className="mt-2.5 max-w-[34ch] text-[15px] leading-[1.45] text-ink/85">
              The whole installation can be played from the keyboard.
            </p>
          </div>
          <IconButton label="Close" title="Close (Esc)" aria-keyshortcuts="Escape" data-gf-autofocus="" onClick={close}>
            <X size={15} strokeWidth={1.5} aria-hidden="true" />
          </IconButton>
        </div>

        <ul className="gf-keys mt-6" style={rows}>
          {SHORTCUTS.map((shortcut) => (
            <li key={shortcut.label} className="flex items-center gap-4 border-t border-line py-[11px]">
              <span className="flex w-[78px] shrink-0 items-center gap-1">
                {shortcut.keys.map((token) => (
                  <KeyCap key={token} token={token} />
                ))}
              </span>
              <span className="text-[13px] leading-snug text-ink/80">{shortcut.label}</span>
            </li>
          ))}
        </ul>

        <div className="mt-5 border-t border-line pt-4">
          <MicroLabel>Instrument</MicroLabel>
          <ul className="mt-2.5 space-y-1.5 text-[12.5px] leading-[1.5] text-muted">
            {NOTES.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      </motion.div>
    </motion.div>
  );
}
