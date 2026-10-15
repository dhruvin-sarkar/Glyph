import { Fragment, useMemo, type ReactNode } from 'react';
import { cx } from '../ui/primitives';
import { Comma, Fn, Frac, Gap, Op, Paren, Sqrt, Sub, Sup, Sym, Up, Var } from './Eq';
import { DASH } from './format';
import { parseMath, splitProse, type MathNode } from './markup';

/* Renders the maths markup of src/content (see markup.ts) with the Eq primitives. */

function renderNode(node: MathNode, key: number): ReactNode {
  switch (node.kind) {
    case 'var':
      return <Var key={key}>{node.text}</Var>;
    case 'upright':
      return <Up key={key}>{node.text}</Up>;
    case 'num':
      return (
        <span key={key} className="tabular not-italic">
          {node.text}
        </span>
      );
    case 'fn':
      return <Fn key={key}>{node.text}</Fn>;
    case 'op':
      return (
        <Op key={key} role={node.role}>
          {node.text}
        </Op>
      );
    case 'punct':
      if (node.text === ',') return <Comma key={key} />;
      if (node.text === '|open' || node.text === '|close') return <Up key={key}>|</Up>;
      return <Up key={key}>{node.text}</Up>;
    case 'space':
      return <Gap key={key} />;
    case 'break':
      return <wbr key={key} />;
    case 'sub':
      return (
        <Sub key={key}>
          <MathNodes nodes={node.children} />
        </Sub>
      );
    case 'sup':
      return (
        <Sup key={key}>
          <MathNodes nodes={node.children} />
        </Sup>
      );
    case 'sqrt':
      return (
        <Sqrt key={key}>
          <MathNodes nodes={node.children} />
        </Sqrt>
      );
    case 'frac':
      return <Frac key={key} num={<MathNodes nodes={node.num} />} den={<MathNodes nodes={node.den} />} />;
    case 'paren':
      return (
        <Paren key={key} kind={node.open === '[' ? 'square' : 'round'} tall>
          <MathNodes nodes={node.children} />
        </Paren>
      );
    case 'draw':
      return <Sym key={key} name={node.name} />;
  }
}

export function MathNodes({ nodes }: { nodes: readonly MathNode[] }) {
  return <>{nodes.map((node, i) => renderNode(node, i))}</>;
}

const parseCache = new Map<string, MathNode[]>();

/** Parse once per distinct source string (labels arrive at 8 Hz but rarely change). */
export function parseCached(src: string): MathNode[] {
  let nodes = parseCache.get(src);
  if (!nodes) {
    nodes = parseMath(src);
    if (parseCache.size > 256) parseCache.clear();
    parseCache.set(src, nodes);
  }
  return nodes;
}

/** Inline maths inside prose or a UI label. */
export function InlineMath({ src, className }: { src: string; className?: string }) {
  return (
    <span className={cx('font-mono font-normal not-italic [font-variant-ligatures:none]', className)}>
      <MathNodes nodes={parseCached(src)} />
    </span>
  );
}

/**
 * A display equation from markup. Breaks only after top-level operators; the
 * continuation lines hang under the first (negative text-indent).
 */
export function DisplayMath({ src, className }: { src: string; className?: string }) {
  return (
    <div
      className={cx(
        'gf-display-math pl-[1.6em] -indent-[1.6em] font-mono font-normal not-italic leading-[1.85] text-ink [font-variant-ligatures:none]',
        className,
      )}
    >
      <MathNodes nodes={parseCached(src)} />
    </div>
  );
}

/**
 * Prose with $inline maths$ and {slots}. Slots are filled from `values` (live
 * React nodes such as a flashing <Num>); an unknown slot shows a dash.
 */
export function MathText({
  text,
  values,
  className,
  mathClassName = 'text-[0.93em] text-ink',
}: {
  text: string;
  values?: Readonly<Record<string, ReactNode>>;
  className?: string;
  mathClassName?: string;
}) {
  const segments = useMemo(() => splitProse(text), [text]);
  return (
    <span className={className}>
      {segments.map((seg, i) => {
        switch (seg.kind) {
          case 'text':
            return <Fragment key={i}>{seg.text}</Fragment>;
          case 'math':
            return (
              <span key={i} className={cx('font-mono font-normal not-italic [font-variant-ligatures:none]', mathClassName)}>
                <MathNodes nodes={seg.nodes} />
              </span>
            );
          case 'slot':
            return <Fragment key={i}>{values?.[seg.key] ?? DASH}</Fragment>;
        }
      })}
    </span>
  );
}
