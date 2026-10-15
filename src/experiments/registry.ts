import type {
  ExperimentFactory,
  ExperimentId,
  ExperimentMeta,
  ParamDef,
  ParamValue,
  ParamValues,
} from '../engine/types';
import { EXPERIMENT_ORDER } from '../engine/types';
import { wavefieldMeta } from './wavefield.params';
import { attractorMeta } from './attractor.params';
import { topologyMeta } from './topology.params';
import { createWavefield } from './wavefield';
import { createAttractor } from './attractor';
import { createTopology } from './topology';

export const META_BY_ID: Record<ExperimentId, ExperimentMeta> = {
  waves: wavefieldMeta,
  attractor: attractorMeta,
  topology: topologyMeta,
};

/** Experiments in dock order (01, 02, 03). */
export const EXPERIMENTS: readonly ExperimentMeta[] = EXPERIMENT_ORDER.map((id) => META_BY_ID[id]);

export const FACTORIES: Record<ExperimentId, ExperimentFactory> = {
  waves: createWavefield,
  attractor: createAttractor,
  topology: createTopology,
};

export function getParamDef(id: ExperimentId, key: string): ParamDef | undefined {
  return META_BY_ID[id].params.find((p) => p.id === key);
}

/** The default ("visually beautiful") parameter set of an experiment. */
export function defaultParams(id: ExperimentId): ParamValues {
  const out: ParamValues = {};
  for (const def of META_BY_ID[id].params) out[def.id] = def.default;
  return out;
}

/** Coerce + clamp + snap a value so it is always valid for its definition. */
export function sanitizeParam(def: ParamDef, value: ParamValue): ParamValue {
  switch (def.kind) {
    case 'range': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) return def.default;
      const clamped = Math.min(def.max, Math.max(def.min, n));
      const snapped = def.min + Math.round((clamped - def.min) / def.step) * def.step;
      // remove floating-point dust (e.g. 0.30000000000000004)
      return Number(Math.min(def.max, Math.max(def.min, snapped)).toFixed(6));
    }
    case 'toggle':
      return typeof value === 'boolean' ? value : value === 'true' || value === 1;
    case 'select':
      return def.options.some((o) => o.value === value) ? String(value) : def.default;
  }
}

/** Decimal places to display for a range parameter. */
export function paramDecimals(def: ParamDef): number {
  if (def.kind !== 'range') return 0;
  if (typeof def.decimals === 'number') return def.decimals;
  const s = String(def.step);
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

/** Display string for a parameter value (no unit). Uses a true minus sign for negatives. */
export function formatParam(def: ParamDef, value: ParamValue): string {
  if (def.kind === 'toggle') return value ? 'ON' : 'OFF';
  if (def.kind === 'select') return def.options.find((o) => o.value === value)?.label ?? String(value);
  const n = typeof value === 'number' ? value : Number(value);
  const d = paramDecimals(def);
  const text = Math.abs(n) >= 1000 && d === 0 ? Math.round(Math.abs(n)).toLocaleString('en-US') : Math.abs(n).toFixed(d);
  return n < 0 && Number(text.replace(/,/g, '')) !== 0 ? `−${text}` : text;
}
