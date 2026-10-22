/**
 * Comp adjustments fitted 2026-10-22 by a time-ordered backtest over 353,223 sold events
 * (nuke-strategy/bt4). Each step was kept only if it lowered median error on the 219k events
 * with >=4 comps. Cumulative: baseline 26.8% / 0.394 within 20% -> 23.1% / 0.447.
 *  1. make price index (advisor_make_price_index): comp log price + (index_now - index_at_comp_sale)
 *  2. sales channel: comps normalized by platform effect, subject channel added back
 *  3. mileage: log((subject+1000)/(median comps+1000)) -> fitted decile curve
 *  4. recency: weighted median, weight 0.5^(age_days/1460)
 *  5. own prior sale (time+channel adjusted) blended with weight 0.9 (<3y) / 0.7 (>=3y)
 *  6. confidence = P(within 20%) table by comp count (or own prior sale) x adjusted spread
 */
export const PLATFORM_EFFECT: Record<string, number> = {
  bat: 0.02, cars_and_bids: -0.047, pcarmarket: -0.028, mecum: 0.039, barrettjackson: 0.071,
  "barrett-jackson": 0.061, bonhams: 0.08, broad_arrow: 0.133, gooding: 0.234, "rm-sothebys": 0.261,
  ebay_motors: -0.183, collecting_cars: -0.065,
};
const MI_X = [-2.427, -1.05, -0.56, -0.269, -0.057, 0.113, 0.291, 0.488, 0.76, 1.449];
const MI_A = [0.296, 0.249, 0.169, 0.09, 0.03, -0.025, -0.082, -0.13, -0.171, -0.188];
export const RECENCY_HALFLIFE_DAYS = 1460;
export const OWN_SALE_WEIGHT = (gapYears: number) => (gapYears < 3 ? 0.9 : 0.7);
const CONF: Record<string, number[]> = {
  // spread cols: <10%, 10-20, 20-30, 30-50, >=50% (IQR/median of adjusted comps)
  "4": [0.555, 0.498, 0.465, 0.412, 0.305],
  "5-9": [0.592, 0.534, 0.467, 0.398, 0.317],
  "10-15": [0.802, 0.67, 0.549, 0.44, 0.34],
  own: [0.733, 0.705, 0.666, 0.613, 0.551],
};

export function normPlatform(p: unknown): string {
  const s = String(p ?? "").toLowerCase().replace(/\s+/g, "_");
  if (!s) return "";
  if (s.includes("bringatrailer") || s === "bat" || s.includes("bring_a_trailer")) return "bat";
  if (s.includes("cars") && s.includes("bids")) return "cars_and_bids";
  if (s.includes("barrett")) return "barrettjackson";
  if (s.includes("rm") && s.includes("sotheby")) return "rm-sothebys";
  if (s.includes("broad")) return "broad_arrow";
  if (s.includes("ebay")) return "ebay_motors";
  if (s.includes("pcar")) return "pcarmarket";
  if (s.includes("collecting")) return "collecting_cars";
  for (const k of ["mecum", "bonhams", "gooding"]) if (s.includes(k)) return k;
  return s;
}
const pe = (p: unknown) => PLATFORM_EFFECT[normPlatform(p)] ?? 0;

export function mileageAdj(x: number): number {
  if (x <= MI_X[0]!) return MI_A[0]!;
  if (x >= MI_X[MI_X.length - 1]!) return MI_A[MI_A.length - 1]!;
  let i = 0;
  while (MI_X[i + 1]! < x) i++;
  const t = (x - MI_X[i]!) / (MI_X[i + 1]! - MI_X[i]!);
  return MI_A[i]! + t * (MI_A[i + 1]! - MI_A[i]!);
}

export type IndexSeries = Array<{ month: string; idx: number }>; // ascending
export function indexAt(series: IndexSeries, date: string | null): number {
  if (!series.length || !date) return 0;
  const m = date.slice(0, 7);
  let v: number | null = null;
  for (const r of series) {
    if (r.month.slice(0, 7) <= m) v = r.idx;
    else break;
  }
  return v ?? 0;
}

export interface AdjComp { sale_price: number; sold_date: string | null; platform: unknown; mileage: unknown }
export interface AdjResult {
  estimate: number; low: number; high: number; spread: number; confidence: number;
  comps_estimate: number | null; own_sale_estimate: number | null; steps: Record<string, unknown>;
}

export function confidenceFor(nComps: number, spread: number | null, hasOwnSale: boolean): number {
  const row = hasOwnSale ? "own" : nComps >= 10 ? "10-15" : nComps >= 5 ? "5-9" : "4";
  if (!hasOwnSale && nComps < 4) return 0.3;
  const s = spread == null || !Number.isFinite(spread) ? 1 : spread;
  const col = s < 0.1 ? 0 : s < 0.2 ? 1 : s < 0.3 ? 2 : s < 0.5 ? 3 : 4;
  return CONF[row]![col]!;
}

function wmedian(vals: number[], ws: number[]): number {
  const z = vals.map((v, i) => [v, ws[i]!] as const).sort((a, b) => a[0] - b[0]);
  const half = ws.reduce((a, b) => a + b, 0) / 2;
  let acc = 0;
  for (const [v, w] of z) { acc += w; if (acc >= half) return v; }
  return z[z.length - 1]![0];
}

export function adjustedEstimate(opts: {
  comps: AdjComp[]; minComps: number; index: IndexSeries; asOf: string;
  subjectPlatform: unknown; subjectMileage: number | null;
  ownSale?: { amount: number; on: string; platform: unknown } | null;
}): AdjResult | null {
  const { index, asOf } = opts;
  const now = indexAt(index, asOf);
  const sp = pe(opts.subjectPlatform);
  const comps = opts.comps.filter((c) => c.sale_price > 0);
  const asOfMs = Date.parse(asOf);
  let compsEst: number | null = null, spread: number | null = null, low = 0, high = 0;
  const steps: Record<string, unknown> = { index_now: now, subject_platform_effect: sp };
  if (comps.length >= opts.minComps) {
    const adj = comps.map((c) => Math.log(c.sale_price) + (now - indexAt(index, c.sold_date)) - pe(c.platform));
    const ws = comps.map((c) => {
      const age = c.sold_date ? Math.max(0, (asOfMs - Date.parse(c.sold_date)) / 86_400_000) : 0;
      return Math.pow(0.5, age / RECENCY_HALFLIFE_DAYS);
    });
    let le = wmedian(adj, ws) + sp;
    const sorted = [...adj].sort((a, b) => a - b), n = sorted.length;
    const q1 = sorted[Math.floor(0.25 * (n - 1))]!, q3 = sorted[Math.floor(0.75 * (n - 1))]!, md = sorted[Math.floor((n - 1) / 2)]!;
    spread = (Math.exp(q3) - Math.exp(q1)) / Math.exp(md);
    const miles = comps.map((c) => Number(c.mileage)).filter((m) => Number.isFinite(m) && m > 0 && m < 2e6).sort((a, b) => a - b);
    if (opts.subjectMileage != null && opts.subjectMileage > 0 && miles.length) {
      const mm = miles.length % 2 ? miles[(miles.length - 1) / 2]! : (miles[miles.length / 2 - 1]! + miles[miles.length / 2]!) / 2;
      const x = Math.log((opts.subjectMileage + 1000) / (mm + 1000));
      const a = mileageAdj(x);
      le += a; steps.mileage = { subject: opts.subjectMileage, comps_median: mm, log_ratio: x, adjustment: a };
    }
    compsEst = Math.exp(le);
    low = Math.exp(q1 + sp + (le - sp - wmedian(adj, ws)));
    high = Math.exp(q3 + sp + (le - sp - wmedian(adj, ws)));
  }
  let ownEst: number | null = null;
  if (opts.ownSale && opts.ownSale.amount > 0 && opts.ownSale.on) {
    const lpp = Math.log(opts.ownSale.amount) + (now - indexAt(index, opts.ownSale.on)) - pe(opts.ownSale.platform) + sp;
    ownEst = Math.exp(lpp);
    const gap = Math.max(0, (asOfMs - Date.parse(opts.ownSale.on)) / (365.25 * 86_400_000));
    steps.own_sale = { gap_years: gap, weight: OWN_SALE_WEIGHT(gap), adjusted: ownEst };
  }
  if (compsEst == null && ownEst == null) return null;
  let est: number;
  if (compsEst != null && ownEst != null) {
    const a = OWN_SALE_WEIGHT((steps.own_sale as { gap_years: number }).gap_years);
    est = Math.exp((1 - a) * Math.log(compsEst) + a * Math.log(ownEst));
    const r = est / compsEst; low *= r; high *= r;
  } else if (compsEst != null) est = compsEst;
  else { est = ownEst!; low = est * 0.85; high = est * 1.15; }
  const confidence = confidenceFor(comps.length, spread, ownEst != null);
  return { estimate: Math.round(est), low: Math.round(Math.min(low, est)), high: Math.round(Math.max(high, est)), spread: spread ?? NaN, confidence, comps_estimate: compsEst != null ? Math.round(compsEst) : null, own_sale_estimate: ownEst != null ? Math.round(ownEst) : null, steps };
}
