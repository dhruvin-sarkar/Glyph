import type { ReactNode } from 'react';
import { deriveFieldConstants, spiralRate } from '../../math/vectorField';
import { useGlyphStore } from '../../state/store';
import { Args, Eq, Frac, Line, Note, Num, Op, Sub, Sup, Term, Up, Var } from './Eq';
import { MINUS, attractorEquationText, fmt, leadingPart, roundsToZero, signedPart } from './format';
import { ProbeVector } from './live';
import type { LiveEquationProps } from './WaveEquation';

/* ═══════════════════════════════════════════════════════════════════════════
 *  F(x, y) = [ s·(−Δy, Δx) − g·(Δx, Δy) ] / (Δx² + Δy² + ε),   Δ = p − a
 *  dp/dt = F(p)  (RK4)      stream lines: r = r₀·e^(−(g/s)θ)
 *  s, g, ε from deriveFieldConstants — the function experiments/attractor.ts runs.
 * ═══════════════════════════════════════════════════════════════════════════ */

const MODE = 'attractor';
const XY = ['x', 'y'] as const;
const S_KEYS = ['swirl'];
const G_KEYS = ['strength'];
const SG_KEYS = ['strength', 'swirl'];

/** Δx, Δy */
function D({ c }: { c: 'x' | 'y' }) {
  return (
    <>
      <Up>Δ</Up>
      <Var>{c}</Var>
    </>
  );
}

/** A 2-vector (a, b). */
function Vec({ a, b }: { a: ReactNode; b: ReactNode }) {
  return (
    <>
      ({a}
      <span className="mr-[0.24em]">,</span>
      {b})
    </>
  );
}

/** The live attractor field. */
export function AttractorEquation({ className, details = true }: LiveEquationProps) {
  const params = useGlyphStore((s) => s.params.attractor);
  const fc = deriveFieldConstants(params);
  const s = leadingPart(fc.s, 2);
  const g = signedPart(-fc.g, 2, MINUS); // the sink term is written "− g·(Δx, Δy)"
  const ratio = spiralRate(fc); // ∞ when s = 0
  const sOff = roundsToZero(fc.s, 2);
  const gOff = roundsToZero(fc.g, 2);
  let spiralNote: string | null = null;
  if (!Number.isFinite(ratio)) spiralNote = 's = 0: straight inflow';
  else if (gOff) spiralNote = 'g = 0: circles';

  return (
    <Eq label={`Main attractor: ${attractorEquationText(fc)}`} className={className}>
      <p className="gf-equation-context">Main attractor</p>
      <Line
        stack="wide"
        lhs={
          <>
            <Var>F</Var>
            <Args vars={XY} />
          </>
        }
      >
        <Frac
          num={
            <span className="gf-field-numerator">
              {/* a coefficient set to zero dims and strikes its term, as in the wave equation */}
              <Term off={sOff}>
                {s.negative && <Op role="unary">{MINUS}</Op>}
                <Num keys={S_KEYS} mode={MODE}>
                  {s.abs}
                </Num>
                <Op role="tight">·</Op>
                <Vec
                  a={
                    <>
                      <Op role="unary">{MINUS}</Op>
                      <D c="y" />
                    </>
                  }
                  b={<D c="x" />}
                />
              </Term>
              <Term lead={g.sign} off={gOff}>
                <Num keys={G_KEYS} mode={MODE}>
                  {g.abs}
                </Num>
                <Op role="tight">·</Op>
                <Vec a={<D c="x" />} b={<D c="y" />} />
              </Term>
            </span>
          }
          den={
            <span className="whitespace-nowrap">
              <D c="x" />²
              <Op>+</Op>
              <D c="y" />²
              <Op>+</Op>
              <Num keys={['softening']} mode={MODE}>
                {fmt(fc.eps, 3)}
              </Num>
            </span>
          }
        />
      </Line>

      {details && (
        <div className="gf-equation-relations space-y-[0.25em]">
          <div className="flex flex-wrap items-baseline gap-x-[1.4em]">
            <span className="whitespace-nowrap">
              <Up>Δ</Up>
              <Op role="rel">=</Op>
              <Var>p</Var>
              <Op>−</Op>
              <Var>a</Var>
              <span>,</span>
            </span>
            <span className="whitespace-nowrap">
              <Var>a</Var>
              <Op role="rel">=</Op>
              {/* the attractor follows the cursor — read live from the probe (8 Hz leaf) */}
              <ProbeVector x="ax" y="ay" />
            </span>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-[0.7em]">
            <span className="whitespace-nowrap">
              <Var>d</Var>
              <Var>p</Var>
              <Op role="slash">/</Op>
              <Var>d</Var>
              <Var>t</Var>
              <Op role="rel">=</Op>
              <Var>F</Var>(<Var>p</Var>)
            </span>
            <Note>— integrated with RK4</Note>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-[1.4em]">
            <span className="whitespace-nowrap">
              <Var>r</Var>
              <Op role="rel">=</Op>
              <Var>r</Var>
              <Sub>0</Sub>
              <Op role="tight">·</Op>
              <Up>e</Up>
              <Sup>
                {MINUS}(<Var>g</Var>/<Var>s</Var>)<Var>θ</Var>
              </Sup>
              <span>,</span>
            </span>
            <span className="whitespace-nowrap">
              <Var>g</Var>
              <Op role="slash">/</Op>
              <Var>s</Var>
              <Op role="rel">=</Op>
              <Num keys={SG_KEYS} mode={MODE}>
                {fmt(ratio, 2)}
              </Num>
              {spiralNote && <Note className="ml-[0.6em]">{spiralNote}</Note>}
            </span>
          </div>
        </div>
      )}
    </Eq>
  );
}
