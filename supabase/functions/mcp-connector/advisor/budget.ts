// budget_options — "What could I do with $X?" Ranked segment options, not financial advice.
import { makeEnvelope, recordedClaim, notRecordedClaim, type Claim } from "./evidence.ts";

export interface SegmentStat {
  segment: string; make: string; era: string; n: number; median_price: number;
  p25: number | null; p75: number | null; make_3y_pct: number | null; era_3y_pct: number | null; era_vol_pct: number | null;
  as_of: string; run_id: string;
}
export interface MarketSignal { label: "heating" | "cooling" | "flat"; as_of: string; gate_passed: boolean }
export interface BudgetOption extends SegmentStat { all_in: number; score: number; why: string[] }

/** Cited cost assumptions (online auction purchase). */
export const COSTS = {
  buyerFeePct: 0.05, buyerFeeCap: 7500,   // BaT / C&B buyer fee, platform_fee_schedules
  transport: 1800,                        // RoadRunner enclosed national average, 2026
  paperwork: 600,                         // title/registration estimate
  sources: [
    "https://bringatrailer.com/bat-guide-how-classic-car-auction-fees-work/",
    "https://www.roadrunnerautotransport.com/",
  ],
} as const;

export function allInCost(median: number): number {
  return Math.round(median + Math.min(median * COSTS.buyerFeePct, COSTS.buyerFeeCap) + COSTS.transport + COSTS.paperwork);
}

export function scoreSegment(s: SegmentStat): number {
  const era = s.era_3y_pct ?? 0;
  const make = s.make_3y_pct ?? era;
  return era + make - 0.5 * (s.era_vol_pct ?? 0) + 3 * Math.log10(Math.max(s.n, 1));
}

/** Rank segments whose typical all-in cost lands between 45% and 100% of the budget. */
export function rankBudgetOptions(budget: number, stats: SegmentStat[], limit = 6, minN = 60): BudgetOption[] {
  if (!Number.isFinite(budget) || budget <= 0) return [];
  return stats
    .filter((s) => s.n >= minN && s.median_price > 0)
    .map((s) => ({ ...s, all_in: allInCost(s.median_price) }))
    .filter((s) => s.all_in >= 0.45 * budget && s.all_in <= budget)
    .map((s) => {
      const why: string[] = [`${s.n} confirmed sales in the last year; typical hammer $${Math.round(s.median_price).toLocaleString("en-US")}`];
      if (s.p25 != null && s.p75 != null) why.push(`middle half sold between $${Math.round(s.p25).toLocaleString("en-US")} and $${Math.round(s.p75).toLocaleString("en-US")}`);
      if (s.make_3y_pct != null) why.push(`${s.make} prices ${s.make_3y_pct >= 0 ? "up" : "down"} ${Math.abs(s.make_3y_pct)}% over 3 years (comp-adjusted)`);
      if (s.era_3y_pct != null) why.push(`${s.era} cars ${s.era_3y_pct >= 0 ? "up" : "down"} ${Math.abs(s.era_3y_pct)}% over 3 years; year-to-year swing ±${s.era_vol_pct ?? "?"}%`);
      return { ...s, score: Math.round(scoreSegment(s) * 100) / 100, why };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(limit, 12)));
}

export function budgetEnvelope(budget: number, options: BudgetOption[], signal: MarketSignal | null) {
  const claims: Claim[] = options.map((o, i) =>
    recordedClaim(`option_${i + 1}`, { segment: o.segment, typical_all_in: o.all_in, median_hammer: o.median_price, sales_last_year: o.n, why: o.why }, {
      confidence: null, note: `market_segment_stats run ${o.run_id}, as of ${o.as_of}`,
    })
  );
  claims.push(signal
    ? recordedClaim("market_temperature", signal.label, { note: `as of ${signal.as_of}; a label only — the timing model did not beat a no-change baseline, so no price forecast is given` })
    : notRecordedClaim("market_temperature", { checked_sources: ["market_signal"] }));
  if (!options.length) claims.push(notRecordedClaim("options", { checked_sources: ["market_segment_stats"], note: "no segment with enough sales lands in this budget" }));
  return makeEnvelope("budget_options", "budget", null, claims, {
    budget_usd: budget,
    cost_assumptions: { buyer_fee: "5% capped at $7,500", transport_usd: COSTS.transport, paperwork_usd: COSTS.paperwork, sources: COSTS.sources },
    disclaimer: "Options, not financial advice. Typical prices from past confirmed sales; any single car can differ a lot.",
  });
}
