// The harness model's scoreboard (stack SH) as kit Measures: one typed read of v_harness_coverage, grouped by the stack's
// layers in order. A row becomes a Measure whose value is its numerator, whose unit is what it counts (grain) and whose
// coverage is numerator of denominator, as of the read; no percentages (the reporting contract). Case ledger 13.12.3.
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import type { Coverage, Measure } from '../../../kit';

/** One row of v_harness_coverage for one vehicle. */
export type ScoreboardRow = { layer: string; measure: string; numerator: number; denominator: number; grain: string | null };

/** One layer of the stack: its measures, and how many of them have anything measured yet. */
export type ScoreboardLayer = { layer: string; title: string; coverage: Coverage; items: Measure[] };

/** The data machine's layers, in the order a stack runs through them. */
export const LAYER_ORDER = ['log', 'key', 'dimension', 'fold', 'baseline', 'residual', 'feature', 'prediction', 'outcome'] as const;

const TITLES: Record<string, string> = {
  log: 'LOG · EVIDENCE', key: 'KEYS', dimension: 'DIMENSIONS', fold: 'FOLD · NETS AND SEGMENTS', baseline: 'BASELINE · FACTORY',
  residual: 'RESIDUAL · AGAINST FACTORY', feature: 'FEATURES', prediction: 'PREDICTIONS', outcome: 'OUTCOME · THE BUILD',
};

/** Rows to layers. Unknown layers sort last; a row without a grain counts as "members" rather than vanishing. */
export function toLayers(rows: ScoreboardRow[], readAt: string): ScoreboardLayer[] {
  const rank = (l: string) => { const i = (LAYER_ORDER as readonly string[]).indexOf(l); return i < 0 ? LAYER_ORDER.length : i; };
  const byLayer = new Map<string, ScoreboardRow[]>();
  for (const r of rows) byLayer.set(r.layer, [...(byLayer.get(r.layer) ?? []), r]);
  return [...byLayer.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([layer, rs]) => {
      const items: Measure[] = rs
        .slice()
        .sort((a, b) => a.measure.localeCompare(b.measure))
        .map(r => ({
          label: r.measure,
          value: r.numerator,
          unit: r.grain ?? 'members',
          method: `stack SH · ${layer} · v_harness_coverage`,
          coverage: { n: r.numerator, of: r.denominator, grain: r.grain ?? 'members', as_of: readAt },
          rank: null,
        }));
      return {
        layer,
        title: TITLES[layer] ?? layer.toUpperCase(),
        coverage: { n: rs.filter(r => r.numerator > 0).length, of: rs.length, grain: 'measures with data', as_of: readAt },
        items,
      };
    });
}

/** The scoreboard of one vehicle, read once. Null while loading; an empty list when the vehicle has no harness model. */
export function useHarnessScoreboard(vehicleId: string | undefined): { layers: ScoreboardLayer[] | null; error: string | null } {
  const [state, setState] = useState<{ layers: ScoreboardLayer[] | null; error: string | null }>({ layers: null, error: null });
  useEffect(() => {
    if (!vehicleId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('v_harness_coverage')
        .select('layer, measure, numerator, denominator, grain')
        .eq('vehicle_id', vehicleId);
      if (cancelled) return;
      if (error) setState({ layers: [], error: error.message });
      else setState({ layers: toLayers((data ?? []) as ScoreboardRow[], new Date().toISOString()), error: null });
    })();
    return () => { cancelled = true; };
  }, [vehicleId]);
  return state;
}
