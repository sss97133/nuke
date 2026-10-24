// Read-only handlers for the Nuke Asset Advisor surface.
import { adjustedEstimate, type AdjResult, type IndexSeries } from "./adjust.ts";
import {
  AGENT_CITATION_RULES,
  citationFromObservation,
  emptyCitation,
  extractEventTime,
  makeEnvelope,
  notRecordedClaim,
  recordedClaim,
  resolveClaimConfidence,
  type AdvisorEnvelope,
  type Claim,
  type Citation,
} from "./evidence.ts";
import { handleEvaluateListing } from "./evaluate_listing.ts";
import { classifyVinQuery } from "./vin.ts";
import {
  canonicalListingUrl,
  cleanListingUrl,
  detectVariant,
  isLikelyPartsSale,
  isGenerationMismatch,
  isVariantMismatch,
  recentSaleSanityGuard,
  scoreSimilarity,
  type VariantKey,
} from "./variants.ts";

import { rankBudgetOptions, budgetEnvelope, type SegmentStat, type MarketSignal } from "./budget.ts";

/** Minimal PostgREST-shaped client used by advisor handlers (avoids pulling supabase-js types into Deno tests). */
// deno-lint-ignore no-explicit-any
export type AdvisorDb = any;

export interface AdvisorDeps {
  sb: () => AdvisorDb;
  callEdgeApi: (
    endpoint: string,
    path?: string,
    method?: "GET" | "POST",
    body?: Record<string, unknown>,
  ) => Promise<unknown>;
}

export interface AdvisorToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: AdvisorEnvelope;
  isError?: boolean;
}

function ok(envelope: AdvisorEnvelope): AdvisorToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }],
    structuredContent: envelope,
  };
}

function err(msg: string, tool: string): AdvisorToolResult {
  const envelope = makeEnvelope(tool, "vehicle", null, [], { error: msg });
  return {
    content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }],
    structuredContent: envelope,
    isError: true,
  };
}

function assetType(args: Record<string, unknown>): string {
  const t = typeof args.asset_type === "string" ? args.asset_type : "vehicle";
  return t || "vehicle";
}

function unsupportedAsset(args: Record<string, unknown>, tool: string): AdvisorToolResult | null {
  const t = assetType(args);
  if (t !== "vehicle") {
    return err(
      `asset_type '${t}' is not yet supported on this surface (vehicles only).`,
      tool,
    );
  }
  return null;
}

const IDENTITY_FIELDS = [
  "year",
  "make",
  "model",
  "trim",
  "vin",
  "body_style",
  "exterior_color",
  "interior_color",
  "mileage",
  "engine_type",
  "transmission",
  "drivetrain",
] as const;

const FIELD_ALIASES: Record<string, string[]> = {
  exterior_color: ["color", "exterior_color", "colour"],
  color: ["color", "exterior_color"],
  sale_price: ["sale_price", "final_price", "high_bid"],
  mileage: ["mileage", "odometer"],
};

function fieldKeys(field: string): string[] {
  const f = field.toLowerCase();
  return FIELD_ALIASES[f] ?? [f];
}

async function loadSources(
  sb: AdvisorDb,
  sourceIds: string[],
): Promise<Map<string, { display_name: string; base_trust_score: number | null; slug: string }>> {
  const map = new Map();
  const ids = [...new Set(sourceIds.filter(Boolean))];
  if (!ids.length) return map;
  const { data } = await sb
    .from("observation_sources")
    .select("id, slug, display_name, base_trust_score")
    .in("id", ids);
  for (const s of data || []) {
    map.set(s.id, s);
  }
  return map;
}

async function priceFacts(sb: AdvisorDb, vid: string) {
  const { data } = await sb.rpc("vehicle_price_facts", { p_vehicle_ids: [vid] });
  const r = Array.isArray(data) ? data[0] : null;
  if (!r) return null;
  return {
    kind: r.price_kind,
    amount: r.price_amount,
    as_of: r.price_as_of,
    live: r.price_live,
    outcome: r.outcome,
    sold: r.sold_basis
      ? { amount: r.sold_amount, on: r.sold_on, basis: r.sold_basis, from: r.sold_amount_from }
      : null,
    ask: r.ask_amount != null ? { amount: r.ask_amount, as_of: r.ask_as_of } : null,
    bid: r.bid_amount != null ? { amount: r.bid_amount, on: r.bid_on, from: r.bid_from } : null,
    estimate: r.estimate_amount != null
      ? { amount: r.estimate_amount, confidence: r.estimate_confidence, as_of: r.estimate_as_of }
      : null,
    source_url: r.source_url as string | null,
  };
}

/** All-in buyer cost per vehicle (hammer + published buyer premium + cited estimates). Never throws. */
async function allInCosts(sb: AdvisorDb, ids: string[]): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return out;
  try {
    const { data, error } = await sb.rpc("all_in_buyer_cost_for_vehicles", { p_vehicle_ids: uniq });
    if (error || !Array.isArray(data)) return out;
    for (const r of data as Array<{ vehicle_id: string; all_in: Record<string, unknown> | null }>) {
      if (r?.vehicle_id && r.all_in) out.set(String(r.vehicle_id), r.all_in);
    }
  } catch {
    // all-in cost is additive context; a missing RPC must not break valuation.
  }
  return out;
}

/**
 * Hammer-basis price for a sale. The adjustments in adjust.ts (channel effects, own-sale blend) were
 * fitted on hammer prices (all_in_buyer_cost -> hammer, else the stored price), so live inputs must be
 * on the same basis: a Broad Arrow / Mecum / RM price stored with the buyer premium is converted back
 * to its hammer, otherwise the premium would be counted on top of the fitted channel effect.
 * Only converts when the all-in record describes this same stored price.
 */
export function hammerBasis(price: number, allIn: Record<string, unknown> | undefined | null): { amount: number; converted: boolean } {
  if (!allIn || !(price > 0)) return { amount: price, converted: false };
  const stored = Number(allIn.stored_price);
  const hammer = Number(allIn.hammer);
  if (allIn.stored_price_includes_premium === true && Number.isFinite(stored) && Math.abs(stored - price) < 1 &&
    Number.isFinite(hammer) && hammer > 0 && hammer <= price) {
    return { amount: hammer, converted: true };
  }
  return { amount: price, converted: false };
}

function allInSummary(a: Record<string, unknown> | undefined | null) {
  if (!a) return null;
  const total = (a.all_in_cost ?? null) as Record<string, unknown> | null;
  return {
    hammer: a.hammer ?? null,
    stored_price: a.stored_price ?? null,
    stored_price_basis: a.stored_price_basis ?? null,
    stored_price_includes_premium: a.stored_price_includes_premium ?? null,
    buyer_premium: Array.isArray(a.components)
      ? ((a.components as Array<Record<string, unknown>>).find((c) => c.item === "buyer_premium")?.amount ?? null)
      : null,
    all_in_known: total?.known ?? null,
    all_in_estimated_mid: total?.estimated_mid ?? null,
  };
}

/** Fitted 2026-10-22 by time-ordered backtest; see backtest.md in nuke-strategy. */
export const VALUATION_THRESHOLDS = { minComps: 4, staleDays: 180, disagreement: 0.10 } as const;

/** Backtested P(within 20%) table. Rows: comps 3-4, 5-9, 10+; cols: IQR/median <10%,10-20,20-30,30-50,>=50%. */
export function calibratedConfidence(nComps: number, dispersion: number | null): number {
  const T = [[0.527, 0.432, 0.381, 0.336, 0.276], [0.578, 0.499, 0.423, 0.364, 0.294], [0.848, 0.635, 0.503, 0.403, 0.31]];
  if (nComps < 3) return 0.3;
  const row = nComps >= 10 ? 2 : nComps >= 5 ? 1 : 0;
  if (dispersion == null || !Number.isFinite(dispersion)) return T[row]![4]!;
  const col = dispersion < 0.1 ? 0 : dispersion < 0.2 ? 1 : dispersion < 0.3 ? 2 : dispersion < 0.5 ? 3 : 4;
  return T[row]![col]!;
}

function listingCitation(vehicle: Record<string, unknown>): Citation {
  const platform = vehicle.canonical_platform || vehicle.auction_source;
  const name =
    platform === "bat" || platform === "bringatrailer"
      ? "Bring a Trailer"
      : typeof platform === "string" && platform
      ? String(platform)
      : "listing";
  return emptyCitation({
    source_name: name,
    source_url: (vehicle.listing_url || vehicle.bat_auction_url || null) as string | null,
    observation_id: null,
    event_time: null,
    ingested_at: (vehicle.updated_at || vehicle.created_at || null) as string | null,
    is_superseded: false,
  });
}

export function createAdvisorHandlers(deps: AdvisorDeps): Record<
  string,
  (args: Record<string, unknown>) => Promise<AdvisorToolResult>
> {
  // Exactly the six catalog tools. Legacy helpers remain in-file for folding into responses.
  return {
    find_asset: (args) => handleFindAsset(deps, args),
    get_asset: (args) => handleGetAsset(deps, args),
    get_comps: (args) => handleGetComps(deps, args),
    value_asset: (args) => handleValueAsset(deps, args),
    evaluate_listing: (args) =>
      handleEvaluateListing({ ...deps, valueAsset: (id) => handleValueAsset(deps, { asset_id: id }) }, args),
    budget_options: (args) => handleBudgetOptions(deps, args),
  };
}

const STALE_DEFAULT_DAYS = 45;

function lastVerifiedAt(v: Record<string, unknown>): string | null {
  const candidates = [v.listing_updated_at, v.listing_posted_at, v.updated_at];
  for (const c of candidates) {
    if (typeof c === "string" && c) return c;
  }
  return null;
}

function isStaleVerified(verifiedAt: string | null, staleAfterDays: number, now = Date.now()): boolean {
  if (!verifiedAt) return true;
  const t = Date.parse(verifiedAt);
  if (!Number.isFinite(t)) return true;
  return now - t > staleAfterDays * 86_400_000;
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx] ?? null;
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Listing path slug for BaT / Cars & Bids style URLs (last non-empty path segment). */
function listingSlugFromUrl(url: string): string | null {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    const parts = u.pathname.split("/").filter(Boolean);
    if (!parts.length) return null;
    const listingIdx = parts.findIndex((p) => p === "listing" || p === "auctions" || p === "auction");
    if (listingIdx >= 0 && parts[listingIdx + 1]) return parts[listingIdx + 1]!;
    return parts[parts.length - 1] || null;
  } catch {
    return null;
  }
}

async function loadPriceFactsMap(
  sb: AdvisorDb,
  ids: string[],
): Promise<Map<string, Record<string, unknown>> & { failedChunks?: number; lastError?: string }> {
  const map: Map<string, Record<string, unknown>> & { failedChunks?: number; lastError?: string } = new Map();
  map.failedChunks = 0;
  const unique = [...new Set(ids.filter(Boolean))];
  // vehicle_price_facts is cheap for small batches; chunk to avoid timeouts. A failed chunk would
  // leave every comp in it without a sale basis (and so dropped as not_sold), so retry with backoff
  // and count chunks that still fail; resolveSoldComps reports them as a degraded lookup.
  for (let i = 0; i < unique.length; i += 40) {
    const chunk = unique.slice(i, i + 40);
    let data: Record<string, unknown>[] | null = null;
    let error: { message?: string } | null = null;
    for (const waitMs of COMPS_RETRY_BACKOFF_MS) {
      if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
      ({ data, error } = await sb.rpc("vehicle_price_facts", { p_vehicle_ids: chunk }));
      if (!error) break;
    }
    if (error) {
      map.failedChunks++;
      map.lastError = String(error.message || error);
      continue;
    }
    for (const row of data || []) {
      map.set(String(row.vehicle_id), row);
    }
  }
  return map;
}

type SaleTruth = {
  ask_prices: number[];
  dup_prices: number[];
  verified_prices: number[];
  has_verified_sold: boolean;
  has_unverified: boolean;
};

/**
 * Per-vehicle sale-truth roles from vehicle_events (PR #2454 flags).
 * ask = orphan-backfill asking price (not a sale); unverified_sale = index "sold" without price.
 * duplicate = overnight sale dedup (sale_dedup_v*) marked this event a twin of a canonical sale, often on
 *   another vehicle; it is never sold support. Null / hammer / hammer_unverified roles count as sold support.
 * Comps rows come from auction_events / vehicles (get_comps_scored), which carry no dedup flag, so the
 * caller matches the comp price against these per-vehicle event prices. Fail-open on read errors.
 */
async function loadSaleTruthMap(
  sb: AdvisorDb,
  ids: string[],
): Promise<Map<string, SaleTruth>> {
  const map = new Map<string, SaleTruth>();
  const unique = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 40) {
    const chunk = unique.slice(i, i + 40);
    try {
      const { data } = await sb
        .from("vehicle_events")
        .select("vehicle_id, sale_truth_role, final_price")
        .in("vehicle_id", chunk)
        .eq("event_status", "sold");
      for (const row of data || []) {
        const vid = String(row.vehicle_id);
        const t = map.get(vid) ?? {
          ask_prices: [],
          dup_prices: [],
          verified_prices: [],
          has_verified_sold: false,
          has_unverified: false,
        };
        const role = row.sale_truth_role != null ? String(row.sale_truth_role) : null;
        const price = row.final_price != null ? Number(row.final_price) : null;
        if (role === "duplicate") {
          if (price != null && price > 0) t.dup_prices.push(price);
        } else if (role === "ask") {
          if (price != null && price > 0) t.ask_prices.push(price);
        } else if (role === "unverified_sale") {
          t.has_unverified = true;
        } else if (price != null && price > 0) {
          t.has_verified_sold = true;
          t.verified_prices.push(price);
        }
        map.set(vid, t);
      }
    } catch {
      // sale_truth_role not readable: keep legacy behaviour for this chunk.
    }
  }
  return map;
}

type SoldComp = {
  asset_id: string | null;
  year: unknown;
  make: unknown;
  model: unknown;
  trim: unknown;
  sale_price: number | null;
  mileage: unknown;
  sold_date: string | null;
  listing_url: string | null;
  platform: string | null;
  transmission: unknown;
  body_style: unknown;
  similarity_score: unknown;
  price_kind: "sold";
  sold_basis: string | null;
  variant: VariantKey;
  flags: string[];
  citation: Citation;
};

/** Waits before each comps RPC attempt (first is immediate). */
export const COMPS_RETRY_BACKOFF_MS = [0, 400, 1200, 3000];

export type CompsLookup = {
  ok: boolean;
  degraded: boolean;
  attempts: number;
  source: string;
  error: string | null;
  /** Basis of every sale_price in this comp set: one basis, never mixed. "legacy_mixed" = edge comps fallback (basis not typed). */
  price_basis?: CompsPriceBasis;
};

/** Comps are hammer prices (premium excluded) unless asked otherwise; gross and net-to-owner are separate contexts. */
export type CompsPriceBasis = "hammer" | "gross_incl_premium" | "net_to_owner" | "legacy_mixed";
export const DEFAULT_COMPS_BASIS: Exclude<CompsPriceBasis, "legacy_mixed"> = "hammer";

async function resolveSoldComps(
  deps: AdvisorDeps,
  args: {
    asset_id?: string;
    make?: string | null;
    model?: string | null;
    year?: number | null;
    limit?: number;
  },
): Promise<{ comps: SoldComp[]; query: Record<string, unknown>; excluded: Record<string, number>; lookup: CompsLookup }> {
  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 25);
  const sb = deps.sb();
  let make = args.make ?? null;
  let model = args.model ?? null;
  let year = args.year ?? null;
  let excludeId: string | null = args.asset_id ? String(args.asset_id) : null;
  let subject: Record<string, unknown> | null = null;

  if (args.asset_id) {
    const { data: vrow } = await sb
      .from("vehicles")
      .select(
        "id, year, make, model, trim, transmission, body_style, mileage, engine_type, listing_url, bat_auction_url, listing_title",
      )
      .eq("id", String(args.asset_id))
      .maybeSingle();
    if (vrow) {
      subject = vrow;
      make = make || (vrow.make as string);
      model = model || (vrow.model as string);
      year = year ?? (vrow.year as number | null);
      excludeId = (vrow.id as string) || excludeId;
    }
  }

  if (!make) {
    return {
      comps: [],
      query: { make, model, year, limit },
      excluded: { no_make: 1 },
      lookup: { ok: false, degraded: true, attempts: 0, source: "none", error: "no make to search on" },
    };
  }

  const subjectVariant = detectVariant(
    `${subject?.model || model || ""} ${subject?.trim || ""} ${subject?.listing_title || ""} ${
      subject?.listing_url || ""
    } ${subject?.bat_auction_url || ""}`,
  );

  const yearRange = 2;
  const fetchLimit = Math.min(limit * 4, 60);
  const compsArgs: Record<string, unknown> = {
    p_basis: DEFAULT_COMPS_BASIS,
    p_make: make,
    p_model: model,
    p_year_min: year != null ? year - yearRange : null,
    p_year_max: year != null ? year + yearRange : null,
    p_min_price: null,
    p_max_price: null,
    p_exclude_vehicle_id: excludeId,
    p_limit: fetchLimit,
  };
  // Under load the comps RPC can hit its 10s statement timeout. Retry with backoff; if every
  // attempt and the edge fallback fail, report lookup.ok=false so callers never present an
  // empty result as "no comparable sales".
  let rpcRows: unknown = null;
  let rpcErr: { message?: string } | null = null;
  let attempts = 0;
  for (const waitMs of COMPS_RETRY_BACKOFF_MS) {
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    attempts++;
    ({ data: rpcRows, error: rpcErr } = await sb.rpc("get_comps_combined", compsArgs));
    if (!rpcErr) break;
  }
  // Typed basis columns are backfilled: an empty hammer-basis result means no comps, never a mixed-basis fallback.
  const priceBasis: CompsPriceBasis = DEFAULT_COMPS_BASIS;
  const compsQueryError = rpcErr ? String(rpcErr.message || rpcErr) : null;
  let lookupSource = "get_comps_combined";
  let lookupOk = !rpcErr;
  let lookupError = compsQueryError;

  let rows: Record<string, unknown>[] = [];
  if (rpcErr) {
    try {
      const raw = (await deps.callEdgeApi("comps", "", "POST", {
        vehicle_id: excludeId,
        make,
        model,
        year,
        limit: fetchLimit,
      })) as Record<string, unknown>;
      if (!Array.isArray(raw?.data)) throw new Error("comps fallback returned no data array");
      rows = raw.data as Record<string, unknown>[];
      lookupSource = "edge_comps_fallback";
      lookupOk = true;
    } catch (e) {
      rows = [];
      lookupSource = `failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  } else {
    rows = (Array.isArray(rpcRows) ? rpcRows : []).map((row: Record<string, unknown>) => ({
      vehicle_id: row.vehicle_id ?? null,
      year: row.yr ?? null,
      make: row.mk ?? null,
      model: row.mdl ?? null,
      trim: row.tr ?? null,
      sale_price: row.sale_price,
      mileage: row.miles ?? null,
      listing_url: row.listing_url ?? null,
      platform: row.platform ?? null,
      sold_date: row.sold_date ?? null,
      source_type: row.source_type ?? null,
      similarity_score: row.similarity_score ?? null,
    }));
  }

  const ids = rows.map((r) => String(r.vehicle_id || "")).filter(Boolean);
  const facts = await loadPriceFactsMap(sb, ids);
  if (facts.failedChunks) {
    lookupOk = false;
    lookupError = `vehicle_price_facts failed for ${facts.failedChunks} chunk(s): ${facts.lastError}`;
  }
  const saleTruth = await loadSaleTruthMap(sb, ids);

  // Optional subject attribute boosts (reader-side; does not invent missing transmission).
  const subTrans = subject?.transmission ? String(subject.transmission).toLowerCase() : null;
  const subBody = subject?.body_style ? String(subject.body_style).toLowerCase() : null;
  const subMiles = typeof subject?.mileage === "number" ? subject.mileage as number : null;

  const excluded: Record<string, number> = {
    not_sold: 0,
    ask_or_bid: 0,
    no_amount: 0,
    hd_diesel_mismatch: 0,
    variant_mismatch: 0,
    generation_mismatch: 0,
    duplicate: 0,
    parts: 0,
  };
  const sold: SoldComp[] = [];
  const seenUrl = new Set<string>();
  const seenPriceDate = new Set<string>();

  // Debug: candidates whose raw price the sale-truth rules would drop, and which rule actually dropped them.
  const truthHitIds = new Set<string>();
  const truthDroppedIds = new Set<string>();
  for (const c of rows) {
    const id = c.vehicle_id ? String(c.vehicle_id) : null;
    const t = id ? saleTruth.get(id) : undefined;
    const raw = c.sale_price != null ? Number(c.sale_price) : null;
    if (id && t && raw != null && (
      (!t.has_verified_sold && t.ask_prices.some((p) => Math.abs(p - raw) < 1)) ||
      (t.dup_prices.some((p) => Math.abs(p - raw) < 1) && !t.verified_prices.some((p) => Math.abs(p - raw) < 1))
    )) truthHitIds.add(id);
  }

  for (const c of rows) {
    const id = c.vehicle_id ? String(c.vehicle_id) : null;
    const fact = id ? facts.get(id) : null;
    const amount = fact?.sold_amount != null
      ? Number(fact.sold_amount)
      : c.sale_price != null
      ? Number(c.sale_price)
      : null;
    const basis = fact?.sold_basis != null ? String(fact.sold_basis) : null;
    const kind = fact?.price_kind != null ? String(fact.price_kind) : null;

    // Confirmed sales only — never promote asks / bids / estimates to comps.
    if (kind === "ask" || kind === "bid" || kind === "estimate") {
      excluded.ask_or_bid++;
      continue;
    }
    if (!basis && kind !== "sold") {
      // vehicle_record comps without sale basis are often mislabeled asks.
      if (!basis) {
        excluded.not_sold++;
        continue;
      }
    }
    if (amount == null || !(amount > 0)) {
      excluded.no_amount++;
      continue;
    }

    // Sale-truth flags: a price that only an asking-price event supports is not a sale.
    const truth = id ? saleTruth.get(id) : undefined;
    if (truth && !truth.has_verified_sold &&
      truth.ask_prices.some((p) => Math.abs(p - amount) < 1)) {
      excluded.ask_or_bid++;
      if (id) truthDroppedIds.add(id);
      continue;
    }
    // Overnight dedup: a price only a duplicate-marked event supports is the same sale counted twice.
    if (truth && truth.dup_prices.some((p) => Math.abs(p - amount) < 1) &&
      !truth.verified_prices.some((p) => Math.abs(p - amount) < 1)) {
      excluded.duplicate++;
      if (id) truthDroppedIds.add(id);
      continue;
    }
    const unverifiedOnly = !!truth && truth.has_unverified && !truth.has_verified_sold;

    const modelText = `${c.model || ""} ${c.trim || ""}`.toLowerCase();
    if (subject?.model && /diesel|hd\b|2500|3500|dually/.test(modelText) &&
      !/diesel|hd\b|2500|3500|dually/.test(String(subject.model).toLowerCase())) {
      excluded.hd_diesel_mismatch++;
      continue;
    }

    const listingUrl = cleanListingUrl(
      (c.listing_url as string) || (fact?.source_url as string) || null,
    );
    const canon = canonicalListingUrl(listingUrl);
    if (canon && seenUrl.has(canon)) {
      excluded.duplicate++;
      continue;
    }

    const soldDate = fact?.sold_on
      ? String(fact.sold_on)
      : c.sold_date
      ? String(c.sold_date)
      : null;
    const priceDateKey = soldDate ? `${Math.round(amount)}|${soldDate.slice(0, 10)}` : "";
    if (priceDateKey && seenPriceDate.has(priceDateKey)) {
      excluded.duplicate++;
      continue;
    }

    const candBlob = `${c.model || ""} ${c.trim || ""} ${listingUrl || ""}`;
    const candVariant = detectVariant(candBlob);
    if (isVariantMismatch(subjectVariant, candVariant)) {
      excluded.variant_mismatch++;
      continue;
    }
    // Same variant, different generation (e.g. 964 Turbo 3.6 comps for a 993 Turbo).
    if (
      isGenerationMismatch(
        {
          make,
          model: String(subject?.model || model || ""),
          year,
          text: `${subject?.trim || ""} ${subject?.listing_title || ""} ${subject?.listing_url || ""} ${subject?.bat_auction_url || ""}`,
        },
        { make: (c.make as string) || make, model: String(c.model || ""), year: c.year != null ? Number(c.year) : null, text: candBlob },
      )
    ) {
      excluded.generation_mismatch++;
      continue;
    }

    const parts = isLikelyPartsSale({
      title: String(c.model || ""),
      url: listingUrl,
      model: String(c.model || ""),
      sale_price: amount,
      year: c.year != null ? Number(c.year) : null,
    });
    const flags: string[] = [];
    if (unverifiedOnly) flags.push("sold_unverified");
    if (parts.parts) {
      excluded.parts++;
      flags.push(`parts_suspect:${parts.reason}`);
      // Keep flagged but do not use as a peer sale in the returned set.
      continue;
    }

    if (canon) seenUrl.add(canon);
    if (priceDateKey) seenPriceDate.add(priceDateKey);

    const cit = emptyCitation({
      source_name: (c.platform as string) || (fact?.platform as string) || null,
      source_url: listingUrl,
      observation_id: null,
      event_time: soldDate,
      ingested_at: null,
      is_superseded: false,
    });

    const score = scoreSimilarity({
      subject: {
        year: year,
        variant: subjectVariant,
        body: subBody,
        transmission: subTrans,
        mileage: subMiles,
        model: model,
      },
      candidate: {
        year: c.year != null ? Number(c.year) : null,
        variant: candVariant,
        body: c.body_style != null ? String(c.body_style).toLowerCase() : null,
        transmission: c.transmission != null ? String(c.transmission) : null,
        mileage: typeof c.mileage === "number" ? c.mileage : null,
        model: c.model != null ? String(c.model) : null,
        sale_price: amount,
      },
    });

    sold.push({
      asset_id: id,
      year: c.year,
      make: c.make,
      model: c.model,
      trim: c.trim ?? null,
      sale_price: amount,
      mileage: c.mileage,
      sold_date: soldDate,
      listing_url: listingUrl,
      platform: (c.platform as string) || (fact?.platform as string) || null,
      transmission: c.transmission ?? null,
      body_style: c.body_style ?? null,
      // sold_unverified comps are down-weighted, not dropped.
      similarity_score: unverifiedOnly && typeof score === "number" ? Math.round(score * 0.5 * 10) / 10 : score,
      price_kind: "sold",
      sold_basis: basis,
      variant: candVariant,
      flags,
      citation: cit,
    });
  }

  sold.sort((a, b) => Number(b.similarity_score || 0) - Number(a.similarity_score || 0));
  const soldIds = new Set(sold.map((s) => String(s.asset_id ?? "")));
  excluded.sale_truth_candidates = truthHitIds.size;
  excluded.sale_truth_dropped_by_truth_rule = truthDroppedIds.size;
  excluded.sale_truth_dropped_by_earlier_check = [...truthHitIds].filter((i) => !truthDroppedIds.has(i) && !soldIds.has(i)).length;
  excluded.sale_truth_still_in_comps = [...truthHitIds].filter((i) => soldIds.has(i)).length;
  return {
    comps: sold.slice(0, limit),
    query: {
      make,
      model,
      year,
      limit,
      year_range: yearRange,
      subject_variant: subjectVariant,
      model_matching: "exact, substring, or model_spelling_key (punctuation/spacing/transmission words ignored); trim variants hard-blocked",
      ...(compsQueryError ? { comps_query_error: compsQueryError } : {}),
    },
    excluded,
    lookup: {
      ok: lookupOk,
      degraded: !lookupOk || lookupSource !== "get_comps_combined",
      attempts,
      source: lookupSource,
      error: lookupError,
      price_basis: lookupSource.startsWith("get_comps_combined") ? priceBasis : "legacy_mixed",
    },
  };
}

async function decodeVinNhtsa(vin: string): Promise<Record<string, string> | null> {
  if (vin.length < 11) return null;
  try {
    const nhtsaRes = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(vin)}?format=json`,
    );
    if (!nhtsaRes.ok) return null;
    const nhtsaData = await nhtsaRes.json();
    const raw = nhtsaData?.Results?.[0] ?? {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v && typeof v === "string" && v.trim() && v !== "Not Applicable") {
        out[k] = v.trim();
      }
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

async function handleFindAsset(
  deps: AdvisorDeps,
  args: Record<string, unknown>,
): Promise<AdvisorToolResult> {
  const bad = unsupportedAsset(args, "find_asset");
  if (bad) return bad;
  // One input: query OR vin (vin alone used to return Empty query).
  const queryStr = String(args.query || args.vin || "").trim();
  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 25);
  if (!queryStr) {
    return ok(makeEnvelope("find_asset", "vehicle", null, [], {
      results: [],
      count: 0,
      note: "Empty query — pass a VIN, listing URL, or year/make/model text",
    }));
  }

  const sb = deps.sb();
  const selectCols =
    "id, year, make, model, trim, vin, sale_price, mileage, primary_image_url, listing_url, bat_auction_url, nuke_estimate, location, auction_source, canonical_platform, updated_at, created_at";

  // Prefer indexed equality paths. Full-text on VIN/URL tokens times out on the live fleet.
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // VIN only for a 17-char VIN or a pre-1981 chassis-number pattern with no spaces; free text such as
  // "1972 Chevy C10" goes to text search (it used to decode to a 2012 KROSS KOUNTRY).
  const vinQuery = classifyVinQuery(queryStr);
  const looksUrl = /^https?:\/\//i.test(queryStr) || /bringatrailer\.com|carsandbids\.com|ebay\.com/i.test(queryStr);

  let data: Record<string, unknown>[] | null = null;
  let error: { message: string } | null = null;

  if (uuidRe.test(queryStr)) {
    const res = await sb.from("vehicles").select(selectCols).eq("id", queryStr).limit(1);
    data = res.data;
    error = res.error;
  } else if (vinQuery.kind !== "text") {
    const vin = vinQuery.vin;
    const res = await sb.from("vehicles").select(selectCols).eq("vin", vin).limit(limit);
    data = res.data;
    error = res.error;
  } else if (looksUrl) {
    const url = queryStr.trim().replace(/\/$/, "");
    // Exact matches first (no .or() with raw URLs — : / break PostgREST filters).
    const exacts = await Promise.all([
      sb.from("vehicles").select(selectCols).eq("listing_url", url).limit(limit),
      sb.from("vehicles").select(selectCols).eq("listing_url", url + "/").limit(limit),
      sb.from("vehicles").select(selectCols).eq("bat_auction_url", url).limit(limit),
      sb.from("vehicles").select(selectCols).eq("bat_auction_url", url + "/").limit(limit),
    ]);
    const seen = new Set<string>();
    const merged: Record<string, unknown>[] = [];
    for (const res of exacts) {
      if (res.error) error = res.error;
      for (const row of res.data || []) {
        const id = String(row.id);
        if (seen.has(id)) continue;
        seen.add(id);
        merged.push(row);
      }
    }
    if (merged.length) {
      data = merged.slice(0, limit);
    } else {
      // Prefer listing slug (BaT /listing/<slug>, C&B /auctions/<id>/...) so live URLs resolve
      // even when the stored host or trailing slash differs.
      const slug = listingSlugFromUrl(url);
      const path = url.replace(/^https?:\/\//i, "");
      const patterns = slug
        ? [`%/listing/${slug}%`, `%/auctions/${slug}%`, `%/${slug}%`]
        : [`%${path}%`];
      for (const pat of patterns) {
        if (merged.length >= limit) break;
        const [a, b] = await Promise.all([
          sb.from("vehicles").select(selectCols).ilike("listing_url", pat).limit(limit),
          sb.from("vehicles").select(selectCols).ilike("bat_auction_url", pat).limit(limit),
        ]);
        error = a.error || b.error || error;
        for (const row of [...(a.data || []), ...(b.data || [])]) {
          const id = String(row.id);
          if (seen.has(id)) continue;
          seen.add(id);
          merged.push(row);
          if (merged.length >= limit) break;
        }
      }
      data = merged;
    }
  } else {
    // Year + free text: do not assume token0 is make (e.g. "1974 Karmann Ghia").
    const yearMatch = queryStr.match(/\b(19|20)\d{2}\b/);
    const year = yearMatch ? Number(yearMatch[0]) : null;
    const rest = queryStr.replace(/\b(19|20)\d{2}\b/g, " ").trim();
    let query = sb.from("vehicles").select(selectCols).limit(limit);
    if (year) query = query.eq("year", year);
    if (rest) {
      // Common make nicknames, so "1972 Chevy C10" finds Chevrolet rows.
      const MAKE_ALIASES: Record<string, string> = { chevy: "chevrolet", vw: "volkswagen", merc: "mercedes", benz: "mercedes" };
      const parts = rest.split(/\s+/).filter(Boolean).map((p) => MAKE_ALIASES[p.toLowerCase()] ?? p);
      // Every token must match make OR model (AND across tokens).
      for (const p of parts) {
        query = query.or(`make.ilike.%${p}%,model.ilike.%${p}%`);
      }
    }
    const res = await query;
    data = res.data;
    error = res.error;
  }

  if (error) return err(error.message, "find_asset");

  let results = (data || []).map((v: Record<string, unknown>) => {
    const cit = listingCitation(v);
    const claims: Claim[] = [
      recordedClaim("year", v.year, { citations: [cit], confidence: 0.8, confidence_basis: "source_trust" }),
      recordedClaim("make", v.make, { citations: [cit], confidence: 0.8, confidence_basis: "source_trust" }),
      recordedClaim("model", v.model, { citations: [cit], confidence: 0.8, confidence_basis: "source_trust" }),
      recordedClaim("vin", v.vin, { citations: [cit], confidence: v.vin ? 0.9 : null, confidence_basis: v.vin ? "source_trust" : "none" }),
      recordedClaim("sale_price", v.sale_price, { citations: [cit], confidence: v.sale_price != null ? 0.75 : null, confidence_basis: "source_trust" }),
    ];
    return {
      asset_id: v.id,
      asset_type: "vehicle",
      label: [v.year, v.make, v.model].filter(Boolean).join(" "),
      listing_url: v.listing_url || v.bat_auction_url || null,
      primary_image_url: v.primary_image_url || null,
      claims,
    };
  });

  // VIN decode fallback when Nuke has no row for this VIN.
  let vin_decode: Record<string, unknown> | null = null;
  // NHTSA decodes 17-char VINs only; a short chassis number would decode to an unrelated vehicle.
  if (!results.length && vinQuery.kind === "vin17") {
    const vinCandidate = vinQuery.vin;
    const decoded = await decodeVinNhtsa(vinCandidate);
    if (decoded) {
      vin_decode = {
        vin: vinCandidate,
        year: decoded.ModelYear || null,
        make: decoded.Make || null,
        model: decoded.Model || null,
        trim: decoded.Trim || null,
        body_class: decoded.BodyClass || null,
        source: "nhtsa_vpic",
        check_digit_valid: vinQuery.check_digit_valid,
        ...(vinQuery.check_digit_valid ? {} : {
          note: "Check digit (position 9) does not validate. Normal for many non-North-American VINs; otherwise likely a typo.",
        }),
      };
      const cit = emptyCitation({
        source_name: "NHTSA VPIC",
        source_url: `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vinCandidate}?format=json`,
        observation_id: null,
        event_time: null,
        ingested_at: new Date().toISOString(),
        is_superseded: false,
      });
      results = [{
        asset_id: null,
        asset_type: "vehicle",
        label: [decoded.ModelYear, decoded.Make, decoded.Model].filter(Boolean).join(" "),
        listing_url: null,
        primary_image_url: null,
        claims: [
          recordedClaim("year", decoded.ModelYear || null, { citations: [cit], confidence: 0.7, confidence_basis: "source_trust" }),
          recordedClaim("make", decoded.Make || null, { citations: [cit], confidence: 0.7, confidence_basis: "source_trust" }),
          recordedClaim("model", decoded.Model || null, { citations: [cit], confidence: 0.7, confidence_basis: "source_trust" }),
          recordedClaim("vin", vinCandidate, { citations: [cit], confidence: 0.95, confidence_basis: "source_trust" }),
          notRecordedClaim("sale_price", { checked_sources: ["vehicles"] }),
        ],
      }];
    }
  }

  return ok(makeEnvelope("find_asset", "vehicle", null, [], {
    query: queryStr,
    query_kind: vinQuery.kind === "text" ? (looksUrl ? "url" : uuidRe.test(queryStr) ? "asset_id" : "text") : vinQuery.kind,
    count: results.length,
    results,
    vin_decode,
    note: AGENT_CITATION_RULES,
  }));
}

async function handleFindListings(
  deps: AdvisorDeps,
  args: Record<string, unknown>,
): Promise<AdvisorToolResult> {
  const bad = unsupportedAsset(args, "find_listings");
  if (bad) return bad;

  const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);
  const page = Math.max(Number(args.page) || 1, 1);
  const offset = (page - 1) * limit;
  const includeStale = Boolean(args.include_stale);
  const staleAfterDays = Math.min(Math.max(Number(args.stale_after_days) || STALE_DEFAULT_DAYS, 7), 365);
  const sb = deps.sb();

  // Over-fetch slightly so stale filtering still fills a page.
  const fetchLimit = includeStale ? limit : Math.min(limit * 3, 100);
  const selectCols =
    "id, year, make, model, trim, vin, asking_price, sale_price, mileage, primary_image_url, " +
    "listing_url, bat_auction_url, location, city, state, auction_source, canonical_platform, " +
    "listing_source, is_for_sale, sale_status, auction_end_date, listing_updated_at, listing_posted_at, " +
    "updated_at, created_at, transmission, body_style";

  // Active asks + live auctions. Prefer is_for_sale; also include auction_live
  // (may carry high_bid rather than asking_price).
  let query = sb
    .from("vehicles")
    .select(selectCols)
    .is("deleted_at", null)
    .or("is_for_sale.eq.true,sale_status.eq.auction_live")
    .order("listing_updated_at", { ascending: false, nullsFirst: false })
    .range(offset, offset + fetchLimit - 1);

  if (args.price_min != null) {
    const min = Number(args.price_min);
    query = query.or(`asking_price.gte.${min},sale_price.gte.${min}`);
  }
  if (args.price_max != null) {
    const max = Number(args.price_max);
    query = query.or(`asking_price.lte.${max},sale_price.lte.${max}`);
  }
  if (args.make) query = query.ilike("make", `%${String(args.make)}%`);
  if (args.model) query = query.ilike("model", `%${String(args.model)}%`);
  if (args.year_from != null) query = query.gte("year", Number(args.year_from));
  if (args.year_to != null) query = query.lte("year", Number(args.year_to));
  if (args.location) {
    const loc = String(args.location);
    query = query.or(`city.ilike.%${loc}%,state.ilike.%${loc}%,location.ilike.%${loc}%`);
  }
  if (args.source) {
    const src = String(args.source);
    query = query.or(
      `canonical_platform.ilike.%${src}%,auction_source.ilike.%${src}%,listing_source.ilike.%${src}%`,
    );
  }
  if (args.ends_before) {
    // auction_end_date is text on vehicles; lexicographic ISO prefix still works for YYYY-MM-DD…
    query = query.lt("auction_end_date", String(args.ends_before));
  }
  if (args.query) {
    const q = String(args.query).trim();
    const yearMatch = q.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) query = query.eq("year", Number(yearMatch[0]));
    const rest = q.replace(/\b(19|20)\d{2}\b/g, " ").trim();
    for (const p of rest.split(/\s+/).filter(Boolean)) {
      query = query.or(`make.ilike.%${p}%,model.ilike.%${p}%`);
    }
  }

  const { data, error } = await query;
  if (error) return err(error.message, "find_listings");

  const rows = (data || []) as Record<string, unknown>[];
  const facts = await loadPriceFactsMap(sb, rows.map((r) => String(r.id)));
  const claims: Claim[] = [];
  const listings: Array<Record<string, unknown>> = [];
  let staleSkipped = 0;

  for (const v of rows) {
    if (listings.length >= limit) break;
    const id = String(v.id);
    const fact = facts.get(id);
    const verified = lastVerifiedAt(v);
    // vehicle_price_facts.price_live is only true for sale_status=auction_live — not a
    // general ask freshness signal. Ask staleness is listing-clock based.
    const stale = isStaleVerified(verified, staleAfterDays);
    const auctionLive = fact?.price_live === true || String(v.sale_status || "") === "auction_live";
    // Prefer price_kind=ask; if facts say sold, this is not a live listing.
    if (fact?.price_kind === "sold" || fact?.sold_basis) {
      staleSkipped++;
      continue;
    }
    if (stale && !includeStale) {
      staleSkipped++;
      continue;
    }

    const askAmount = fact?.ask_amount != null
      ? Number(fact.ask_amount)
      : v.asking_price != null
      ? Number(v.asking_price)
      : null;
    const bidAmount = fact?.bid_amount != null ? Number(fact.bid_amount) : null;
    const displayAmount = askAmount ?? bidAmount;
    if (displayAmount == null || !(displayAmount > 0)) continue;
    const priceKind = askAmount != null ? "ask" : "bid";
    const cit = emptyCitation({
      source_name: (v.canonical_platform || v.auction_source || v.listing_source || "listing") as string,
      source_url: (v.listing_url || v.bat_auction_url || fact?.source_url || null) as string | null,
      observation_id: null,
      event_time: (fact?.ask_as_of as string) || verified,
      ingested_at: (v.updated_at as string) || null,
      is_superseded: false,
    });
    claims.push(
      recordedClaim(
        `listing.${id}.${priceKind === "ask" ? "asking_price" : "high_bid"}`,
        displayAmount,
        {
          confidence: stale ? 0.35 : 0.75,
          confidence_basis: "source_trust",
          citations: [cit],
          note: stale
            ? "STALE ask — last_verified_at older than threshold; not a confirmed current offer"
            : priceKind === "ask"
            ? "Asking price (not a sale)"
            : "Live auction high bid (not a sale)",
        },
      ),
    );
    listings.push({
      asset_id: id,
      asset_type: "vehicle",
      label: [v.year, v.make, v.model].filter(Boolean).join(" "),
      price_kind: priceKind,
      asking_price: askAmount,
      high_bid: bidAmount,
      sale_price: null,
      live: auctionLive || (!stale && displayAmount > 0),
      auction_live: auctionLive,
      staleness: stale ? "stale" : verified ? "fresh" : "unknown",
      last_verified_at: verified,
      // Retained CL capture URLs of the form craigslist.org/view/d/… routinely 404 on
      // the public site; listing-clock freshness is not an HTTP HEAD check.
      url_suspect: /craigslist\.org\/view\/d\//i.test(
        String(v.listing_url || v.bat_auction_url || ""),
      ),
      ends_at: v.auction_end_date || null,
      location: v.city || v.state || v.location || null,
      source: v.canonical_platform || v.auction_source || v.listing_source || null,
      listing_url: v.listing_url || v.bat_auction_url || null,
      primary_image_url: v.primary_image_url || null,
      transmission: v.transmission || null,
      mileage: v.mileage || null,
      citation: cit,
    });
  }

  if (!listings.length) {
    claims.push(
      notRecordedClaim("active_listings", {
        checked_sources: ["vehicles.is_for_sale", "vehicle_price_facts"],
        note: includeStale
          ? "No for-sale asks matched these filters."
          : "No fresh for-sale asks matched; retry with include_stale=true or widen filters.",
      }),
    );
  }

  return ok(
    makeEnvelope("find_listings", "vehicle", null, claims, {
      listings,
      count: listings.length,
      page,
      limit,
      stale_skipped: staleSkipped,
      filters: {
        status: "active",
        price_min: args.price_min ?? null,
        price_max: args.price_max ?? null,
        location: args.location ?? null,
        ends_before: args.ends_before ?? null,
        source: args.source ?? null,
        include_stale: includeStale,
        stale_after_days: staleAfterDays,
        query: args.query ?? null,
      },
      note:
        "Results are asking prices only (price_kind=ask). Stale rows are excluded by default. " +
        "A listing_url that 404s on the source is still retained evidence — liveness is last_verified_at / price_live.",
    }),
  );
}

async function handleGetAsset(
  deps: AdvisorDeps,
  args: Record<string, unknown>,
): Promise<AdvisorToolResult> {
  const bad = unsupportedAsset(args, "get_asset");
  if (bad) return bad;
  const vid = String(args.asset_id || "");
  if (!vid) return err("asset_id is required", "get_asset");

  const sb = deps.sb();
  const { data: vehicle, error } = await sb
    .from("vehicles")
    .select(
      "id, vin, year, make, model, trim, series, body_style, engine_type, engine_displacement, " +
        "transmission, drivetrain, color, interior_color, mileage, " +
        "canonical_platform, status, " +
        "nuke_estimate, nuke_estimate_confidence, " +
        "primary_image_url, image_count, observation_count, " +
        "description, location, city, state, country, " +
        "listing_url, bat_auction_url, created_at, updated_at",
    )
    .eq("id", vid)
    .single();
  if (error) return err(error.message, "get_asset");
  if (!vehicle) return err("Asset not found", "get_asset");

  const [price, obsRes] = await Promise.all([
    priceFacts(sb, vid),
    sb
      .from("vehicle_observations")
      .select("id, kind, structured_data, confidence_score, observed_at, source_url, source_id, is_superseded, ingested_at")
      .eq("vehicle_id", vid)
      .eq("is_superseded", false)
      .order("ingested_at", { ascending: false })
      .limit(20),
  ]);

  const obs = obsRes.data || [];
  const sourceMap = await loadSources(sb, obs.map((o: { source_id: string }) => o.source_id));
  type EnrichedObs = Record<string, unknown> & {
    source_name: string | null;
    source_trust: number | null;
    structured_data: Record<string, unknown> | null;
  };
  const enriched: EnrichedObs[] = obs.map((o: Record<string, unknown>) => {
    const src = sourceMap.get(o.source_id as string);
    return {
      ...o,
      source_name: src?.display_name ?? null,
      source_trust: src?.base_trust_score ?? null,
      structured_data: (o.structured_data || null) as Record<string, unknown> | null,
    };
  });

  const listingCit = listingCitation(vehicle as Record<string, unknown>);
  const claims: Claim[] = [];

  const row = vehicle as Record<string, unknown>;
  const colorVal = row.color;
  for (const field of IDENTITY_FIELDS) {
    const value = field === "exterior_color" ? colorVal : row[field];
    const matchingObs = enriched.filter((o: EnrichedObs) => {
      const sd = o.structured_data;
      if (!sd) return false;
      return fieldKeys(field).some((k) => sd[k] != null && sd[k] !== "");
    });
    const citations: Citation[] = matchingObs.length
      ? matchingObs.slice(0, 3).map((o: EnrichedObs) => citationFromObservation(o))
      : value != null && value !== ""
      ? [listingCit]
      : [];
    const best = matchingObs[0];
    const conf = best
      ? resolveClaimConfidence(best.confidence_score as number | null, best.source_trust as number | null)
      : value != null && value !== ""
      ? { confidence: 0.7, confidence_basis: "source_trust" as const }
      : { confidence: null, confidence_basis: "none" as const };

    claims.push(
      recordedClaim(field, value, {
        ...conf,
        citations,
        note: matchingObs.length
          ? undefined
          : value != null && value !== ""
          ? "Value from vehicle record; no matching observation structured_data key found."
          : undefined,
      }),
    );
  }

  // Price / sale as first-class claims with event_time from price facts or events
  if (price?.sold) {
    claims.push(
      recordedClaim("sale_price", price.sold.amount, {
        confidence: 0.95,
        confidence_basis: "claim_score",
        citations: [
          emptyCitation({
            source_name: listingCit.source_name,
            source_url: price.source_url || listingCit.source_url,
            observation_id: null,
            event_time: price.sold.on ? String(price.sold.on) : null,
            ingested_at: null,
            is_superseded: false,
          }),
        ],
        note: `Sale basis: ${price.sold.basis}; amount from ${price.sold.from}`,
      }),
    );
  } else {
    claims.push(
      notRecordedClaim("sale_price", {
        checked_sources: ["vehicle_price_facts", listingCit.source_name || "listing"].filter(Boolean) as string[],
      }),
    );
  }

  if (price?.estimate) {
    const conf = resolveClaimConfidence(price.estimate.confidence, null);
    claims.push(
      recordedClaim("nuke_estimate", price.estimate.amount, {
        confidence: conf.confidence != null ? Math.min(conf.confidence, 0.6) : null,
        confidence_basis: conf.confidence != null ? "estimate_model" : "none",
        citations: [
          emptyCitation({
            source_name: "Nuke Estimate",
            source_url: price.source_url || listingCit.source_url,
            observation_id: null,
            event_time: price.estimate.as_of ? String(price.estimate.as_of) : null,
            ingested_at: price.estimate.as_of ? String(price.estimate.as_of) : null,
            is_superseded: false,
          }),
        ],
      }),
    );
  } else {
    claims.push(notRecordedClaim("nuke_estimate", { checked_sources: ["vehicle_price_facts", "nuke_estimates"] }));
  }

  // History + coverage folded in (no separate tools on this surface).
  const [{ data: events }, { count: eventCount }, { count: imageCount }] = await Promise.all([
    sb
      .from("vehicle_events")
      .select(
        "id, event_type, event_status, sold_at, ended_at, started_at, final_price, current_price, starting_price, source_platform, source_url, created_at",
      )
      .eq("vehicle_id", vid)
      .order("sold_at", { ascending: false, nullsFirst: false })
      .limit(25),
    sb.from("vehicle_events").select("id", { count: "exact", head: true }).eq("vehicle_id", vid),
    sb.from("vehicle_images").select("id", { count: "exact", head: true }).eq("vehicle_id", vid),
  ]);

  const history = (events || []).map((e: Record<string, unknown>) => ({
    event_type: e.event_type ?? null,
    event_status: e.event_status ?? null,
    event_date: e.sold_at || e.ended_at || e.started_at || null,
    sale_price: e.final_price ?? null,
    high_bid: e.current_price ?? null,
    asking_price: e.starting_price ?? null,
    source_name: e.source_platform ?? null,
    source_url: e.source_url ?? null,
    venue: e.source_platform ?? null,
  }));

  const recordedFields = IDENTITY_FIELDS.filter((f) => {
    const v = f === "exterior_color" ? row.color : row[f];
    return v != null && v !== "";
  });
  const missingFields = IDENTITY_FIELDS.filter((f) => !recordedFields.includes(f));

  return ok(
    makeEnvelope("get_asset", "vehicle", vid, claims, {
      status: row.status ?? null,
      location: {
        location: row.location ?? null,
        city: row.city ?? null,
        state: row.state ?? null,
        country: row.country ?? null,
      },
      links: {
        listing_url: row.listing_url ?? null,
        bat_auction_url: row.bat_auction_url ?? null,
        primary_image_url: row.primary_image_url ?? null,
        profile_url: `https://nuke.ag/vehicle/${vid}`,
      },
      price,
      history,
      coverage: {
        recorded_fields: recordedFields,
        missing_fields: missingFields,
        observation_count: row.observation_count ?? enriched.length,
        event_count: eventCount ?? history.length,
        image_count: imageCount ?? row.image_count ?? null,
      },
      observation_count: row.observation_count ?? enriched.length,
      image_count: imageCount ?? row.image_count ?? null,
    }),
  );
}

async function handleGetHistory(
  deps: AdvisorDeps,
  args: Record<string, unknown>,
): Promise<AdvisorToolResult> {
  const bad = unsupportedAsset(args, "get_history");
  if (bad) return bad;
  const vid = String(args.asset_id || "");
  if (!vid) return err("asset_id is required", "get_history");
  const limit = Math.min(Math.max(Number(args.limit) || 25, 1), 100);
  const sb = deps.sb();

  const [eventsRes, obsRes] = await Promise.all([
    sb
      .from("vehicle_events")
      .select(
        "id, source_platform, source_url, event_type, event_status, started_at, ended_at, sold_at, final_price, starting_price, bid_count, comment_count, view_count",
      )
      .eq("vehicle_id", vid)
      .order("ended_at", { ascending: false, nullsFirst: false })
      .limit(limit),
    sb
      .from("vehicle_observations")
      .select(
        "id, kind, content_text, structured_data, confidence_score, observed_at, source_url, source_id, is_superseded, ingested_at",
      )
      .eq("vehicle_id", vid)
      .order("ingested_at", { ascending: false })
      .limit(limit),
  ]);
  if (eventsRes.error) return err(eventsRes.error.message, "get_history");
  if (obsRes.error) return err(obsRes.error.message, "get_history");

  const events = eventsRes.data || [];
  const obs = obsRes.data || [];
  const sourceMap = await loadSources(sb, obs.map((o: { source_id: string }) => o.source_id));

  const claims: Claim[] = [];
  const timeline: Array<Record<string, unknown>> = [];

  for (const ev of events) {
    const eventTime = extractEventTime(null, [ev.sold_at, ev.ended_at, ev.started_at]);
    const platform = ev.source_platform === "bat" ? "Bring a Trailer" : ev.source_platform;
    const cit = emptyCitation({
      source_name: platform || null,
      source_url: ev.source_url,
      observation_id: null,
      event_time: eventTime,
      ingested_at: null,
      is_superseded: false,
    });
    const status = String(ev.event_status || "").toLowerCase();
    const etype = String(ev.event_type || "").toLowerCase();
    let priceRole: "hammer" | "ask" | "high_bid_unsold" | "unknown" = "unknown";
    if (status === "sold" || etype.includes("sale")) priceRole = "hammer";
    else if (status.includes("unsold") || status.includes("not_sold") || status === "bid_to") {
      priceRole = "high_bid_unsold";
    } else if (etype.includes("list") || status === "active" || status === "for_sale") {
      priceRole = "ask";
    }
    const label = `${ev.event_type || "event"}:${ev.event_status || "unknown"}`;
    claims.push(
      recordedClaim(`event.${ev.id}.final_price`, ev.final_price, {
        confidence: ev.final_price != null && priceRole === "hammer" ? 0.9 : ev.final_price != null ? 0.55 : null,
        confidence_basis: ev.final_price != null ? "claim_score" : "none",
        citations: [cit],
        note: `${label}; price_role=${priceRole}`,
      }),
    );
    timeline.push({
      kind: "market_event",
      id: ev.id,
      event_type: ev.event_type,
      event_status: ev.event_status,
      price_role: priceRole,
      final_price: ev.final_price,
      starting_price: ev.starting_price,
      bid_count: ev.bid_count,
      event_time: eventTime,
      ingested_at: null,
      source_url: ev.source_url,
      source_name: platform,
    });
  }

  let conditionOptionNoise = 0;
  for (const o of obs) {
    const src = sourceMap.get(o.source_id);
    const enriched = {
      ...o,
      source_name: src?.display_name ?? null,
      source_trust: src?.base_trust_score ?? null,
      structured_data: (o.structured_data || null) as Record<string, unknown> | null,
    };
    const cit = citationFromObservation(enriched);
    const conf = resolveClaimConfidence(o.confidence_score, src?.base_trust_score ?? null);
    const sd = enriched.structured_data || {};
    const summaryValue =
      o.content_text ||
      sd.sale_price ||
      sd.final_price ||
      sd.high_bid ||
      o.kind;
    // Collapse option-list noise labeled as "condition" (restate equipment, not condition).
    const kind = String(o.kind || "").toLowerCase();
    const text = String(o.content_text || "");
    if (
      kind === "condition" &&
      (text.split(/,|;|\n/).length > 8 || /option|equipment|package|included/i.test(text))
    ) {
      conditionOptionNoise++;
      continue;
    }
    claims.push(
      recordedClaim(`observation.${o.id}`, summaryValue, {
        ...conf,
        citations: [cit],
        note: `kind=${o.kind}; observed_at(scrape_or_declared)=${o.observed_at ?? "null"}`,
      }),
    );
    timeline.push({
      kind: "observation",
      id: o.id,
      observation_kind: o.kind,
      value_summary: summaryValue,
      confidence: conf.confidence,
      confidence_basis: conf.confidence_basis,
      event_time: cit.event_time,
      ingested_at: o.ingested_at,
      observed_at: o.observed_at,
      is_superseded: o.is_superseded,
      source_name: cit.source_name,
      source_url: cit.source_url,
    });
  }

  if (!events.length && !obs.length) {
    claims.push(
      notRecordedClaim("history", {
        checked_sources: ["vehicle_events", "vehicle_observations"],
        note: "No events or observations retained for this asset.",
      }),
    );
  }

  return ok(
    makeEnvelope("get_history", "vehicle", vid, claims, {
      timeline,
      event_count: events.length,
      observation_count: obs.length,
      condition_option_noise_omitted: conditionOptionNoise,
      clocks_note:
        "event_time is the real-world sale/auction clock when known. observed_at on observations is often scrape time; ingested_at is when Nuke stored the row. " +
        "price_role separates hammer / ask / high_bid_unsold — do not treat asks or unsolds as sales.",
    }),
  );
}

async function handleExplainField(
  deps: AdvisorDeps,
  args: Record<string, unknown>,
): Promise<AdvisorToolResult> {
  const bad = unsupportedAsset(args, "explain_field");
  if (bad) return bad;
  const vid = String(args.asset_id || "");
  const field = String(args.field || "").trim();
  if (!vid || !field) return err("asset_id and field are required", "explain_field");
  const sb = deps.sb();
  const keys = fieldKeys(field);

  // Only select columns that exist on vehicles (aliases like odometer are observation keys, not columns).
  const vehicleColumns = new Set([
    "id", "year", "make", "model", "trim", "vin", "mileage", "color", "interior_color",
    "body_style", "sale_price", "listing_url", "bat_auction_url", "canonical_platform",
    "updated_at", "created_at", "engine_type", "transmission", "drivetrain", "description",
  ]);
  const selectCols = [
    "id",
    ...[...vehicleColumns].filter((c) => c !== "id"),
  ].join(", ");

  const { data: vehicle, error: vErr } = await sb.from("vehicles").select(selectCols).eq("id", vid).maybeSingle();
  if (vErr) return err(vErr.message, "explain_field");
  if (!vehicle) return err("Asset not found", "explain_field");

  const { data: evidence } = await sb
    .from("vehicle_field_evidence")
    .select(
      "id, field_name, value_text, value_number, value_date, value_json, source_type, source_id, confidence_score, extracted_at, flagged_as_incorrect, metadata",
    )
    .eq("vehicle_id", vid)
    .eq("field_name", field)
    .eq("flagged_as_incorrect", false)
    .order("confidence_score", { ascending: false })
    .limit(20);

  const { data: obs } = await sb
    .from("vehicle_observations")
    .select(
      "id, kind, structured_data, confidence_score, observed_at, source_url, source_id, is_superseded, ingested_at",
    )
    .eq("vehicle_id", vid)
    .eq("is_superseded", false)
    .limit(50);

  const sourceMap = await loadSources(
    sb,
    (obs || []).map((o: { source_id: string }) => o.source_id),
  );

  const matchingObs = (obs || []).filter((o: { structured_data: Record<string, unknown> | null }) => {
    const sd = o.structured_data;
    if (!sd || typeof sd !== "object") return false;
    return keys.some((k) => sd[k] != null && sd[k] !== "");
  });

  let projected: unknown = null;
  const attrCandidates = [`vehicle.${field}`, field];
  for (const attr of attrCandidates) {
    const { data, error } = await sb.rpc("project_attribute", {
      p_subject_id: vid,
      p_attribute: attr,
    });
    if (!error && data != null) {
      projected = { attribute: attr, projection: data };
      break;
    }
  }

  const claims: Claim[] = [];
  const row = vehicle as Record<string, unknown>;
  let current: unknown = undefined;
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== "") {
      current = row[k];
      break;
    }
  }
  if (field === "exterior_color" && current === undefined) current = row.color;

  const listingCit = listingCitation(row);
  const checked = ["vehicles", "vehicle_observations", "vehicle_field_evidence", "project_attribute"];

  if (evidence && evidence.length) {
    for (const ev of evidence) {
      const value = ev.value_text ?? ev.value_number ?? ev.value_date ?? ev.value_json;
      const conf = resolveClaimConfidence(
        ev.confidence_score != null ? Number(ev.confidence_score) / 100 : null,
        null,
      );
      claims.push(
        recordedClaim(field, value, {
          ...conf,
          citations: [
            emptyCitation({
              source_name: ev.source_type || "field_evidence",
              source_url: (ev.metadata as { source_url?: string } | null)?.source_url ?? listingCit.source_url,
              observation_id: ev.source_id || ev.id,
              event_time: ev.value_date ? String(ev.value_date) : null,
              ingested_at: ev.extracted_at,
              is_superseded: false,
            }),
          ],
          note: "From vehicle_field_evidence",
        }),
      );
    }
  }

  for (const o of matchingObs.slice(0, 5)) {
    const src = sourceMap.get(o.source_id);
    const enriched = {
      ...o,
      source_name: src?.display_name ?? null,
      source_trust: src?.base_trust_score ?? null,
      structured_data: o.structured_data,
    };
    const sd = o.structured_data || {};
    let value: unknown = null;
    for (const k of keys) {
      if (sd[k] != null && sd[k] !== "") {
        value = sd[k];
        break;
      }
    }
    const conf = resolveClaimConfidence(o.confidence_score, src?.base_trust_score ?? null);
    claims.push(
      recordedClaim(field, value, {
        ...conf,
        citations: [citationFromObservation(enriched)],
        note: `From observation kind=${o.kind}`,
      }),
    );
  }

  if (projected) {
    const p = projected as { attribute: string; projection: Record<string, unknown> };
    const consensus = p.projection?.consensus ?? p.projection;
    claims.push(
      recordedClaim(field, consensus, {
        confidence:
          typeof (consensus as { weighted_confidence?: number })?.weighted_confidence === "number"
            ? (consensus as { weighted_confidence: number }).weighted_confidence
            : null,
        confidence_basis: "consensus",
        citations: [
          emptyCitation({
            source_name: "project_attribute",
            source_url: null,
            observation_id: null,
            event_time: null,
            ingested_at: null,
            is_superseded: false,
          }),
        ],
        note: `Canonical projection for ${p.attribute}`,
      }),
    );
  }

  if (!claims.length) {
    if (current !== undefined) {
      claims.push(
        recordedClaim(field, current, {
          confidence: 0.6,
          confidence_basis: "source_trust",
          citations: [listingCit],
          note: "Denormalized vehicle column only; no observation or field_evidence rows matched.",
        }),
      );
    } else {
      claims.push(notRecordedClaim(field, { checked_sources: checked, citations: [listingCit] }));
    }
  }

  return ok(
    makeEnvelope("explain_field", "vehicle", vid, claims, {
      field,
      current_vehicle_value: current ?? null,
      evidence_count: evidence?.length ?? 0,
      observation_matches: matchingObs.length,
      projection: projected,
      checked_sources: checked,
    }),
  );
}

async function handleValueAsset(
  deps: AdvisorDeps,
  args: Record<string, unknown>,
): Promise<AdvisorToolResult> {
  const bad = unsupportedAsset(args, "value_asset");
  if (bad) return bad;
  const vid = String(args.asset_id || "");
  if (!vid) return err("asset_id is required", "value_asset");
  const sb = deps.sb();

  const { data: vehicle } = await sb
    .from("vehicles")
    .select(
      "id, year, make, model, mileage, nuke_estimate, nuke_estimate_confidence, listing_url, bat_auction_url, canonical_platform, updated_at, created_at",
    )
    .eq("id", vid)
    .maybeSingle();
  if (!vehicle) return err("Asset not found", "value_asset");

  const { data: estimates } = await sb
    .from("nuke_estimates")
    .select(
      "estimated_value, value_low, value_high, confidence_score, deal_score, heat_score, price_tier, calculated_at, methodology",
    )
    .eq("vehicle_id", vid)
    .order("calculated_at", { ascending: false })
    .limit(1);

  const est = estimates?.[0] ?? null;
  const price = await priceFacts(sb, vid);
  const { comps, excluded, lookup: compsLookup } = await resolveSoldComps(deps, {
    asset_id: vid,
    make: vehicle.make as string,
    model: vehicle.model as string,
    year: vehicle.year as number,
    limit: 15,
  });

  const allIn = await allInCosts(sb, [vid, ...comps.map((c) => String(c.asset_id))]);
  const soldPrices = comps
    .map((c) => c.sale_price)
    .filter((n): n is number => typeof n === "number" && n > 0)
    .sort((a, b) => a - b);
  const med = median(soldPrices);
  const p25 = percentile(soldPrices, 0.25);
  const p75 = percentile(soldPrices, 0.75);
  const maxComp = soldPrices.length ? soldPrices[soldPrices.length - 1]! : null;

  const storedEstimate = est?.estimated_value ?? price?.estimate?.amount ?? null;
  const storedLow = est?.value_low ?? null;
  const storedHigh = est?.value_high ?? null;

  // Resist a single high comp setting the estimate: if stored point equals max comp
  // (or sits above p75 while median is much lower), prefer median ± IQR band.
  let valuePoint: number | null = storedEstimate != null ? Number(storedEstimate) : null;
  let valueLow: number | null = storedLow != null ? Number(storedLow) : null;
  let valueHigh: number | null = storedHigh != null ? Number(storedHigh) : null;
  let estimateSource = "nuke_estimates";
  const flags: string[] = [];

  // Same-asset sale within 90 days dominates cohort medians.
  if (price?.sold?.amount != null && price.sold.on) {
    const days = Math.round((Date.now() - Date.parse(String(price.sold.on))) / 86_400_000);
    if (days >= 0 && days <= 90) {
      const saleAmt = Number(price.sold.amount);
      valuePoint = saleAmt;
      valueLow = Math.round(saleAmt * 0.92);
      valueHigh = Math.round(saleAmt * 1.08);
      estimateSource = "recent_same_asset_sale";
      flags.push("recent_same_asset_sale_dominates");
    }
  }

  // Thresholds fitted by a time-ordered backtest over 353,316 sold events (docs: backtest 2026-10-22):
  // error flattens from 4 comps (3->4 saves 1.1pt median APE, later comps <0.5pt each); estimates are
  // >=1pt worse from 180 days; once a stored estimate is >10% off the fresh comp median the comps win.
  const MIN_COMPS = VALUATION_THRESHOLDS.minComps;
  const STALE_DAYS = VALUATION_THRESHOLDS.staleDays;
  // A stale stored estimate, or one outside the confirmed-comps range, never wins over the comps.
  const storedCalcAt = est?.calculated_at ?? price?.estimate?.as_of ?? null;
  const storedStale = valuePoint != null && (storedCalcAt == null || isStaleVerified(storedCalcAt, STALE_DAYS));
  const minComp = soldPrices.length ? soldPrices[0]! : null;
  const storedOutside = valuePoint != null && soldPrices.length >= MIN_COMPS && minComp != null && maxComp != null &&
    (valuePoint < minComp || valuePoint > maxComp);
  const storedDisagrees = valuePoint != null && med != null && soldPrices.length >= MIN_COMPS &&
    (storedOutside || Math.abs(valuePoint - med) / med > VALUATION_THRESHOLDS.disagreement);
  const storedValue = valuePoint;
  let noEstimateReason: string | null = null;

  if (estimateSource !== "recent_same_asset_sale") {
    if (med != null && soldPrices.length >= MIN_COMPS) {
      const equalsMax = maxComp != null && valuePoint != null && Math.abs(valuePoint - maxComp) < 1;
      const aboveBand = valuePoint != null && p75 != null && valuePoint > p75 * 1.15;
      if (valuePoint == null || storedStale || storedOutside || storedDisagrees || equalsMax || aboveBand) {
        valuePoint = med;
        valueLow = p25 ?? med;
        valueHigh = p75 ?? med;
        estimateSource = "sold_comps_median";
        if (storedValue == null) flags.push("no_stored_estimate_used_comps");
        if (storedStale) flags.push("stored_estimate_stale_replaced_by_comps");
        if (storedOutside) flags.push("stored_estimate_outside_comp_range");
        if (storedDisagrees) flags.push("stored_estimate_replaced_by_comps_disagreement");
        if (equalsMax) flags.push("stored_estimate_matched_max_comp");
        if (aboveBand) flags.push("stored_estimate_above_comp_band");
        flags.push("used_median_of_confirmed_sales");
      } else if (valueLow == null || valueHigh == null) {
        valueLow = valueLow ?? p25 ?? med;
        valueHigh = valueHigh ?? p75 ?? med;
        flags.push("filled_range_from_sold_comps");
      }
    } else if (valuePoint == null || storedStale) {
      // Fewer than MIN_COMPS confirmed comps and no fresh stored estimate: say so instead of guessing.
      noEstimateReason = valuePoint == null
        ? `only ${soldPrices.length} confirmed sold comp(s) (need ${MIN_COMPS}) and no stored estimate`
        : `stored estimate is stale (older than ${STALE_DAYS} days) and only ${soldPrices.length} confirmed sold comp(s) (need ${MIN_COMPS})`;
      valuePoint = null;
      valueLow = null;
      valueHigh = null;
      estimateSource = "none";
      flags.push("no_estimate_insufficient_evidence");
    }
  }
  if (storedDisagrees) flags.push("stored_estimate_disagrees_with_comps");

  // A failed comps lookup is not "no comparable sales": never estimate from an empty or partial comp set.
  if (!compsLookup.ok && estimateSource !== "recent_same_asset_sale") {
    valuePoint = null;
    valueLow = null;
    valueHigh = null;
    estimateSource = "comps_lookup_failed";
    noEstimateReason = `comps lookup failed after ${compsLookup.attempts} attempt(s): ${compsLookup.error ?? compsLookup.source}; retry later`;
    flags.length = 0;
    flags.push("comps_lookup_failed");
  }

  // Backtest-fitted adjustments (advisor/adjust.ts): time index, channel, mileage, recency, own prior sale.
  // All inputs on hammer basis, matching the fit (see hammerBasis).
  let adjusted: AdjResult | null = null;
  let hammerConversions = 0;
  if (compsLookup.ok && (estimateSource !== "nuke_estimates" || storedStale)) {
    let index: IndexSeries = [];
    try {
      const { data: ix } = await sb.from("advisor_make_price_index").select("month, idx")
        .eq("make", String(vehicle.make || "").toLowerCase()).order("month", { ascending: true }).limit(1000);
      index = (ix ?? []).map((r: Record<string, unknown>) => ({ month: String(r.month), idx: Number(r.idx) }));
    } catch { index = []; }
    const ownHammer = price?.sold?.amount != null ? hammerBasis(Number(price.sold.amount), allIn.get(vid)) : null;
    if (ownHammer?.converted) hammerConversions++;
    const ownSale = ownHammer && price?.sold?.on
      ? { amount: ownHammer.amount, on: String(price.sold.on), platform: price.source_url ?? vehicle.canonical_platform }
      : null;
    const compsHammer = comps.map((c) => {
      const h = hammerBasis(Number(c.sale_price), allIn.get(String(c.asset_id)));
      if (h.converted) hammerConversions++;
      return h.amount;
    });
    adjusted = adjustedEstimate({
      comps: comps.map((c, i) => ({ sale_price: compsHammer[i]!, sold_date: c.sold_date ? String(c.sold_date) : null, platform: c.platform ?? c.listing_url, mileage: c.mileage })),
      minComps: MIN_COMPS,
      index,
      asOf: new Date().toISOString(),
      subjectPlatform: vehicle.canonical_platform || "bat",
      subjectMileage: typeof vehicle.mileage === "number" ? vehicle.mileage as number : null,
      ownSale,
    });
    if (adjusted) {
      valuePoint = adjusted.estimate;
      valueLow = adjusted.low;
      valueHigh = adjusted.high;
      estimateSource = adjusted.comps_estimate != null ? "adjusted_comps" : "adjusted_own_sale";
      noEstimateReason = null;
      for (const stale of ["used_median_of_confirmed_sales", "no_estimate_insufficient_evidence"]) {
        const i = flags.indexOf(stale);
        if (i >= 0) flags.splice(i, 1);
      }
      flags.push(adjusted.own_sale_estimate != null ? "blended_own_prior_sale_time_adjusted" : "comps_time_channel_mileage_adjusted");
    }
  }

  const guard = recentSaleSanityGuard({
    estimate: valuePoint,
    saleAmount: price?.sold?.amount != null ? Number(price.sold.amount) : null,
    saleOn: price?.sold?.on ? String(price.sold.on) : null,
  });
  if (guard.triggered && price?.sold?.amount != null) {
    const saleAmt = Number(price.sold.amount);
    flags.push("valuation_over_3x_off_recent_sale");
    valuePoint = saleAmt;
    valueLow = Math.round(saleAmt * 0.92);
    valueHigh = Math.round(saleAmt * 1.08);
    estimateSource = "recent_same_asset_sale";
  }

  const calculatedAt = est?.calculated_at ?? price?.estimate?.as_of ?? price?.sold?.on ?? null;
  const estimateStale = estimateSource === "nuke_estimates" &&
    (isStaleVerified(calculatedAt, STALE_DAYS) || soldPrices.length < MIN_COMPS);
  if (estimateStale) flags.push(soldPrices.length < MIN_COMPS ? "thin_comp_set" : "estimate_older_than_180d");

  // Confidence = backtested P(actual sale within 20% of estimate), by comp count and IQR/median spread.
  const CONFIDENCE_CAP = calibratedConfidence(soldPrices.length, med != null && p25 != null && p75 != null && med > 0 ? (p75 - p25) / med : null);
  const claims: Claim[] = [];
  const sourceUrl = price?.source_url ||
    (vehicle.listing_url as string) ||
    (vehicle.bat_auction_url as string) ||
    null;
  const cit = emptyCitation({
    source_name: estimateSource === "recent_same_asset_sale"
      ? "Same-asset sale"
      : estimateSource === "sold_comps_median" || estimateSource.startsWith("adjusted_")
      ? "Confirmed sold comps"
      : "Nuke Estimate",
    source_url: sourceUrl,
    observation_id: null,
    event_time: price?.sold?.on ? String(price.sold.on) : null,
    ingested_at: calculatedAt,
    is_superseded: false,
  });

  if (valuePoint != null) {
    const conf = resolveClaimConfidence(
      est?.confidence_score ?? price?.estimate?.confidence ?? (soldPrices.length >= 5 ? 70 : 45),
      null,
    );
    let confVal = estimateSource === "sold_comps_median" ? CONFIDENCE_CAP : Math.min(conf.confidence ?? 0.5, CONFIDENCE_CAP);
    if (estimateStale) confVal = Math.min(confVal, 0.36);
    if (storedDisagrees && estimateSource === "nuke_estimates") confVal = Math.min(confVal, 0.30);
    if (guard.triggered) confVal = Math.min(confVal, 0.25);
    if (estimateSource === "recent_same_asset_sale") confVal = 0.55;
    if (adjusted && (estimateSource === "adjusted_comps" || estimateSource === "adjusted_own_sale")) {
      confVal = estimateSource === "adjusted_own_sale" ? Math.min(adjusted.confidence, 0.55) : adjusted.confidence;
    }
    const confAdj = { confidence: confVal, confidence_basis: "estimate_model" as const };
    const noteParts = [...flags];
    if (guard.message) noteParts.push(guard.message);
    noteParts.push(`confidence = backtested share of sales within 20% (${soldPrices.length} comps)`);
    claims.push(
      recordedClaim("estimated_value", valuePoint, {
        ...confAdj,
        citations: [cit],
        note: noteParts.join("; ") || undefined,
      }),
    );
    claims.push(
      recordedClaim("value_low", valueLow, {
        ...confAdj,
        citations: [cit],
      }),
    );
    claims.push(
      recordedClaim("value_high", valueHigh, {
        ...confAdj,
        citations: [cit],
      }),
    );
  } else {
    claims.push(
      notRecordedClaim("estimated_value", {
        checked_sources: ["nuke_estimates", "vehicle_price_facts", "get_comps_combined"],
        ...(noEstimateReason ? { note: noEstimateReason } : {}),
      }),
    );
  }

  if (price?.sold) {
    claims.push(
      recordedClaim("last_sale_price", price.sold.amount, {
        confidence: 0.95,
        confidence_basis: "claim_score",
        citations: [
          emptyCitation({
            source_name: listingCitation(vehicle as Record<string, unknown>).source_name,
            source_url: price.source_url,
            observation_id: null,
            event_time: price.sold.on ? String(price.sold.on) : null,
            ingested_at: null,
            is_superseded: false,
          }),
        ],
        note: "Observed sale — not the model estimate",
      }),
    );
  }
  if (price?.ask) {
    claims.push(
      recordedClaim("asking_price", price.ask.amount, {
        confidence: 0.7,
        confidence_basis: "source_trust",
        citations: [listingCitation(vehicle as Record<string, unknown>)],
        note: "Ask — not a hammer price",
      }),
    );
  }

  return ok(
    makeEnvelope("value_asset", "vehicle", vid, claims, {
      value_low: valueLow,
      value_high: valueHigh,
      estimated_value: valuePoint,
      estimate_source: estimateSource,
      // adjusted_* estimates are hammer prices (buyer premium excluded); add the venue premium for all-in.
      price_basis: estimateSource.startsWith("adjusted_") ? "hammer" : "stored_sale_price",
      degraded: !compsLookup.ok || compsLookup.degraded,
      comps_lookup: compsLookup,
      estimate_stale: estimateStale,
      no_estimate_reason: noEstimateReason,
      stored_estimate: storedValue,
      stored_estimate_stale: storedStale,
      confidence: claims.find((c) => c.field === "estimated_value")?.confidence ?? null,
      flags,
      adjustments: adjusted
        ? { price_basis: "hammer", hammer_conversions: hammerConversions, comps_estimate: adjusted.comps_estimate, own_sale_estimate: adjusted.own_sale_estimate, spread: Number.isFinite(adjusted.spread) ? adjusted.spread : null, ...adjusted.steps, method: "bt4 backtest 2026-10-22: make index + channel + mileage + recency(1460d) + own sale" }
        : null,
      // Hammer vs all-in: the stored sale price can be hammer-only or include the buyer premium
      // depending on platform; all_in_cost carries the breakdown with cited fee terms.
      hammer: (allIn.get(vid)?.hammer as number | undefined) ?? null,
      all_in_cost: allIn.get(vid) ?? null,
      comps_used: comps.map((c) => ({
        asset_id: c.asset_id,
        sale_price: c.sale_price,
        all_in: allInSummary(allIn.get(String(c.asset_id))),
        sold_date: c.sold_date,
        platform: c.platform,
        listing_url: c.listing_url,
        year: c.year,
        make: c.make,
        model: c.model,
      })),
      comps_summary: {
        count: soldPrices.length,
        median: med,
        p25,
        p75,
        max: maxComp,
        excluded,
      },
      estimate: est,
      price,
      recent_sale_guard: guard.triggered
        ? { ratio: guard.ratio, days_since_sale: guard.days_since_sale, message: guard.message }
        : null,
      identity: {
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
      },
    }),
  );
}

async function handleGetComps(
  deps: AdvisorDeps,
  args: Record<string, unknown>,
): Promise<AdvisorToolResult> {
  const bad = unsupportedAsset(args, "get_comps");
  if (bad) return bad;
  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 25);

  if (!args.asset_id && !args.make && !args.vin) {
    return err("Provide asset_id, or make(+model), or vin", "get_comps");
  }

  const sb = deps.sb();
  let make = typeof args.make === "string" ? args.make : null;
  let model = typeof args.model === "string" ? args.model : null;
  let year = args.year != null ? Number(args.year) : null;
  let assetId = args.asset_id ? String(args.asset_id) : undefined;

  if (args.vin && !assetId) {
    const { data: vrow } = await sb
      .from("vehicles")
      .select("id, year, make, model")
      .eq("vin", String(args.vin).toUpperCase())
      .maybeSingle();
    if (vrow) {
      assetId = String(vrow.id);
      make = make || (vrow.make as string);
      model = model || (vrow.model as string);
      year = year ?? (vrow.year as number | null);
    }
  }

  const { comps, query, excluded, lookup } = await resolveSoldComps(deps, {
    asset_id: assetId,
    make,
    model,
    year,
    limit,
  });

  if (!make && !assetId) {
    return err("Could not resolve make for comps (provide asset_id or make)", "get_comps");
  }
  if (!lookup.ok) {
    // Never report an empty or partial comp set as valid when the lookup itself failed.
    return err(
      `Comps lookup failed after ${lookup.attempts} attempt(s) (${lookup.error ?? lookup.source}); this is not "no comparable sales" — retry later`,
      "get_comps",
    );
  }

  const claims: Claim[] = [];
  const allIn = await allInCosts(sb, comps.map((c) => String(c.asset_id)));
  const out = comps.map((c, i) => {
    claims.push(
      recordedClaim(`comp.${i}.sale_price`, c.sale_price, {
        confidence: c.sold_basis ? 0.9 : 0.7,
        confidence_basis: "claim_score",
        citations: [c.citation],
        note: [
          c.year,
          c.make,
          c.model,
          c.sold_date ? `sold ${c.sold_date}` : "sold_date not recorded",
          `price_kind=sold`,
        ]
          .filter(Boolean)
          .join(" · "),
      }),
    );
    return {
      asset_id: c.asset_id,
      year: c.year,
      make: c.make,
      model: c.model,
      trim: c.trim,
      sale_price: c.sale_price,
      hammer: (allIn.get(String(c.asset_id))?.hammer as number | undefined) ?? null,
      all_in_cost: allIn.get(String(c.asset_id)) ?? null,
      mileage: c.mileage,
      sold_date: c.sold_date,
      listing_url: c.listing_url,
      platform: c.platform,
      transmission: c.transmission,
      body_style: c.body_style,
      similarity_score: c.similarity_score,
      variant: c.variant,
      flags: c.flags,
      price_kind: "sold" as const,
      sold_basis: c.sold_basis,
      citation: c.citation,
    };
  });

  if (!out.length) {
    claims.push(
      notRecordedClaim("comps", {
        checked_sources: ["get_comps_combined", "vehicle_price_facts"],
        note: "No confirmed sold comps after excluding asks/bids/unbased vehicle_record prices.",
      }),
    );
  }

  return ok(
    makeEnvelope("get_comps", "vehicle", assetId ?? null, claims, {
      comps: out,
      count: out.length,
      query,
      excluded,
      degraded: lookup.degraded,
      comps_lookup: lookup,
      note:
        "sale_price is the stored price; hammer and all_in_cost show whether it includes the buyer premium and the all-in buyer cost (published fee schedule + cited transport/paperwork estimates). Only price_kind=sold with a sale basis. Asks, unsold high bids, parts suspects, and variant mismatches are excluded. URLs are canonicalized for dedupe.",
    }),
  );
}

async function handleGetCoverage(
  deps: AdvisorDeps,
  args: Record<string, unknown>,
): Promise<AdvisorToolResult> {
  const bad = unsupportedAsset(args, "get_coverage");
  if (bad) return bad;
  const vid = String(args.asset_id || "");
  if (!vid) return err("asset_id is required", "get_coverage");
  const sb = deps.sb();

  const { data: vehicle, error } = await sb
    .from("vehicles")
    .select(
      "id, vin, year, make, model, trim, body_style, color, interior_color, mileage, engine_type, transmission, drivetrain, description, sale_price, listing_url, bat_auction_url, image_count, observation_count, data_quality_score, nuke_estimate, canonical_platform, updated_at, created_at",
    )
    .eq("id", vid)
    .maybeSingle();
  if (error) return err(error.message, "get_coverage");
  if (!vehicle) return err("Asset not found", "get_coverage");

  const [eventsCount, obsCount, imgCount, sourcesRes, estimateRes] = await Promise.all([
    sb.from("vehicle_events").select("id", { count: "exact", head: true }).eq("vehicle_id", vid),
    sb.from("vehicle_observations").select("id", { count: "exact", head: true }).eq("vehicle_id", vid),
    sb.from("vehicle_images").select("id", { count: "exact", head: true }).eq("vehicle_id", vid),
    sb
      .from("vehicle_observations")
      .select("source_id")
      .eq("vehicle_id", vid)
      .eq("is_superseded", false)
      .limit(100),
    sb
      .from("nuke_estimates")
      .select(
        "estimated_value, value_low, value_high, confidence_score, confidence_interval_pct, signal_weights, deal_score, deal_score_label, heat_score, heat_score_label, model_version, input_count, calculated_at, is_stale",
      )
      .eq("vehicle_id", vid)
      .order("calculated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const sourceMap = await loadSources(
    sb,
    (sourcesRes.data || []).map((o: { source_id: string }) => o.source_id),
  );
  const sourceNames = [...new Set([...sourceMap.values()].map((s) => s.display_name).filter(Boolean))];

  const row = vehicle as Record<string, unknown>;
  const fields: Array<{ field: string; value: unknown }> = [
    { field: "year", value: row.year },
    { field: "make", value: row.make },
    { field: "model", value: row.model },
    { field: "vin", value: row.vin },
    { field: "mileage", value: row.mileage },
    { field: "exterior_color", value: row.color },
    { field: "interior_color", value: row.interior_color },
    { field: "body_style", value: row.body_style },
    { field: "engine_type", value: row.engine_type },
    { field: "transmission", value: row.transmission },
    { field: "drivetrain", value: row.drivetrain },
    { field: "description", value: row.description },
    { field: "sale_price", value: row.sale_price },
    { field: "nuke_estimate", value: row.nuke_estimate },
  ];

  const listingCit = listingCitation(row);
  const claims: Claim[] = fields.map(({ field, value }) =>
    recordedClaim(field, value, {
      confidence: value != null && value !== "" ? 0.7 : null,
      confidence_basis: value != null && value !== "" ? "source_trust" : "none",
      citations: value != null && value !== "" ? [listingCit] : [],
      ...(value == null || value === ""
        ? { note: undefined }
        : {}),
    }),
  );

  // Force not-recorded shape for empties (recordedClaim already does this)
  const recorded = claims.filter((c) => c.value !== "not recorded").length;
  const missing = claims.length - recorded;
  const estimate = estimateRes.error ? null : estimateRes.data ?? null;

  return ok(
    makeEnvelope("get_coverage", "vehicle", vid, claims, {
      summary: {
        fields_checked: claims.length,
        fields_recorded: recorded,
        fields_not_recorded: missing,
        coverage_ratio: claims.length ? recorded / claims.length : 0,
        event_count: eventsCount.count ?? 0,
        observation_count: obsCount.count ?? row.observation_count ?? 0,
        image_count: imgCount.count ?? row.image_count ?? 0,
        data_quality_score: row.data_quality_score ?? null,
        data_quality_score_note:
          "Profile-level completeness signal. Do not treat it as calibrated factual accuracy without the supporting evidence and score components.",
        sources: sourceNames,
      },
      estimate: estimate
        ? {
            estimated_value: estimate.estimated_value,
            value_low: estimate.value_low,
            value_high: estimate.value_high,
            confidence_score: estimate.confidence_score,
            confidence_interval_pct: estimate.confidence_interval_pct,
            signal_weights: estimate.signal_weights,
            deal_score: estimate.deal_score,
            deal_score_label: estimate.deal_score_label,
            heat_score: estimate.heat_score,
            heat_score_label: estimate.heat_score_label,
            model_version: estimate.model_version,
            input_count: estimate.input_count,
            calculated_at: estimate.calculated_at,
            is_stale: estimate.is_stale,
            interpretation:
              "Derived valuation output. Read signal_weights, input_count, model_version, calculated_at, and is_stale with the value; this is not an independently verified sale outcome.",
          }
        : {
            status: "not recorded",
            note: estimateRes.error
              ? "The valuation ledger could not be read for this asset."
              : "No valuation row is recorded for this asset.",
          },
      checked_sources: [
        "vehicles",
        "vehicle_events",
        "vehicle_observations",
        "vehicle_images",
        "nuke_estimates",
        ...sourceNames,
      ],
    }),
  );
}

async function handleBudgetOptions(deps: AdvisorDeps, args: Record<string, unknown>): Promise<AdvisorToolResult> {
  const budget = Number(args.budget_usd);
  if (!Number.isFinite(budget) || budget <= 0) return err("budget_usd must be a positive number", "budget_options");
  const limit = Math.min(Math.max(Number(args.limit) || 6, 1), 12);
  const sb = deps.sb();
  const { data: latest } = await sb.from("market_segment_stats").select("run_id").order("created_at", { ascending: false }).limit(1);
  const runId = latest?.[0]?.run_id;
  const { data: stats, error } = runId
    ? await sb.from("market_segment_stats").select("*").eq("run_id", runId).lte("median_price", budget)
    : { data: [], error: null };
  if (error) return err(`market_segment_stats: ${error.message}`, "budget_options");
  const { data: sig } = await sb.from("market_signal").select("label,as_of,gate_passed").order("created_at", { ascending: false }).limit(1);
  const options = rankBudgetOptions(budget, (stats ?? []) as SegmentStat[], limit);
  return ok(budgetEnvelope(budget, options, (sig?.[0] as MarketSignal | undefined) ?? null));
}
