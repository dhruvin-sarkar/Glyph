import { deriveWaveConstants } from '../../math/waves';
import { useGlyphStore } from '../../state/store';
import { cx } from '../ui/primitives';
import { Args, Eq, Fn, Note, Num, Op, Sub, Term, Unit, Up, Var } from './Eq';
import { MINUS, fmt, leadingPart, signedPart, waveEquationText } from './format';
import { paramText } from './params';

/* ═══════════════════════════════════════════════════════════════════════════
 *  f(x,y,t) = A₁·sin(k₁ₓx + k₁ᵧy − ωt) + A₂·sin(k₂ₓx + k₂ᵧy − ωt) + Σᵢ ρᵢ
 *  — typeset with the numbers the simulation is using right now
 *  (deriveWaveConstants is the same function experiments/wavefield.ts runs).
 * ═══════════════════════════════════════════════════════════════════════════ */

const MODE = 'waves';
const XYT = ['x', 'y', 't'] as const;
const A1_KEYS = ['amplitude'];
const A2_KEYS = ['amplitude', 'second'];
const K1_KEYS = ['frequency'];
const K2_KEYS = ['frequency', 'angle'];
const OMEGA_KEYS = ['speed', 'frequency'];
const B_KEYS = ['disturb'];

/** A·sin(kₓx + kᵧy − ωt) with substituted, sign-normalised coefficients. */
function PlaneWave({
  A,
  kx,
  ky,
  omega,
  aKeys,
  kKeys,
}: {
  A: number;
  kx: number;
  ky: number;
  omega: number;
  aKeys: readonly string[];
  kKeys: readonly string[];
}) {
  const x = leadingPart(kx, 2);
  const y = signedPart(ky, 2); // "+ −0.21y" is written "− 0.21y"
  const t = signedPart(-omega, 2, MINUS); // always "− ωt", even when ω = 0
  return (
    <>
      <Num keys={aKeys} mode={MODE}>
        {fmt(A, 2)}
      </Num>
      <Op role="tight">·</Op>
      <Fn>sin</Fn>(
      {x.negative && <Op role="unary">{MINUS}</Op>}
      <Num keys={kKeys} mode={MODE}>
        {x.abs}
      </Num>
      <Var>x</Var>
      <wbr />
      <Op>{y.sign}</Op>
      <Num keys={kKeys} mode={MODE}>
        {y.abs}
      </Num>
      <Var>y</Var>
      <wbr />
      <Op>{t.sign}</Op>
      <Num keys={OMEGA_KEYS} mode={MODE}>
        {t.abs}
      </Num>
      <Var>t</Var>)
    </>
  );
}

/** Σᵢ ρᵢ — the cursor ripples (each one carries the strength B). */
function RippleSum() {
  return (
    <>
      <Up>Σ</Up>
      <Sub>
        <Var>i</Var>
      </Sub>
      <span className="ml-[0.12em]">
        <Var>ρ</Var>
        <Sub>
          <Var>i</Var>
        </Sub>
      </span>
    </>
  );
}

export interface LiveEquationProps {
  className?: string;
  /** also show the secondary lines (relations, definitions) — default true */
  details?: boolean;
}

/** The live wavefield equation (+ ω = c·k and θ). */
export function WaveEquation({ className, details = true }: LiveEquationProps) {
  const params = useGlyphStore((s) => s.params.waves);
  const wc = deriveWaveConstants(params);

  return (
    <Eq label={waveEquationText(wc)} className={className}>
      <div className="gf-wave-heading">
        <span><Var>f</Var><Args vars={XYT} /><Op role="rel">=</Op></span>
        <Note>Wave 1 + wave 2 + ripples</Note>
      </div>
      <div className="gf-wave-terms">
        <Term>
          <PlaneWave A={wc.A1} kx={wc.k1x} ky={wc.k1y} omega={wc.omega1} aKeys={A1_KEYS} kKeys={K1_KEYS} />
        </Term>
        {/* switching the second wave off sets A₂ = 0: the term dims and is struck through */}
        <Term lead="+" off={!wc.second}>
          <PlaneWave A={wc.A2} kx={wc.k2x} ky={wc.k2y} omega={wc.omega2} aKeys={A2_KEYS} kKeys={K2_KEYS} />
        </Term>
        <Term lead="+" off={wc.B === 0}>
          <RippleSum />
          <Note className="ml-3">cursor ripples</Note>
        </Term>
      </div>

      {details && (
        <div className="gf-equation-relations flex flex-wrap items-baseline gap-x-[1.6em] gap-y-1">
          <span className="whitespace-nowrap">
            <Var>ω</Var>
            <Op role="rel">=</Op>
            <Var>c</Var>
            <Op role="tight">·</Op>
            <Var>k</Var>
            <Op role="rel">=</Op>
            <Num keys={['speed']} mode={MODE}>
              {paramText(MODE, 'speed', wc.c)}
            </Num>
            <Op>×</Op>
            <Num keys={K1_KEYS} mode={MODE}>
              {paramText(MODE, 'frequency', wc.k)}
            </Num>
            <Op role="rel">=</Op>
            <Num keys={OMEGA_KEYS} mode={MODE}>
              {fmt(wc.omega1, 2)}
            </Num>
            <Unit>rad/s</Unit>
          </span>
          {/* θ only matters while the second wave exists */}
          <span className={cx('whitespace-nowrap transition-opacity duration-500', !wc.second && 'opacity-40')}>
            <Var>θ</Var>
            <Op role="rel">=</Op>
            <Num keys={['angle']} mode={MODE}>
              {paramText(MODE, 'angle', wc.thetaDeg)}°
            </Num>
          </span>
          {wc.B === 0 && (
            <span className="whitespace-nowrap">
              <Var>B</Var>
              <Op role="rel">=</Op>
              <Num keys={B_KEYS} mode={MODE}>
                {fmt(0, 2)}
              </Num>
            </span>
          )}
        </div>
      )}
    </Eq>
  );
}
