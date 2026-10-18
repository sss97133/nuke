import React from 'react';
import type { Coverage, Measure } from './types';
import { Text } from './Text';
import { day, formatMeasure, rankLabel } from './format';

/** `n of N grain · date`. Every number on a page carries one of these. */
export function CoverageView({ c, className }: { c: Coverage; className?: string }) {
  const text = `${c.n.toLocaleString('en-US')} of ${c.of.toLocaleString('en-US')} ${c.grain}${c.as_of ? ` · ${day(c.as_of)}` : ''}`;
  return <Text role="caption" className={className ? `k-coverage ${className}` : 'k-coverage'} aria-label={`Coverage: ${text}`}>{text}</Text>;
}

/** A computed number: label, value, rank (or why not), coverage. The rank floor lives here and nowhere else. */
export function MeasureView({ m }: { m: Measure }) {
  const rank = rankLabel(m.rank);
  const peers = m.rank?.n ?? 0;
  return <div className="k-measure-block" role="group" aria-label={m.label}>
    <Text role="label">{m.label}</Text>
    <Text role="measure">{formatMeasure(m.value, m.unit)}</Text>
    <Text role="caption">{rank ? `${rank} of ${peers} peers` : `unranked · ${peers} peer${peers === 1 ? '' : 's'}`}</Text>
    <CoverageView c={m.coverage} />
  </div>;
}
