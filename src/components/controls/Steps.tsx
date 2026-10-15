import { useRef, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { cx } from '../ui/primitives';
import '../../styles/controls.css';

type CSSVars = CSSProperties & Record<`--${string}`, string | number>;

/** Odd/even meaning of the values (half-twists: odd → one side, even → two sides). */
export interface StepsParity {
  odd: string;
  even: string;
  /** full accessible name of one value, e.g. "3 half-twists — one side, one edge" */
  describe: (value: number) => string;
}

export interface StepsProps {
  value: number;
  /** every allowed value, ascending (e.g. 0…7) */
  values: readonly number[];
  onChange: (value: number) => void;
  labelledBy?: string;
  describedBy?: string;
  parity?: StepsParity;
}

/**
 * An integer parameter as notches on a ruler (role="radiogroup").
 * Click a notch, scrub across the ruler, or use the arrow keys — the value only
 * ever lands on whole numbers. For the Möbius band that is the point: a
 * fractional number of half-twists would not close up into a surface.
 */
export default function Steps({ value, values, onChange, labelledBy, describedBy, parity }: StepsProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const scrubbing = useRef<number | null>(null);
  const found = values.indexOf(value);
  const active = found < 0 ? 0 : found;
  const style: CSSVars = { '--n': Math.max(1, values.length), '--i': active };
  const isOdd = Math.abs(value % 2) === 1;

  const commit = (index: number, focus: boolean) => {
    if (values.length === 0) return;
    const i = Math.max(0, Math.min(values.length - 1, index));
    if (focus) buttons.current[i]?.focus({ preventScroll: true });
    if (values[i] !== value) onChange(values[i]);
  };

  /** Notch under a horizontal pointer position. */
  const indexAt = (clientX: number): number => {
    const row = rowRef.current;
    if (!row) return active;
    const rect = row.getBoundingClientRect();
    return Math.floor(((clientX - rect.left) / Math.max(1, rect.width)) * values.length);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !e.isPrimary) return;
    scrubbing.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    commit(indexAt(e.clientX), true);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (scrubbing.current !== e.pointerId) return;
    commit(indexAt(e.clientX), true);
  };

  const endScrub = () => {
    scrubbing.current = null;
  };

  // Pointer input is handled by the scrub above; a click with detail 0 comes from
  // the keyboard (Enter) or assistive technology, so it selects directly.
  const onNotchClick = (e: MouseEvent<HTMLButtonElement>, index: number) => {
    if (e.detail === 0) commit(index, false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    let next: number;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = active + 1;
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = active - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = values.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    commit(next, true);
  };

  return (
    <div>
      <div
        ref={rowRef}
        role="radiogroup"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        className="gf-steps-row"
        style={style}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endScrub}
        onPointerCancel={endScrub}
        onLostPointerCapture={endScrub}
      >
        <span className="gf-steps-cursor" aria-hidden="true" />
        {values.map((n, i) => {
          const odd = Math.abs(n % 2) === 1;
          return (
            <button
              key={n}
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={i === active}
              aria-label={parity ? parity.describe(n) : String(n)}
              tabIndex={i === active ? 0 : -1}
              className="gf-notch"
              onClick={(e) => onNotchClick(e, i)}
              onKeyDown={onKeyDown}
            >
              <span className="gf-notch-num" aria-hidden="true">
                {n}
              </span>
              <span className="gf-notch-tick" aria-hidden="true" />
              {parity && odd ? <span className="gf-notch-dot" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>

      {parity ? (
        <div className="gf-parity-legend">
          <span
            className={cx(
              'inline-flex items-center gap-2 transition-colors duration-300',
              isOdd ? 'text-ink/90' : 'text-muted',
            )}
          >
            <span
              aria-hidden="true"
              className={cx('h-[3px] w-[3px] rounded-full', isOdd ? 'bg-mint shadow-[0_0_6px_rgba(185,245,208,0.8)]' : 'bg-mint/50')}
            />
            {parity.odd}
          </span>
          <span className={cx('transition-colors duration-300', isOdd ? 'text-muted' : 'text-ink/90')}>{parity.even}</span>
        </div>
      ) : null}
    </div>
  );
}
