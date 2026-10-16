import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Text } from '../../kit';

// What a family's car is worth, same car and same miles (family_price_index_read): a hedonic time-dummy index fitted
// nightly per family (scripts/market/family-price-index.py), so the family's price move is read with its mix of
// variants, gearboxes, miles, model years and venues held fixed. Owner, 2026-10-16, on the rolling median: "median
// doesnt matter... a graph that actually says nothing". The headline is the like-for-like 12-month change with its
// interval and sales count, or "too few to tell"; the plain median stays only as a thin gray line.

export type IndexPoint = { t: number; usd: number; lo: number; hi: number; n: number; median: number | null };
export type Segment = { key: string; label: string; change: number | null; lo: number | null; hi: number | null;
  nPrior: number; nLast: number; verdict: string };
export type FamilyIndex = {
  verdict: 'up' | 'down' | 'flat' | 'too few to tell';
  change: number | null; lo: number | null; hi: number | null; nPrior: number; nLast: number;
  periodKind: 'month' | 'quarter' | null; series: IndexPoint[]; segments: Segment[];
  rawChange: number | null; pairs: number | null; repeatChange: number | null; fittedAt: string | null;
  /** The fit is over 72 hours old (the reader's own flag): shown with its date, never as current. */
  stale: boolean;
};

const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x
  : typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x)) ? Number(x) : null);
const VERDICTS = new Set(['up', 'down', 'flat', 'too few to tell']);

/** The reader's value as a typed family index; anything else is null. Field names follow family_price_index_read
 *  (20261018 price-index migration): a fitted family carries `change`; one never fitted (below the floor) carries only
 *  its live `counts`, and reads as "too few to tell" with them. */
export function parseFamilyIndex(value: unknown): FamilyIndex | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const counts = (v.counts && typeof v.counts === 'object' ? v.counts : {}) as Record<string, unknown>;
  const fitted = v.change && typeof v.change === 'object';
  // A family above the sales floor that the nightly fit has not reached yet (it fits the biggest families first) is
  // not "too few to tell": it has a fit coming. It reads as no index, and the family chart keeps drawing as before.
  if (!fitted) {
    const floor = (v.floor && typeof v.floor === 'object' ? v.floor : {}) as Record<string, unknown>;
    const yr = num(floor.sales_each_year), tot = num(floor.sales_total);
    if (yr != null && tot != null && (num(counts.n_last12) ?? 0) >= yr && (num(counts.n_prior12) ?? 0) >= yr && (num(counts.n_total) ?? 0) >= tot) return null;
  }
  const c = (fitted ? v.change : {
    verdict: 'counts' in v ? 'too few to tell' : undefined, n_last12: counts.n_last12, n_prior12: counts.n_prior12,
  }) as Record<string, unknown>;
  const verdict = String(c.verdict ?? '');
  if (!VERDICTS.has(verdict)) return null;
  const rawSeries = Array.isArray(v.series) ? v.series : [];
  const series = rawSeries.map((p) => {
    const r = (p ?? {}) as Record<string, unknown>;
    const t = Date.parse(String(r.period_start ?? ''));
    const usd = num(r.index_usd), lo = num(r.lo_usd), hi = num(r.hi_usd);
    return Number.isFinite(t) && usd && lo && hi ? { t, usd, lo, hi, n: num(r.n) ?? 0, median: num(r.raw_median_usd) } : null;
  }).filter((p): p is IndexPoint => p !== null).sort((a, b) => a.t - b.t);
  const segs = Array.isArray(c.chips) ? c.chips : Array.isArray(c.segments) ? c.segments : [];
  const segments = segs.map((s) => {
    const r = (s ?? {}) as Record<string, unknown>;
    const label = String(r.label ?? r.key ?? '');
    return label ? { key: String(r.key ?? label), label, change: num(r.change ?? r.change_12m), lo: num(r.lo), hi: num(r.hi),
      nPrior: num(r.n_prior12) ?? 0, nLast: num(r.n_last12) ?? 0, verdict: String(r.verdict ?? 'too few to tell') } : null;
  }).filter((s): s is Segment => s !== null);
  return {
    verdict: verdict as FamilyIndex['verdict'], change: num(c.change_12m), lo: num(c.lo), hi: num(c.hi),
    nPrior: num(c.n_prior12) ?? 0, nLast: num(c.n_last12) ?? 0,
    periodKind: (v.period_kind === 'month' || v.period_kind === 'quarter') ? v.period_kind : series.length ? 'quarter' : null,
    series: fitted ? series : [], segments, rawChange: num(c.raw_change), pairs: num(c.pairs), repeatChange: num(c.rs_change),
    fittedAt: typeof v.fitted_at === 'string' ? v.fitted_at : typeof c.fitted_at === 'string' ? c.fitted_at : null,
    stale: v.stale === true,
  };
}

export function useFamilyIndex(brand: string | null, familyKey: string | null): FamilyIndex | null {
  const [data, setData] = useState<FamilyIndex | null>(null);
  useEffect(() => {
    setData(null);
    if (!brand || !familyKey) return undefined;
    let live = true;
    Promise.resolve().then(() => supabase.rpc('family_price_index_read', { p_brand: brand, p_family_key: familyKey }))
      .then(({ data: value, error }) => { if (live && !error) setData(parseFamilyIndex(value)); })
      .catch(() => {});
    return () => { live = false; };
  }, [brand, familyKey]);
  return data;
}

const pct = (v: number) => `${v > 0 ? '▲' : v < 0 ? '▼' : ''}${Math.abs(Math.round(v * 100))}%`;
const pts = (lo: number, hi: number) => Math.round(((hi - lo) / 2) * 100);

/** The big answer in plain words: the move, "flat within ±N", or "too few sales to tell". */
export function answerOf(ix: Pick<FamilyIndex, 'verdict' | 'change' | 'lo' | 'hi'>): string {
  if (ix.verdict === 'too few to tell' || ix.change == null) return 'Too few sales to tell';
  if (ix.verdict === 'flat') {
    const w = ix.lo != null && ix.hi != null ? Math.max(Math.abs(ix.lo), Math.abs(ix.hi)) : Math.abs(ix.change);
    return `Flat: within ±${Math.max(1, Math.round(w * 100))}% in 12 months`;
  }
  return `${pct(ix.change)} in 12 months`;
}
/** Its evidence, small: the interval, the sales behind it, and what the plain median said. */
export function evidenceOf(ix: FamilyIndex): string {
  const parts: string[] = [];
  if (ix.lo != null && ix.hi != null && ix.verdict !== 'too few to tell') parts.push(`±${pts(ix.lo, ix.hi)} points (95%)`);
  parts.push(`${(ix.nPrior + ix.nLast).toLocaleString('en-US')} sales in the two years`);
  if (ix.verdict === 'too few to tell' && ix.change == null) parts.push('needs 30 a year');
  if (ix.rawChange != null) parts.push(`plain median said ${pct(ix.rawChange)}`);
  if (ix.stale && ix.fittedAt) parts.push(`measured ${new Date(ix.fittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`);
  return parts.join(' · ');
}

/** The head block: the plain question's answer, its evidence, and the segments that move apart, as chips. */
export function LikeForLike({ ix, narrow }: { ix: FamilyIndex; narrow: boolean }) {
  // Segments earn their row when at least two carry a number: a row of "too few" says nothing.
  const readable = ix.segments.filter((s) => s.verdict !== 'too few to tell' && s.change != null).length;
  const repeat = ix.pairs && ix.repeatChange != null ? `same cars sold twice: ${pct(ix.repeatChange)} (${ix.pairs} pairs, a check, not the headline)` : undefined;
  return (
    <div className="family-index">
      <span className="family-index__kicker">Same car, same miles</span>
      <span className={`family-index__answer family-index__answer--${ix.verdict.replace(/ /g, '-')}`} title={repeat}>{answerOf(ix)}</span>
      <span className="family-index__evidence">{evidenceOf(ix)}</span>
      {readable >= 2 && !narrow && (
        <div className="family-index__chips" aria-label="By variant or generation">
          {ix.segments.map((s) => (
            <span key={s.key} className={`family-index__chip${s.verdict === 'too few to tell' || s.change == null ? ' family-index__chip--few' : ''}`}
              title={`${s.label}: ${(s.nPrior + s.nLast).toLocaleString('en-US')} sales in the two years${s.lo != null && s.hi != null ? `, 95% ${pct(s.lo)} to ${pct(s.hi)}` : ''}`}>
              {s.label} <b>{s.verdict === 'too few to tell' || s.change == null ? 'too few' : s.verdict === 'flat' ? 'flat' : pct(s.change)}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
