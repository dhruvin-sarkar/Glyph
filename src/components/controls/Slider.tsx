import type { CSSProperties, KeyboardEvent } from 'react';
import { fillSpan, pct, rangeFraction } from './model';
import '../../styles/controls.css';

type CSSVars = CSSProperties & Record<`--${string}`, string | number>;

export interface SliderProps {
  id: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** the parameter's default — drawn as a mint tick, restored on double-click */
  defaultValue: number;
  /** formatted value + unit for assistive tech, e.g. "70°" */
  valueText: string;
  onChange: (value: number) => void;
  describedBy?: string;
}

const ARROW_DIRECTION: Readonly<Record<string, 1 | -1>> = {
  ArrowRight: 1,
  ArrowUp: 1,
  ArrowLeft: -1,
  ArrowDown: -1,
};

/**
 * A native range input drawn as a measuring instrument: a quiet mint track,
 * a visible round handle, and min / default / max ticks underneath.
 * Being native, it is keyboard- and screen-reader-accessible for free.
 *   · drag or click — live updates
 *   · double-click — back to the default
 *   · Shift + arrows — ten steps at a time
 */
export default function Slider({ id, value, min, max, step, defaultValue, valueText, onChange, describedBy }: SliderProps) {
  const [from, to] = fillSpan(value, min, max);
  const trackStyle: CSSVars = { '--a': pct(from), '--b': pct(to) };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const direction = ARROW_DIRECTION[e.key];
    if (!e.shiftKey || direction === undefined) return;
    e.preventDefault();
    onChange(value + direction * step * 10);
  };

  return (
    <div className="gf-slider">
      <input
        id={id}
        type="range"
        className="gf-range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={valueText}
        aria-describedby={describedBy}
        style={trackStyle}
        onChange={(e) => onChange(e.currentTarget.valueAsNumber)}
        onDoubleClick={() => onChange(defaultValue)}
        onKeyDown={onKeyDown}
      />
      <div className="gf-ticks" aria-hidden="true">
        <span className="gf-tick" style={{ '--t': 0 } as CSSVars} />
        <span className="gf-tick" style={{ '--t': 1 } as CSSVars} />
        <span className="gf-tick" data-default="" style={{ '--t': rangeFraction(defaultValue, min, max) } as CSSVars} />
      </div>
    </div>
  );
}
