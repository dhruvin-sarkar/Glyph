import { describe, expect, it } from 'vitest';
import { SHORTCUTS, isTextEntry, ownsArrowKeys, resolveShortcut, type ElementLike } from '../shortcuts';

describe('resolveShortcut', () => {
  it('maps the SPEC §8 keyboard map', () => {
    expect(resolveShortcut({ key: ' ', code: 'Space' })).toEqual({ kind: 'pause' });
    expect(resolveShortcut({ key: '1' })).toEqual({ kind: 'mode', index: 0 });
    expect(resolveShortcut({ key: '3' })).toEqual({ kind: 'mode', index: 2 });
    expect(resolveShortcut({ key: 'ArrowLeft' })).toEqual({ kind: 'cycle', direction: -1 });
    expect(resolveShortcut({ key: 'ArrowRight' })).toEqual({ kind: 'cycle', direction: 1 });
    expect(resolveShortcut({ key: 'r' })).toEqual({ kind: 'reset' });
    expect(resolveShortcut({ key: 'M' })).toEqual({ kind: 'math' });
    expect(resolveShortcut({ key: 'p' })).toEqual({ kind: 'panel' });
    expect(resolveShortcut({ key: 'h' })).toEqual({ kind: 'ui' });
    expect(resolveShortcut({ key: 'f' })).toEqual({ kind: 'fullscreen' });
    expect(resolveShortcut({ key: '?' })).toEqual({ kind: 'shortcuts' });
    expect(resolveShortcut({ key: 'Escape' })).toEqual({ kind: 'escape' });
  });

  it('leaves browser combinations alone', () => {
    expect(resolveShortcut({ key: 'r', ctrlKey: true })).toBeNull();
    expect(resolveShortcut({ key: 'f', metaKey: true })).toBeNull();
    expect(resolveShortcut({ key: '1', altKey: true })).toBeNull();
  });

  it('ignores keys that are not shortcuts', () => {
    expect(resolveShortcut({ key: 'x' })).toBeNull();
    expect(resolveShortcut({ key: '4' })).toBeNull();
    expect(resolveShortcut({ key: 'Enter' })).toBeNull();
    expect(resolveShortcut({ key: 'ArrowUp' })).toBeNull();
  });

  it('falls back to physical keys on other layouts', () => {
    // AZERTY: the "1" key types "&" without Shift
    expect(resolveShortcut({ key: '&', code: 'Digit1' })).toEqual({ kind: 'mode', index: 0 });
    // Russian layout: the R key types "к"
    expect(resolveShortcut({ key: 'к', code: 'KeyR' })).toEqual({ kind: 'reset' });
  });

  it('lists every action in the overlay exactly once', () => {
    const resolved = SHORTCUTS.flatMap((s) =>
      s.keys.map((k) => {
        const key = k === 'Space' ? ' ' : k === 'Esc' ? 'Escape' : k;
        return resolveShortcut({ key })?.kind ?? 'none';
      }),
    );
    expect(resolved).not.toContain('none');
    expect(new Set(resolved).size).toBe(10);
  });
});

const el = (tagName: string, extra: Partial<ElementLike> = {}): ElementLike => ({
  tagName,
  getAttribute: () => null,
  closest: () => null,
  ...extra,
});

describe('focus classification', () => {
  it('recognises text entry', () => {
    expect(isTextEntry(el('INPUT', { type: 'text' }))).toBe(true);
    expect(isTextEntry(el('INPUT', { type: 'number' }))).toBe(true);
    expect(isTextEntry(el('TEXTAREA'))).toBe(true);
    expect(isTextEntry(el('DIV', { isContentEditable: true }))).toBe(true);
    expect(isTextEntry(el('DIV', { getAttribute: (n) => (n === 'role' ? 'textbox' : null) }))).toBe(true);
    expect(isTextEntry(el('INPUT', { type: 'range' }))).toBe(false);
    expect(isTextEntry(el('BUTTON'))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });

  it('lets sliders, radios and tabs keep their arrow keys', () => {
    expect(ownsArrowKeys(el('INPUT', { type: 'range' }))).toBe(true);
    expect(ownsArrowKeys(el('INPUT', { type: 'radio' }))).toBe(true);
    expect(ownsArrowKeys(el('BUTTON', { closest: (s) => (s.includes('"radio"') ? {} : null) }))).toBe(true);
    expect(ownsArrowKeys(el('BUTTON'))).toBe(false);
    expect(ownsArrowKeys(el('BODY'))).toBe(false);
  });
});
