import { describe, expect, it } from 'vitest';
import type { ExperimentId, ExperimentMeta, ParamDef } from '../../engine/types';
import { EXPERIMENT_ORDER, GLYPH_CHARSET, RAMPS } from '../../engine/types';
import { wavefieldMeta } from '../../experiments/wavefield.params';
import { attractorMeta } from '../../experiments/attractor.params';
import { topologyMeta } from '../../experiments/topology.params';
import { mathSources, parseMath, slotKeys } from '../../components/equations/markup';
import { ASCII_PIPELINE, CENTRAL_IDEA, COVERAGE_NOTE, EXPLANATIONS, VALUE_KEYS, type Explanation } from '../explanations';
import { PRESETS } from '../presets';

const METAS: Record<ExperimentId, ExperimentMeta> = { waves: wavefieldMeta, attractor: attractorMeta, topology: topologyMeta };

/** Valid exactly as useGlyphStore.applyPreset → sanitizeParam would keep it (in range, on a step, right type). */
function isValidValue(def: ParamDef, value: unknown): boolean {
  switch (def.kind) {
    case 'range': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return false;
      if (value < def.min - 1e-9 || value > def.max + 1e-9) return false;
      const steps = (value - def.min) / def.step;
      return Math.abs(steps - Math.round(steps)) < 1e-6;
    }
    case 'toggle':
      return typeof value === 'boolean';
    case 'select':
      return typeof value === 'string' && def.options.some((o) => o.value === value);
  }
}

/* ─── Font coverage (from the @fontsource unicode-range subsets we bundle) ─── */

const inRange = (cp: number, lo: number, hi: number): boolean => cp >= lo && cp <= hi;
/** Geist Variable: latin + latin-ext only — NO Greek. */
function geistHas(cp: number): boolean {
  return (
    inRange(cp, 0x20, 0x7e) ||
    inRange(cp, 0xa0, 0xff) ||
    inRange(cp, 0x100, 0x2ba) ||
    inRange(cp, 0x2000, 0x206f) ||
    cp === 0x2212 ||
    cp === 0x2215
  );
}
/** JetBrains Mono: Geist's ranges plus Greek. */
function monoHas(cp: number): boolean {
  return geistHas(cp) || inRange(cp, 0x370, 0x3ff);
}
/** Maths symbols the renderer draws as SVG, plus the markup's own syntax characters. */
const DRAWN_OR_SYNTAX = new Set(['∈', '≈', '→', '√', '\\', '{', '}', '_', '^']);

function uncoveredInMath(src: string): string[] {
  return Array.from(src).filter((ch) => !DRAWN_OR_SYNTAX.has(ch) && !monoHas(ch.codePointAt(0) ?? 0));
}

/** Prose: text outside $…$ is set in Geist; maths inside is set in JetBrains Mono. */
function uncoveredInProse(text: string): string[] {
  const outside = text.replace(/\$[^$]*\$/g, '').replace(/\{[A-Za-z][A-Za-z0-9]*\}/g, '');
  const bad = Array.from(outside).filter((ch) => !geistHas(ch.codePointAt(0) ?? 0));
  return [...bad, ...mathSources(text).flatMap(uncoveredInMath)];
}

/** An ASCII hyphen used as a minus sign in front of a number. */
const ASCII_MINUS = /(^|[\s([=,:;])-(?=\d)/;

function proseOf(exp: Explanation): string[] {
  return [
    exp.where,
    ...exp.ideas.flatMap((i) => [i.title, i.body]),
    ...exp.variables.flatMap((v) => [v.meaning, v.note ?? '']),
    ...exp.effects.flatMap((e) => [e.cause, e.effect]),
    ...exp.pipeline.map((p) => p.note),
  ];
}

function plainOf(exp: Explanation): string[] {
  return [
    exp.reading,
    exp.realWorld,
    exp.realWorldMore ?? '',
    ...exp.topics,
    ...exp.variables.map((v) => v.name),
    ...exp.pipeline.map((p) => p.step),
  ];
}

function mathOf(exp: Explanation): string[] {
  return [
    exp.symbol,
    ...exp.general,
    ...exp.variables.map((v) => v.symbol),
    ...exp.effects.map((e) => e.symbol),
    ...exp.pipeline.map((p) => p.math),
  ];
}

describe('presets', () => {
  for (const id of EXPERIMENT_ORDER) {
    const meta = METAS[id];
    const presets = PRESETS[id];

    it(`${id}: at least four presets, unique ids`, () => {
      expect(presets.length).toBeGreaterThanOrEqual(4);
      expect(new Set(presets.map((p) => p.id)).size).toBe(presets.length);
    });

    it(`${id}: every value is valid for a frozen parameter id`, () => {
      for (const preset of presets) {
        expect(Object.keys(preset.values).length, preset.id).toBeGreaterThan(0);
        for (const [key, value] of Object.entries(preset.values)) {
          const def = meta.params.find((p) => p.id === key);
          expect(def, `${preset.id}.${key} is not a parameter of ${id}`).toBeDefined();
          if (def) expect(isValidValue(def, value), `${preset.id}.${key} = ${String(value)}`).toBe(true);
        }
      }
    });

    it(`${id}: labels and descriptions are plain text in the UI font`, () => {
      for (const p of presets) {
        for (const s of [p.label, p.description]) {
          expect(s).not.toMatch(/[${}]/);
          expect(uncoveredInProse(s), s).toEqual([]);
          expect(s).not.toMatch(ASCII_MINUS);
        }
        expect(p.description.length).toBeLessThanOrEqual(110);
      }
    });
  }

  it('Standing wave and Lattice turn the second wave on (they need it to show anything)', () => {
    for (const id of ['standing-wave', 'beats', 'lattice']) {
      expect(PRESETS.waves.find((p) => p.id === id)?.values.second).toBe(true);
    }
  });

  it('Pure vortex restores a non-zero swirl', () => {
    const swirl = PRESETS.attractor.find((p) => p.id === 'pure-vortex')?.values.swirl;
    expect(typeof swirl === 'number' && swirl !== 0).toBe(true);
  });
});

describe('explanations', () => {
  for (const id of EXPERIMENT_ORDER) {
    const exp: Explanation = EXPLANATIONS[id];
    const meta = METAS[id];
    const keys: readonly string[] = VALUE_KEYS[id];

    it(`${id}: describes itself`, () => {
      expect(exp.id).toBe(id);
      expect(exp.reading.length).toBeGreaterThan(40);
      expect(exp.ideas.length).toBeGreaterThanOrEqual(3);
      expect(exp.realWorld.length).toBeGreaterThan(40);
      expect(RAMPS[exp.ramp]).toBeDefined();
    });

    it(`${id}: exactly one "what changes what" line per parameter`, () => {
      const params = meta.params.map((p) => p.id).sort();
      expect(exp.effects.map((e) => e.param).sort()).toEqual(params);
    });

    it(`${id}: variables and slots only use declared live values`, () => {
      for (const v of exp.variables) {
        expect(v.value !== undefined || v.note !== undefined, v.symbol).toBe(true);
        if (v.value) expect(keys).toContain(v.value);
      }
      for (const text of proseOf(exp)) for (const key of slotKeys(text)) expect(keys, text).toContain(key);
      expect(new Set(exp.variables.map((v) => v.symbol)).size).toBe(exp.variables.length);
    });

    it(`${id}: the general form is an equation`, () => {
      for (const src of exp.general) {
        expect(parseMath(src).some((n) => n.kind === 'op' && n.role === 'rel')).toBe(true);
      }
    });

    it(`${id}: every character is in the bundled fonts (Greek only inside $maths$)`, () => {
      for (const s of proseOf(exp)) expect(uncoveredInProse(s), s).toEqual([]);
      for (const s of plainOf(exp)) expect(uncoveredInProse(s), s).toEqual([]);
      for (const s of mathOf(exp)) expect(uncoveredInMath(s), s).toEqual([]);
    });

    it(`${id}: negative numbers use the true minus sign`, () => {
      for (const s of [...proseOf(exp), ...plainOf(exp), ...mathOf(exp)]) expect(s, s).not.toMatch(ASCII_MINUS);
    });

    it(`${id}: glyph tiles only show glyphs the field can draw`, () => {
      for (const step of exp.pipeline) {
        for (const ch of step.glyphs ?? '') expect(GLYPH_CHARSET).toContain(ch);
      }
    });
  }

  it('shared copy: only the {cells} slot, fonts covered', () => {
    expect(slotKeys(ASCII_PIPELINE)).toEqual(['cells']);
    expect(slotKeys(COVERAGE_NOTE)).toEqual([]);
    for (const s of [ASCII_PIPELINE, COVERAGE_NOTE, ...CENTRAL_IDEA]) expect(uncoveredInProse(s), s).toEqual([]);
  });

  it('the central idea is the exhibit statement', () => {
    expect(CENTRAL_IDEA.join(' ')).toBe(
      'Every character is a pixel. Every motion is an equation. Every design is a mathematical system.',
    );
  });
});
