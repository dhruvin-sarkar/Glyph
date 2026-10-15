import { describe, expect, it } from 'vitest';
import { mathSources, parseMath, slotKeys, splitProse, type MathNode } from '../markup';

const v = (text: string): MathNode => ({ kind: 'var', text });
const num = (text: string): MathNode => ({ kind: 'num', text });
const up = (text: string): MathNode => ({ kind: 'upright', text });
const BREAK: MathNode = { kind: 'break' };

describe('parseMath', () => {
  it('sets single letters as italic variables and digits as numbers', () => {
    expect(parseMath('2k')).toEqual([num('2'), v('k')]);
  });

  it('reads subscripts, including grouped ones: k_1, k_{1x}', () => {
    expect(parseMath('k_1')).toEqual([v('k'), { kind: 'sub', children: [num('1')] }]);
    expect(parseMath('k_{1x}')).toEqual([v('k'), { kind: 'sub', children: [num('1'), v('x')] }]);
  });

  it('sets function names upright, with a small gap before a bare argument', () => {
    expect(parseMath('cos u')).toEqual([{ kind: 'fn', text: 'cos' }, { kind: 'space' }, v('u')]);
    expect(parseMath('sin(x)')).toEqual([
      { kind: 'fn', text: 'sin' },
      { kind: 'punct', text: '(' },
      v('x'),
      { kind: 'punct', text: ')' },
    ]);
  });

  it('tells a sign from a subtraction, and always prints U+2212', () => {
    expect(parseMath('-a - b')).toEqual([
      { kind: 'op', text: '−', role: 'unary' },
      v('a'),
      { kind: 'op', text: '−', role: 'bin' },
      BREAK,
      v('b'),
    ]);
  });

  it('allows line breaks only after top-level operators', () => {
    const nodes = parseMath('a = (b + c)');
    expect(nodes.filter((n) => n.kind === 'break')).toHaveLength(1);
    expect(nodes[1]).toEqual({ kind: 'op', text: '=', role: 'rel' });
    expect(nodes[2]).toEqual(BREAK);
  });

  it('reads two letters as a product and longer runs as upright words', () => {
    expect(parseMath('nu')).toEqual([v('n'), v('u')]);
    expect(parseMath('glyph')).toEqual([up('glyph')]);
    expect(parseMath('V_{max}')).toEqual([v('V'), { kind: 'sub', children: [{ kind: 'fn', text: 'max' }] }]);
  });

  it("sets Euler's e upright when it is raised to a power", () => {
    expect(parseMath('e^{x}')).toEqual([up('e'), { kind: 'sup', children: [v('x')] }]);
  });

  it('italicises lower-case Greek, keeps capitals and π upright', () => {
    expect(parseMath('θΔπ')).toEqual([v('θ'), up('Δ'), up('π')]);
  });

  it('reads fractions, tall delimiters and roots', () => {
    expect(parseMath(String.raw`\left(\frac{f}{F_0}\right)`)).toEqual([
      {
        kind: 'paren',
        open: '(',
        close: ')',
        children: [{ kind: 'frac', num: [v('f')], den: [v('F'), { kind: 'sub', children: [num('0')] }] }],
      },
    ]);
    expect(parseMath('√ε')).toEqual([{ kind: 'sqrt', children: [v('ε')] }]);
  });

  it('draws the symbols the font lacks', () => {
    expect(parseMath('u ∈ A')[1]).toEqual({ kind: 'draw', name: 'in' });
    expect(parseMath('a ≈ b')[1]).toEqual({ kind: 'draw', name: 'approx' });
  });

  it('pairs absolute-value bars', () => {
    expect(parseMath('|F|')).toEqual([{ kind: 'punct', text: '|open' }, v('F'), { kind: 'punct', text: '|close' }]);
  });

  it('never throws on malformed input', () => {
    for (const src of ['\\', '_', '^', '{', '}', String.raw`\left(`, String.raw`\frac{a}`, '√', '|', ')(']) {
      expect(() => parseMath(src)).not.toThrow();
    }
  });
});

describe('splitProse', () => {
  it('splits text, $maths$ and {slots}', () => {
    expect(splitProse('Raise $k$ now {lambda}.')).toEqual([
      { kind: 'text', text: 'Raise ' },
      { kind: 'math', nodes: [v('k')] },
      { kind: 'text', text: ' now ' },
      { kind: 'slot', key: 'lambda' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('does not treat maths groups as slots', () => {
    expect(slotKeys('$V_{max}$ = {vmax}')).toEqual(['vmax']);
  });

  it('keeps an unbalanced $ as text', () => {
    expect(splitProse('costs $5')).toEqual([{ kind: 'text', text: 'costs $5' }]);
  });

  it('lists the maths sources', () => {
    expect(mathSources('a $x$ b $y_1$')).toEqual(['x', 'y_1']);
  });
});
