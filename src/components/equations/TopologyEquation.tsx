import { deriveBandConstants } from '../../math/mobius';
import { useGlyphStore } from '../../state/store';
import { cx } from '../ui/primitives';
import { Aligned, Args, Comma, Eq, Fn, Gap, Note, Num, Op, Sym, Up, Var, useParamFlash } from './Eq';
import { MINUS, fmt, topologyEquationLines, twistAngle, type TwistAngle } from './format';
import { paramText } from './params';
import type { LiveEquationProps } from './WaveEquation';

/* ═══════════════════════════════════════════════════════════════════════════
 *  x(u,v) = (R + v·cos(nu/2))·cos u,  y(u,v) = (R + v·cos(nu/2))·sin u,
 *  z(u,v) = v·sin(nu/2)  — with n substituted and the angle nu/2 written in
 *  lowest terms, so an odd n visibly keeps its "/2" (the Möbius flip).
 *  n and w come from deriveBandConstants — the function experiments/topology.ts runs.
 * ═══════════════════════════════════════════════════════════════════════════ */

const MODE = 'topology';
const UV = ['u', 'v'] as const;
const N_KEYS = ['twists'];
const W_KEYS = ['width'];

/** cos 0 · cos u · cos(2u) · cos(u/2) · cos(3u/2) */
function Trig({ fn, angle }: { fn: 'cos' | 'sin'; angle: TwistAngle }) {
  switch (angle.kind) {
    case 'zero':
      return (
        <>
          <Fn>{fn}</Fn>
          <Gap />
          <Num keys={N_KEYS} mode={MODE}>
            0
          </Num>
        </>
      );
    case 'whole':
      if (angle.m === 1) {
        return (
          <>
            <Fn>{fn}</Fn>
            <Gap />
            <Var>u</Var>
          </>
        );
      }
      return (
        <>
          <Fn>{fn}</Fn>(
          <Num keys={N_KEYS} mode={MODE}>
            {angle.m}
          </Num>
          <Var>u</Var>)
        </>
      );
    case 'half':
      return (
        <>
          <Fn>{fn}</Fn>(
          {angle.n !== 1 && (
            <Num keys={N_KEYS} mode={MODE}>
              {angle.n}
            </Num>
          )}
          <Var>u</Var>
          <Op role="slash">/</Op>2)
        </>
      );
  }
}

/** (R + v·cos(…)) */
function Radius({ angle }: { angle: TwistAngle }) {
  return (
    <>
      (<Var>R</Var>
      <Op>+</Op>
      <Var>v</Var>
      <Op role="tight">·</Op>
      <Trig fn="cos" angle={angle} />)
    </>
  );
}

/** The live parametric band. */
export function TopologyEquation({ className, details = true }: LiveEquationProps) {
  const params = useGlyphStore((s) => s.params.topology);
  const bc = deriveBandConstants(params);
  const angle = twistAngle(bc.n);
  const w = fmt(bc.w, 2);

  return (
    <Eq label={topologyEquationLines(bc).join('; ')} className={className}>
      <Aligned
        rows={[
          {
            key: 'x',
            lhs: (
              <>
                <Var>x</Var>
                <Args vars={UV} />
              </>
            ),
            rhs: (
              <span className="whitespace-nowrap">
                <Radius angle={angle} />
                <Op role="tight">·</Op>
                <Fn>cos</Fn>
                <Gap />
                <Var>u</Var>
              </span>
            ),
          },
          {
            key: 'y',
            lhs: (
              <>
                <Var>y</Var>
                <Args vars={UV} />
              </>
            ),
            rhs: (
              <span className="whitespace-nowrap">
                <Radius angle={angle} />
                <Op role="tight">·</Op>
                <Fn>sin</Fn>
                <Gap />
                <Var>u</Var>
              </span>
            ),
          },
          {
            key: 'z',
            lhs: (
              <>
                <Var>z</Var>
                <Args vars={UV} />
              </>
            ),
            rhs: (
              <span className="whitespace-nowrap">
                <Var>v</Var>
                <Op role="tight">·</Op>
                <Trig fn="sin" angle={angle} />
                {angle.kind === 'zero' && (
                  <>
                    <Op role="rel">=</Op>0
                  </>
                )}
              </span>
            ),
          },
        ]}
      />

      {details && (
        <>
          <div className="gf-equation-relations flex flex-wrap items-baseline gap-x-[1.2em] gap-y-1">
            <span className="whitespace-nowrap">
              <Var>u</Var>
              <Sym name="in" />
              [0
              <Comma />
              2<Up>π</Up>)
            </span>
            <span className="whitespace-nowrap">
              <Var>v</Var>
              <Sym name="in" />[
              <Num keys={W_KEYS} mode={MODE}>
                {MINUS + w}
              </Num>
              <Comma />
              <Num keys={W_KEYS} mode={MODE}>
                {w}
              </Num>
              ]
            </span>
            <span className="whitespace-nowrap">
              <Var>R</Var>
              <Op role="rel">=</Op>
              {fmt(bc.R, 0)}
            </span>
            <span className="whitespace-nowrap">
              <Var>n</Var>
              <Op role="rel">=</Op>
              <Num keys={N_KEYS} mode={MODE}>
                {paramText(MODE, 'twists', bc.n)}
              </Num>
            </span>
          </div>
          {angle.kind === 'zero' && (
            <div>
              <Note>n = 0: cos 0 = 1 and sin 0 = 0 — the strip never turns.</Note>
            </div>
          )}
        </>
      )}
    </Eq>
  );
}

function FactChip({ label, value }: { label: string; value: string }) {
  const ref = useParamFlash<HTMLLIElement>(N_KEYS, MODE);
  return (
    <li
      ref={ref}
      className="inline-flex items-baseline gap-2 rounded-md bg-white/[0.035] px-2.5 py-1.5"
    >
      <span className="font-sans text-[11px] text-muted">{label.toLowerCase()}</span>
      <span className="font-mono text-[12px] text-ink">{value}</span>
    </li>
  );
}

/** SIDES · EDGES · ORIENTABLE · EDGE — the band's invariants, from deriveBandConstants. */
export function BandFacts({ className }: { className?: string }) {
  const params = useGlyphStore((s) => s.params.topology);
  const bc = deriveBandConstants(params);
  return (
    <ul aria-label="Topological invariants" className={cx('flex flex-wrap gap-1.5', className)}>
      <FactChip label="SIDES" value={String(bc.sides)} />
      <FactChip label="EDGES" value={String(bc.edges)} />
      <FactChip label="ORIENTABLE" value={bc.orientable ? 'YES' : 'NO'} />
      <FactChip label="EDGE" value={bc.edgeName} />
    </ul>
  );
}
