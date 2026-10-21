// Read-only handlers for the Nuke Asset Advisor surface.
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
  return {
    find_asset: (args) => handleFindAsset(deps, args),
    find_listings: (args) => handleFindListings(deps, args),
    get_asset: (args) => handleGetAsset(deps, args),
    get_history: (args) => handleGetHistory(deps, args),
    explain_field: (args) => handleExplainField(deps, args),
    value_asset: (args) => handleValueAsset(deps, args),
    get_comps: (args) => handleGetComps(deps, args),
    get_coverage: (args) => handleGetCoverage(deps, args),
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
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  const unique = [...new Set(ids.filter(Boolean))];
  // vehicle_price_facts is cheap for small batches; chunk to avoid timeouts.
  for (let i = 0; i < unique.length; i += 40) {
    const chunk = unique.slice(i, i + 40);
    const { data } = await sb.rpc("vehicle_price_facts", { p_vehicle_ids: chunk });
    for (const row of data || []) {
      map.set(String(row.vehicle_id), row);
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
  citation: Citation;
};

async function resolveSoldComps(
  deps: AdvisorDeps,
  args: {
    asset_id?: string;
    make?: string | null;
    model?: string | null;
    year?: number | null;
    limit?: number;
  },
): Promise<{ comps: SoldComp[]; query: Record<string, unknown>; excluded: Record<string, number> }> {
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
      .select("id, year, make, model, trim, transmission, body_style, mileage, engine_type")
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
    return { comps: [], query: { make, model, year, limit }, excluded: { no_make: 1 } };
  }

  const yearRange = 2;
  const fetchLimit = Math.min(limit * 4, 60);
  const { data: rpcRows, error: rpcErr } = await sb.rpc("get_comps_combined", {
    p_make: make,
    p_model: model,
    p_year_min: year != null ? year - yearRange : null,
    p_year_max: year != null ? year + yearRange : null,
    p_min_price: null,
    p_max_price: null,
    p_exclude_vehicle_id: excludeId,
    p_limit: fetchLimit,
  });

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
      rows = Array.isArray(raw.data) ? raw.data as Record<string, unknown>[] : [];
    } catch {
      rows = [];
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

  // Optional subject attribute boosts (reader-side; does not invent missing transmission).
  const subTrans = subject?.transmission ? String(subject.transmission).toLowerCase() : null;
  const subBody = subject?.body_style ? String(subject.body_style).toLowerCase() : null;
  const subMiles = typeof subject?.mileage === "number" ? subject.mileage as number : null;

  const excluded: Record<string, number> = {
    not_sold: 0,
    ask_or_bid: 0,
    no_amount: 0,
    hd_diesel_mismatch: 0,
  };
  const sold: SoldComp[] = [];

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

    const modelText = `${c.model || ""} ${c.trim || ""}`.toLowerCase();
    if (subject?.model && /diesel|hd\b|2500|3500|dually/.test(modelText) &&
      !/diesel|hd\b|2500|3500|dually/.test(String(subject.model).toLowerCase())) {
      excluded.hd_diesel_mismatch++;
      continue;
    }

    const soldDate = fact?.sold_on
      ? String(fact.sold_on)
      : c.sold_date
      ? String(c.sold_date)
      : null;

    const cit = emptyCitation({
      source_name: (c.platform as string) || (fact?.platform as string) || null,
      source_url: (c.listing_url as string) || (fact?.source_url as string) || null,
      observation_id: null,
      event_time: soldDate,
      ingested_at: null,
      is_superseded: false,
    });

    let score = typeof c.similarity_score === "number" ? c.similarity_score : 0.5;
    // Soft reader boosts when subject attributes are recorded.
    if (subTrans && typeof c.transmission === "string" &&
      String(c.transmission).toLowerCase().includes(subTrans.slice(0, 4))) {
      score += 0.05;
    }
    if (subBody && typeof c.body_style === "string" &&
      String(c.body_style).toLowerCase() === subBody) {
      score += 0.05;
    }
    if (subMiles != null && typeof c.mileage === "number") {
      const ratio = Math.abs(c.mileage - subMiles) / Math.max(subMiles, 1);
      if (ratio <= 0.35) score += 0.05;
    }

    sold.push({
      asset_id: id,
      year: c.year,
      make: c.make,
      model: c.model,
      trim: c.trim ?? null,
      sale_price: amount,
      mileage: c.mileage,
      sold_date: soldDate,
      listing_url: (c.listing_url as string) || (fact?.source_url as string) || null,
      platform: (c.platform as string) || (fact?.platform as string) || null,
      transmission: c.transmission ?? null,
      body_style: c.body_style ?? null,
      similarity_score: score,
      price_kind: "sold",
      sold_basis: basis,
      citation: cit,
    });
  }

  sold.sort((a, b) => Number(b.similarity_score || 0) - Number(a.similarity_score || 0));
  return {
    comps: sold.slice(0, limit),
    query: { make, model, year, limit, year_range: yearRange },
    excluded,
  };
}

async function handleFindAsset(
  deps: AdvisorDeps,
  args: Record<string, unknown>,
): Promise<AdvisorToolResult> {
  const bad = unsupportedAsset(args, "find_asset");
  if (bad) return bad;
  const queryStr = String(args.query || "").trim();
  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 25);
  if (!queryStr) {
    return ok(makeEnvelope("find_asset", "vehicle", null, [], {
      results: [],
      count: 0,
      note: "Empty query",
    }));
  }

  const sb = deps.sb();
  const selectCols =
    "id, year, make, model, trim, vin, sale_price, mileage, primary_image_url, listing_url, bat_auction_url, nuke_estimate, location, auction_source, canonical_platform, updated_at, created_at";

  // Prefer indexed equality paths. Full-text on VIN/URL tokens times out on the live fleet.
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // Pre-1981 chassis numbers are often 8–11 chars (e.g. VW 1442612348); modern VINs are 17.
  const vinRe = /^[A-HJ-NPR-Z0-9]{8,17}$/i;
  const looksUrl = /^https?:\/\//i.test(queryStr) || /bringatrailer\.com|carsandbids\.com|ebay\.com/i.test(queryStr);

  let data: Record<string, unknown>[] | null = null;
  let error: { message: string } | null = null;

  if (uuidRe.test(queryStr)) {
    const res = await sb.from("vehicles").select(selectCols).eq("id", queryStr).limit(1);
    data = res.data;
    error = res.error;
  } else if (vinRe.test(queryStr.replace(/\s+/g, ""))) {
    const vin = queryStr.replace(/\s+/g, "").toUpperCase();
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
      const parts = rest.split(/\s+/).filter(Boolean);
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

  const results = (data || []).map((v: Record<string, unknown>) => {
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

  return ok(makeEnvelope("find_asset", "vehicle", null, [], {
    query: queryStr,
    count: results.length,
    results,
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
        confidence: conf.confidence,
        confidence_basis: conf.confidence != null ? "estimate_model" : "none",
        citations: [
          emptyCitation({
            source_name: "Nuke Estimate",
            source_url: null,
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
      observation_count: row.observation_count ?? enriched.length,
      image_count: row.image_count ?? null,
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
      "id, year, make, model, nuke_estimate, nuke_estimate_confidence, listing_url, bat_auction_url, canonical_platform, updated_at, created_at",
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
  const { comps, excluded } = await resolveSoldComps(deps, {
    asset_id: vid,
    make: vehicle.make as string,
    model: vehicle.model as string,
    year: vehicle.year as number,
    limit: 15,
  });

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

  if (med != null && soldPrices.length >= 3) {
    const equalsMax = maxComp != null && valuePoint != null && Math.abs(valuePoint - maxComp) < 1;
    const aboveBand = valuePoint != null && p75 != null && valuePoint > p75 * 1.15;
    if (valuePoint == null || equalsMax || aboveBand) {
      valuePoint = med;
      valueLow = p25 ?? med;
      valueHigh = p75 ?? med;
      estimateSource = "sold_comps_median";
      if (equalsMax) flags.push("stored_estimate_matched_max_comp");
      if (aboveBand) flags.push("stored_estimate_above_comp_band");
      flags.push("used_median_of_confirmed_sales");
    } else if (valueLow == null || valueHigh == null) {
      valueLow = valueLow ?? p25 ?? med;
      valueHigh = valueHigh ?? p75 ?? med;
      flags.push("filled_range_from_sold_comps");
    }
  } else if (valuePoint == null && med != null) {
    valuePoint = med;
    valueLow = p25 ?? med;
    valueHigh = p75 ?? med;
    estimateSource = "sold_comps_median";
    flags.push("no_stored_estimate_used_comps");
  }

  const calculatedAt = est?.calculated_at ?? price?.estimate?.as_of ?? null;
  const estimateStale = isStaleVerified(calculatedAt, 180) || soldPrices.length < 3;
  if (estimateStale) flags.push(soldPrices.length < 3 ? "thin_comp_set" : "estimate_older_than_180d");

  const claims: Claim[] = [];
  const cit = emptyCitation({
    source_name: estimateSource === "sold_comps_median" ? "Confirmed sold comps" : "Nuke Estimate",
    source_url: null,
    observation_id: null,
    event_time: null,
    ingested_at: calculatedAt,
    is_superseded: false,
  });

  if (valuePoint != null) {
    const conf = resolveClaimConfidence(
      est?.confidence_score ?? price?.estimate?.confidence ?? (soldPrices.length >= 5 ? 70 : 45),
      null,
    );
    const confAdj = estimateStale
      ? { confidence: Math.min(conf.confidence ?? 0.5, 0.45), confidence_basis: conf.confidence_basis }
      : conf;
    claims.push(
      recordedClaim("estimated_value", valuePoint, {
        ...confAdj,
        confidence_basis: "estimate_model",
        citations: [cit],
        note: flags.join("; ") || undefined,
      }),
    );
    claims.push(
      recordedClaim("value_low", valueLow, {
        ...confAdj,
        confidence_basis: "estimate_model",
        citations: [cit],
      }),
    );
    claims.push(
      recordedClaim("value_high", valueHigh, {
        ...confAdj,
        confidence_basis: "estimate_model",
        citations: [cit],
      }),
    );
  } else {
    claims.push(
      notRecordedClaim("estimated_value", {
        checked_sources: ["nuke_estimates", "vehicle_price_facts", "get_comps_combined"],
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
      estimate_stale: estimateStale,
      flags,
      comps_used: comps.map((c) => ({
        asset_id: c.asset_id,
        sale_price: c.sale_price,
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

  const { comps, query, excluded } = await resolveSoldComps(deps, {
    asset_id: assetId,
    make,
    model,
    year,
    limit,
  });

  if (!make && !assetId) {
    return err("Could not resolve make for comps (provide asset_id or make)", "get_comps");
  }

  const claims: Claim[] = [];
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
      mileage: c.mileage,
      sold_date: c.sold_date,
      listing_url: c.listing_url,
      platform: c.platform,
      transmission: c.transmission,
      body_style: c.body_style,
      similarity_score: c.similarity_score,
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
      note: "Only price_kind=sold with a sale basis. Asks and unsold high bids are excluded.",
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

  const [eventsCount, obsCount, imgCount, sourcesRes] = await Promise.all([
    sb.from("vehicle_events").select("id", { count: "exact", head: true }).eq("vehicle_id", vid),
    sb.from("vehicle_observations").select("id", { count: "exact", head: true }).eq("vehicle_id", vid),
    sb.from("vehicle_images").select("id", { count: "exact", head: true }).eq("vehicle_id", vid),
    sb
      .from("vehicle_observations")
      .select("source_id")
      .eq("vehicle_id", vid)
      .eq("is_superseded", false)
      .limit(100),
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
        sources: sourceNames,
      },
      checked_sources: ["vehicles", "vehicle_events", "vehicle_observations", "vehicle_images", ...sourceNames],
    }),
  );
}
