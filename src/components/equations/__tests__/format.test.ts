import { describe, expect, it } from 'vitest';
import { deriveWaveConstants } from '../../../math/waves';
import { deriveFieldConstants } from '../../../math/vectorField';
import { deriveBandConstants } from '../../../math/mobius';
import {
  DASH,
  MINUS,
  attractorEquationText,
  fmt,
  laneSpacing,
  lapTurnText,
  leadingPart,
  roundsToZero,
  signedPart,
  spiralPitchDeg,
  topologyEquationLines,
  trueMinus,
  twistAngle,
  twistAngleText,
  waveEquationText,
  wavePeriod,
  wavelength,
} from '../format';

const WAVE_DEFAULTS = { amplitude: 1, frequency: 9, speed: 0.35, angle: 70, second: true, disturb: 1, view: 'horizon' };

describe('fmt', () => {
  it('prints negatives with the true minus sign U+2212', () => {
    expect(fmt(-0.21, 2)).toBe(`${MINUS}0.21`);
    expect(fmt(-0.21, 2).charCodeAt(0)).toBe(0x2212);
  });

  it('never prints a negative zero', () => {
    expect(fmt(-0.001, 2)).toBe('0.00');
    expect(fmt(-0, 2)).toBe('0.00');
    expect(roundsToZero(-0.004, 2)).toBe(true);
    expect(roundsToZero(-0.006, 2)).toBe(false);
  });

  it('shows a dash where a value does not exist', () => {
    expect(fmt(Infinity, 2)).toBe(DASH);
    expect(fmt(Number.NaN, 1)).toBe(DASH);
  });

  it('replaces ASCII minus signs in front of numbers only', () => {
    expect(trueMinus('(0.12, -0.30)')).toBe(`(0.12, ${MINUS}0.30)`);
    expect(trueMinus('-1.5')).toBe(`${MINUS}1.5`);
    expect(trueMinus('Wi-Fi')).toBe('Wi-Fi');
    expect(trueMinus('1e-5')).toBe('1e-5');
  });
});

describe('sign normalisation', () => {
  it("writes '+ −0.21x' as '− 0.21x'", () => {
    expect(signedPart(-0.21, 2)).toEqual({ sign: MINUS, abs: '0.21' });
    expect(signedPart(0.21, 2)).toEqual({ sign: '+', abs: '0.21' });
  });

  it('treats a value that rounds to zero as zero', () => {
    expect(signedPart(-0.004, 2)).toEqual({ sign: '+', abs: '0.00' });
    // the time term of a wave is "− ωt" even when ω = 0
    expect(signedPart(-0, 2, MINUS)).toEqual({ sign: MINUS, abs: '0.00' });
  });

  it('puts a unary minus only on genuinely negative leading terms', () => {
    expect(leadingPart(-8.5595, 2)).toEqual({ negative: true, abs: '8.56' });
    expect(leadingPart(-0.001, 2)).toEqual({ negative: false, abs: '0.00' });
  });
});

describe('waveEquationText — the numbers the simulation uses', () => {
  it('substitutes the default constants', () => {
    // k₁ = 9·(cos 18°, sin 18°) = (8.56, 2.78); k₂ = 9·(cos 88°, sin 88°) = (0.31, 8.99); ω = 0.35 × 9 = 3.15
    expect(waveEquationText(deriveWaveConstants(WAVE_DEFAULTS))).toBe(
      `f(x, y, t) = 1.00·sin(8.56x + 2.78y ${MINUS} 3.15t) + 1.00·sin(0.31x + 8.99y ${MINUS} 3.15t) + Σᵢ ρᵢ`,
    );
  });

  it('standing wave (θ = 180°): k₂ = −k₁', () => {
    const text = waveEquationText(deriveWaveConstants({ ...WAVE_DEFAULTS, angle: 180 }));
    expect(text).toContain(`1.00·sin(${MINUS}8.56x ${MINUS} 2.78y ${MINUS} 3.15t)`);
  });

  it('normalises a negative y-coefficient into a subtraction (θ = 170°)', () => {
    const text = waveEquationText(deriveWaveConstants({ ...WAVE_DEFAULTS, angle: 170 }));
    expect(text).toContain(`sin(${MINUS}8.91x ${MINUS} 1.25y ${MINUS} 3.15t)`);
    expect(text).not.toContain(`+ ${MINUS}`);
  });

  it('second wave off: A₂ = 0', () => {
    const text = waveEquationText(deriveWaveConstants({ ...WAVE_DEFAULTS, second: false }));
    expect(text).toContain('+ 0.00·sin(');
  });

  it('c = 0 keeps the "− ωt" structure', () => {
    const text = waveEquationText(deriveWaveConstants({ ...WAVE_DEFAULTS, speed: 0 }));
    expect(text).toContain(`${MINUS} 0.00t)`);
  });
});

describe('attractorEquationText', () => {
  it('substitutes s, g and ε', () => {
    expect(attractorEquationText(deriveFieldConstants({ swirl: 0.65, strength: 0.22, softening: 0.008 }))).toBe(
      `F(x, y) = [0.65·(${MINUS}Δy, Δx) ${MINUS} 0.22·(Δx, Δy)] / (Δx² + Δy² + 0.008)`,
    );
  });

  it('negative swirl gets a unary minus', () => {
    const text = attractorEquationText(deriveFieldConstants({ swirl: -0.65, strength: 0.22, softening: 0.008 }));
    expect(text.startsWith(`F(x, y) = [${MINUS}0.65·`)).toBe(true);
  });
});

describe('topology', () => {
  it('writes the twist angle nu/2 in lowest terms', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(twistAngleText)).toEqual(['0', 'u/2', 'u', '3u/2', '2u', '5u/2', '3u', '7u/2']);
    expect(twistAngle(3)).toEqual({ kind: 'half', n: 3 });
    expect(twistAngle(6)).toEqual({ kind: 'whole', m: 3 });
  });

  it('total turn after one lap is nπ', () => {
    expect(lapTurnText(0)).toBe('0');
    expect(lapTurnText(1)).toBe('π');
    expect(lapTurnText(3)).toBe('3π');
  });

  it('substitutes n and w into r(u, v)', () => {
    const lines = topologyEquationLines(deriveBandConstants({ twists: 3, width: 0.42 }));
    expect(lines).toEqual([
      'x(u, v) = (R + v·cos(3u/2))·cos u',
      'y(u, v) = (R + v·cos(3u/2))·sin u',
      'z(u, v) = v·sin(3u/2)',
      `u ∈ [0, 2π),  v ∈ [${MINUS}0.42, 0.42],  R = 1`,
    ]);
  });

  it('n = 0 shows cos 0 and sin 0', () => {
    const [x, , z] = topologyEquationLines(deriveBandConstants({ twists: 0, width: 0.42 }));
    expect(x).toBe('x(u, v) = (R + v·cos 0)·cos u');
    expect(z).toBe('z(u, v) = v·sin 0');
  });
});

describe('derived quantities', () => {
  it('wavelength and period', () => {
    expect(wavelength(9)).toBeCloseTo((2 * Math.PI) / 9, 12);
    expect(wavePeriod(3.15)).toBeCloseTo((2 * Math.PI) / 3.15, 12);
    expect(wavePeriod(0)).toBe(Infinity);
  });

  it('interference lanes are π / (k·sin(θ/2)) apart', () => {
    expect(laneSpacing(9, 70)).toBeCloseTo(Math.PI / (9 * Math.sin((35 * Math.PI) / 180)), 12);
    // head-on waves: the nodes of a standing wave are half a wavelength apart
    expect(laneSpacing(9, 180)).toBeCloseTo(wavelength(9) / 2, 12);
    expect(laneSpacing(9, 0)).toBe(Infinity);
  });

  it('lanes really are calm: f = 0 there at every time (two equal waves)', () => {
    const wc = deriveWaveConstants({ ...WAVE_DEFAULTS, angle: 70 });
    // a point where q·r = π/2 with q = (k₁ − k₂)/2
    const qx = (wc.k1x - wc.k2x) / 2;
    const qy = (wc.k1y - wc.k2y) / 2;
    const q2 = qx * qx + qy * qy;
    const s = Math.PI / 2 / q2;
    const [x, y] = [qx * s, qy * s];
    for (const t of [0, 0.37, 1.2, 5.9]) {
      const f = wc.A1 * Math.sin(wc.k1x * x + wc.k1y * y - wc.omega1 * t) + wc.A2 * Math.sin(wc.k2x * x + wc.k2y * y - wc.omega2 * t);
      expect(Math.abs(f)).toBeLessThan(1e-9);
    }
  });

  it('spiral pitch angle α = arctan(g / |s|)', () => {
    expect(spiralPitchDeg(0.65, 0.22)).toBeCloseTo((Math.atan(0.22 / 0.65) * 180) / Math.PI, 12);
    expect(spiralPitchDeg(-0.65, 0.22)).toBeCloseTo(spiralPitchDeg(0.65, 0.22), 12);
    expect(spiralPitchDeg(0, 0.6)).toBe(90);
    expect(spiralPitchDeg(0.65, 0)).toBe(0);
    expect(Number.isNaN(spiralPitchDeg(0, 0))).toBe(true);
  });
});
