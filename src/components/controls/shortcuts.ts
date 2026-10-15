/* ═══════════════════════════════════════════════════════════════════════════
 *  GLYPHFIELD keyboard map (docs/SPEC.md §8) — data + pure resolution logic.
 *  KeyboardShortcuts.tsx executes the actions; ShortcutsOverlay.tsx lists them.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** A key as printed on a key cap. Arrows are drawn as icons (no font fallback). */
export type KeyToken = 'Space' | 'Esc' | 'ArrowLeft' | 'ArrowRight' | (string & {});

export interface ShortcutDef {
  keys: readonly KeyToken[];
  label: string;
}

/** Every global shortcut, in the order the overlay lists them. */
export const SHORTCUTS: readonly ShortcutDef[] = [
  { keys: ['Space'], label: 'Pause / play' },
  { keys: ['1', '2', '3'], label: 'Choose an experiment' },
  { keys: ['ArrowLeft', 'ArrowRight'], label: 'Previous / next experiment' },
  { keys: ['R'], label: 'Reset the experiment' },
  { keys: ['M'], label: 'The math' },
  { keys: ['P'], label: 'Parameter panel' },
  { keys: ['H'], label: 'Hide the interface' },
  { keys: ['F'], label: 'Fullscreen' },
  { keys: ['?'], label: 'Keyboard shortcuts' },
  { keys: ['Esc'], label: 'Close overlays' },
];

export type ShortcutAction =
  | { kind: 'pause' }
  | { kind: 'mode'; index: number }
  | { kind: 'cycle'; direction: 1 | -1 }
  | { kind: 'reset' }
  | { kind: 'math' }
  | { kind: 'panel' }
  | { kind: 'ui' }
  | { kind: 'fullscreen' }
  | { kind: 'shortcuts' }
  | { kind: 'escape' };

/** The subset of KeyboardEvent the resolver needs (keeps it testable without a DOM). */
export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

const LETTER_ACTIONS: Readonly<Record<string, ShortcutAction>> = {
  r: { kind: 'reset' },
  m: { kind: 'math' },
  p: { kind: 'panel' },
  h: { kind: 'ui' },
  f: { kind: 'fullscreen' },
};

export function isSpaceKey(e: KeyLike): boolean {
  return e.key === ' ' || e.key === 'Spacebar' || e.code === 'Space';
}

/**
 * Map a key press to an action, or null when it is not a GLYPHFIELD shortcut.
 * Ctrl / Meta / Alt combinations always belong to the browser (reload, find, …).
 */
export function resolveShortcut(e: KeyLike): ShortcutAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const key = e.key;
  const code = e.code ?? '';

  if (isSpaceKey(e)) return { kind: 'pause' };
  if (key === 'Escape' || key === 'Esc') return { kind: 'escape' };
  if (key === 'ArrowLeft' || key === 'Left') return { kind: 'cycle', direction: -1 };
  if (key === 'ArrowRight' || key === 'Right') return { kind: 'cycle', direction: 1 };
  if (key === '?') return { kind: 'shortcuts' };

  if (key === '1' || key === '2' || key === '3') return { kind: 'mode', index: Number(key) - 1 };
  // Layouts that need Shift for digits (e.g. AZERTY): fall back to the physical key.
  if (code === 'Digit1' || code === 'Digit2' || code === 'Digit3') {
    return { kind: 'mode', index: Number(code.slice(5)) - 1 };
  }

  if (key.length === 1) {
    const lower = key.toLowerCase();
    const byKey = LETTER_ACTIONS[lower];
    if (byKey) return byKey;
    // Non-Latin layouts (Cyrillic, Greek…) produce other letters: use the physical key.
    if (key.charCodeAt(0) > 127 && code.startsWith('Key')) {
      return LETTER_ACTIONS[code.slice(3).toLowerCase()] ?? null;
    }
  }
  return null;
}

/* ─── Focus-target classification (duck-typed so it is testable in Node) ── */

export interface ElementLike {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  getAttribute?(name: string): string | null;
  closest?(selector: string): unknown;
}

const TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  'text',
  'search',
  'email',
  'url',
  'tel',
  'password',
  'number',
  'date',
  'datetime-local',
  'month',
  'week',
  'time',
]);

const TEXT_ROLES: ReadonlySet<string> = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']);

/** True while the visitor is typing — every shortcut must stay out of the way. */
export function isTextEntry(el: ElementLike | null | undefined): boolean {
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return TEXT_INPUT_TYPES.has((el.type || 'text').toLowerCase());
  if (el.isContentEditable === true) return true;
  const role = el.getAttribute?.('role');
  return role != null && TEXT_ROLES.has(role);
}

const ARROW_OWNER_SELECTOR = [
  '[role="slider"]',
  '[role="radio"]',
  '[role="radiogroup"]',
  '[role="tab"]',
  '[role="tablist"]',
  '[role="listbox"]',
  '[role="option"]',
  '[role="menu"]',
  '[role="menubar"]',
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="scrollbar"]',
  '[role="tree"]',
  '[role="grid"]',
].join(',');

/**
 * True when the focused element uses ← / → itself (range inputs, radio groups,
 * tab lists…): the global "previous / next experiment" keys must not steal them.
 */
export function ownsArrowKeys(el: ElementLike | null | undefined): boolean {
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.tagName.toUpperCase() === 'INPUT') {
    const type = (el.type || '').toLowerCase();
    if (type === 'range' || type === 'radio') return true;
  }
  return Boolean(el.closest?.(ARROW_OWNER_SELECTOR));
}
