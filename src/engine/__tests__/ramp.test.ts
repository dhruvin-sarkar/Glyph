import { describe, expect, it } from 'vitest';
import { BG_COLOR, GLYPH_CHARSET, RAMPS, TONE_COLORS, TONE_COUNT, Tone } from '../types';
import { RAMP_LUT_SIZE, buildRamp, measureGlyphCoverage } from '../GlyphRamp';
import { packCells } from '../AsciiRenderer';
import { GlyphBuffer } from '../GlyphField';
import {
  ATLAS_LEVELS,
  ATLAS_MAX_DIM,
  ATLAS_MAX_PIXELS,
  GLYPH_COLUMN,
  hexToRgb,
  mixRgb,
  planAtlasLayout,
} from '../GlyphAtlas';

/** One step of the ramp lookup table in v. */
const STEP = 1 / (RAMP_LUT_SIZE - 1);
const SPACE = 32;

const cov = (...values: number[]): Float32Array => Float32Array.from(values);
const f32 = (x: number): number => Math.fround(x);
const char = (code: number): string => String.fromCharCode(code);

/** Deterministic PRNG (mulberry32) so any failure is reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Reference answer: index of the coverage nearest to v, the lowest index on ties. */
function bruteNearest(coverage: Float32Array, v: number): number {
  let best = 0;
  for (let i = 1; i < coverage.length; i++) {
    if (Math.abs(coverage[i] - v) < Math.abs(coverage[best] - v)) best = i;
  }
  return best;
}

/** A random ramp: n distinct printable chars with coverage quantised to force ties. */
function randomRamp(rand: () => number) {
  const n = 2 + Math.floor(rand() * 40);
  let chars = '';
  for (let i = 0; i < n; i++) chars += char(33 + i);
  const values = new Float32Array(n);
  for (let i = 0; i < n; i++) values[i] = Math.round(rand() * 24) / 24;
  return buildRamp(chars, values);
}

describe('buildRamp · ordering', () => {
  it('sorts characters by measured coverage, emptiest first', () => {
    const r = buildRamp(' abcd', cov(0, 0.9, 0.1, 0.5, 1));
    expect(r.chars).toBe(' bcad');
    expect(Array.from(r.coverage)).toEqual([0, f32(0.1), f32(0.5), f32(0.9), 1]);
  });

  it('keeps codes in step with chars', () => {
    const r = buildRamp(RAMPS.fine, measureGlyphCoverage(RAMPS.fine, 16, 10, 19));
    expect(r.codes).toHaveLength(r.chars.length);
    expect(r.coverage).toHaveLength(r.chars.length);
    for (let i = 0; i < r.chars.length; i++) expect(r.codes[i]).toBe(r.chars.charCodeAt(i));
  });

  it('is a stable sort: equal coverage keeps the candidate order', () => {
    const r = buildRamp(' xyz', cov(0, 0.5, 0.5, 0.2));
    expect(r.chars).toBe(' zxy');
    // at v = 1 both x and y are exact matches — the lower index (x) wins
    expect(char(r.codeFor(1))).toBe('x');
  });

  it('reorders a nominal ramp when the measurement disagrees with it', () => {
    // pretend that in this font '*' carries less ink than '+'
    const r = buildRamp(RAMPS.classic, cov(0, 0.05, 0.1, 0.15, 0.3, 0.5, 0.4, 0.8, 0.9, 1));
    expect(r.chars).toBe(' .:-=*+#%@');
    for (let i = 1; i < r.coverage.length; i++) expect(r.coverage[i]).toBeGreaterThanOrEqual(r.coverage[i - 1]);
  });

  it('renormalises so the densest character is exactly 1', () => {
    const r = buildRamp(' .:', cov(0, 2, 4));
    expect(Array.from(r.coverage)).toEqual([0, 0.5, 1]);
  });
});

describe('buildRamp · space', () => {
  it('puts space first with coverage 0, whatever coverage it was given', () => {
    const r = buildRamp('ab c', cov(0.3, 0.6, 0.9, 1));
    expect(r.chars).toBe(' abc');
    expect(Array.from(r.coverage)).toEqual([0, f32(0.3), f32(0.6), 1]);
  });

  it('adds a space when the candidates have none', () => {
    const r = buildRamp('ab', cov(0.5, 1));
    expect(r.chars).toBe(' ab');
    expect(r.codeFor(0)).toBe(SPACE);
    expect(r.indexFor(0)).toBe(0);
  });

  it('draws nothing at v = 0 and the densest glyph at v = 1', () => {
    const r = buildRamp(RAMPS.classic, measureGlyphCoverage(RAMPS.classic, 16, 10, 19));
    expect(r.codeFor(0)).toBe(SPACE);
    expect(char(r.codeFor(1))).toBe('@');
  });

  it('turns an empty candidate string into a space-only ramp', () => {
    const r = buildRamp('', cov());
    expect(r.chars).toBe(' ');
    expect(r.codeFor(0.5)).toBe(SPACE);
    expect(r.codeFor(1)).toBe(SPACE);
    expect(r.indexFor(1)).toBe(0);
  });
});

describe('buildRamp · duplicates', () => {
  it('drops repeated characters; the first occurrence wins', () => {
    const r = buildRamp('..::##', cov(0.1, 0.9, 0.4, 0.4, 1, 0.2));
    expect(r.chars).toBe(' .:#');
    expect(Array.from(r.coverage)).toEqual([0, f32(0.1), f32(0.4), 1]);
  });

  it('collapses repeated spaces', () => {
    expect(buildRamp('  .  :', cov(0, 0, 0.5, 0, 0, 1)).chars).toBe(' .:');
  });

  it('never repeats a code in any built-in ramp', () => {
    for (const candidates of Object.values(RAMPS)) {
      const r = buildRamp(candidates, measureGlyphCoverage(candidates, 16, 10, 19));
      expect(new Set(r.codes).size).toBe(r.codes.length);
    }
  });
});

describe('buildRamp · bounds', () => {
  const r = buildRamp(RAMPS.classic, measureGlyphCoverage(RAMPS.classic, 16, 10, 19));
  const last = r.chars.length - 1;

  it('clamps v below 0 to space', () => {
    expect(r.indexFor(-0.5)).toBe(0);
    expect(r.codeFor(-1)).toBe(SPACE);
    expect(r.codeFor(-Infinity)).toBe(SPACE);
  });

  it('clamps v above 1 to the densest character', () => {
    expect(r.indexFor(1.5)).toBe(last);
    expect(r.indexFor(Infinity)).toBe(last);
    expect(char(r.codeFor(7))).toBe('@');
  });

  it('maps NaN to space', () => {
    expect(r.indexFor(Number.NaN)).toBe(0);
    expect(r.codeFor(Number.NaN)).toBe(SPACE);
  });

  it('codeFor and indexFor always agree', () => {
    for (let v = -0.25; v <= 1.25; v += 0.0037) expect(r.codeFor(v)).toBe(r.codes[r.indexFor(v)]);
  });
});

describe('buildRamp · lookup table vs brute force', () => {
  it('is exact at every table sample', () => {
    const rand = rng(1);
    const mismatches: string[] = [];
    for (let trial = 0; trial < 150; trial++) {
      const r = randomRamp(rand);
      for (let j = 0; j < RAMP_LUT_SIZE; j++) {
        const v = j / (RAMP_LUT_SIZE - 1);
        const want = bruteNearest(r.coverage, v);
        if (r.indexFor(v) !== want) mismatches.push(`trial ${trial}, v=${v}: ${r.indexFor(v)} ≠ ${want}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('between samples is never worse than the true nearest by more than one table step', () => {
    const rand = rng(2);
    let worst = 0;
    for (let trial = 0; trial < 150; trial++) {
      const r = randomRamp(rand);
      for (let s = 0; s < 400; s++) {
        const v = rand();
        const got = Math.abs(r.coverage[r.indexFor(v)] - v);
        const best = Math.abs(r.coverage[bruteNearest(r.coverage, v)] - v);
        worst = Math.max(worst, got - best);
      }
    }
    expect(worst).toBeLessThanOrEqual(STEP + 1e-12);
  });

  it('is monotone: a brighter value never selects less ink', () => {
    const rand = rng(3);
    for (let trial = 0; trial < 40; trial++) {
      const r = randomRamp(rand);
      let prev = 0;
      for (let k = 0; k <= 5000; k++) {
        const idx = r.indexFor(k / 5000);
        expect(idx).toBeGreaterThanOrEqual(prev);
        prev = idx;
      }
    }
  });
});

describe('buildRamp · degenerate input', () => {
  it('falls back to the nominal order when nothing has any ink', () => {
    const r = buildRamp(' abc', cov(0, 0, 0, 0));
    expect(r.chars).toBe(' abc');
    expect(Array.from(r.coverage)).toEqual([0, f32(1 / 3), f32(2 / 3), 1]);
    expect(char(r.codeFor(1))).toBe('c');
  });

  it('treats NaN, negative and missing coverage as 0', () => {
    // 'd' has no coverage entry at all
    const r = buildRamp(' abcd', cov(0, Number.NaN, -1, 1));
    expect(r.chars).toBe(' abdc');
    expect(Array.from(r.coverage)).toEqual([0, 0, 0, 0, 1]);
    expect(r.codeFor(0.4)).toBe(SPACE);
    expect(char(r.codeFor(0.6))).toBe('c');
  });
});

describe('measureGlyphCoverage', () => {
  it('never throws without a canvas and keeps the nominal order', () => {
    const c = measureGlyphCoverage(RAMPS.classic, 16, 10, 19);
    expect(c).toBeInstanceOf(Float32Array);
    expect(c).toHaveLength(RAMPS.classic.length);
    expect(c[0]).toBe(0);
    expect(Math.max(...c)).toBe(1);
    for (let i = 2; i < c.length; i++) expect(c[i]).toBeGreaterThan(c[i - 1]);
  });

  it('handles empty input and nonsense sizes', () => {
    expect(measureGlyphCoverage('', 16, 10, 19)).toHaveLength(0);
    expect(() => measureGlyphCoverage(' .', Number.NaN, -1, 0)).not.toThrow();
  });

  it('feeds buildRamp end to end', () => {
    const r = buildRamp(RAMPS.soft, measureGlyphCoverage(RAMPS.soft, 16, 10, 19));
    expect(r.chars).toBe(RAMPS.soft);
  });
});

describe('glyph atlas', () => {
  it('maps every charset character to its own column and unknown codes to "?"', () => {
    for (let i = 0; i < GLYPH_CHARSET.length; i++) expect(GLYPH_COLUMN[GLYPH_CHARSET.charCodeAt(i)]).toBe(i);
    const q = GLYPH_CHARSET.indexOf('?');
    for (const code of [1, 9, 127, 0xa0, 0xff]) expect(GLYPH_COLUMN[code]).toBe(q);
  });

  it('can draw every character of every built-in ramp', () => {
    for (const candidates of Object.values(RAMPS)) {
      for (const ch of candidates) expect(GLYPH_CHARSET.includes(ch)).toBe(true);
    }
  });

  it('keeps all 16 brightness levels at everyday sizes', () => {
    const at1x = planAtlasLayout(GLYPH_CHARSET.length, TONE_COUNT, 9, 18);
    expect(at1x.levels).toBe(ATLAS_LEVELS);
    expect(at1x.width).toBe(GLYPH_CHARSET.length * 9);
    expect(at1x.height).toBe(TONE_COUNT * (ATLAS_LEVELS - 1) * 18);
    const at2x = planAtlasLayout(GLYPH_CHARSET.length, TONE_COUNT, 18, 36);
    expect(at2x.levels).toBe(ATLAS_LEVELS);
  });

  it('lowers the level count instead of exceeding the size budgets', () => {
    for (const [w, h] of [
      [9, 18],
      [30, 60],
      [42, 84],
      [50, 100],
    ]) {
      const l = planAtlasLayout(GLYPH_CHARSET.length, TONE_COUNT, w, h);
      expect(l.width).toBeLessThanOrEqual(ATLAS_MAX_DIM);
      expect(l.height).toBeLessThanOrEqual(ATLAS_MAX_DIM);
      expect(l.width * l.height).toBeLessThanOrEqual(ATLAS_MAX_PIXELS);
      expect(l.levels).toBeGreaterThanOrEqual(2);
      expect(l.levels).toBeLessThanOrEqual(ATLAS_LEVELS);
    }
    // absurd sizes still produce a usable (if coarse) layout
    expect(planAtlasLayout(GLYPH_CHARSET.length, TONE_COUNT, 400, 800).levels).toBe(2);
  });

  it('wraps the glyph strip onto several rows when one row would be too wide', () => {
    const l = planAtlasLayout(GLYPH_CHARSET.length, TONE_COUNT, 120, 240);
    expect(l.perRow).toBe(Math.floor(ATLAS_MAX_DIM / 120));
    expect(l.stripRows).toBe(2);
    expect(l.bandH).toBe(480);
    expect(l.width).toBeLessThanOrEqual(ATLAS_MAX_DIM);
  });
});

describe('renderer · cell packing (WebGL2 back-end)', () => {
  it('applies the same skip, level and fallback rules as the Canvas 2D loop', () => {
    const field = new GlyphBuffer(9, 1);
    const at = '@'.charCodeAt(0);
    field.set(0, 0, at, 1, Tone.INK); // full brightness → top level (L − 1 = 15)
    field.set(1, 0, SPACE, 1); // space → empty
    field.set(2, 0, 0, 1); // code 0 → empty
    field.set(3, 0, at, 0.019); // below the 0.02 threshold → empty
    field.set(4, 0, at, Number.NaN); // NaN → empty
    field.set(5, 0, at, 0.03); // round(0.03 · 15) = 0 → the background colour → empty
    field.set(6, 0, 0x2588, 0.5, Tone.MINT); // '█' is not in the charset → '?', round(7.5) = 8
    field.set(7, 0, at, 7); // above 1 → clamped to the top level
    field.set(8, 0, at, 0.5);
    field.tone[8] = 9; // unknown tone → INK

    const cells = new Uint8Array(9 * 4);
    const drawn = packCells(field, cells, 9);
    const levels = Array.from({ length: 9 }, (_, i) => cells[i * 4 + 1]);

    expect(levels).toEqual([15, 0, 0, 0, 0, 0, 8, 15, 8]);
    expect(drawn).toBe(4);
    expect(cells[0]).toBe(GLYPH_CHARSET.indexOf('@'));
    expect(cells[6 * 4]).toBe(GLYPH_CHARSET.indexOf('?'));
    expect(cells[6 * 4 + 2]).toBe(Tone.MINT);
    expect(cells[8 * 4 + 2]).toBe(Tone.INK);
  });
});

describe('tone colours', () => {
  it('parses the palette tokens', () => {
    expect(hexToRgb('#E9EDF2')).toEqual([233, 237, 242]);
    expect(hexToRgb('#060A10')).toEqual([6, 10, 16]);
    expect(hexToRgb('#fff')).toEqual([255, 255, 255]);
    expect(hexToRgb('nope')).toEqual([0, 0, 0]);
  });

  it('runs every tone from the background (level 0) to the exact token (top level)', () => {
    const bg = hexToRgb(BG_COLOR);
    for (const tone of TONE_COLORS) {
      const rgb = hexToRgb(tone);
      expect(mixRgb(bg, rgb, 0)).toEqual(bg);
      expect(mixRgb(bg, rgb, 1)).toEqual(rgb);
    }
  });
});
