/**
 * Band-backtest registers, one per BaT cohort (model page), exported from the
 * local BaT archive (scripts/bat-archive.sql → band_backtest). This is the
 * hindcast register: every sold lot since 2024-09 priced only from the sales
 * that closed before it. Prod has no organ for it yet, so the rows ship with
 * the page, each carrying its lot URL as the drill target.
 */

import porsche914 from './porsche-914-171820.json';

export interface BacktestRow {
  slug: string;
  url: string;
  title: string;
  sold_on: string;
  actual: number;
  n_comps: number;
  n_eff: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  in_p10_p90: boolean;
  miss_pct: number;
}

export interface BacktestRegister {
  meta: {
    cohort: string;
    cohort_label: string;
    register: string;
    source_file: string;
    source_object: string;
    method: string;
    archive_commit: string;
    exported_at: string;
    n: number;
    caught_p10_p90_pct: number;
    caught_p25_p75_pct: number;
    median_miss_pct: number;
    first_sale: string;
    last_sale: string;
    not_in_database: string;
  };
  rows: BacktestRow[];
}

const REGISTERS: Record<string, BacktestRegister> = {
  'porsche/914-171820': porsche914 as BacktestRegister,
};

/** BaT cohort key for a make + model, as the archive names its model pages. */
export function cohortKey(make: string | null | undefined, model: string | null | undefined): string | null {
  const m = (make ?? '').trim().toLowerCase();
  const d = (model ?? '').trim().toLowerCase();
  if (m === 'porsche' && /^914\b/.test(d) && !/914[-/ ]?6/.test(d)) return 'porsche/914-171820';
  return null;
}

export function backtestFor(make: string | null | undefined, model: string | null | undefined): BacktestRegister | null {
  const key = cohortKey(make, model);
  return key ? REGISTERS[key] ?? null : null;
}
