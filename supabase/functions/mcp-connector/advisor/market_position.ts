/**
 * T4 money / position / trend for evaluate_listing. Pure helpers; every number carries its source.
 * - allInCost: page price + platform buyer fee (cited platform_fee_schedule row) + transport + paperwork
 *   (the budget_options assumptions, cited).
 * - pricePosition: where the subject price sits among the comps shown.
 * - cohortTrend: 12-month cohort median vs the prior 12 months, with n.
 */
import { COSTS } from "./budget.ts";

export function medianOf(nums: number[]): number | null {
  const s = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export interface FeeRow {
  id: number | string;
  platform: string;
  role: string;
  fee_kind: string;
  rate: number | null;
  min_amount: number | null;
  cap_amount: number | null;
  flat_amount: number | null;
  currency: string | null;
  published_price_basis: string | null;
  valid_from: string | null;
  valid_to: string | null;
  source_url: string | null;
  lot_class: string | null;
  sale_type?: string | null;
}

/** Buyer-fee row in force for this platform, currency and date (cars: lot_class any/car). */
export function pickBuyerFeeRow(
  rows: FeeRow[],
  currency: string,
  atIso: string,
): FeeRow | null {
  const t = Date.parse(atIso);
  const live = rows.filter((r) =>
    r.role === "buyer" &&
    (r.lot_class == null || r.lot_class === "any" || r.lot_class === "car") &&
    (r.sale_type == null || r.sale_type === "any") &&
    (r.currency || "USD").toUpperCase() === currency.toUpperCase() &&
    (!r.valid_from || Date.parse(r.valid_from) <= t) &&
    (!r.valid_to || Date.parse(r.valid_to) > t)
  );
  // Prefer the car-specific row over "any", then the most recent start.
  live.sort((a, b) =>
    (a.lot_class === "car" ? 0 : 1) - (b.lot_class === "car" ? 0 : 1) ||
    Date.parse(b.valid_from || "1970-01-01") -
      Date.parse(a.valid_from || "1970-01-01")
  );
  return live[0] ?? null;
}

export function buyerFee(row: FeeRow, price: number): number {
  if (row.fee_kind === "flat") return Number(row.flat_amount) || 0;
  let fee = price * (Number(row.rate) || 0);
  if (row.min_amount != null) fee = Math.max(fee, Number(row.min_amount));
  if (row.cap_amount != null) fee = Math.min(fee, Number(row.cap_amount));
  return Math.round(fee);
}

/**
 * All-in cost to a buyer at the page price. RNM high bids and live bids are "if bought at this
 * price", never a sale. Only computed on a known price basis; a basis conflict is reported instead.
 */
export function allInCost(input: {
  price: number | null;
  price_kind: string | null;
  price_basis: string | null;
  currency: string | null;
  platform: string;
  at: string;
  feeRows: FeeRow[];
  listingUrl: string;
}): Record<string, unknown> {
  const { price, price_kind, price_basis } = input;
  const currency = (input.currency || "USD").toUpperCase();
  if (price == null || !(price > 0)) {
    return {
      status: "not_recorded",
      reason: "no price on the listing page",
      total: null,
    };
  }
  if (price_basis !== "hammer" && price_basis !== "gross_incl_premium") {
    return {
      status: "not_recorded",
      reason: `price basis is ${
        price_basis ?? "unknown"
      }; adding a buyer fee could double-count it`,
      total: null,
      price,
      currency,
    };
  }
  const row = pickBuyerFeeRow(input.feeRows, currency, input.at);
  let fee: Record<string, unknown>;
  let feeAmount = 0;
  if (price_basis === "gross_incl_premium") {
    fee = {
      amount: 0,
      included_in_price: true,
      note: "page price already includes the buyer premium",
    };
  } else if (!row) {
    return {
      status: "not_recorded",
      reason:
        `no ${input.platform} buyer-fee row in platform_fee_schedule for ${currency} on ${
          input.at.slice(0, 10)
        }`,
      total: null,
      price,
      currency,
    };
  } else {
    feeAmount = buyerFee(row, price);
    fee = {
      amount: feeAmount,
      rate: row.rate,
      min: row.min_amount,
      cap: row.cap_amount,
      currency: row.currency,
      citation: {
        source_name: "platform_fee_schedule",
        fee_schedule_id: row.id,
        source_url: row.source_url,
        valid_from: row.valid_from,
        valid_to: row.valid_to,
      },
    };
  }
  // Transport and paperwork are USD estimates (budget_options); not added to a non-USD price.
  const usd = currency === "USD";
  const transport = usd ? COSTS.transport : null;
  const paperwork = usd ? COSTS.paperwork : null;
  const total = usd
    ? Math.round(price + feeAmount + COSTS.transport + COSTS.paperwork)
    : Math.round(price + feeAmount);
  const label = price_kind === "sold"
    ? "what the buyer paid all-in (winning bid + buyer fee + estimated transport and paperwork)"
    : price_kind === "current_bid"
    ? "all-in if the auction closed at the current bid"
    : price_kind === "high_bid_reserve_not_met"
    ? "all-in had the car sold at its high bid (it did not sell)"
    : "all-in at the asking price";
  return {
    status: "recorded",
    label,
    currency,
    price,
    price_kind,
    price_basis,
    price_citation: {
      source_name: input.platform,
      source_url: input.listingUrl,
    },
    buyer_fee: fee,
    transport: transport != null
      ? {
        amount: transport,
        estimate: true,
        citation: {
          source_url: COSTS.sources[1],
          note: "enclosed national average, same as budget_options",
        },
      }
      : null,
    paperwork: paperwork != null
      ? {
        amount: paperwork,
        estimate: true,
        citation: {
          source_name: "budget_options assumption",
          note: "title/registration estimate",
        },
      }
      : null,
    total,
    total_note: usd
      ? null
      : "transport/paperwork estimates are USD-only and were not added",
  };
}

/** Where the subject price sits among the comps shown (hammer basis on both sides). */
export function pricePosition(
  price: number | null,
  priceKind: string | null,
  comps: Array<
    {
      sale_price: number | null;
      listing_url?: string | null;
      sold_date?: string | null;
    }
  >,
): Record<string, unknown> {
  const xs = comps.map((c) => Number(c.sale_price)).filter((n) => n > 0).sort((
    a,
    b,
  ) => a - b);
  if (price == null || !(price > 0) || xs.length < 3) {
    return {
      status: "not_recorded",
      reason: price == null
        ? "no price on the listing page"
        : `only ${xs.length} comp(s) shown (need 3)`,
      percentile: null,
      n: xs.length,
    };
  }
  const below = xs.filter((x) => x < price).length;
  const ties = xs.filter((x) => x === price).length;
  const percentile = Math.round(((below + ties / 2) / xs.length) * 100);
  return {
    status: "recorded",
    price,
    price_kind: priceKind,
    percentile,
    n: xs.length,
    min: xs[0],
    median: medianOf(xs),
    max: xs[xs.length - 1],
    note: `${
      priceKind === "sold"
        ? "sold price"
        : priceKind === "current_bid"
        ? "current bid"
        : priceKind === "high_bid_reserve_not_met"
        ? "high bid (no sale)"
        : "price"
    } is above ${below} of ${xs.length} comparable sales shown`,
    citations: comps.slice(0, 10).map((c) => ({
      source_url: c.listing_url ?? null,
      event_time: c.sold_date ?? null,
      sale_price: c.sale_price,
    })),
  };
}

/** 12-month cohort median vs the prior 12 months, from dated hammer-basis comps (T4). */
export function cohortTrend(
  rows: Array<
    {
      sale_price: number | null;
      sold_date: string | null;
      listing_url?: string | null;
    }
  >,
  nowMs = Date.now(),
): Record<string, unknown> {
  const yr = 365 * 86_400_000;
  const recent: typeof rows = [];
  const prior: typeof rows = [];
  for (const r of rows) {
    const t = r.sold_date ? Date.parse(r.sold_date) : NaN;
    if (!Number.isFinite(t) || !(Number(r.sale_price) > 0)) continue;
    if (t <= nowMs && t > nowMs - yr) recent.push(r);
    else if (t <= nowMs - yr && t > nowMs - 2 * yr) prior.push(r);
  }
  const med = (xs: typeof rows) =>
    medianOf(xs.map((x) => Number(x.sale_price)));
  const mRecent = med(recent);
  const mPrior = med(prior);
  const enough = recent.length >= 3 && prior.length >= 3 && mRecent != null &&
    mPrior != null && mPrior > 0;
  const asOf = new Date(nowMs).toISOString().slice(0, 10);
  return {
    window_recent: {
      from: new Date(nowMs - yr).toISOString().slice(0, 10),
      to: asOf,
      n: recent.length,
      median: mRecent,
    },
    window_prior: {
      from: new Date(nowMs - 2 * yr).toISOString().slice(0, 10),
      to: new Date(nowMs - yr).toISOString().slice(0, 10),
      n: prior.length,
      median: mPrior,
    },
    change_pct: enough
      ? Math.round(((mRecent! - mPrior!) / mPrior!) * 1000) / 10
      : null,
    direction: enough
      ? (mRecent! > mPrior! * 1.03
        ? "up"
        : mRecent! < mPrior! * 0.97
        ? "down"
        : "flat")
      : null,
    status: enough ? "recorded" : "not_recorded_insufficient_n",
    note: enough
      ? "Median of variant-matched, junk-filtered sold comps (hammer basis); same cohort as the comps shown"
      : "Fewer than 3 dated sold comps in one of the windows; no trend claimed",
    price_basis: "hammer",
    citations: [...recent, ...prior].slice(0, 12).map((r) => ({
      source_url: r.listing_url ?? null,
      event_time: r.sold_date,
      sale_price: r.sale_price,
    })),
  };
}
