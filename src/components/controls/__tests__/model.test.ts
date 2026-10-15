import { describe, expect, it } from 'vitest';
import type { ParamDef } from '../../../engine/types';
import { fillSpan, paramGroup, pct, rangeFraction, splitParams, stepValues, unitHugs, valueText } from '../model';

const range = (id: string, extra: Partial<ParamDef> = {}): ParamDef =>
  ({ kind: 'range', id, label: id, min: 0, max: 1, step: 0.01, default: 0.5, ...extra }) as ParamDef;
const toggle = (id: string): ParamDef => ({ kind: 'toggle', id, label: id, default: true });
const select = (id: string): ParamDef => ({
  kind: 'select',
  id,
  label: id,
  default: 'a',
  options: [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
  ],
});

describe('rangeFraction', () => {
  it('maps the range linearly onto [0, 1]', () => {
    expect(rangeFraction(0.1, 0.1, 2)).toBe(0);
    expect(rangeFraction(2, 0.1, 2)).toBe(1);
    expect(rangeFraction(90, 0, 180)).toBeCloseTo(0.5, 12);
  });
  it('clamps out-of-range values and survives a degenerate range', () => {
    expect(rangeFraction(-5, 0, 1)).toBe(0);
    expect(rangeFraction(5, 0, 1)).toBe(1);
    expect(rangeFraction(1, 1, 1)).toBe(0);
    expect(rangeFraction(Number.NaN, 0, 1)).toBe(0);
  });
});

describe('fillSpan', () => {
  it('lights an ordinary slider from its minimum to the value', () => {
    expect(fillSpan(9, 2, 30)).toEqual([0, 0.25]);
  });
  it('lights a bipolar slider from zero, so the sign shows', () => {
    // swirl s ∈ [−1.5, 1.5]: zero sits in the middle of the track
    const [a1, b1] = fillSpan(0.75, -1.5, 1.5);
    expect(a1).toBeCloseTo(0.5, 12);
    expect(b1).toBeCloseTo(0.75, 12);
    const [a2, b2] = fillSpan(-0.75, -1.5, 1.5);
    expect(a2).toBeCloseTo(0.25, 12);
    expect(b2).toBeCloseTo(0.5, 12);
    expect(fillSpan(0, -1.5, 1.5)).toEqual([0.5, 0.5]);
  });
});

describe('stepValues', () => {
  it('lists every half-twist 0…7', () => {
    expect(stepValues({ min: 0, max: 7, step: 1 })).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
  it('is immune to floating-point dust', () => {
    expect(stepValues({ min: 0, max: 0.3, step: 0.1 })).toEqual([0, 0.1, 0.2, 0.3]);
  });
});

describe('units', () => {
  it('hugs degree, times and percent signs only', () => {
    expect(unitHugs('°')).toBe(true);
    expect(unitHugs('×')).toBe(true);
    expect(unitHugs('u/s')).toBe(false);
    expect(valueText('70', '°')).toBe('70°');
    expect(valueText('0.35', 'u/s')).toBe('0.35 u/s');
    expect(valueText('−0.65')).toBe('−0.65');
  });
  it('formats percentages for CSS custom properties', () => {
    expect(pct(0)).toBe('0%');
    expect(pct(0.25)).toBe('25%');
    expect(pct(1 / 3)).toBe('33.333%');
  });
});

describe('panel grouping', () => {
  it('puts equation variables first and display settings second', () => {
    expect(paramGroup('waves', range('amplitude'))).toBe('equation');
    expect(paramGroup('waves', toggle('second'))).toBe('display');
    expect(paramGroup('waves', select('view'))).toBe('display');
    expect(paramGroup('topology', range('twists'))).toBe('equation');
    expect(paramGroup('topology', range('density'))).toBe('display');
    expect(paramGroup('topology', range('spin'))).toBe('display');
  });
  it('keeps schema order inside each group', () => {
    const defs = [range('twists'), range('width'), range('density'), range('spin'), toggle('edges')];
    const { equation, display } = splitParams('topology', defs);
    expect(equation.map((d) => d.id)).toEqual(['twists', 'width']);
    expect(display.map((d) => d.id)).toEqual(['density', 'spin', 'edges']);
  });
});
