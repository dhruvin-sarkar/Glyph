import { useRef, type CSSProperties, type KeyboardEvent } from 'react';
import '../../styles/controls.css';

type CSSVars = CSSProperties & Record<`--${string}`, string | number>;

export interface SegmentedOption {
  value: string;
  label: string;
}

export interface SegmentedProps {
  value: string;
  options: readonly SegmentedOption[];
  onChange: (value: string) => void;
  labelledBy?: string;
  describedBy?: string;
}

/**
 * Two or three mutually exclusive options (a select parameter) as a radio group
 * with a sliding mint indicator. Arrow keys move the selection (roving tabindex).
 */
export default function Segmented({ value, options, onChange, labelledBy, describedBy }: SegmentedProps) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const found = options.findIndex((o) => o.value === value);
  const active = found < 0 ? 0 : found;
  const style: CSSVars = { '--n': Math.max(1, options.length), '--i': active };

  const choose = (index: number, focus: boolean) => {
    const n = options.length;
    if (n === 0) return;
    const i = ((index % n) + n) % n;
    if (focus) buttons.current[i]?.focus({ preventScroll: true });
    if (options[i].value !== value) onChange(options[i].value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        choose(active + 1, true);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        choose(active - 1, true);
        break;
      case 'Home':
        choose(0, true);
        break;
      case 'End':
        choose(options.length - 1, true);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <div role="radiogroup" aria-labelledby={labelledBy} aria-describedby={describedBy} className="gf-seg" style={style}>
      <span className="gf-seg-indicator" aria-hidden="true" />
      {options.map((option, i) => (
        <button
          key={option.value}
          ref={(el) => {
            buttons.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={i === active}
          tabIndex={i === active ? 0 : -1}
          className="gf-seg-option"
          onClick={() => choose(i, false)}
          onKeyDown={onKeyDown}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
