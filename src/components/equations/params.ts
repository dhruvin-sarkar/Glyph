import type { ExperimentId, ParamValue } from '../../engine/types';
import { formatParam, getParamDef } from '../../experiments/registry';

/** A parameter value formatted exactly as the parameter panel shows it (decimals, true minus sign). */
export function paramText(mode: ExperimentId, id: string, value: ParamValue): string {
  const def = getParamDef(mode, id);
  return def ? formatParam(def, value) : String(value);
}
