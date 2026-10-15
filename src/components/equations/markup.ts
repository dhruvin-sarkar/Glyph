/* ═══════════════════════════════════════════════════════════════════════════
 *  A tiny maths markup for the exhibit copy — pure (no React), unit-tested.
 *
 *  Prose:   "Raise $k$ and $λ = 2π/k$ shrinks — right now {lambda}."
 *           $…$      inline maths
 *           {key}    a live value slot, filled by the renderer
 *
 *  Maths:   k_1  k_{1x}  e^{−τ/T}  √ε  √{x² + y²}
 *           \frac{num}{den}   \left( … \right)   \left[ … \right]
 *           single letters → italic variables (lower-case Greek too);
 *           runs of ≥ 3 letters → upright words (sin, cos, tanh, max, …);
 *           a two-letter run (nu, dp) is a product of two variables;
 *           ∈ ≈ → are drawn as SVG (the bundled font has no maths operators).
 * ═══════════════════════════════════════════════════════════════════════════ */

export type OpRole = 'bin' | 'rel' | 'unary' | 'tight' | 'slash';
export type DrawnSymbol = 'in' | 'approx' | 'arrow';

export type MathNode =
  | { kind: 'var'; text: string }
  | { kind: 'upright'; text: string }
  | { kind: 'num'; text: string }
  | { kind: 'fn'; text: string }
  | { kind: 'op'; text: string; role: OpRole }
  | { kind: 'punct'; text: string }
  | { kind: 'space' }
  | { kind: 'break' }
  | { kind: 'sub'; children: MathNode[] }
  | { kind: 'sup'; children: MathNode[] }
  | { kind: 'sqrt'; children: MathNode[] }
  | { kind: 'frac'; num: MathNode[]; den: MathNode[] }
  | { kind: 'paren'; open: string; close: string; children: MathNode[] }
  | { kind: 'draw'; name: DrawnSymbol };

export type ProseSegment =
  | { kind: 'text'; text: string }
  | { kind: 'math'; nodes: MathNode[] }
  | { kind: 'slot'; key: string };

/** Function names typeset upright. */
const FUNCTIONS = new Set(['sin', 'cos', 'tan', 'tanh', 'exp', 'log', 'ln', 'arctan', 'atan2', 'max', 'min', 'sign']);
const DRAWN: Record<string, DrawnSymbol> = { '∈': 'in', '≈': 'approx', '→': 'arrow' };
const OPEN_FOR: Record<string, string> = { '(': ')', '[': ']', '|': '|' };

const isDigit = (ch: string): boolean => ch >= '0' && ch <= '9';
const isLatin = (ch: string): boolean => (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
const isGreekLower = (ch: string): boolean => ch >= 'α' && ch <= 'ω' && ch !== 'π';
const isGreekUpper = (ch: string): boolean => ch >= 'Α' && ch <= 'Ω';
/** Superscript digits, fractions and the degree sign travel with numbers. */
const NUMERIC_EXTRAS = '½²³°';

/** Nodes after which an operator is binary (and a minus is a subtraction, not a sign). */
function endsOperand(node: MathNode | undefined): boolean {
  if (!node) return false;
  switch (node.kind) {
    case 'var':
    case 'upright':
    case 'num':
    case 'sub':
    case 'sup':
    case 'sqrt':
    case 'frac':
    case 'paren':
      return true;
    case 'punct':
      return node.text === ')' || node.text === ']' || node.text === '|close';
    default:
      return false;
  }
}

/** Parse a maths string into typeset nodes. Never throws: unknown characters pass through upright. */
export function parseMath(src: string): MathNode[] {
  let i = 0;

  /** Read one group after _ ^ √ \frac: either {…} or a single atom. */
  const group = (): MathNode[] => {
    if (src[i] === '{') {
      i++;
      return seq('}', 1);
    }
    const ch = src[i];
    if (ch === undefined) return [];
    i++;
    if (isDigit(ch)) return [{ kind: 'num', text: ch }];
    if (isLatin(ch) || isGreekLower(ch)) return [{ kind: 'var', text: ch }];
    return [{ kind: 'upright', text: ch }];
  };

  /**
   * Parse until `stop` ('}' or '\right') or the end. `depth` > 0 inside groups:
   * no line-break opportunities there, and letter runs of ≥ 2 become upright text.
   */
  const seq = (stop: '}' | '\\right' | null, depth: number): MathNode[] => {
    const out: MathNode[] = [];
    let nest = 0; // parentheses depth inside this sequence
    let barOpen = false;
    const top = (): boolean => depth === 0 && nest === 0;
    const pushOp = (text: string, role: OpRole): void => {
      out.push({ kind: 'op', text, role });
      if (top() && (role === 'bin' || role === 'rel')) out.push({ kind: 'break' });
    };

    while (i < src.length) {
      if (stop === '}' && src[i] === '}') {
        i++;
        return out;
      }
      if (stop === '\\right' && src.startsWith('\\right', i)) return out;

      const ch = src[i];
      const last = out.length > 0 ? out[out.length - 1] : undefined;

      // \commands
      if (ch === '\\') {
        const m = /^\\([a-zA-Z]+|[{}])/.exec(src.slice(i));
        if (!m) {
          i++;
          continue;
        }
        i += m[0].length;
        const name = m[1];
        if (name === '{' || name === '}') {
          out.push({ kind: 'punct', text: name });
        } else if (name === 'frac') {
          const num = group();
          const den = group();
          out.push({ kind: 'frac', num, den });
        } else if (name === 'left') {
          const open = src[i] ?? '(';
          i++;
          const children = seq('\\right', depth + 1);
          let close = OPEN_FOR[open] ?? ')';
          if (src.startsWith('\\right', i)) {
            i += '\\right'.length;
            close = src[i] ?? close;
            i++;
          }
          out.push({ kind: 'paren', open, close, children });
        }
        continue;
      }

      if (ch === ' ') {
        // a gap only between a function name and its bare argument: "cos u"
        if (last?.kind === 'fn' && i + 1 < src.length && src[i + 1] !== '(' && src[i + 1] !== ' ') {
          out.push({ kind: 'space' });
        }
        i++;
        continue;
      }

      if (ch === '{') {
        i++;
        out.push(...seq('}', depth + 1));
        continue;
      }
      if (ch === '_' || ch === '^') {
        i++;
        const children = group();
        out.push(ch === '_' ? { kind: 'sub', children } : { kind: 'sup', children });
        continue;
      }
      if (ch === '√') {
        i++;
        out.push({ kind: 'sqrt', children: group() });
        continue;
      }
      if (DRAWN[ch]) {
        i++;
        out.push({ kind: 'draw', name: DRAWN[ch] });
        if (top()) out.push({ kind: 'break' });
        continue;
      }

      if (isDigit(ch) || (ch === '.' && isDigit(src[i + 1] ?? ''))) {
        let j = i;
        while (j < src.length && (isDigit(src[j]) || (src[j] === '.' && isDigit(src[j + 1] ?? '')))) j++;
        out.push({ kind: 'num', text: src.slice(i, j) });
        i = j;
        continue;
      }
      if (NUMERIC_EXTRAS.includes(ch)) {
        out.push({ kind: 'num', text: ch });
        i++;
        continue;
      }

      if (isLatin(ch)) {
        let j = i;
        while (j < src.length && isLatin(src[j])) j++;
        const word = src.slice(i, j);
        i = j;
        if (FUNCTIONS.has(word)) out.push({ kind: 'fn', text: word });
        else if (word.length >= 3 || (depth > 0 && word.length >= 2)) out.push({ kind: 'upright', text: word });
        else {
          for (const letter of word) {
            // Euler's number is a constant: upright when raised to a power
            const euler = letter === 'e' && word.length === 1 && src[i] === '^';
            out.push(euler ? { kind: 'upright', text: 'e' } : { kind: 'var', text: letter });
          }
        }
        continue;
      }
      if (isGreekLower(ch)) {
        out.push({ kind: 'var', text: ch });
        i++;
        continue;
      }
      if (isGreekUpper(ch) || ch === 'π') {
        out.push({ kind: 'upright', text: ch });
        i++;
        continue;
      }

      i++;
      switch (ch) {
        case '-':
        case '−':
          pushOp('−', endsOperand(last) ? 'bin' : 'unary');
          break;
        case '+':
        case '±':
          pushOp(ch, endsOperand(last) ? 'bin' : 'unary');
          break;
        case '×':
          pushOp(ch, 'bin');
          break;
        case '=':
        case '<':
        case '>':
          pushOp(ch, 'rel');
          break;
        case '·':
          pushOp(ch, 'tight');
          break;
        case '/':
          pushOp(ch, 'slash');
          break;
        case '(':
        case '[':
          nest++;
          out.push({ kind: 'punct', text: ch });
          break;
        case ')':
        case ']':
          nest = Math.max(0, nest - 1);
          out.push({ kind: 'punct', text: ch });
          break;
        case '|':
          // absolute-value bars: the first opens, the next closes
          out.push({ kind: 'punct', text: barOpen ? '|close' : '|open' });
          barOpen = !barOpen;
          break;
        case ',':
          out.push({ kind: 'punct', text: ',' });
          if (top()) out.push({ kind: 'break' });
          break;
        case "'":
        case '′':
          out.push({ kind: 'upright', text: '′' });
          break;
        default:
          out.push({ kind: 'upright', text: ch });
      }
    }
    return out;
  };

  return seq(null, 0);
}

/** Split prose into text, $maths$ and {slot} segments. Unbalanced `$` is treated as text. */
export function splitProse(text: string): ProseSegment[] {
  const out: ProseSegment[] = [];
  const pushText = (t: string): void => {
    if (!t) return;
    const re = /\{([A-Za-z][A-Za-z0-9]*)\}/g;
    let last = 0;
    for (let m = re.exec(t); m; m = re.exec(t)) {
      if (m.index > last) out.push({ kind: 'text', text: t.slice(last, m.index) });
      out.push({ kind: 'slot', key: m[1] });
      last = m.index + m[0].length;
    }
    if (last < t.length) out.push({ kind: 'text', text: t.slice(last) });
  };

  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('$', i);
    if (open === -1) break;
    const close = text.indexOf('$', open + 1);
    if (close === -1) break;
    pushText(text.slice(i, open));
    out.push({ kind: 'math', nodes: parseMath(text.slice(open + 1, close)) });
    i = close + 1;
  }
  pushText(text.slice(i));
  return out;
}

/** Every {slot} key used in a prose string. */
export function slotKeys(text: string): string[] {
  return splitProse(text).flatMap((s) => (s.kind === 'slot' ? [s.key] : []));
}

/** The maths segments of a prose string, as raw source (for tests / linting). */
export function mathSources(text: string): string[] {
  const out: string[] = [];
  const re = /\$([^$]*)\$/g;
  for (let m = re.exec(text); m; m = re.exec(text)) out.push(m[1]);
  return out;
}
