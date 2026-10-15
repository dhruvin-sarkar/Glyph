import { useCallback, useId, useMemo, type ReactNode, type RefObject } from 'react';
import type { ExperimentId, ParamDef, ParamValue } from '../../engine/types';
import { formatParam } from '../../experiments/registry';
import { useGlyphStore } from '../../state/store';
import { cx } from '../ui/primitives';
import Segmented from './Segmented';
import Slider from './Slider';
import Steps, { type StepsParity } from './Steps';
import Toggle from './Toggle';
import { stepValues, unitHugs, valueText } from './model';
import { useValueFlash } from './useValueFlash';
import '../../styles/controls.css';

/** Half-twists: the parity of n decides how many sides the band has (SPEC §4.3). */
const TWIST_PARITY: StepsParity = {
  odd: 'Odd · 1 side',
  even: 'Even · 2 sides',
  describe: (n) =>
    `${n} half-twist${n === 1 ? '' : 's'} — ${n % 2 === 1 ? 'one side, one edge' : 'two sides, two edges'}`,
};

const PARITY: Readonly<Record<string, StepsParity>> = { 'topology.twists': TWIST_PARITY };

/** Short effect-first copy stays visible, including on touch screens. */
const CONTROL_HINTS: Readonly<Record<string, string>> = {
  'waves.amplitude': 'Higher waves, stronger contrast.',
  'waves.frequency': 'More crests in the same space.',
  'waves.speed': 'How quickly the crests travel.',
  'waves.angle': '180° creates a standing wave.',
  'waves.disturb': 'Strength of the ripples your cursor creates.',
  'waves.second': 'Add a second wave to reveal interference.',
  'waves.view': 'See the ocean in perspective or from above.',
  'attractor.strength': 'Pull particles toward the centre.',
  'attractor.swirl': 'Negative values reverse the rotation.',
  'attractor.count': 'Number of particles moving with the flow.',
  'attractor.softening': 'Spread the pull across a softer core.',
  'attractor.trails': 'Leave a fading trace of each path.',
  'attractor.field': 'Reveal the flow direction across the plane.',
  'topology.twists': 'Each step adds a 180° twist.',
  'topology.width': 'Distance from the centreline to either edge.',
  'topology.density': 'Smaller glyphs reveal finer surface detail.',
  'topology.spin': 'Speed of the automatic rotation.',
  'topology.autorotate': 'Let the surface turn on its own.',
  'topology.edges': 'One colour per continuous boundary.',
  'topology.sides': 'Show how the front and back connect.',
};

export interface ParamRowProps {
  mode: ExperimentId;
  def: ParamDef;
}

/**
 * One parameter of the instrument:
 *
 *   Label  symbol                      value unit
 *   ────────────────●──────────────────────────────   (control)
 *   a short explanation of what changes — always visible
 *
 * Each row subscribes to its own value only, so moving one slider re-renders one row.
 */
export default function ParamRow({ mode, def }: ParamRowProps) {
  const stored = useGlyphStore((s) => s.params[mode]?.[def.id]);
  const value: ParamValue = stored ?? def.default;
  const key = def.id;
  const update = useCallback((next: ParamValue) => useGlyphStore.getState().setParam(mode, key, next), [mode, key]);
  const flashRef = useValueFlash<HTMLSpanElement>(value);

  const uid = useId();
  const controlId = `${uid}control`;
  const labelId = `${uid}label`;
  const hint = CONTROL_HINTS[`${mode}.${def.id}`] ?? def.description;
  const descId = hint ? `${uid}desc` : undefined;

  // Stable list of notches for a stepped parameter (e.g. 0…7 half-twists).
  const steps = useMemo(() => (def.kind === 'range' && def.ui === 'steps' ? stepValues(def) : null), [def]);

  let trailing: ReactNode = null;
  let control: ReactNode = null;

  switch (def.kind) {
    case 'range': {
      const n = typeof value === 'number' ? value : Number(value);
      const text = formatParam(def, n);
      trailing = <Readout text={text} unit={def.unit} flashRef={flashRef} />;
      control = steps ? (
        <Steps
          value={n}
          values={steps}
          onChange={update}
          labelledBy={labelId}
          describedBy={descId}
          parity={PARITY[`${mode}.${def.id}`]}
        />
      ) : (
        <Slider
          id={controlId}
          value={n}
          min={def.min}
          max={def.max}
          step={def.step}
          defaultValue={def.default}
          valueText={valueText(text, def.unit)}
          onChange={update}
          describedBy={descId}
        />
      );
      break;
    }
    case 'toggle':
      trailing = (
        <span className="gf-toggle-value">
          <span aria-hidden="true" className="gf-toggle-state">{value === true ? 'On' : 'Off'}</span>
          <Toggle id={controlId} checked={value === true} onChange={update} describedBy={descId} />
        </span>
      );
      break;
    case 'select':
      control = (
        <Segmented
          value={String(value)}
          options={def.options}
          onChange={update}
          labelledBy={labelId}
          describedBy={descId}
        />
      );
      break;
  }

  const labelClass = cx(
    'gf-param-label flex min-w-0 items-baseline gap-2',
    'transition-colors duration-200 ease-expo',
  );
  const labelContent = (
    <>
      <span>{def.label}</span>
      {def.kind === 'range' && def.symbol ? (
        <span className="gf-param-symbol font-mono font-normal italic">{def.symbol}</span>
      ) : null}
    </>
  );
  // A native <label> names inputs and switches (and makes the label clickable);
  // radio groups are named through aria-labelledby instead.
  const labelled = (def.kind === 'range' && !steps) || def.kind === 'toggle';

  return (
    <div className={cx('gf-row group', `gf-row-${def.kind}`)}>
      <div className="gf-row-heading">
        {labelled ? (
          <label id={labelId} htmlFor={controlId} className={cx(labelClass, 'cursor-pointer')}>
            {labelContent}
          </label>
        ) : (
          <span id={labelId} className={labelClass}>
            {labelContent}
          </span>
        )}
        {trailing}
      </div>

      {hint ? <p id={descId} className="gf-param-hint">{hint}</p> : null}
      {control ? <div className="gf-row-control">{control}</div> : null}
    </div>
  );
}

/** Tabular mono value + muted unit. The number itself is the element that flashes mint. */
function Readout({ text, unit, flashRef }: { text: string; unit?: string; flashRef: RefObject<HTMLSpanElement | null> }) {
  return (
    <span className="gf-param-readout shrink-0 whitespace-nowrap font-mono tabular">
      <span ref={flashRef}>{text}</span>
      {unit ? <span className={cx('text-muted', !unitHugs(unit) && 'ml-[0.45em]')}>{unit}</span> : null}
    </span>
  );
}
