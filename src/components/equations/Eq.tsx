import { Children, Fragment, useEffect, useRef, type ReactNode, type RefObject } from 'react';
import type { ExperimentId } from '../../engine/types';
import { useGlyphStore } from '../../state/store';
import { cx } from '../ui/primitives';
import { MINUS } from './format';
import type { DrawnSymbol, OpRole } from './markup';

/* ═══════════════════════════════════════════════════════════════════════════
 *  Equation typesetting primitives — JetBrains Mono, no KaTeX.
 *
 *  Conventions (as in printed mathematics):
 *    variables italic · numbers and function names upright · live numbers mint
 *    binary operators get a medium space, relations a thick one, "·" stays tight
 *    sub/superscripts are 68 % size and shifted without disturbing line height
 *  The font has no maths-operator block, so ∈ ≈ → and √ are drawn as SVG.
 * ═══════════════════════════════════════════════════════════════════════════ */

const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

/* ─── Flash: a number glows when the parameter it depends on changes ─────── */

const FLASH_FRAMES: Keyframe[] = [
  {
    color: '#F2FFF6',
    textShadow: '0 0 0.85em rgba(185, 245, 208, 0.9)',
    boxShadow: '0 0 0 0.2em rgba(185, 245, 208, 0.2)',
  },
  { textShadow: '0 0 0 rgba(185, 245, 208, 0)', boxShadow: '0 0 0 0.2em rgba(185, 245, 208, 0)' },
];
const FLASH_TIMING: KeyframeAnimationOptions = { duration: 1100, easing: EASE };

/**
 * Returns a ref; the referenced element flashes whenever `store.lastChange`
 * names one of `keys` (for `mode`, default: the active experiment). Uses the
 * Web Animations API, so the flash costs no React render and no stylesheet.
 */
export function useParamFlash<T extends HTMLElement>(keys?: readonly string[], mode?: ExperimentId): RefObject<T | null> {
  const ref = useRef<T>(null);
  const at = useGlyphStore((s) => {
    const lc = s.lastChange;
    if (!keys || keys.length === 0 || !lc) return 0;
    if (lc.mode !== (mode ?? s.mode)) return 0;
    return keys.includes(lc.key) ? lc.at : 0;
  });
  const seen = useRef(at); // a change that happened before mount does not flash
  const anim = useRef<Animation | null>(null);

  useEffect(() => {
    if (at === 0 || at === seen.current) return;
    seen.current = at;
    const el = ref.current;
    if (!el || typeof el.animate !== 'function') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (typeof performance !== 'undefined' && performance.now() - at > 1500) return;
    anim.current?.cancel();
    anim.current = el.animate(FLASH_FRAMES, FLASH_TIMING);
  }, [at]);

  useEffect(
    () => () => {
      anim.current?.cancel();
    },
    [],
  );

  return ref;
}

/* ─── Root ───────────────────────────────────────────────────────────────── */

export interface EqProps {
  /** plain-text reading for screen readers (the typeset tree is then hidden from them) */
  label?: string;
  className?: string;
  children: ReactNode;
}

/** Root of a typeset equation block: mono, no ligatures, generous leading for scripts. */
export function Eq({ label, className, children }: EqProps) {
  return (
    <div className={cx('gf-equation font-mono font-normal not-italic leading-[1.9] text-ink [font-variant-ligatures:none]', className)}>
      {label && <span className="sr-only">{label}</span>}
      <div aria-hidden={label ? true : undefined}>{children}</div>
    </div>
  );
}

/* ─── Atoms ──────────────────────────────────────────────────────────────── */

interface ChildProps {
  children: ReactNode;
  className?: string;
}

/** A variable: italic (JetBrains Mono 400 italic is bundled). */
export function Var({ children, className }: ChildProps) {
  return <span className={cx('font-normal italic', className)}>{children}</span>;
}

/** Upright symbol or constant (Δ, Σ, π, e). */
export function Up({ children, className }: ChildProps) {
  return <span className={cx('not-italic', className)}>{children}</span>;
}

export interface NumProps extends ChildProps {
  /** parameter ids this number is computed from — it is live (mint) and flashes when one changes */
  keys?: readonly string[];
  mode?: ExperimentId;
  /** force the live (mint) style, e.g. for probe-driven values */
  live?: boolean;
}

/** A number: upright, tabular. Live numbers are mint and flash when their parameter changes. */
export function Num({ children, keys, mode, live, className }: NumProps) {
  const ref = useParamFlash<HTMLSpanElement>(keys, mode);
  const isLive = live ?? (keys !== undefined && keys.length > 0);
  return (
    <span ref={ref} className={cx('tabular rounded-[0.2em] not-italic', isLive ? 'text-mint' : 'text-ink', className)}>
      {children}
    </span>
  );
}

const OP_SPACE: Record<OpRole, string> = {
  bin: 'mx-[0.2em]',
  rel: 'mx-[0.3em]',
  unary: 'mr-[0.04em]',
  tight: 'mx-[-0.08em]',
  slash: 'mx-[-0.04em]',
};

/** An operator with mathematical spacing. "-" is always printed as the true minus sign U+2212. */
export function Op({ children, role = 'bin', className }: ChildProps & { role?: OpRole }) {
  return (
    <span className={cx('not-italic', role === 'rel' ? 'text-ink' : 'text-ink/80', OP_SPACE[role], className)}>
      {children === '-' ? MINUS : children}
    </span>
  );
}

/** An upright function name: sin, cos, tanh. */
export function Fn({ children, className }: ChildProps) {
  return <span className={cx('not-italic text-ink', className)}>{children}</span>;
}

/** The small gap between a function name and a bare argument: "cos u". */
export function Gap() {
  return <span aria-hidden="true" className="inline-block w-[0.3em]" />;
}

/** Argument separator with a thin space after it. */
export function Comma() {
  return <span className="mr-[0.24em]">,</span>;
}

/** "(x, y, t)" — an argument list of italic variables. */
export function Args({ vars }: { vars: readonly string[] }) {
  return (
    <>
      (
      {vars.map((v, i) => (
        <Fragment key={v}>
          {i > 0 && <Comma />}
          <Var>{v}</Var>
        </Fragment>
      ))}
      )
    </>
  );
}

/** Subscript: 68 % size, shifted below the baseline; does not grow the line box. */
export function Sub({ children, className }: ChildProps) {
  return <span className={cx('relative top-[0.34em] text-[0.68em] leading-none', className)}>{children}</span>;
}

/** Superscript: 68 % size, raised; does not grow the line box. */
export function Sup({ children, className }: ChildProps) {
  return <span className={cx('relative -top-[0.66em] text-[0.68em] leading-none', className)}>{children}</span>;
}

/** A unit after a value: "rad/s". */
export function Unit({ children }: { children: ReactNode }) {
  return <span className="ml-[0.4em] text-[0.86em] text-muted not-italic">{children}</span>;
}

/** A quiet prose aside inside an equation line. */
export function Note({ children, className }: ChildProps) {
  return <span className={cx('font-sans text-[0.94em] tracking-normal text-muted not-italic', className)}>{children}</span>;
}

/* ─── Structures ─────────────────────────────────────────────────────────── */

/**
 * Stacked fraction with a 1 px rule. `vertical-align: middle` puts the rule on
 * the maths axis of the surrounding line (numerator and denominator padded alike).
 */
export function Frac({ num, den, small = false, className }: { num: ReactNode; den: ReactNode; small?: boolean; className?: string }) {
  return (
    <span
      className={cx(
        'mx-[0.12em] inline-flex min-w-0 max-w-full flex-col text-center align-middle',
        small ? 'text-[0.8em] leading-[1.2]' : 'leading-[1.35]',
        className,
      )}
    >
      <span className="block px-[0.2em] pb-[0.14em]">{num}</span>
      <span aria-hidden="true" className="block h-px bg-current opacity-60" />
      <span className="sr-only"> over </span>
      <span className="block px-[0.2em] pt-[0.14em]">{den}</span>
    </span>
  );
}

const DELIMS = {
  round: { open: '(', close: ')', l: 'M8.6 1 C1.6 26 1.6 74 8.6 99', r: 'M1.4 1 C8.4 26 8.4 74 1.4 99' },
  square: { open: '[', close: ']', l: 'M8.4 1 H3.2 V99 H8.4', r: 'M1.6 1 H6.8 V99 H1.6' },
} as const;

function Delim({ d, side }: { d: string; side: 'left' | 'right' }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 10 100"
      preserveAspectRatio="none"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cx('absolute top-0 h-full w-[0.4em] overflow-visible opacity-80', side === 'left' ? 'left-0' : 'right-0')}
    >
      <path d={d} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * Delimiters. `tall` draws them as SVG strokes that stretch to the content —
 * tall enough to enclose a stacked fraction — otherwise plain glyphs.
 */
export function Paren({ children, kind = 'round', tall = false }: { children: ReactNode; kind?: keyof typeof DELIMS; tall?: boolean }) {
  const d = DELIMS[kind];
  if (!tall) {
    return (
      <>
        {d.open}
        {children}
        {d.close}
      </>
    );
  }
  return (
    <span className="relative inline-block px-[0.48em] leading-[1.15]">
      <span className="sr-only">{d.open}</span>
      <Delim d={d.l} side="left" />
      {children}
      <Delim d={d.r} side="right" />
      <span className="sr-only">{d.close}</span>
    </span>
  );
}

/** Square root: a drawn radical and a vinculum over the radicand. */
export function Sqrt({ children }: { children: ReactNode }) {
  return (
    <span className="relative ml-[0.56em] inline-block border-t border-current/70 pl-[0.08em] pr-[0.04em] leading-[1.2]">
      <span className="sr-only">square root of </span>
      <svg
        aria-hidden="true"
        viewBox="0 0 10 20"
        preserveAspectRatio="none"
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        strokeLinejoin="round"
        className="absolute -left-[0.56em] -top-px h-[calc(100%+1px)] w-[0.56em] overflow-visible opacity-80"
      >
        <path d="M0.6 12.6 L2.8 11.2 L5.4 19.4 L9.6 0.5 L10 0.5" vectorEffect="non-scaling-stroke" />
      </svg>
      {children}
    </span>
  );
}

const SYMBOLS: Record<DrawnSymbol, { viewBox: string; d: string; className: string }> = {
  // ∈ — an open semicircle with a bar through its middle
  in: { viewBox: '0 0 10 10', d: 'M8.8 0.9 H5.2 A4.1 4.1 0 0 0 5.2 9.1 H8.8 M1.1 5 H8.8', className: 'w-[0.6em] mx-[0.3em]' },
  // ≈ — two stacked tildes
  approx: {
    viewBox: '0 0 10 10',
    d: 'M0.8 3.7 C2.6 2.1 4.1 2.1 5 3.3 C5.9 4.5 7.4 4.5 9.2 2.9 M0.8 7.1 C2.6 5.5 4.1 5.5 5 6.7 C5.9 7.9 7.4 7.9 9.2 6.3',
    className: 'w-[0.6em] mx-[0.3em]',
  },
  // → — hairline arrow on the maths axis
  arrow: { viewBox: '0 0 16 10', d: 'M1 5 H14.6 M11.2 1.7 L14.6 5 L11.2 8.3', className: 'w-[0.96em] mx-[0.32em]' },
};

/** Maths symbols the bundled font lacks (∈ ≈ →), drawn on the maths axis. */
export function Sym({ name, className }: { name: DrawnSymbol; className?: string }) {
  const s = SYMBOLS[name];
  return (
    <>
    <span className="sr-only">{name === 'in' ? ' belongs to ' : name === 'approx' ? ' approximately ' : ' to '}</span>
    <svg
      aria-hidden="true"
      viewBox={s.viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cx('inline-block h-[0.6em] overflow-visible align-baseline', s.className, className)}
    >
      <path d={s.d} vectorEffect="non-scaling-stroke" />
    </svg>
    </>
  );
}

/* ─── Lines ──────────────────────────────────────────────────────────────── */

/**
 * One term of a sum. It never breaks internally; lines may break *between*
 * terms. `off` dims the term and draws a hairline strike through it — used
 * when a coefficient is switched to zero (A₂ = 0 when the second wave is off).
 */
export function Term({ lead, off = false, children }: { lead?: string; off?: boolean; children: ReactNode }) {
  return (
    <span className={cx('inline-block whitespace-nowrap transition-opacity duration-500 ease-expo', off && 'opacity-40')}>
      {lead && <Op role="bin">{lead}</Op>}
      <span className="relative inline-block">
        {children}
        <span
          aria-hidden="true"
          className={cx(
            'pointer-events-none absolute -inset-x-[0.15em] top-[56%] h-px origin-left bg-current',
            'transition-transform duration-500 ease-expo',
            off ? 'scale-x-100' : 'scale-x-0',
          )}
        />
      </span>
    </span>
  );
}

const STACK = {
  never: { grid: '', rhs: '' },
  // Below 27 em the left-hand side moves onto its own row. 27 em is the worst
  // case of "f(x, y, t) = + 2.00·sin(−21.21x + 21.21y − 60.00t)" in a 0.6 em mono.
  wide: { grid: '@max-[27em]:grid-cols-1', rhs: '@max-[27em]:pt-[0.25em]' },
} as const;

/**
 * One display equation "lhs = rhs". Terms of the rhs wrap as whole units and
 * continuation rows align under the first term; in a narrow container the lhs
 * moves onto its own row (container query, so the card and the drawer both work).
 */
export function Line({
  lhs,
  rel = '=',
  stack = 'never',
  className,
  children,
}: {
  lhs: ReactNode;
  rel?: ReactNode;
  stack?: keyof typeof STACK;
  className?: string;
  children: ReactNode;
}) {
  const items = Children.toArray(children);
  return (
    <div className={cx('@container', className)}>
      <div className={cx('grid grid-cols-[max-content_minmax(0,1fr)] items-baseline', STACK[stack].grid)}>
        <span className="whitespace-nowrap">
          {lhs}
          <Op role="rel">{rel}</Op>
        </span>
        <span className={cx('min-w-0', STACK[stack].rhs)}>
          {items.map((item, i) => (
            <Fragment key={i}>
              {i > 0 && <wbr />}
              {item}
            </Fragment>
          ))}
        </span>
      </div>
    </div>
  );
}

/** A system of equations with their "=" signs aligned (the band's x, y, z). */
export function Aligned({
  rows,
  className,
}: {
  rows: ReadonlyArray<{ key: string; lhs: ReactNode; rhs: ReactNode }>;
  className?: string;
}) {
  return (
    <div className={cx('gf-equation-aligned grid grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-y-[0.25em]', className)}>
      {rows.map((row) => (
        <Fragment key={row.key}>
          <span className="whitespace-nowrap">
            {row.lhs}
            <Op role="rel">=</Op>
          </span>
          <span className="min-w-0">{row.rhs}</span>
        </Fragment>
      ))}
    </div>
  );
}
