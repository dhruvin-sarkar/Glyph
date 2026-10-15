import { memo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { ExperimentId, ProbeRow, ReadoutTone } from '../../engine/types';
import { useGlyphStore } from '../../state/store';
import { cx } from '../ui/primitives';
import { trueMinus } from './format';
import { PipelineStrip, useProbeFor } from './live';
import { InlineMath } from './MathText';

/* The PROBE block of the equation card: one cell of the field, read live at
 * ~8 Hz. Memoised and self-subscribing, so a probe tick re-renders only this
 * block — never the typeset equation above it. */

const TONE: Record<ReadoutTone, string> = {
  ink: 'text-ink',
  mint: 'text-mint',
  ice: 'text-ice',
  muted: 'text-muted',
};

/** Words ("steps", "YAW") are set as micro labels; maths ("x", "|F|", "N·L") keeps its case and italics. */
function RowLabel({ label }: { label: string }) {
  const names: Record<string, string> = { x: 'x position', y: 'y position', t: 'Time', f: 'Height', n: 'Level', p: 'Position', 'F(p)': 'Velocity', '|F|': 'Speed' };
  if (names[label]) return <span className="gf-probe-label">{names[label]}</span>;
  const word = /^[a-z]{3,}( [a-z]+)*$/.test(label) || /^[A-Z]{2,}( [A-Z]+)*$/.test(label);
  if (word) return <span className="micro truncate text-muted">{label}</span>;
  return (
    <span className="truncate text-[11px] text-muted">
      <InlineMath src={label} />
    </span>
  );
}

function Row({ row }: { row: ProbeRow }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <RowLabel label={row.label} />
      <span className={cx('tabular truncate font-mono text-[12px]', TONE[row.tone ?? 'ink'])}>{trueMinus(row.value)}</span>
    </div>
  );
}

export const ProbePanel = memo(function ProbePanel({ mode, intensitySymbol, defaultOpen = false }: { mode: ExperimentId; intensitySymbol: string; defaultOpen?: boolean }) {
  const [expanded, setExpanded] = useState(defaultOpen);
  const { probe, stale } = useProbeFor(mode);
  const paused = useGlyphStore((s) => s.paused);
  const live = stale ? null : probe;
  // the glyph is shown large in the pipeline strip
  const rows = (live?.rows ?? []).filter((r) => r.label.trim().toLowerCase() !== 'glyph').slice(0, 8);

  return (
    <details aria-label="Probe" className="gf-probe-disclosure" open={expanded} onToggle={(e) => setExpanded(e.currentTarget.open)}>
      <summary className="gf-probe-summary">
        <span className="flex items-center gap-2 text-[12px] text-ink/85">
          <span
            aria-hidden="true"
            className={cx('h-1 w-1 rounded-full transition-colors duration-300', live ? 'bg-mint' : 'bg-faint')}
          />
          {expanded ? live?.heading ?? 'Sample' : 'Inspect a sample'}
        </span>
        <span className="flex items-center gap-2">
          <span className="gf-probe-status">{!live ? 'Settling' : paused ? 'Paused' : 'Live sample'}</span>
          <ChevronDown aria-hidden="true" size={13} strokeWidth={1.5} />
        </span>
      </summary>

      <div className="space-y-3 pt-3">
      <div className="[@media(max-height:920px)]:hidden">
        {rows.length > 0 ? (
          <div className="grid grid-cols-2 gap-x-5 gap-y-2">
            {rows.map((row) => (
              <Row key={row.label} row={row} />
            ))}
          </div>
        ) : (
          <p className="text-[12px] leading-snug text-muted">Move across the field to read one cell of the computation.</p>
        )}
      </div>

      <PipelineStrip mode={mode} probe={probe} stale={stale} intensitySymbol={intensitySymbol} />
      </div>
    </details>
  );
});
