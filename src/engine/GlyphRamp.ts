import type { GlyphRamp } from './types';
import { ATLAS_MAX_DIM, createSurface, measureGlyphCell, releaseSurface, renderGlyphTiles } from './GlyphAtlas';
import type { Surface } from './GlyphAtlas';

/* ═══════════════════════════════════════════════════════════════════════════
 *  GLYPHFIELD · CALIBRATED LUMINANCE RAMPS
 *
 *  An ASCII ramp such as " .:-=+*#%@" is a ladder of characters from empty to
 *  dense. The order in the brief is a guess made by eye — in a particular
 *  font, '+' may well carry more ink than '*'. GLYPHFIELD measures instead:
 *
 *    coverage(char) = Σ alpha of its pixels / (255 · cellW · cellH)
 *
 *  i.e. the fraction of the cell the character covers, rasterised exactly as
 *  the atlas draws it (same font, weight, size and baseline). Dividing by the
 *  densest character gives a scale where space = 0 and the densest = 1.
 *  Sorting by that number turns the ramp into a calibrated lookup:
 *
 *    brightness v ∈ [0, 1]  ──▶  the character whose coverage is closest to v
 *
 *  so a brighter value always means more ink on screen. The lookup is
 *  precomputed for 1024 evenly spaced values of v, which makes codeFor(v)
 *  one multiply and one array read — cheap enough for 15 000 cells a frame.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Number of precomputed samples of v ∈ [0, 1] in every ramp's lookup table. */
export const RAMP_LUT_SIZE = 1024;
const LUT_MAX = RAMP_LUT_SIZE - 1;
const SPACE = 32;

/**
 * Fallback when pixels cannot be read (no canvas, or readback blocked by a
 * privacy mode): trust the given (nominal) order — space = 0, the other
 * characters evenly spaced up to 1.
 */
function nominalCoverage(chars: string, out: Float32Array): Float32Array {
  let inked = 0;
  for (let i = 0; i < chars.length; i++) if (chars.charCodeAt(i) !== SPACE) inked++;
  let rank = 0;
  for (let i = 0; i < chars.length; i++) out[i] = chars.charCodeAt(i) === SPACE ? 0 : ++rank / inked;
  return out;
}

/**
 * Measure the ink coverage of each char by rasterising it — white, with the
 * glyph font at `fontSize` px, placed exactly as the atlas places it — into a
 * cellW × cellH cell and summing the alpha of its pixels.
 * Returns one value per UTF-16 code unit of `chars`, normalised so the densest
 * char = 1 and space = 0. Never throws: without a usable canvas it falls back
 * to the nominal order of `chars`.
 */
export function measureGlyphCoverage(chars: string, fontSize: number, cellW: number, cellH: number): Float32Array {
  const n = chars.length;
  const out = new Float32Array(n);
  if (n === 0) return out;

  const w = Math.max(1, Math.round(Number.isFinite(cellW) ? cellW : 1));
  const h = Math.max(1, Math.round(Number.isFinite(cellH) ? cellH : 1));
  const perRow = Math.max(1, Math.min(n, Math.floor(ATLAS_MAX_DIM / w)));
  const width = perRow * w;
  const height = Math.ceil(n / perRow) * h;

  let surface: Surface | null = null;
  try {
    surface = createSurface(width, height, true);
    if (surface) {
      const { ctx } = surface;
      renderGlyphTiles(ctx, chars, measureGlyphCell(ctx, fontSize, w, h), perRow);
      // One readback for every tile; RGBA bytes, so alpha is every 4th byte.
      const data = ctx.getImageData(0, 0, width, height).data;
      let max = 0;
      for (let i = 0; i < n; i++) {
        if (chars.charCodeAt(i) === SPACE) {
          out[i] = 0;
          continue;
        }
        const x0 = (i % perRow) * w;
        const y0 = Math.floor(i / perRow) * h;
        let sum = 0;
        for (let y = y0; y < y0 + h; y++) {
          for (let p = (y * width + x0) * 4 + 3, end = p + w * 4; p < end; p += 4) sum += data[p];
        }
        out[i] = sum;
        if (sum > max) max = sum;
      }
      if (max > 0) {
        for (let i = 0; i < n; i++) out[i] /= max;
        return out;
      }
    }
  } catch {
    // Readback refused (e.g. anti-fingerprinting): use the nominal order below.
  } finally {
    releaseSurface(surface);
  }
  return nominalCoverage(chars, out);
}

interface RampEntry {
  code: number;
  coverage: number;
  /** position among the candidates — keeps the sort stable and explicit */
  order: number;
}

/**
 * Build a calibrated ramp from candidate chars and their measured coverage
 * (`coverage[i]` belongs to `candidates[i]`).
 *
 * - Duplicates are dropped (the first occurrence wins).
 * - Space is always index 0 with coverage 0 (added if missing), so v = 0 draws nothing.
 * - The other chars are stable-sorted by coverage, ascending, and renormalised so
 *   the densest = 1. Missing, negative or NaN coverage counts as 0; if no char
 *   has any ink at all, the nominal candidate order is used instead.
 * - codeFor / indexFor read a 1024-entry table of nearest matches (ties → the
 *   lower index). v is clamped to [0, 1]; NaN → space.
 */
export function buildRamp(candidates: string, coverage: Float32Array): GlyphRamp {
  const seen = new Set<number>([SPACE]);
  const entries: RampEntry[] = [];
  let max = 0;
  for (let i = 0; i < candidates.length; i++) {
    const code = candidates.charCodeAt(i);
    if (seen.has(code)) continue;
    seen.add(code);
    const raw = coverage[i];
    const c = Number.isFinite(raw) && raw > 0 ? raw : 0;
    if (c > max) max = c;
    entries.push({ code, coverage: c, order: entries.length });
  }

  for (const e of entries) e.coverage = max > 0 ? e.coverage / max : (e.order + 1) / entries.length;
  entries.sort((a, b) => a.coverage - b.coverage || a.order - b.order);

  const n = entries.length + 1;
  const codes = new Uint16Array(n);
  const cov = new Float32Array(n);
  codes[0] = SPACE;
  let chars = ' ';
  for (let k = 0; k < entries.length; k++) {
    codes[k + 1] = entries[k].code;
    cov[k + 1] = entries[k].coverage;
    chars += String.fromCharCode(entries[k].code);
  }

  // Nearest-coverage table. cov is sorted, so as v grows the best index can only
  // move up: one sweep finds every answer. Equal coverages are skipped as a
  // group (a tie never moves us), so a tie always keeps the lower index.
  const indexLut = new Uint16Array(RAMP_LUT_SIZE);
  const codeLut = new Uint16Array(RAMP_LUT_SIZE);
  let best = 0;
  for (let j = 0; j < RAMP_LUT_SIZE; j++) {
    const v = j / LUT_MAX;
    for (;;) {
      let next = best + 1;
      while (next < n && cov[next] === cov[best]) next++;
      if (next >= n || Math.abs(cov[next] - v) >= Math.abs(cov[best] - v)) break;
      best = next;
    }
    indexLut[j] = best;
    codeLut[j] = codes[best];
  }
  const topIndex = indexLut[LUT_MAX];
  const topCode = codes[topIndex];

  return {
    chars,
    codes,
    coverage: cov,
    // `v > 0` is false for NaN, so NaN, negatives and 0 all map to space.
    indexFor: (v: number): number => (v > 0 ? (v < 1 ? indexLut[(v * LUT_MAX + 0.5) | 0] : topIndex) : 0),
    codeFor: (v: number): number => (v > 0 ? (v < 1 ? codeLut[(v * LUT_MAX + 0.5) | 0] : topCode) : SPACE),
  };
}
