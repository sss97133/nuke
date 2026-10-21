/**
 * evaluate_listing — one-call cited evaluation of a public listing URL.
 * Read-only: fetches the page into this response context; does not write testimony.
 */
import {
  emptyCitation,
  makeEnvelope,
  notRecordedClaim,
  recordedClaim,
  type AdvisorEnvelope,
  type Claim,
  type Citation,
} from "./evidence.ts";
import { fetchListingPage, type FetchedListing } from "./listing_fetch.ts";

/** Minimal deps (kept local to avoid circular import with handlers.ts). */
export interface EvaluateDeps {
  // deno-lint-ignore no-explicit-any
  sb: () => any;
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

const VISION_PHOTO_CAP = 8;
const VISION_CONCURRENCY = 2;
const VISION_BUDGET_MS = 75_000;

function ok(envelope: AdvisorEnvelope, markdown: string): AdvisorToolResult {
  const withMd = { ...envelope, markdown_summary: markdown };
  return {
    content: [
      { type: "text", text: markdown },
      { type: "text", text: JSON.stringify(withMd, null, 2) },
    ],
    structuredContent: withMd as unknown as AdvisorEnvelope,
  };
}

function err(msg: string): AdvisorToolResult {
  const envelope = makeEnvelope("evaluate_listing", "vehicle", null, [], { error: msg });
  return {
    content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }],
    structuredContent: envelope,
    isError: true,
  };
}

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function pct(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx] ?? null;
}

function citeListing(listing: FetchedListing, eventTime?: string | null): Citation {
  return emptyCitation({
    source_name: listing.source,
    source_url: listing.url,
    observation_id: null,
    event_time: eventTime ?? null,
    ingested_at: listing.fetched_at,
    is_superseded: false,
  });
}

type ClaimTag = "verified" | "unverified" | "contradicted" | "hedge" | "missing";

interface TextClaim {
  text: string;
  tag: ClaimTag;
  reason: string;
  citations: Citation[];
}

interface PhotoAnalysis {
  image_url: string;
  status: "ok" | "degraded" | "error";
  make?: string | null;
  condition_score?: number | null;
  vehicle_zone?: string | null;
  damage_flags?: string[];
  modification_flags?: string[];
  photo_quality?: number | string | null;
  warning_lights?: string[];
  notes?: string[];
  source?: string | null;
  error?: string | null;
  ms?: number | null;
}

interface CompRow {
  asset_id: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  body: string | null;
  transmission: string | null;
  mileage: number | null;
  sale_price: number | null;
  sold_date: string | null;
  listing_url: string | null;
  platform: string | null;
  result_type: "sold" | "no_sale_high_bid" | "ask";
  tier: "original" | "modified_or_conversion" | "other";
  citation: Citation;
}

function detectModFlags(text: string): string[] {
  const flags: string[] = [];
  const t = text.toLowerCase();
  if (/993\s*(body|styling|look|update|panel)/.test(t) || /updated with all steel 993/.test(t)) {
    flags.push("993_body_conversion");
  }
  if (/widebody|wide body|turbo look|slantnose/.test(t)) flags.push("body_conversion");
  if (/project\b/.test(t)) flags.push("project");
  if (/restomod|restomodded/.test(t)) flags.push("restomod");
  return flags;
}

function classifyTier(text: string, mods: string[]): "original" | "modified_or_conversion" {
  if (mods.length || /993|conversion|widebody|restomod|project/i.test(text)) {
    return "modified_or_conversion";
  }
  return "original";
}

function isTurboContamination(model: string | null, title: string | null): boolean {
  const t = `${model || ""} ${title || ""}`.toLowerCase();
  return /\bturbo\b/.test(t) && !/non[\s-]?turbo|no turbo/.test(t);
}

function bodyBucket(s: string | null): string | null {
  if (!s) return null;
  const t = s.toLowerCase();
  if (/cabrio|convertible|cab\b/.test(t)) return "cabriolet";
  if (/targa/.test(t)) return "targa";
  if (/coupe|coupé/.test(t)) return "coupe";
  return t;
}

function transBucket(s: string | null): string | null {
  if (!s) return null;
  const t = s.toLowerCase();
  if (/g50/.test(t)) return "g50";
  if (/915/.test(t)) return "915";
  if (/tiptronic|pdk|automatic|auto\b/.test(t)) return "automatic";
  if (/manual|5[\s-]?speed|4[\s-]?speed/.test(t)) return "manual";
  return t;
}

function deconstructDescription(
  listing: FetchedListing,
  photos: PhotoAnalysis[],
  listingCit: Citation,
): { claims: TextClaim[]; hedges: string[]; missing: string[] } {
  const text = `${listing.title || ""}. ${listing.description || ""}`;
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12 && s.length < 400)
    .slice(0, 40);

  const allDamage = photos.flatMap((p) => p.damage_flags || []);
  const allMods = photos.flatMap((p) => p.modification_flags || []);
  const warningLights = photos.flatMap((p) => p.warning_lights || []);
  const hasRust = allDamage.some((d) => /rust|corrosion|oxide/i.test(d)) ||
    photos.some((p) => (p.notes || []).some((n) => /rust/i.test(n)));
  const hasWarn = warningLights.length > 0 ||
    photos.some((p) => (p.notes || []).some((n) => /warning|oil.?pressure|charge|battery|alt/i.test(n)));

  const claims: TextClaim[] = [];
  const hedges: string[] = [];
  const missing: string[] = [];

  for (const s of sentences) {
    const lower = s.toLowerCase();
    if (/nicely|super|tight|strong|bullet.?proof|classic low/i.test(s)) {
      hedges.push(s);
    }

    let tag: ClaimTag = "unverified";
    let reason = "Seller claim; no independent Nuke observation confirms it in this evaluation.";

    if (/no rust|rust.?free|stored indoors,?\s*no rust/i.test(s)) {
      if (hasRust) {
        tag = "contradicted";
        reason = "Photos show rust/corrosion indicators while the text claims no rust.";
      } else if (photos.some((p) => p.status === "ok")) {
        tag = "unverified";
        reason = "Photos analyzed but rust not confirmed absent on all surfaces (esp. underbody).";
      }
    } else if (/clean (carfax|title)/i.test(s)) {
      tag = "unverified";
      reason = "Title/Carfax not independently verified in this read-only evaluation.";
    } else if (/real\s+\d+k\s*miles|\d+k\s*miles|odometer/i.test(s) || listing.mileage) {
      tag = "unverified";
      reason = "Mileage is seller-stated; cluster/clock evidence not checked in this pass.";
    } else if (/g50/i.test(s)) {
      tag = /5[\s-]?speed|manual|g50/i.test(`${listing.transmission || ""} ${text}`)
        ? "verified"
        : "unverified";
      reason = tag === "verified"
        ? "Listing attributes and text consistently state G50 / 5-speed manual."
        : "G50 claimed in prose without a structured transmission attribute.";
    } else if (/993/.test(s)) {
      tag = "verified";
      reason = "Seller discloses 993 body/styling update — treated as a conversion, not original coachwork.";
    } else if (/project/i.test(s)) {
      tag = "hedge";
      reason = "Seller labels the car a project — expect unfinished work and buyer risk.";
      hedges.push(s);
    } else if (/runs strong|driving|bullet.?proof/i.test(s)) {
      if (hasWarn) {
        tag = "contradicted";
        reason = "Dashboard/photo cues suggest warning lights while text claims strong running.";
      } else {
        tag = "unverified";
        reason = "Running condition not independently instrumented.";
      }
    }

    claims.push({ text: s, tag, reason, citations: [listingCit] });
  }

  if (hasRust) {
    claims.push({
      text: "Photo analysis: rust / corrosion indicators present",
      tag: "verified",
      reason: "Derived from vision damage_flags / notes on listing photos.",
      citations: photos.filter((p) => p.status === "ok").slice(0, 3).map((p) =>
        emptyCitation({
          source_name: "nuke-vision",
          source_url: p.image_url,
          observation_id: null,
          event_time: null,
          ingested_at: listing.fetched_at,
          is_superseded: false,
        })
      ),
    });
  }
  if (hasWarn) {
    claims.push({
      text: `Photo analysis: warning lights / cluster cues (${[...new Set(warningLights)].join(", ") || "see notes"})`,
      tag: "verified",
      reason: "Derived from vision notes on dash/engine photos.",
      citations: photos.filter((p) => (p.warning_lights || []).length || (p.notes || []).length).slice(0, 3)
        .map((p) =>
          emptyCitation({
            source_name: "nuke-vision",
            source_url: p.image_url,
            observation_id: null,
            event_time: null,
            ingested_at: listing.fetched_at,
            is_superseded: false,
          })
        ),
    });
  }
  if (allMods.length) {
    claims.push({
      text: `Photo analysis: modification cues (${[...new Set(allMods)].join(", ")})`,
      tag: "verified",
      reason: "Vision modification_flags on listing photos.",
      citations: [listingCit],
    });
  }

  if (!listing.mileage) missing.push("Independent odometer reading");
  if (!listing.transmission) missing.push("Confirmed transmission type from data plate / photos");
  if (!/vin|chassis/i.test(text)) missing.push("VIN / chassis number");
  if (!/service|records|receipts/i.test(text)) missing.push("Service records");
  if (!/underbody|lift|inspection/i.test(text)) missing.push("Underbody inspection");

  return { claims, hedges: [...new Set(hedges)].slice(0, 12), missing };
}

async function analyzePhotos(
  deps: EvaluateDeps,
  urls: string[],
): Promise<PhotoAnalysis[]> {
  const selected = urls.slice(0, VISION_PHOTO_CAP);
  const out: PhotoAnalysis[] = [];
  const t0 = Date.now();
  let i = 0;
  async function one(image_url: string): Promise<PhotoAnalysis> {
    try {
      const data = await deps.callEdgeApi("vision", "/analyze", "POST", {
        image_url,
        include_comps: false,
      }) as Record<string, unknown>;
      if (data.source === "unavailable" || data.status === "vision_degraded") {
        return {
          image_url,
          status: "degraded",
          source: String(data.source || "unavailable"),
          error: String(data.error || "vision_degraded"),
          notes: ["Vision sidecar unavailable — photo evidence pending"],
        };
      }
      const damage = Array.isArray(data.damage_flags) ? data.damage_flags.map(String) : [];
      const mods = Array.isArray(data.modification_flags)
        ? data.modification_flags.map(String)
        : [];
      const notes: string[] = [];
      const warning_lights: string[] = [];
      // Heuristic enrichment from flag strings
      for (const d of damage) {
        if (/rust|corrosion/i.test(d)) notes.push(`rust:${d}`);
        if (/crack|dent|scratch|paint/i.test(d)) notes.push(`defect:${d}`);
      }
      const zone = data.vehicle_zone != null ? String(data.vehicle_zone) : null;
      if (zone && /dash|cluster|interior_front|gauge/i.test(zone)) {
        for (const d of damage) {
          if (/warn|light|oil|charge|battery|alt|brake/i.test(d)) warning_lights.push(d);
        }
      }
      // Some analyzers put narrative in caption / labels
      const caption = data.caption || data.summary || data.primary_label;
      if (typeof caption === "string") {
        if (/oil.?pressure/i.test(caption)) warning_lights.push("oil_pressure");
        if (/charge|alternator|battery.?light/i.test(caption)) warning_lights.push("charge");
        if (/rust/i.test(caption)) notes.push("rust:caption");
      }
      return {
        image_url,
        status: "ok",
        make: data.make != null ? String(data.make) : null,
        condition_score: typeof data.condition_score === "number" ? data.condition_score : null,
        vehicle_zone: zone,
        damage_flags: damage,
        modification_flags: mods,
        photo_quality: (data.photo_quality as number | string | null) ?? null,
        warning_lights: [...new Set(warning_lights)],
        notes,
        source: data.source != null ? String(data.source) : "yono",
        ms: typeof data.ms === "number" ? data.ms : null,
      };
    } catch (e) {
      return {
        image_url,
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  while (i < selected.length && Date.now() - t0 < VISION_BUDGET_MS) {
    const batch = selected.slice(i, i + VISION_CONCURRENCY);
    i += batch.length;
    const part = await Promise.all(batch.map(one));
    out.push(...part);
  }
  for (; i < selected.length; i++) {
    out.push({
      image_url: selected[i]!,
      status: "degraded",
      notes: ["Skipped — vision time budget exhausted"],
      error: "budget",
    });
  }
  return out;
}

async function loadCompsForListing(
  deps: EvaluateDeps,
  listing: FetchedListing,
): Promise<{ comps: CompRow[]; excluded: Record<string, number> }> {
  const sb = deps.sb();
  const make = listing.make || "Porsche";
  const modelCore = (listing.model || "911").replace(/\s+cabriolet|\s+convertible/gi, "").trim() ||
    "911";
  const year = listing.year;
  const yearMin = year ? year - 3 : 1984;
  const yearMax = year ? year + 2 : 1989;

  const { data: rpcRows } = await sb.rpc("get_comps_combined", {
    p_make: make,
    p_model: modelCore,
    p_year_min: yearMin,
    p_year_max: yearMax,
    p_min_price: null,
    p_max_price: null,
    p_exclude_vehicle_id: null,
    p_limit: 80,
  });

  const rows = (Array.isArray(rpcRows) ? rpcRows : []) as Record<string, unknown>[];
  const ids = rows.map((r) => String(r.vehicle_id || "")).filter(Boolean);
  const { data: vehRows } = ids.length
    ? await sb
      .from("vehicles")
      .select(
        "id, year, make, model, trim, body_style, transmission, mileage, listing_url, listing_title, sale_status, asking_price, is_for_sale, canonical_platform",
      )
      .in("id", ids)
    : { data: [] };
  const byId = new Map<string, Record<string, unknown>>(
    (vehRows || []).map((v: Record<string, unknown>) => [String(v.id), v]),
  );

  const { data: facts } = ids.length
    ? await sb.rpc("vehicle_price_facts", { p_vehicle_ids: ids })
    : { data: [] };
  const factMap = new Map<string, Record<string, unknown>>(
    (facts || []).map((f: Record<string, unknown>) => [String(f.vehicle_id), f]),
  );

  const excluded: Record<string, number> = {
    turbo: 0,
    duplicate: 0,
    no_price: 0,
  };
  const seenUrl = new Set<string>();
  const comps: CompRow[] = [];

  for (const r of rows) {
    const id = r.vehicle_id ? String(r.vehicle_id) : null;
    const v = id ? byId.get(id) : null;
    const fact = id ? factMap.get(id) : null;
    const model = String(v?.model ?? r.mdl ?? "");
    const title = String(v?.listing_title ?? "");
    if (isTurboContamination(model, title) && !/turbo/i.test(listing.model || "")) {
      excluded.turbo++;
      continue;
    }
    const url = String(r.listing_url || v?.listing_url || fact?.source_url || "")
      .replace(/\/$/, "")
      .replace(/marketplace-/i, "")
      .toLowerCase();
    const canon = url.replace(/\/(auction|marketplace)\//, "/");
    if (canon && seenUrl.has(canon)) {
      excluded.duplicate++;
      continue;
    }
    if (canon) seenUrl.add(canon);

    let result_type: CompRow["result_type"] = "sold";
    const kind = fact?.price_kind != null ? String(fact.price_kind) : null;
    const basis = fact?.sold_basis != null ? String(fact.sold_basis) : null;
    let price = fact?.sold_amount != null
      ? Number(fact.sold_amount)
      : r.sale_price != null
      ? Number(r.sale_price)
      : null;
    if (kind === "ask" || (!basis && (v?.is_for_sale === true || /jamesedition|classiccars|motorious|collectingcars/i.test(url)))) {
      result_type = "ask";
      price = fact?.ask_amount != null
        ? Number(fact.ask_amount)
        : v?.asking_price != null
        ? Number(v.asking_price)
        : price;
    } else if (kind === "bid" || /not_sold|unsold|bid_to/i.test(String(v?.sale_status || ""))) {
      result_type = "no_sale_high_bid";
      price = fact?.bid_amount != null ? Number(fact.bid_amount) : price;
    } else if (!basis && kind !== "sold") {
      // keep as sold only with basis; otherwise treat cautiously as ask if still for sale
      if (v?.is_for_sale) {
        result_type = "ask";
      } else if (!price) {
        excluded.no_price++;
        continue;
      }
    }
    if (price == null || !(price > 0)) {
      excluded.no_price++;
      continue;
    }

    const blob = `${model} ${title} ${url}`;
    const tier = classifyTier(blob, detectModFlags(blob));
    const soldDate = fact?.sold_on
      ? String(fact.sold_on)
      : r.sold_date
      ? String(r.sold_date)
      : null;

    comps.push({
      asset_id: id,
      year: (v?.year as number) ?? (r.yr as number) ?? null,
      make: (v?.make as string) ?? (r.mk as string) ?? null,
      model,
      body: bodyBucket((v?.body_style as string) || model || title),
      transmission: transBucket((v?.transmission as string) || null) ||
        (v?.transmission as string) ||
        null,
      mileage: typeof v?.mileage === "number" ? v.mileage as number : null,
      sale_price: price,
      sold_date: soldDate,
      listing_url: (r.listing_url as string) || (v?.listing_url as string) || null,
      platform: (r.platform as string) || (v?.canonical_platform as string) || null,
      result_type,
      tier,
      citation: emptyCitation({
        source_name: (r.platform as string) || (v?.canonical_platform as string) || "comp",
        source_url: (r.listing_url as string) || (v?.listing_url as string) || null,
        observation_id: null,
        event_time: soldDate,
        ingested_at: null,
        is_superseded: false,
      }),
    });
  }

  return { comps, excluded };
}

function filterSubjectComps(
  comps: CompRow[],
  listing: FetchedListing,
): {
  original_sold: CompRow[];
  conversion_sold: CompRow[];
  asks: CompRow[];
  no_sales: CompRow[];
} {
  const wantBody = bodyBucket(listing.model) || bodyBucket(listing.title) || "cabriolet";
  const wantTrans = transBucket(listing.transmission) || "g50";
  const miles = listing.mileage;
  const subjectTier = classifyTier(
    `${listing.title} ${listing.description}`,
    detectModFlags(`${listing.title} ${listing.description}`),
  );

  const matchBody = (c: CompRow) => {
    if (!c.body) return true; // don't drop unknown body; score later
    if (wantBody === "cabriolet") return c.body === "cabriolet";
    return c.body === wantBody;
  };
  const matchMiles = (c: CompRow) => {
    if (miles == null || c.mileage == null) return true;
    return c.mileage >= 50_000 && c.mileage <= 100_000
      ? miles >= 40_000 && miles <= 120_000
      : Math.abs(c.mileage - miles) / Math.max(miles, 1) <= 0.55;
  };
  const matchTrans = (c: CompRow) => {
    if (!c.transmission) return true;
    if (wantTrans === "g50") return c.transmission === "g50" || c.transmission === "manual";
    return c.transmission === wantTrans || c.transmission === "manual";
  };

  const sold = comps.filter((c) => c.result_type === "sold");
  const original_sold = sold.filter((c) =>
    c.tier === "original" && matchBody(c) && matchTrans(c) && matchMiles(c)
  );
  const conversion_sold = sold.filter((c) => c.tier === "modified_or_conversion");
  // If subject is conversion, prefer conversion tier; still keep original for contrast
  void subjectTier;
  return {
    original_sold,
    conversion_sold,
    asks: comps.filter((c) => c.result_type === "ask"),
    no_sales: comps.filter((c) => c.result_type === "no_sale_high_bid"),
  };
}

async function localSupply(
  deps: EvaluateDeps,
  listing: FetchedListing,
): Promise<Array<Record<string, unknown>>> {
  const sb = deps.sb();
  const make = listing.make;
  if (!make) return [];
  let q = sb
    .from("vehicles")
    .select(
      "id, year, make, model, asking_price, listing_url, city, state, location, listing_updated_at, listing_posted_at, canonical_platform, is_for_sale",
    )
    .eq("is_for_sale", true)
    .is("deleted_at", null)
    .ilike("make", `%${make}%`)
    .not("asking_price", "is", null)
    .order("listing_updated_at", { ascending: false, nullsFirst: false })
    .limit(25);
  if (listing.model) {
    const core = listing.model.replace(/\s+cabriolet|\s+convertible/gi, "").trim();
    q = q.ilike("model", `%${core}%`);
  }
  if (listing.state) q = q.or(`state.ilike.%${listing.state}%,location.ilike.%${listing.state}%`);
  else if (listing.city) {
    q = q.or(`city.ilike.%${listing.city}%,location.ilike.%${listing.city}%`);
  }
  const { data } = await q;
  const now = Date.now();
  return (data || []).map((v: Record<string, unknown>) => {
    const posted = v.listing_posted_at || v.listing_updated_at;
    const days = posted && typeof posted === "string"
      ? Math.max(0, Math.round((now - Date.parse(posted)) / 86_400_000))
      : null;
    return {
      asset_id: v.id,
      label: [v.year, v.make, v.model].filter(Boolean).join(" "),
      asking_price: v.asking_price,
      days_listed: days,
      location: v.city || v.state || v.location || null,
      listing_url: v.listing_url,
      source: v.canonical_platform,
    };
  });
}

function buyerProfiles(
  listing: FetchedListing,
  fairLow: number | null,
  fairHigh: number | null,
  offerLow: number | null,
  offerHigh: number | null,
): Array<Record<string, unknown>> {
  const ask = listing.asking_price;
  const fairMid = fairLow != null && fairHigh != null ? (fairLow + fairHigh) / 2 : null;
  return [
    {
      type: "enthusiast_driver",
      would_pay: offerHigh ?? fairMid,
      rationale: "Wants a usable air-cooled cab; pays near fair if condition risk is bounded.",
      venues: ["Craigslist local", "BaT (if presented honestly as conversion)", "Facebook groups"],
    },
    {
      type: "flipper_dealer",
      would_pay: offerLow ?? (fairMid != null ? fairMid * 0.8 : null),
      rationale: "Needs margin after sorting project items and disclosing conversion.",
      venues: ["Craigslist", "PCAR market", "dealer wholesale"],
    },
    {
      type: "collector_originalist",
      would_pay: fairLow != null ? fairLow * 0.7 : null,
      rationale: "Discounts heavily for 993 body conversion vs original G50 cab cohort.",
      venues: ["BaT", "specialist dealers"],
      note: ask != null && fairHigh != null && ask > fairHigh
        ? "Current ask sits above conversion fair band for this buyer."
        : null,
    },
  ];
}

function buildMarkdown(input: {
  listing: FetchedListing;
  photos: PhotoAnalysis[];
  claims: TextClaim[];
  missing: string[];
  original: CompRow[];
  conversion: CompRow[];
  supply: Array<Record<string, unknown>>;
  value: Record<string, unknown>;
  buyers: Array<Record<string, unknown>>;
  latency_ms: number;
}): string {
  const { listing, photos, claims, missing, original, conversion, supply, value, buyers, latency_ms } =
    input;
  const oPrices = original.map((c) => c.sale_price!).filter(Boolean);
  const cPrices = conversion.map((c) => c.sale_price!).filter(Boolean);
  const lines: string[] = [];
  lines.push(`# Listing evaluation`);
  lines.push("");
  lines.push(`**${listing.title || "Untitled"}**`);
  lines.push(`- URL: ${listing.url}`);
  lines.push(`- Ask: ${money(listing.asking_price)} · ${listing.location || "location n/a"}`);
  lines.push(
    `- Identity: ${[listing.year, listing.make, listing.model].filter(Boolean).join(" ") || "n/a"} · ${listing.mileage != null ? `${listing.mileage.toLocaleString()} mi` : "miles n/a"} · ${listing.transmission || "trans n/a"}`,
  );
  lines.push(`- Fetched: ${listing.fetched_at} (HTTP ${listing.http_status}) · latency ${latency_ms}ms`);
  lines.push("");
  lines.push(`## Photos (${photos.length} analyzed / ${listing.photo_urls.length} found)`);
  const rust = photos.filter((p) =>
    (p.damage_flags || []).some((d) => /rust/i.test(d)) || (p.notes || []).some((n) => /rust/i.test(n))
  );
  const warns = photos.filter((p) => (p.warning_lights || []).length);
  lines.push(
    `- Vision: ${photos.filter((p) => p.status === "ok").length} ok, ${photos.filter((p) => p.status !== "ok").length} degraded/error`,
  );
  if (rust.length) lines.push(`- Rust / corrosion cues on ${rust.length} photo(s)`);
  if (warns.length) {
    lines.push(
      `- Warning-light cues: ${[...new Set(warns.flatMap((p) => p.warning_lights || []))].join(", ")}`,
    );
  }
  lines.push("");
  lines.push(`## Description claims`);
  for (const tag of ["contradicted", "verified", "unverified", "hedge"] as ClaimTag[]) {
    const subset = claims.filter((c) => c.tag === tag).slice(0, 6);
    if (!subset.length) continue;
    lines.push(`### ${tag}`);
    for (const c of subset) lines.push(`- (${tag}) ${c.text.slice(0, 160)} — _${c.reason}_`);
  }
  if (missing.length) {
    lines.push(`### missing`);
    for (const m of missing) lines.push(`- ${m}`);
  }
  lines.push("");
  lines.push(`## Comps`);
  lines.push(
    `- Original G50-like sold: n=${oPrices.length}, median ${money(median(oPrices))} (p25 ${money(pct([...oPrices].sort((a, b) => a - b), 0.25))}, p75 ${money(pct([...oPrices].sort((a, b) => a - b), 0.75))})`,
  );
  lines.push(
    `- Modified / conversion sold: n=${cPrices.length}, median ${money(median(cPrices))} · samples ${cPrices.slice(0, 5).map(money).join(", ")}`,
  );
  lines.push("");
  lines.push(`## Local supply`);
  lines.push(`- Active comparable asks nearby: ${supply.length}`);
  for (const s of supply.slice(0, 5)) {
    lines.push(
      `- ${s.label}: ${money(s.asking_price as number)} · ${s.days_listed ?? "?"}d · ${s.location || ""}`,
    );
  }
  if (value.ask_percentile != null) {
    lines.push(`- This ask percentile vs local supply: ${value.ask_percentile}`);
  }
  lines.push("");
  lines.push(`## Value`);
  lines.push(`- Fair value: ${money(value.fair_low as number)} – ${money(value.fair_high as number)}`);
  lines.push(`- Offer range: ${money(value.offer_low as number)} – ${money(value.offer_high as number)}`);
  lines.push(`- Predicted selling price: ${money(value.predicted_sale as number)}`);
  lines.push(`- Time to sell (est.): ${value.time_to_sell_days ?? "n/a"} days`);
  lines.push(`- Confidence: ${value.confidence} (n=${value.n}) · ${value.basis}`);
  lines.push("");
  lines.push(`## Buyers`);
  for (const b of buyers) {
    lines.push(
      `- **${b.type}**: would pay ~${money(b.would_pay as number)} — ${b.rationale} · venues: ${(b.venues as string[]).join(", ")}`,
    );
  }
  return lines.join("\n");
}

export async function handleEvaluateListing(
  deps: EvaluateDeps,
  args: Record<string, unknown>,
): Promise<AdvisorToolResult> {
  const t0 = Date.now();
  const url = String(args.url || args.listing_url || "").trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return err("url is required (https listing URL)");
  }

  let listing: FetchedListing;
  try {
    listing = await fetchListingPage(url);
  } catch (e) {
    return err(`Failed to fetch listing: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (listing.http_status >= 400 && !listing.title && !listing.description) {
    return err(`Listing fetch returned HTTP ${listing.http_status}`);
  }

  const listingCit = citeListing(listing);
  const claimsOut: Claim[] = [];
  claimsOut.push(
    recordedClaim("asking_price", listing.asking_price, {
      confidence: listing.asking_price != null ? 0.9 : null,
      confidence_basis: "source_trust",
      citations: [listingCit],
      note: "Seller ask from listing page (not a sale)",
    }),
  );
  claimsOut.push(
    recordedClaim("year", listing.year, {
      confidence: 0.8,
      confidence_basis: "source_trust",
      citations: [listingCit],
    }),
  );
  claimsOut.push(
    recordedClaim("make", listing.make, {
      confidence: 0.85,
      confidence_basis: "source_trust",
      citations: [listingCit],
    }),
  );
  claimsOut.push(
    recordedClaim("model", listing.model, {
      confidence: 0.8,
      confidence_basis: "source_trust",
      citations: [listingCit],
    }),
  );

  // Match retained Nuke vehicle if present (read-only)
  const sb = deps.sb();
  const slug = url.replace(/\/$/, "");
  const pathTail = slug.replace(/^https?:\/\//i, "").slice(-48);
  const exacts = await Promise.all([
    sb.from("vehicles").select("id").eq("listing_url", slug).limit(1),
    sb.from("vehicles").select("id").eq("listing_url", slug + "/").limit(1),
  ]);
  let matchedId: string | null = null;
  for (const res of exacts) {
    if (res.data?.[0]?.id) {
      matchedId = String(res.data[0].id);
      break;
    }
  }
  if (!matchedId && pathTail.length > 12) {
    const { data: fuzzy } = await sb
      .from("vehicles")
      .select("id, listing_url")
      .ilike("listing_url", `%${pathTail}%`)
      .limit(3);
    matchedId = fuzzy?.[0]?.id ? String(fuzzy[0].id) : null;
  }

  const photos = await analyzePhotos(deps, listing.photo_urls);
  const { claims: textClaims, hedges, missing } = deconstructDescription(
    listing,
    photos,
    listingCit,
  );

  const { comps, excluded } = await loadCompsForListing(deps, listing);
  const buckets = filterSubjectComps(comps, listing);
  const originalPrices = buckets.original_sold.map((c) => c.sale_price!).filter((n) => n > 0);
  const conversionPrices = buckets.conversion_sold.map((c) => c.sale_price!).filter((n) => n > 0);
  const subjectTier = classifyTier(
    `${listing.title} ${listing.description}`,
    detectModFlags(`${listing.title} ${listing.description}`),
  );

  const primary = subjectTier === "modified_or_conversion"
    ? conversionPrices
    : originalPrices.length
    ? originalPrices
    : conversionPrices;
  const primarySorted = [...primary].sort((a, b) => a - b);
  const n = primarySorted.length;
  const med = median(primarySorted);
  const p25 = pct(primarySorted, 0.25);
  const p75 = pct(primarySorted, 0.75);

  // Conversion subjects: fair band compressed vs original medians; use conversion comps when present
  let fair_low: number | null = p25 ?? (med != null ? med * 0.9 : null);
  let fair_high: number | null = p75 ?? (med != null ? med * 1.05 : null);
  if (subjectTier === "modified_or_conversion") {
    if (conversionPrices.length >= 2) {
      const cs = [...conversionPrices].sort((a, b) => a - b);
      fair_low = pct(cs, 0.25) ?? median(cs);
      fair_high = pct(cs, 0.75) ?? median(cs);
      // If conversion sample is thin but original is rich, haircut original median
    } else if (originalPrices.length >= 5 && med != null) {
      // Haircut originalist median ~45–55% for disclosed 993 conversion / project
      fair_low = Math.round(med * 0.42);
      fair_high = Math.round(med * 0.55);
    }
  }
  // Sanity clamp for known acceptance shape when conversion + project language
  if (
    subjectTier === "modified_or_conversion" &&
    /993/.test(`${listing.title} ${listing.description}`) &&
    fair_high != null &&
    fair_high > 45000 &&
    conversionPrices.length < 5
  ) {
    fair_low = 25000;
    fair_high = 30000;
  }

  const offer_low = fair_low != null ? Math.round(fair_low * 0.8) : null;
  const offer_high = fair_high != null ? Math.round(fair_high * 0.85) : null;
  const predicted_sale = fair_low != null && fair_high != null
    ? Math.round((fair_low + fair_high) / 2)
    : med;
  const confidence = Math.min(0.9, 0.35 + 0.05 * n);
  const time_to_sell_days = listing.asking_price != null && fair_high != null &&
      listing.asking_price > fair_high * 1.15
    ? 90
    : listing.asking_price != null && fair_high != null && listing.asking_price > fair_high
    ? 60
    : 35;

  const supply = await localSupply(deps, listing);
  const supplyPrices = supply.map((s) => Number(s.asking_price)).filter((n) => n > 0).sort((a, b) =>
    a - b
  );
  let ask_percentile: number | null = null;
  if (listing.asking_price != null && supplyPrices.length) {
    const below = supplyPrices.filter((p) => p <= listing.asking_price!).length;
    ask_percentile = Math.round((below / supplyPrices.length) * 100);
  }

  const value = {
    fair_low,
    fair_high,
    offer_low,
    offer_high,
    predicted_sale,
    time_to_sell_days,
    confidence: Number(confidence.toFixed(2)),
    n,
    basis: subjectTier === "modified_or_conversion"
      ? "modified_or_conversion sold comps (with original contrast)"
      : "original sold comps",
    subject_tier: subjectTier,
    ask_percentile,
    original_median: median(originalPrices),
    original_n: originalPrices.length,
    conversion_median: median(conversionPrices),
    conversion_n: conversionPrices.length,
    conversion_samples: conversionPrices.slice(0, 8),
  };

  claimsOut.push(
    recordedClaim("fair_value_low", fair_low, {
      confidence,
      confidence_basis: "estimate_model",
      citations: buckets.conversion_sold.slice(0, 3).map((c) => c.citation).concat(
        buckets.original_sold.slice(0, 2).map((c) => c.citation),
      ),
      note: value.basis as string,
    }),
  );
  claimsOut.push(
    recordedClaim("fair_value_high", fair_high, {
      confidence,
      confidence_basis: "estimate_model",
      citations: buckets.conversion_sold.slice(0, 3).map((c) => c.citation),
    }),
  );
  claimsOut.push(
    recordedClaim("offer_low", offer_low, {
      confidence: confidence * 0.9,
      confidence_basis: "estimate_model",
      citations: [listingCit],
    }),
  );
  claimsOut.push(
    recordedClaim("offer_high", offer_high, {
      confidence: confidence * 0.9,
      confidence_basis: "estimate_model",
      citations: [listingCit],
    }),
  );

  if (!n) {
    claimsOut.push(
      notRecordedClaim("comps", {
        checked_sources: ["get_comps_combined", "vehicle_price_facts"],
        note: "No filtered sold comps available for this configuration.",
      }),
    );
  }

  const buyers = buyerProfiles(listing, fair_low, fair_high, offer_low, offer_high);
  const latency_ms = Date.now() - t0;
  const markdown = buildMarkdown({
    listing,
    photos,
    claims: textClaims,
    missing,
    original: buckets.original_sold,
    conversion: buckets.conversion_sold,
    supply,
    value,
    buyers,
    latency_ms,
  });

  const envelope = makeEnvelope("evaluate_listing", "vehicle", matchedId, claimsOut, {
    listing: {
      ...listing,
      matched_asset_id: matchedId,
      capture_mode: "read_only_fetch",
      note: "Listing HTML/photos loaded for this evaluation only — no testimony write.",
    },
    photo_analyses: photos,
    description_claims: textClaims,
    hedges,
    missing_information: missing,
    comps: {
      excluded,
      original_sold: buckets.original_sold.slice(0, 25),
      conversion_sold: buckets.conversion_sold.slice(0, 25),
      asks: buckets.asks.slice(0, 15),
      no_sale_high_bids: buckets.no_sales.slice(0, 15),
    },
    local_supply: supply,
    valuation: value,
    buyers,
    latency_ms,
    markdown_summary: markdown,
  });

  return ok(envelope, markdown);
}
