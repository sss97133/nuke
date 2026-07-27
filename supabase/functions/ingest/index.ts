/**
 * nuke.ingest() — Universal Vehicle Discovery Ingestion
 *
 * POST /functions/v1/ingest
 *
 * Accepts:
 *   { url: "https://facebook.com/marketplace/item/..." }
 *   { text: "1980 Chevy C10 $27,500 Greeneville TN" }
 *   { year: 1980, make: "Chevrolet", model: "C10", price: 27500 }
 *   { batch: [{ url: "..." }, { url: "..." }] }  (up to 50)
 *
 * Auth: Bearer token (user JWT or service role key)
 *
 * Flow:
 *   Input → source detection → parse/extract → match or create vehicle → link to user → return
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { normalizeVehicleFields, normalizeMake, isGarbageMake } from "../_shared/normalizeVehicle.ts";
import { qualityGate } from "../_shared/extractionQualityGate.ts";
import { validateVINChecksum } from "../_shared/intelligence-layer.ts";
import { decodeVin } from "../_shared/vin-decoder.ts";
import { archiveFetch } from "../_shared/archiveFetch.ts";
import { normalizeListingUrl, extractCraigslistCanonicalUrls } from "../_shared/urlNormalization.ts";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ── Source Detection ────────────────────────────────────────────

interface SourceMatch {
  platform: string;
  externalId: string | null;
}

const SOURCE_PATTERNS: Array<{
  platform: string;
  pattern: RegExp;
  extractId: (match: RegExpMatchArray) => string | null;
}> = [
  {
    platform: "facebook_marketplace",
    pattern: /facebook\.com\/marketplace\/item\/(\d+)/,
    extractId: (m) => m[1],
  },
  {
    platform: "facebook_marketplace",
    pattern: /fb\.com\/marketplace\/item\/(\d+)/,
    extractId: (m) => m[1],
  },
  {
    platform: "bring_a_trailer",
    pattern: /bringatrailer\.com\/listing\/([\w-]+)/,
    extractId: (m) => m[1],
  },
  {
    platform: "cars_and_bids",
    pattern: /carsandbids\.com\/auctions\/([\w-]+)/,
    extractId: (m) => m[1],
  },
  {
    platform: "craigslist",
    pattern: /(\w+)\.craigslist\.org\/\w+\/d\/([\w-]+)\/(\d+)\.html/,
    extractId: (m) => m[3],
  },
  {
    // Craigslist share links: https://www.craigslist.org/view/d/{slug}/{token}
    // The token is an opaque share id, not the listing id — resolve to the
    // canonical regional URL via resolveCraigslistShareUrl() before use.
    platform: "craigslist",
    pattern: /(?:www\.)?craigslist\.org\/view\/d\/[\w-]+\/(\w+)/,
    extractId: (m) => m[1],
  },
  {
    platform: "ebay_motors",
    pattern: /ebay\.com\/itm\/(\d+)/,
    extractId: (m) => m[1],
  },
  {
    platform: "hagerty",
    // https://www.hagerty.com/marketplace/auction/1965-Ford-Mustang/ce62f601-14d5-4090-9489-2287744182ee
    // The old pattern stopped at the first path segment, so extractId returned
    // the literal "auction" (or "classified") for EVERY hagerty listing — one
    // external_id shared by the whole venue. Identity lives in the second-to-
    // last segment; the id is the tail (uuid, or a 22-char shortid).
    // `auction` read off the live search page 2026-07-26; `classified` is the
    // feed's own listing_url_regex (listing_feeds 2cc4741f) — same shape.
    pattern: /hagerty\.com\/marketplace\/(?:auction|classified)\/[\w-]+\/([\w-]+)/,
    extractId: (m) => m[1],
  },
  {
    platform: "facebook_group",
    pattern: /facebook\.com\/groups\/(\d+)\/posts\/(\d+)/,
    extractId: (m) => m[2],
  },
  {
    platform: "instagram",
    pattern: /instagram\.com\/p\/([\w-]+)/,
    extractId: (m) => m[1],
  },
  // ── Venues polled by listing_feeds whose URL carries {year}-{make}-{model}
  // in the last path segment. Registering them is what lets the
  // minimum-viability gate below trust their slug WITHOUT a live fetch —
  // exactly the trust Craigslist already gets. Every pattern here was
  // written against a real URL observed in import_queue (2026-07-26), not
  // guessed; venues whose slug does NOT carry identity are deliberately
  // absent (see notes at the bottom of this list).
  {
    platform: "mecum",
    // https://www.mecum.com/lots/1177355/2005-hummer-h2
    pattern: /mecum\.com\/lots\/(\d+)\//,
    extractId: (m) => m[1],
  },
  {
    platform: "classiccars",
    // https://classiccars.com/listings/view/2089229/1993-chevrolet-corvette-for-sale-in-cleveland-ohio-44128
    pattern: /classiccars\.com\/listings\/view\/(\d+)\//,
    extractId: (m) => m[1],
  },
  {
    platform: "barrett_jackson",
    // https://www.barrett-jackson.com/2026-columbus/docket/vehicle/1951-plymouth-cranbrook-300183
    pattern: /barrett-jackson\.com\/[\w-]+\/docket\/vehicle\/([\w-]+)/,
    extractId: (m) => m[1],
  },
  {
    platform: "pcarmarket",
    // https://www.pcarmarket.com/auction/2003-bmw-z4-25i-roadster
    pattern: /pcarmarket\.com\/auction\/([\w-]+)/,
    extractId: (m) => m[1],
  },
  {
    platform: "autohunter",
    // https://autohunter.com/Listing/Details/90844982/1966-PLYMOUTH-SATELLITE-CUSTOM-HARDTOP
    pattern: /autohunter\.com\/Listing\/Details\/(\d+)\//i,
    extractId: (m) => m[1],
  },
  {
    platform: "allcollectorcars",
    // https://www.allcollectorcars.com/classic-car-auctions/vehicles/1949-chevrolet-styleline-sport-coupe
    pattern: /allcollectorcars\.com\/[\w-]+\/vehicles\/([\w-]+)/,
    extractId: (m) => m[1],
  },
  {
    platform: "vanguard_motors",
    // https://www.vanguardmotorsales.com/inventory/5686/1970-plymouth-gtx
    pattern: /vanguardmotorsales\.com\/inventory\/(\d+)\//,
    extractId: (m) => m[1],
  },
  {
    platform: "carandclassic",
    // https://www.carandclassic.com/auctions/1972-mercedes-benz-350slc-c107-n7kb3n
    pattern: /carandclassic\.com\/auctions\/([\w-]+)/,
    extractId: (m) => m[1],
  },
  // NOT registered on purpose — their URLs do not carry identity, so trusting
  // them would mint stubs from guesswork (the failure this gate exists to stop):
  //   cars.ksl.com/listing/10662354        — numeric only, no slug (needs a fetch)
  //   barnfinds.com/testarvette-ferrari-…  — editorial slug, no year
  //   themarket.co.uk/listings/jaguar/…    — make/model but no year
  //   rmsothebys.com/…/lots/s0005-1914-…   — lot-code prefix + mangled make ("rollsroyce")
];

/**
 * Strip marketplace boilerplate and opaque ids off the tail of a listing slug,
 * so only the vehicle description survives into year/make/model.
 *
 * Without this the model field silently absorbs junk — exactly the make/model
 * corruption class that took a gate to fix on 2026-07-08 (see ISSUES.md):
 *   1993-chevrolet-corvette-for-sale-in-cleveland-ohio-44128
 *     -> model "corvette for sale in cleveland ohio 44128"
 *   1951-plymouth-cranbrook-300183   -> model "cranbrook 300183"
 *   1972-mercedes-benz-350slc-c107-n7kb3n -> model "…c107 n7kb3n"
 * Only the TAIL is trimmed; nothing before the boilerplate marker is touched,
 * so real model names keep their digits (z4-25i, 350slc, k5-blazer, f-100).
 */
function cleanSlugTail(seg: string): string {
  let out = seg;
  // "…-for-sale-in-cleveland-ohio-44128" / "…-for-sale-by-owner" and friends
  out = out.replace(/-for-sale(-(in|by|near)-.*)?$/i, "");
  // trailing opaque listing/lot id: 5+ digits, or a mixed alphanumeric hash
  out = out.replace(/-\d{5,}$/, "");
  out = out.replace(/-(?=[a-z0-9]{6,}$)(?=[a-z]*\d)(?=[0-9]*[a-z])[a-z0-9]{6,}$/i, "");
  return out || seg;
}

/**
 * Extract a human-readable title from a URL slug.
 * Works for Craigslist, Facebook Marketplace, and similar classifieds
 * where the URL path contains the listing title as a slug.
 * e.g. /d/joshua-tree-1976-chevy-k5-blazer-4x4/123.html → "joshua tree 1976 chevy k5 blazer 4x4"
 */
function extractTitleFromUrlSlug(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname;

    // Craigslist: /{region}.craigslist.org/{category}/d/{slug}/{id}.html
    const clMatch = path.match(/\/d\/([\w-]+)\/\d+\.html$/);
    if (clMatch) {
      return clMatch[1].replace(/-/g, " ");
    }

    // Facebook Marketplace: /marketplace/item/{id}/ — no slug, skip
    // Generic: try last path segment if it has dashes (looks like a slug)
    const segments = path.split("/").filter(Boolean);
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i];
      // Skip numeric-only segments (IDs) and file extensions
      if (/^\d+$/.test(seg) || /\.\w{2,4}$/.test(seg)) continue;
      // Skip UUID tails. A uuid has dashes, and 0.871% of them contain a
      // hex group that reads as a year (…-1993-4e13-…) — measured over
      // 200k random uuids — so without this guard the id itself wins the
      // loop below and becomes the title: year 1993, make "4e13".
      // Hagerty puts identity in the second-to-last segment behind exactly
      // such an id (/marketplace/auction/1965-Ford-Mustang/{uuid}).
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) continue;
      // Must have dashes (slugified) and contain a 4-digit year
      if (seg.includes("-") && /\b(19|20)\d{2}\b/.test(seg)) {
        return cleanSlugTail(seg).replace(/-/g, " ");
      }
    }
    return null;
  } catch {
    return null;
  }
}

function detectSource(url: string): SourceMatch {
  for (const { platform, pattern, extractId } of SOURCE_PATTERNS) {
    const match = url.match(pattern);
    if (match) {
      return { platform, externalId: extractId(match) };
    }
  }
  return { platform: "unknown", externalId: null };
}

// ── Craigslist Share-URL Resolution ─────────────────────────────

const CRAIGSLIST_SHARE_RE = /(?:www\.)?craigslist\.org\/view\/d\//;

/**
 * A www.craigslist.org/view/d/... share link hides the real listing.
 * Fetch the page (archived to listing_page_snapshots) and pull the canonical
 * regional URL (e.g. lasvegas.craigslist.org/cto/d/.../7944399929.html) out
 * of the body/JSON. Returns null if it can't be resolved (expired/blocked).
 */
async function resolveCraigslistShareUrl(shareUrl: string): Promise<string | null> {
  try {
    const { html } = await archiveFetch(shareUrl, {
      platform: "craigslist",
      callerName: "ingest",
      maxAgeSec: 86400,
    });
    if (!html) return null;
    return extractCraigslistCanonicalUrls(html)[0]?.url ?? null;
  } catch (e) {
    console.error(`Craigslist share resolution failed for ${shareUrl}:`, e instanceof Error ? e.message : String(e));
    return null;
  }
}

// ── Vehicle Title Parser ────────────────────────────────────────

// Title-parsing make list — includes common aliases for matching.
// normalizeMake() from normalizeVehicle.ts handles canonical form conversion.
const MAKES = [
  "Toyota", "Ford", "Chevrolet", "Chevy", "Honda", "Nissan", "BMW",
  "Mercedes-Benz", "Mercedes", "Audi", "Porsche", "Volkswagen", "VW",
  "Dodge", "Ram", "Jeep", "GMC", "Cadillac", "Lincoln", "Buick",
  "Pontiac", "Oldsmobile", "Plymouth", "Chrysler", "Mazda", "Subaru",
  "Lexus", "Acura", "Infiniti", "Hyundai", "Kia", "Volvo", "Jaguar",
  "Land Rover", "Mini", "AMC", "International", "Studebaker", "Datsun",
  "Triumph", "MG", "Austin-Healey", "Shelby", "Saab", "Peugeot",
  "Fiat", "Alfa Romeo", "Ferrari", "Lamborghini", "Maserati", "Lotus",
  "De Tomaso", "Jensen", "TVR", "Morgan", "Sunbeam", "Opel",
  "Willys", "Kaiser", "Nash", "Hudson", "Packard", "Lancia",
  "DeLorean", "Isuzu", "Mitsubishi", "Suzuki", "Eagle",
  "Aston Martin", "Rolls-Royce", "Bentley", "McLaren", "Bugatti",
  "Tesla", "Rivian", "Hummer", "International Harvester",
  "AM General",
];

interface ParsedVehicle {
  year: number | null;
  make: string | null;
  model: string | null;
}

// Models/sub-brands that unambiguously identify a make when the title omits it.
// Improves title parsing for facebook-saved and other sources with informal titles.
const MODEL_IMPLIES_MAKE: Record<string, string> = {
  // Chevrolet
  "corvette": "Chevrolet", "camaro": "Chevrolet", "chevelle": "Chevrolet",
  "nova": "Chevrolet", "el camino": "Chevrolet", "impala": "Chevrolet",
  "bel air": "Chevrolet", "monte carlo": "Chevrolet", "blazer": "Chevrolet",
  "silverado": "Chevrolet", "suburban": "Chevrolet",
  "c10": "Chevrolet", "c-10": "Chevrolet", "c20": "Chevrolet", "c-20": "Chevrolet",
  "c30": "Chevrolet", "c-30": "Chevrolet", "k10": "Chevrolet", "k-10": "Chevrolet",
  "k20": "Chevrolet", "k-20": "Chevrolet", "k5": "Chevrolet",
  "square body": "Chevrolet", "squarebody": "Chevrolet",
  "stingray": "Chevrolet",
  // GMC
  "k15": "GMC", "k-15": "GMC",
  // Ford
  "mustang": "Ford", "bronco": "Ford", "thunderbird": "Ford",
  "f-100": "Ford", "f100": "Ford", "f-150": "Ford", "f150": "Ford",
  "f-250": "Ford", "f250": "Ford", "f-350": "Ford", "f350": "Ford",
  "fairlane": "Ford", "galaxie": "Ford", "falcon": "Ford",
  // Dodge / Plymouth
  "charger": "Dodge", "challenger": "Dodge", "coronet": "Dodge",
  "roadrunner": "Plymouth", "road runner": "Plymouth",
  "barracuda": "Plymouth", "'cuda": "Plymouth", "cuda": "Plymouth",
  "duster": "Plymouth", "satellite": "Plymouth", "gtx": "Plymouth",
  // Pontiac
  "firebird": "Pontiac", "trans am": "Pontiac", "gto": "Pontiac",
  // Mercury / Dodge / Plymouth / Jeep / AMC bare models
  "comet": "Mercury", "cougar": "Mercury",
  "dart": "Dodge",
  "valiant": "Plymouth",
  "gremlin": "AMC", "javelin": "AMC",
  "wrangler": "Jeep", "cj": "Jeep", "cj5": "Jeep", "cj7": "Jeep", "yj": "Jeep",
  // Misc
  "miata": "Mazda",
  "scout": "International Harvester",
  "moke": "MINI",
};

function parseVehicleTitle(text: string): ParsedVehicle {
  if (!text) return { year: null, make: null, model: null };

  // Strip common prefixes
  const cleaned = text
    .replace(/^(SOLD|PENDING|NEW|REDUCED|PRICE DROP)[:\s!-]*/i, "")
    .trim();

  // Extract year
  const yearMatch = cleaned.match(/\b(19\d{2}|20[0-2]\d)\b/);
  if (!yearMatch) return { year: null, make: null, model: null };
  const year = parseInt(yearMatch[1]);

  // Get text after year
  const afterYear = cleaned.slice(cleaned.indexOf(yearMatch[0]) + yearMatch[0].length).trim();
  const lower = afterYear.toLowerCase();

  for (const make of MAKES) {
    if (lower.startsWith(make.toLowerCase())) {
      const afterMake = afterYear.slice(make.length).trim();
      const model = afterMake
        .split(/[\s·•|—,\-$]+/)
        .filter(w => w && !/^\d+$/.test(w) && !/^\$/.test(w))
        .slice(0, 3)
        .join(" ")
        .trim() || null;
      return { year, make: normalizeMake(make) || make, model };
    }
  }

  // No explicit make found — check if a known model name implies the make
  for (const [keyword, impliedMake] of Object.entries(MODEL_IMPLIES_MAKE)) {
    const re = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(lower)) {
      // Extract model as the text starting from the keyword
      const modelStart = lower.indexOf(keyword.toLowerCase());
      const modelText = afterYear.slice(modelStart).split(/[\s·•|—,\-$]+/)
        .filter(w => w && !/^\d+$/.test(w) && !/^\$/.test(w))
        .slice(0, 3)
        .join(" ")
        .trim() || keyword;
      return { year, make: impliedMake, model: modelText };
    }
  }

  // Tier 3 fallback: no known make/model matched. Take the first token that
  // could plausibly be a make — skip leading dimension/engine/spec tokens
  // ("5x8", "22r", "500cc", "115", a doubled year) that FB/CL titles lead with.
  // If nothing plausible remains, make is UNKNOWN (null) — never a garbage
  // token on a live listing. (Gate 5, 2026-07-08.)
  const words = afterYear.split(/\s+/).filter(Boolean);
  let mi = 0;
  while (mi < words.length && isGarbageMake(words[mi])) mi++;
  const candidate = words[mi] || null;
  const make = candidate && !isGarbageMake(candidate) ? candidate : null;
  return {
    year,
    make,
    model: make ? words.slice(mi + 1, mi + 3).join(" ") || null : null,
  };
}

// ── Price Parser ────────────────────────────────────────────────

function parsePrice(text: string): number | null {
  if (!text) return null;
  const match = text.match(/\$\s*([\d,]+)/);
  if (match) return parseInt(match[1].replace(/,/g, ""));
  const numMatch = text.match(/(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
  if (numMatch) {
    const val = parseInt(numMatch[1].replace(/,/g, ""));
    if (val >= 100 && val <= 10000000) return val;
  }
  return null;
}

// ── Location Parser ─────────────────────────────────────────────

function parseLocation(text: string): { city: string | null; state: string | null } {
  if (!text) return { city: null, state: null };
  // "Greeneville, TN" or "Los Angeles CA"
  const match = text.match(/([A-Za-z\s.]+),?\s+([A-Z]{2})\b/);
  if (match) return { city: match[1].trim(), state: match[2] };
  return { city: null, state: null };
}

// ── Match or Create Vehicle ─────────────────────────────────────

interface MatchResult {
  vehicleId: string;
  isNew: boolean;
  matchTier?: number;       // 1=VIN, 2=URL, 3=YMM+context
  matchConfidence?: number; // 0-1
}

interface VehicleEnrichment {
  vin?: string | null;
  url?: string | null;
  price?: number | null;
  location?: string | null;
  imageUrl?: string | null;
  imageUrls?: string[];
  description?: string | null;
  mileage?: number | null;
  engine?: string | null;
  transmission?: string | null;
  color?: string | null;
  condition?: string | null;
  bodyStyle?: string | null;
  titleStatus?: string | null;
  sellerName?: string | null;
}

/** vehicle_images.source value for a given detected platform. */
function imageSourceFor(platform?: string | null): string {
  return platform && platform !== "unknown" && platform !== "manual" ? platform : "ingest";
}

/** Best-effort platform -> observation_sources.slug mapping for condition-claim provenance. */
const PLATFORM_OBSERVATION_SOURCE_SLUG: Record<string, string> = {
  bring_a_trailer: "bat",
  cars_and_bids: "cars-and-bids",
  craigslist: "craigslist",
  facebook_marketplace: "facebook_marketplace",
  "facebook-saved": "facebook-saved",
  hagerty: "hagerty-marketplace",
};

/**
 * Condition is free text with no home on the `vehicles` table (no
 * condition_notes column exists — confirmed against the live schema; see
 * the comment on vehicleData below). Per Entity Resolution Rules, a claim
 * with nowhere to overwrite belongs in vehicle_observations, not dropped.
 * Falls back to the always-present 'user-input' source so this never
 * silently no-ops. Mirrors the existing facebook-saved observation write
 * below (same upsert/content-hash pattern), generalized across platforms.
 */
async function recordConditionObservation(
  vehicleId: string,
  platform: string | null | undefined,
  condition: string,
  sourceUrl: string | null,
) {
  try {
    const slug = (platform && PLATFORM_OBSERVATION_SOURCE_SLUG[platform]) || "user-input";
    const { data: srcRow } = await supabaseAdmin
      .from("observation_sources")
      .select("id")
      .eq("slug", slug)
      .single();
    if (!srcRow) {
      console.error(`recordConditionObservation: no observation_sources row for slug "${slug}"`);
      return;
    }
    const contentText = `Condition: ${condition}`;
    const contentHash = await crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(`${slug}:condition:${vehicleId}:${condition}`))
      .then((buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""));
    await supabaseAdmin.from("vehicle_observations").upsert({
      vehicle_id: vehicleId,
      vehicle_match_confidence: 1.0,
      observed_at: new Date().toISOString(),
      source_id: srcRow.id,
      source_url: sourceUrl,
      source_identifier: `ingest-condition-${vehicleId}`,
      kind: "condition",
      content_text: contentText,
      content_hash: contentHash,
      structured_data: { condition },
    }, { onConflict: "source_id,source_identifier,kind,content_hash", ignoreDuplicates: true });
  } catch (err: any) {
    console.error("recordConditionObservation error (non-fatal):", err.message);
  }
}

async function matchOrCreateVehicle(
  parsed: ParsedVehicle & VehicleEnrichment,
  platform?: string | null,
  opts?: { identityUncertain?: boolean },
): Promise<MatchResult> {
  // Canonicalize the listing URL once for matching + storage. Per Entity
  // Resolution Rules ("Add URL normalization to entity resolution... extract
  // platform-specific listing IDs"): URL variants (trailing slash, www,
  // query params) of the same listing must resolve to the same vehicle,
  // not fork into a second row because Tier 2c does an exact string match.
  const canonicalUrl = parsed.url ? (normalizeListingUrl(parsed.url)?.normalized ?? parsed.url) : null;

  // ── Tier 1: VIN match (confidence 0.99) ───────────────────────
  // VIN is definitive identity for post-1981 vehicles.
  if (parsed.vin) {
    const { data: vinMatch } = await supabaseAdmin
      .from("vehicles")
      .select("id")
      .eq("vin", parsed.vin)
      .limit(1)
      .single();

    if (vinMatch) {
      await enrichVehicle(vinMatch.id, parsed, platform);
      return { vehicleId: vinMatch.id, isNew: false, matchTier: 1, matchConfidence: 0.99 };
    }
  }

  // ── Tier 2a: URL match in marketplace_listings ────────────────
  if (parsed.url) {
    const { data: urlMatch } = await supabaseAdmin
      .from("marketplace_listings")
      .select("vehicle_id")
      .eq("url", parsed.url)
      .not("vehicle_id", "is", null)
      .limit(1)
      .single();

    if (urlMatch?.vehicle_id) {
      await enrichVehicle(urlMatch.vehicle_id, parsed, platform);
      return { vehicleId: urlMatch.vehicle_id, isNew: false, matchTier: 2, matchConfidence: 0.99 };
    }
  }

  // ── Tier 2b: URL match in vehicle_events.source_url ───────────
  if (parsed.url) {
    const { data: eventUrlMatch } = await supabaseAdmin
      .from("vehicle_events")
      .select("vehicle_id")
      .eq("source_url", parsed.url)
      .not("vehicle_id", "is", null)
      .limit(1)
      .single();

    if (eventUrlMatch?.vehicle_id) {
      await enrichVehicle(eventUrlMatch.vehicle_id, parsed, platform);
      return { vehicleId: eventUrlMatch.vehicle_id, isNew: false, matchTier: 2, matchConfidence: 0.99 };
    }
  }

  // ── Tier 2c: URL match in vehicles.listing_url ────────────────
  if (canonicalUrl) {
    const { data: listingUrlMatch } = await supabaseAdmin
      .from("vehicles")
      .select("id")
      .eq("listing_url", canonicalUrl)
      .limit(1)
      .single();

    if (listingUrlMatch) {
      await enrichVehicle(listingUrlMatch.id, parsed, platform);
      return { vehicleId: listingUrlMatch.id, isNew: false, matchTier: 2, matchConfidence: 0.95 };
    }
  }

  // ── Tier 3: Year+Make+Model fuzzy match ───────────────────────
  // Only attempt if we have all three identity fields.
  // Does NOT auto-link — collects candidates for merge_proposals after vehicle creation.
  // Per Entity Resolution Rules: "False splits are acceptable. False merges are catastrophic."
  interface MergeCandidate {
    existingVehicleId: string;
    confidence: number;
    reasons: string[];
    evidence: Record<string, unknown>;
  }
  const mergeCandidates: MergeCandidate[] = [];

  if (parsed.year && parsed.make && parsed.model) {
    const { data: ymmCandidates } = await supabaseAdmin
      .from("vehicles")
      .select("id, vin, location, mileage, sale_price, asking_price, listing_url")
      .eq("year", parsed.year)
      .eq("make", parsed.make)
      .eq("model", parsed.model)
      .limit(5);

    // When identity resolution itself is uncertain (e.g. an unresolved
    // Craigslist share URL, where Tier 2 URL-matching cannot run at all),
    // fall back to the Tier-3 circumstantial-evidence floor (0.50, per
    // Entity Resolution Rules) instead of the default 0.60 threshold, so a
    // same-platform YMM match still produces a reviewable merge_proposal
    // candidate instead of a fully silent duplicate. Rule #10: "When in
    // doubt, create a candidate link and wait for more evidence."
    const linkThreshold = opts?.identityUncertain ? 0.50 : 0.60;

    if (ymmCandidates && ymmCandidates.length > 0) {
      for (const candidate of ymmCandidates) {
        let confidence = 0.50; // Base: year+make+model match
        const reasons: string[] = ["year+make+model match"];

        // Location overlap boosts confidence
        if (parsed.location && candidate.location) {
          const parsedLoc = parsed.location.toLowerCase().trim();
          const candLoc = candidate.location.toLowerCase().trim();
          if (parsedLoc === candLoc) {
            confidence += 0.15;
            reasons.push("exact location match");
          } else if (parsedLoc.split(",")[0]?.trim() === candLoc.split(",")[0]?.trim()) {
            confidence += 0.08;
            reasons.push("city match");
          }
        }

        // Mileage within 5% boosts confidence (mileage decays over time)
        if (parsed.mileage && candidate.mileage) {
          const diff = Math.abs(parsed.mileage - candidate.mileage);
          const pct = diff / Math.max(parsed.mileage, candidate.mileage);
          if (pct <= 0.01) {
            confidence += 0.12;
            reasons.push("mileage within 1%");
          } else if (pct <= 0.05) {
            confidence += 0.06;
            reasons.push("mileage within 5%");
          }
        }

        // Price within 10% is a signal (same car re-listed at similar price)
        const candPrice = candidate.sale_price || candidate.asking_price;
        if (parsed.price && candPrice) {
          const priceDiff = Math.abs(parsed.price - candPrice);
          const pricePct = priceDiff / Math.max(parsed.price, candPrice);
          if (pricePct <= 0.05) {
            confidence += 0.08;
            reasons.push("price within 5%");
          } else if (pricePct <= 0.10) {
            confidence += 0.04;
            reasons.push("price within 10%");
          }
        }

        // Only propose if confidence reaches threshold
        if (confidence >= linkThreshold) {
          mergeCandidates.push({
            existingVehicleId: candidate.id,
            confidence: Math.min(confidence, 0.99),
            reasons,
            evidence: {
              ingest_url: parsed.url,
              ingest_year: parsed.year,
              ingest_make: parsed.make,
              ingest_model: parsed.model,
              ingest_location: parsed.location,
              ingest_price: parsed.price,
              ingest_mileage: parsed.mileage,
              candidate_id: candidate.id,
              candidate_location: candidate.location,
              candidate_mileage: candidate.mileage,
              candidate_price: candPrice,
            },
          });
        }
      }
    }
  }

  // ── No definitive match: Create new vehicle ───────────────────
  const vehicleData: Record<string, any> = {
    year: parsed.year,
    make: parsed.make,
    model: parsed.model,
    vin: parsed.vin || null,
    status: "discovered",
    primary_image_url: parsed.imageUrl || (parsed.imageUrls?.[0]) || null,
    source: platform && platform !== "unknown" ? platform : null,
  };

  // Populate everything we have (real vehicles columns only — the table has
  // engine_type, not engine, and no condition_notes column)
  if (parsed.description) vehicleData.description = parsed.description;
  if (parsed.mileage) vehicleData.mileage = parsed.mileage;
  if (parsed.engine) vehicleData.engine_type = parsed.engine;
  if (parsed.transmission) vehicleData.transmission = parsed.transmission;
  if (parsed.color) vehicleData.color = parsed.color;
  if (parsed.bodyStyle) vehicleData.body_style = parsed.bodyStyle;
  if (parsed.titleStatus) vehicleData.title_status = parsed.titleStatus;
  if (parsed.sellerName) vehicleData.seller_name = parsed.sellerName;
  if (parsed.price != null) {
    vehicleData.asking_price = parsed.price;
    vehicleData.price = Math.round(parsed.price);
  }
  if (parsed.location) {
    vehicleData.location = parsed.location;
    const { city, state } = parseLocation(parsed.location);
    if (city && state) {
      vehicleData.city = city;
      vehicleData.state = state;
    }
  }
  if (canonicalUrl) {
    vehicleData.listing_url = canonicalUrl;
    if (platform && platform !== "unknown" && platform !== "manual") {
      vehicleData.listing_source = platform;
    }
  }

  const { data: newVehicle, error } = await supabaseAdmin
    .from("vehicles")
    .insert(vehicleData)
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to create vehicle: ${error.message}`);
  }

  // If we have multiple images, insert them to vehicle_images
  const allImages = parsed.imageUrls || (parsed.imageUrl ? [parsed.imageUrl] : []);
  if (allImages.length > 0) {
    const imageRows = allImages.map((url: string, i: number) => ({
      vehicle_id: newVehicle.id,
      image_url: url,
      is_primary: i === 0,
      source: imageSourceFor(platform),
      is_external: true,
      source_url: parsed.url || null,
    }));
    await supabaseAdmin.from("vehicle_images").insert(imageRows);
  }

  // ── Create merge proposals for Tier 3 candidates ──────────────
  // Now that the new vehicle exists, we can properly reference it.
  // Per Entity Resolution Rules: Tier 3 does NOT auto-link.
  // Human/AI reviews the proposal and decides whether to merge.
  for (const candidate of mergeCandidates) {
    try {
      await supabaseAdmin
        .from("merge_proposals")
        .upsert({
          vehicle_a_id: candidate.existingVehicleId,
          vehicle_b_id: newVehicle.id,
          detection_source: "ingest-entity-resolution",
          ai_decision: "REVIEW",
          ai_confidence: candidate.confidence,
          ai_reasoning: candidate.reasons.join("; "),
          match_tier: 3,
          match_reason: candidate.reasons.join("; "),
          confidence: candidate.confidence,
          proposed_by: "ingest",
          proposed_at: new Date().toISOString(),
          status: "pending",
          evidence: candidate.evidence,
        }, { onConflict: "vehicle_a_id,vehicle_b_id", ignoreDuplicates: true });
    } catch (propErr: any) {
      // Non-fatal: merge proposal creation failure shouldn't block ingestion
      console.error("Merge proposal creation error:", propErr.message);
    }
  }

  return { vehicleId: newVehicle.id, isNew: true };
}

// Enrich an existing vehicle with new data (only fill NULLs, don't overwrite)
async function enrichVehicle(vehicleId: string, data: VehicleEnrichment, platform?: string | null) {
  const { data: existing } = await supabaseAdmin
    .from("vehicles")
    .select("description, mileage, engine_type, transmission, color, body_style, title_status, seller_name, asking_price, primary_image_url, location, city, state, listing_url, listing_source, vin")
    .eq("id", vehicleId)
    .single();

  if (!existing) return;

  const updates: Record<string, any> = {};

  if (!existing.description && data.description) updates.description = data.description;
  if (!existing.mileage && data.mileage) updates.mileage = data.mileage;
  if (!existing.engine_type && data.engine) updates.engine_type = data.engine;
  if (!existing.transmission && data.transmission) updates.transmission = data.transmission;
  if (!existing.color && data.color) updates.color = data.color;
  if (!existing.body_style && data.bodyStyle) updates.body_style = data.bodyStyle;
  if (!existing.title_status && data.titleStatus) updates.title_status = data.titleStatus;
  if (!existing.seller_name && data.sellerName) updates.seller_name = data.sellerName;
  if (!existing.asking_price && data.price != null) updates.asking_price = data.price;
  if (!existing.primary_image_url && (data.imageUrl || data.imageUrls?.[0])) {
    updates.primary_image_url = data.imageUrl || data.imageUrls![0];
  }
  if (!existing.location && data.location) {
    updates.location = data.location;
    if (!existing.city && !existing.state) {
      const { city, state } = parseLocation(data.location);
      if (city && state) {
        updates.city = city;
        updates.state = state;
      }
    }
  }
  if (!existing.listing_url && data.url) {
    updates.listing_url = normalizeListingUrl(data.url)?.normalized ?? data.url;
    if (!existing.listing_source && platform && platform !== "unknown" && platform !== "manual") {
      updates.listing_source = platform;
    }
  }
  if (!existing.vin && data.vin) updates.vin = data.vin;

  if (Object.keys(updates).length > 0) {
    await supabaseAdmin.from("vehicles").update(updates).eq("id", vehicleId);
  }

  // Add any new images
  const allImages = data.imageUrls || (data.imageUrl ? [data.imageUrl] : []);
  if (allImages.length > 0) {
    // Check which images already exist
    const { data: existingImages } = await supabaseAdmin
      .from("vehicle_images")
      .select("image_url")
      .eq("vehicle_id", vehicleId);

    const existingUrls = new Set((existingImages || []).map((i: any) => i.image_url));
    const newImages = allImages.filter((url: string) => !existingUrls.has(url));

    if (newImages.length > 0) {
      const hasPrimary = !!existing.primary_image_url;
      const imageRows = newImages.map((url: string, i: number) => ({
        vehicle_id: vehicleId,
        image_url: url,
        is_primary: !hasPrimary && i === 0,
        source: imageSourceFor(platform),
        is_external: true,
        source_url: data.url || null,
      }));
      await supabaseAdmin.from("vehicle_images").insert(imageRows);

      // Update primary_image_url if vehicle didn't have one
      if (!hasPrimary) {
        await supabaseAdmin.from("vehicles")
          .update({ primary_image_url: newImages[0] })
          .eq("id", vehicleId);
      }
    }
  }
}

// ── Auto-Enrichment via Existing Extractors ──────────────────────

interface EnrichedData {
  year?: number | null;
  make?: string | null;
  model?: string | null;
  price?: number | null;
  description?: string | null;
  image_url?: string | null;
  image_urls?: string[] | null;
  vin?: string | null;
  mileage?: number | null;
  engine?: string | null;
  transmission?: string | null;
  color?: string | null;
  body_style?: string | null;
  title_status?: string | null;
  condition?: string | null;
  location?: string | null;
  seller_name?: string | null;
  /** Canonicalized listing URL the extractor actually wrote to `vehicles.listing_url`, if it differs from the input URL. */
  listing_url?: string | null;
}

type EnrichResult =
  | { ok: true; data: EnrichedData }
  | { ok: false; skipped?: boolean; error: string };

async function tryAutoEnrich(url: string, platform: string): Promise<EnrichResult> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // BaT delegates to extract-bat-core, a self-contained writer (it creates or
  // conservatively updates the vehicle row itself, resolving by
  // discovery_url/bat_auction_url/listing_url/VIN). complete-bat-import — the
  // old mapping — was deleted in the March triage; its 404 left BaT rows
  // slug-shallow (found 2026-07-02). We call the writer, read the row back,
  // and return its fields; the downstream Tier-2 listing_url match links the
  // discovery to the same row instead of double-creating.
  if (platform === "bring_a_trailer") {
    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/extract-bat-core`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(75_000),
      });
      if (!resp.ok) {
        const bodyText = await resp.text().catch(() => "");
        return { ok: false, error: `extract-bat-core HTTP ${resp.status}: ${bodyText.slice(0, 200)}` };
      }
      const core = await resp.json();
      if (core.success === false || core.error) {
        return { ok: false, error: core.error || "extract-bat-core returned success=false" };
      }
      const batVehicleId =
        core.created_vehicle_ids?.[0] || core.updated_vehicle_ids?.[0] || null;
      if (!batVehicleId) {
        return { ok: false, error: "extract-bat-core wrote no vehicle (no created/updated ids)" };
      }
      // extract-bat-core only writes core identity/spec fields — it does NOT
      // extract comments (its own header comment says so: "Comments/bids are
      // handled separately by extract-auction-comments"). The documented
      // orchestrator that used to chain the two (complete-bat-import) is not
      // deployed (404 — confirmed 2026-07-07, same finding as the BaT-slug-
      // shallow incident this delegation branch already works around).
      // continuous-queue-processor independently chains extract-auction-
      // comments, but only for items routed through import_queue — this
      // ingest path bypasses that queue entirely, so without this trigger a
      // BaT vehicle created here would never get its auction_comments rows.
      // Fire-and-forget, gated on "no comments yet" so re-enrichment of an
      // already-matched vehicle doesn't redundantly re-extract every time.
      const { count: existingCommentCount } = await supabaseAdmin
        .from("auction_comments")
        .select("id", { count: "exact", head: true })
        .eq("vehicle_id", batVehicleId);
      if (!existingCommentCount) {
        fetch(`${supabaseUrl}/functions/v1/extract-auction-comments`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ auction_url: url, vehicle_id: batVehicleId }),
          signal: AbortSignal.timeout(120_000),
        }).catch((e: any) => console.warn(`Comment extraction trigger failed for ${batVehicleId}:`, e instanceof Error ? e.message : String(e)));
      }
      const { data: row, error: rowError } = await supabaseAdmin
        .from("vehicles")
        .select(
          "year, make, model, vin, mileage, color, transmission, body_style, title_status, description, sale_price, high_bid, price, asking_price, listing_location, primary_image_url, bat_seller"
        )
        .eq("id", batVehicleId)
        .maybeSingle();
      if (rowError || !row) {
        return { ok: false, error: `extract-bat-core wrote ${batVehicleId} but read-back failed: ${rowError?.message || "no row"}` };
      }
      return {
        ok: true,
        data: {
          year: row.year || null,
          make: row.make || null,
          model: row.model || null,
          price: row.sale_price || row.high_bid || row.price || row.asking_price || null,
          description: row.description || null,
          image_url: row.primary_image_url || null,
          image_urls: null, // extract-bat-core manages vehicle_images itself
          vin: row.vin || null,
          mileage: row.mileage || null,
          engine: null,
          transmission: row.transmission || null,
          color: row.color || null,
          body_style: row.body_style || null,
          title_status: row.title_status || null,
          condition: null,
          location: row.listing_location || null,
          seller_name: row.bat_seller || null,
          // extract-bat-core writes vehicles.listing_url through its own
          // canonicalUrl() (strips trailing slash). Adopting the exact
          // string it returns — rather than re-deriving it — guarantees
          // the downstream Tier-2c match in matchOrCreateVehicle finds
          // this same row instead of missing on a trailing-slash/www
          // mismatch and creating a duplicate vehicle for the same auction.
          listing_url: core.listing_url || null,
        },
      };
    } catch (err: any) {
      return { ok: false, error: `extract-bat-core delegate: ${err?.message || String(err)}` };
    }
  }

  // Map platform to extractor edge function
  const extractors: Record<string, string> = {
    cars_and_bids: "extract-cars-and-bids-core",
    hagerty: "extract-hagerty-listing",
  };

  // Use dedicated extractor if available, otherwise fall back to generic AI extraction
  const extractorName = extractors[platform] || "extract-vehicle-data-ai";

  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/${extractorName}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(75_000),
    });

    if (!resp.ok) {
      const bodyText = await resp.text().catch(() => "");
      return { ok: false, error: `${extractorName} HTTP ${resp.status}: ${bodyText.slice(0, 200)}` };
    }

    const result = await resp.json();

    // Editorial gate: extractor looked at the page and said "not a vehicle listing"
    if (result.skipped === true) {
      return { ok: false, skipped: true, error: result.skip_reason || result.reason || `${extractorName} skipped this page` };
    }
    if (result.success === false || result.error) {
      return { ok: false, error: result.error || `${extractorName} returned success=false` };
    }

    // Normalize across extractors (they have slightly different schemas):
    //   extract-vehicle-data-ai → { success, data: {...} }
    //   extract-craigslist      → { success, extracted: {...} }
    //   complete-bat-import     → { success, listing: {...} }
    //   others                  → { vehicle: {...} } or flat
    const vehicle = result.data || result.extracted || result.vehicle || result.listing || result;

    // Extraction that produced no identity is a failure, not an enrichment
    if (!vehicle || (!vehicle.year && !vehicle.make && !vehicle.vin)) {
      return { ok: false, error: `${extractorName} returned no identity fields (year/make/vin)` };
    }

    return {
      ok: true,
      data: {
        year: vehicle.year || null,
        make: vehicle.make || null,
        model: vehicle.model || null,
        price: vehicle.sale_price || vehicle.sold_price || vehicle.asking_price || vehicle.price || null,
        description: vehicle.description || vehicle.listing_description || null,
        image_url: vehicle.primary_image_url || vehicle.image_url || vehicle.images?.[0] || vehicle.image_urls?.[0] || null,
        image_urls: vehicle.image_urls || vehicle.images || null,
        vin: vehicle.vin || null,
        mileage: vehicle.mileage || null,
        engine: vehicle.engine || vehicle.engine_type || null,
        transmission: vehicle.transmission || null,
        color: vehicle.exterior_color || vehicle.color || null,
        body_style: vehicle.body_style || vehicle.body_type || null,
        title_status: vehicle.title_status || null,
        condition: vehicle.condition || null,
        location: vehicle.location || null,
        seller_name: vehicle.seller || vehicle.seller_username || vehicle.seller_name || null,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Auto-enrich failed for ${platform}:`, msg);
    return { ok: false, error: `${extractorName}: ${msg}` };
  }
}

// ── Single Ingestion ────────────────────────────────────────────

interface IngestInput {
  url?: string;
  text?: string;
  year?: number;
  make?: string;
  model?: string;
  vin?: string;
  price?: number;
  location?: string;
  seller_name?: string;
  notes?: string;
  tags?: string[];
  image_url?: string;
  image_urls?: string[];
  description?: string;
  mileage?: number;
  engine?: string;
  transmission?: string;
  color?: string;
  condition?: string;
  body_style?: string;
  title_status?: string;
  enrich?: boolean; // attempt to auto-enrich from source URL
  _source?: string; // source hint from caller (e.g. "facebook_saved")
  sold?: boolean; // sold status from caller
  // Parse-only mode: detect platform + parse identity, WRITE NOTHING, return
  // status "preview". For form prefill — creation stays at the caller's explicit
  // submit (Sign tier — .claude/rules/liveness-and-intent.md).
  preview?: boolean;
}

interface IngestResult {
  status: "created" | "matched" | "duplicate" | "rejected" | "error" | "preview";
  vehicle_id?: string | null;
  discovery_id?: string | null;
  is_new_vehicle?: boolean;
  source?: string | null;
  external_id?: string | null;
  error?: string;
  // Why a submission was rejected (minimum-viability gate)
  reason?: string;
  // Enrichment failed but platform was recognized — vehicle created with honest fields only
  enrichment_error?: string;
  // Validation gate fields (present when status=rejected or flagged)
  quality_score?: number;
  issues?: string[];
  suggestions?: Record<string, string>;
  needs_review?: boolean;
  // preview mode only: what was parsed without writing
  parsed?: { year: number | null; make: string | null; model: string | null };
  price?: number | null;
  location?: string | null;
}

/**
 * Coerce a location of unknown shape to the string the rest of ingest assumes.
 *
 * `location` is typed `string` everywhere downstream and used unguarded
 * (`.toLowerCase()` in the Tier-3 confidence scorer, `parseLocation()` on the
 * write path). A TypeScript annotation is not a runtime check: on 2026-07-26
 * extract-hagerty-listing returned Hagerty's GraphQL location OBJECT and every
 * ingest call in the poll died with "parsed.location.toLowerCase is not a
 * function" — 20/20. This is the single door extractor output comes through,
 * so one coercion here protects every consumer from every extractor.
 */
function normalizeLocation(loc: unknown): string | null {
  if (typeof loc === "string") return loc.trim() || null;
  if (loc && typeof loc === "object") {
    const o = loc as Record<string, unknown>;
    const parts = [o.city, o.state, o.country]
      .filter((p): p is string => typeof p === "string" && p.trim().length > 0);
    if (parts.length) return parts.join(", ");
    // Unknown object shape — drop it rather than stringify "[object Object]"
    // into a field that gets displayed and geocoded.
    return null;
  }
  return null;
}

async function ingestOne(input: IngestInput, userId: string | null): Promise<IngestResult> {
  try {
    // Strict boolean: a JSON string "false" must not silently turn a real ingest
    // into a preview (refuter finding, 2026-07-12).
    const isPreview = input.preview === true;

    // Callers post arbitrary JSON — normalize before anything reads it.
    input.location = normalizeLocation(input.location) ?? undefined;

    // Determine source
    let platform = "manual";
    let externalId: string | null = null;
    let parsed: ParsedVehicle = { year: null, make: null, model: null };
    let listingUrl: string | null = input.url || null;

    // True when identity resolution can't rely on Tier 2 URL-matching at
    // all — currently: an unresolved Craigslist share URL. Passed into
    // matchOrCreateVehicle so Tier 3 uses its lower confidence floor and
    // still queues a reviewable merge_proposal instead of a fully silent
    // duplicate vehicle.
    let identityUncertain = false;

    if (input.url) {
      const source = detectSource(input.url);
      platform = source.platform;
      externalId = source.externalId;

      // Craigslist share links hide the real listing — resolve to the
      // canonical regional URL and use it everywhere (dedup, listing_url,
      // enrichment). If resolution fails, keep the share URL; the platform
      // is still recognized as craigslist. Retry once — Craigslist fetches
      // are frequently transient-blocked (verified 2026-07-01/02), and a
      // second attempt materially reduces how often we fall back to the
      // uncertain-identity path below.
      // Skipped in preview: resolution calls archiveFetch (external fetch +
      // listing_page_snapshots insert) — preview must stay zero-fetch/zero-write.
      // A CL share URL in preview simply yields no slug → caller falls back to
      // manual entry.
      if (platform === "craigslist" && CRAIGSLIST_SHARE_RE.test(input.url) && !isPreview) {
        let canonical = await resolveCraigslistShareUrl(input.url);
        if (!canonical) canonical = await resolveCraigslistShareUrl(input.url);
        if (canonical) {
          listingUrl = canonical;
          const canonicalSource = detectSource(canonical);
          if (canonicalSource.externalId) externalId = canonicalSource.externalId;
        } else {
          identityUncertain = true;
        }
      }
    }

    // Source hint override (e.g. from facebook_saved connector)
    if (input._source === "facebook_saved") {
      platform = "facebook-saved";
    }

    // Parse vehicle info from available data
    let identityIsSlugGuess = false;
    if (input.year && input.make) {
      parsed = { year: input.year, make: input.make, model: input.model || null };
    } else if (input.text) {
      parsed = parseVehicleTitle(input.text);
      if (!input.price) input.price = parsePrice(input.text) ?? undefined;
      if (!input.location) {
        const loc = parseLocation(input.text);
        if (loc.city && loc.state) input.location = `${loc.city}, ${loc.state}`;
      }
    } else if (listingUrl) {
      // Try parsing vehicle info from URL slug (works for Craigslist, classifieds).
      // Identity only — NEVER derive a price from a URL slug (a slug year like
      // "1968" is not an asking price).
      const slugTitle = extractTitleFromUrlSlug(listingUrl);
      if (slugTitle) {
        parsed = parseVehicleTitle(slugTitle);
        // A "pure" slug guess: the caller supplied NO explicit identity
        // fields at all, so year/make/model came entirely from parsing the
        // URL path. This is the specific low-trust case the minimum-
        // viability gate below exists to catch — it is NOT the same thing
        // as "the URL's platform isn't recognized."
        identityIsSlugGuess = !input.year && !input.make && !input.model;
      }
      // Fall back to explicit fields if slug parsing didn't find anything
      if (!parsed.year) parsed.year = input.year || null;
      if (!parsed.make) parsed.make = input.make || null;
      if (!parsed.model) parsed.model = input.model || null;
    }

    // Duplicate check: same user + same source URL = return existing discovery
    if (listingUrl && userId) {
      const { data: existingDiscovery } = await supabaseAdmin
        .from("user_vehicle_discoveries")
        .select("id, vehicle_id")
        .eq("user_id", userId)
        .eq("source_url", listingUrl)
        .limit(1)
        .single();

      if (existingDiscovery) {
        return {
          status: "duplicate",
          vehicle_id: existingDiscovery.vehicle_id,
          discovery_id: existingDiscovery.id,
          is_new_vehicle: false,
          source: platform,
          external_id: externalId,
        };
      }
    }

    // PREVIEW MODE — parse-only, never write. Returns what could be read from the
    // URL/text so a form can prefill; creation happens at the caller's explicit
    // submit (Sign tier — .claude/rules/liveness-and-intent.md). Deliberately
    // placed BEFORE tryAutoEnrich: platform extractors (extract-bat-core et al)
    // write vehicles as a side effect, which preview must never trigger. The
    // user-dedupe check above still runs first (read-only), so a URL the user
    // already ingested returns "duplicate" + vehicle_id and the caller can
    // navigate instead of prefilling.
    if (isPreview) {
      return {
        status: "preview",
        source: platform,
        external_id: externalId,
        parsed,
        price: input.price ?? null,
        location: input.location ?? null,
      };
    }

    // Auto-enrich: call the platform's extractor to get full listing data
    let enrichmentSucceeded = false;
    let enrichmentSkipped = false;
    let enrichmentError: string | null = null;

    if (input.enrich !== false && listingUrl && !input.description) {
      const enrichResult = await tryAutoEnrich(listingUrl, platform);
      if (enrichResult.ok) {
        enrichmentSucceeded = true;
        const enriched = enrichResult.data;
        // The extractor (e.g. extract-bat-core) may have written the vehicle
        // under its own canonicalized URL, which can differ from the URL we
        // were given (trailing slash, www, query params). Adopt it so the
        // Tier-2c listing_url match and the final discovery upsert (both
        // below) agree with what was actually written, instead of missing
        // and creating a second vehicle.
        if (enriched.listing_url) listingUrl = enriched.listing_url;
        if (!input.year && enriched.year) input.year = enriched.year;
        if (!input.make && enriched.make) input.make = enriched.make;
        if (!input.model && enriched.model) input.model = enriched.model;
        if (!input.price && enriched.price) input.price = enriched.price;
        if (!input.description && enriched.description) input.description = enriched.description;
        if (!input.image_url && enriched.image_url) input.image_url = enriched.image_url;
        if (!input.image_urls && enriched.image_urls) input.image_urls = enriched.image_urls;
        if (!input.vin && enriched.vin) input.vin = enriched.vin;
        if (!input.mileage && enriched.mileage) input.mileage = enriched.mileage;
        if (!input.engine && enriched.engine) input.engine = enriched.engine;
        if (!input.transmission && enriched.transmission) input.transmission = enriched.transmission;
        if (!input.color && enriched.color) input.color = enriched.color;
        if (!input.body_style && enriched.body_style) input.body_style = enriched.body_style;
        if (!input.title_status && enriched.title_status) input.title_status = enriched.title_status;
        if (!input.condition && enriched.condition) input.condition = enriched.condition;
        if (!input.location && enriched.location) {
          input.location = normalizeLocation(enriched.location) ?? undefined;
        }
        if (!input.seller_name && enriched.seller_name) input.seller_name = enriched.seller_name;
        // Extracted identity beats slug-derived guesses (caller-explicit fields
        // were already merged into input above, so they still win)
        if (enriched.year && enriched.make) {
          parsed = {
            year: input.year || enriched.year,
            make: input.make || enriched.make,
            model: input.model || enriched.model || parsed.model,
          };
        }
      } else {
        enrichmentSkipped = enrichResult.skipped === true;
        enrichmentError = enrichResult.error;
        console.error(`Enrichment failed for ${listingUrl} (${platform}): ${enrichmentError}`);
      }
    }

    // ── MINIMUM-VIABILITY GATE ──────────────────────────────────────
    // Never mint a stub from a URL slug guess. Creating a vehicle requires
    // full identity (year+make+model) AND a trusted origin (recognized
    // platform or a successful extraction). No silent green.
    if (enrichmentSkipped) {
      // The extractor's editorial gate said this page is not a vehicle listing
      return {
        status: "rejected",
        reason: `extractor skipped page: ${enrichmentError}`,
        source: platform,
        external_id: externalId,
      };
    }
    if (!parsed.year || !parsed.make || !parsed.model) {
      return {
        status: "rejected",
        reason: `insufficient identity: year=${parsed.year ?? "?"} make=${parsed.make ?? "?"} model=${parsed.model ?? "?"} — need all three`,
        enrichment_error: enrichmentError || undefined,
        source: platform,
        external_id: externalId,
      };
    }
    // A pure URL-slug guess is exactly the "stub" this gate exists to block
    // — UNLESS it's trusted by either of two independent paths: a
    // recognized platform (its URL pattern is validated, so we trust the
    // slug even without a live fetch succeeding) or a successful
    // enrichment. Caller-supplied year/make/model (explicit fields, free
    // text) never reaches this branch at all — identityIsSlugGuess is only
    // ever true when the caller supplied NONE of year/make/model, so
    // explicit/text-sourced identity is unconditionally exempt regardless
    // of platform. (Previously this checked `platform === "unknown"` alone,
    // which rejected explicit/text-sourced identity submitted alongside a
    // URL to any unrecognized-but-real site, e.g. Hemmings, or a manually-
    // typed AddVehicle form with a cars.com reference link — fixed by
    // scoping the platform check to the slug-guess case specifically,
    // instead of dropping it.)
    if (identityIsSlugGuess && platform === "unknown" && !enrichmentSucceeded) {
      return {
        status: "rejected",
        reason: enrichmentError
          ? `unrecognized platform, unresolved URL-slug guess, and enrichment failed: ${enrichmentError}`
          : "unrecognized platform, identity derived only from a URL slug guess, with no successful enrichment — refusing to create from URL guesswork",
        enrichment_error: enrichmentError || undefined,
        source: platform,
        external_id: externalId,
      };
    }

    // ── VALIDATION GATE ─────────────────────────────────────────────
    // Normalize + validate before writing to DB. Catches: wrong make from
    // VIN, RPO codes in body_style, impossible fuel/year combos, garbage.
    const candidateData: Record<string, any> = {
      year: parsed.year ?? input.year,
      make: parsed.make ?? input.make,
      model: parsed.model ?? input.model,
      vin: input.vin ?? null,
      price: input.price ?? null,
      asking_price: input.price ?? null,
      description: input.description || input.notes || null,
      mileage: input.mileage ?? null,
      engine: input.engine ?? null,
      transmission: input.transmission ?? null,
      color: input.color ?? null,
      body_style: input.body_style ?? null,
      fuel_type: (input as any).fuel_type ?? null,
      condition: input.condition ?? null,
    };

    // 1) Normalize fields (make aliases, VIN cleanup, RPO→trim, etc.)
    normalizeVehicleFields(candidateData);

    // 2) VIN cross-check: if VIN present, verify make against VIN prefix
    // Handles both modern 17-char and pre-1981 shorter VINs
    const vinIssues: string[] = [];
    const suggestions: Record<string, string> = {};
    if (candidateData.vin && typeof candidateData.vin === "string" && candidateData.vin.length >= 6) {
      const decoded = decodeVin(candidateData.vin);
      if (decoded.make && candidateData.make) {
        const vinMake = normalizeMake(decoded.make);
        const claimedMake = normalizeMake(candidateData.make);
        if (vinMake && claimedMake && vinMake !== claimedMake) {
          vinIssues.push(`vin_make_mismatch: VIN prefix indicates ${vinMake}, claimed ${claimedMake}`);
          suggestions.make = `VIN indicates ${vinMake}, not ${claimedMake}`;
        }
      }
      // Pre-1981: if VIN decoded a model, cross-check against claimed model
      if (decoded.is_pre_1981 && decoded.model && candidateData.model) {
        const vinModel = decoded.model.toLowerCase();
        const claimedModel = String(candidateData.model).toLowerCase();
        // Only flag if models are clearly different vehicle lines
        // e.g. VIN says Corvette but claim says Camaro (or vice versa)
        const conflictingModels = [
          ['corvette', 'camaro'], ['corvette', 'chevelle'], ['corvette', 'nova'],
          ['camaro', 'chevelle'], ['camaro', 'nova'], ['camaro', 'corvette'],
        ];
        for (const [a, b] of conflictingModels) {
          if (vinModel.includes(a) && claimedModel.includes(b)) {
            vinIssues.push(`vin_model_mismatch: VIN indicates ${decoded.model}, claimed ${candidateData.model}`);
            suggestions.model = `VIN indicates ${decoded.model}, not ${candidateData.model}`;
            break;
          }
        }
      }
    }

    // 3) Cross-field sanity checks
    const crossFieldIssues: string[] = [];
    const yr = Number(candidateData.year) || 0;
    if (yr > 0 && yr < 1990 && candidateData.fuel_type &&
        /^electric$/i.test(String(candidateData.fuel_type))) {
      crossFieldIssues.push(`anachronistic_fuel: Electric fuel_type on ${yr} vehicle`);
      suggestions.fuel_type = `Electric vehicles did not exist in ${yr}`;
    }

    // 4) Quality gate (uses normalizeVehicleFields internally, scores identity/specs/cleanliness)
    const sourceType = platform === "facebook_marketplace" ? "marketplace" as const
      : ["bring_a_trailer", "cars_and_bids", "hagerty"].includes(platform) ? "auction" as const
      : "other" as const;

    const gateResult = qualityGate(candidateData, {
      source: platform,
      sourceType,
    });

    // Merge VIN + cross-field issues into gate result
    gateResult.issues.push(...vinIssues, ...crossFieldIssues);

    // Determine if we should reject
    if (gateResult.action === "reject" || vinIssues.some(i => i.startsWith("vin_make_mismatch"))) {
      // VIN-make mismatch is a hard reject — the data is verifiably wrong
      const isVinMismatch = vinIssues.some(i => i.startsWith("vin_make_mismatch"));
      if (isVinMismatch) {
        gateResult.action = "reject";
      }
      // A `reason` is required here (not just `issues`) so callers like
      // poll-listing-feeds can tell a deterministic quality-gate reject
      // (this exact URL will fail the same way on every retry) apart from
      // a transient one, and ledger it as permanently skipped instead of
      // re-attempting it on every future poll.
      return {
        status: "rejected",
        reason: isVinMismatch
          ? `quality_gate_reject: vin_make_mismatch — ${gateResult.issues.join("; ")}`
          : `quality_gate_reject: ${gateResult.issues.join("; ") || "score below acceptance threshold"}`,
        quality_score: gateResult.score,
        issues: gateResult.issues,
        suggestions: Object.keys(suggestions).length > 0 ? suggestions : undefined,
        source: platform,
        external_id: externalId,
      };
    }

    // Apply cleaned/normalized data back to parsed + input
    parsed = {
      year: gateResult.cleaned.year ?? parsed.year,
      make: gateResult.cleaned.make ?? parsed.make,
      model: gateResult.cleaned.model ?? parsed.model,
    };
    if (gateResult.cleaned.vin) input.vin = gateResult.cleaned.vin;
    if (gateResult.cleaned.transmission) input.transmission = gateResult.cleaned.transmission;
    if (gateResult.cleaned.color) input.color = gateResult.cleaned.color;
    if (gateResult.cleaned.engine) input.engine = gateResult.cleaned.engine;

    const needsReview = gateResult.action === "flag_for_review";

    // Match or create vehicle with ALL available enrichment data
    const match = await matchOrCreateVehicle({
      ...parsed,
      vin: input.vin,
      url: listingUrl,
      price: input.price,
      location: input.location,
      imageUrl: input.image_url,
      imageUrls: input.image_urls,
      description: input.description || input.notes,
      mileage: input.mileage,
      engine: input.engine,
      transmission: input.transmission,
      color: input.color,
      condition: input.condition,
      bodyStyle: input.body_style,
      titleStatus: input.title_status,
      sellerName: input.seller_name,
    }, platform, { identityUncertain });

    // Condition is free text with no home on the vehicles table — record it
    // as an observation so it's not silently discarded (see
    // recordConditionObservation for why).
    if (input.condition && match.vehicleId) {
      await recordConditionObservation(match.vehicleId, platform, input.condition, listingUrl);
    }

    // Facebook Saved: set status based on sold flag
    if (platform === "facebook-saved" && match.vehicleId) {
      const isSold = !!(input as any).sold;
      const fbUpdates: Record<string, any> = {
        source: "facebook-saved",
        discovery_source: "facebook-saved",
        status: isSold ? "sold" : "discovered",
        auction_status: isSold ? "ended" : null,
        is_for_sale: !isSold,
      };
      if (input.seller_name) {
        fbUpdates.seller_name = input.seller_name;
      }
      await supabaseAdmin.from("vehicles")
        .update(fbUpdates)
        .eq("id", match.vehicleId);

      // Create observation in the ontology layer
      try {
        const title = [parsed.year, parsed.make, parsed.model].filter(Boolean).join(" ");
        const structuredData: Record<string, unknown> = {
          year: parsed.year, make: parsed.make, model: parsed.model,
          sold: isSold, is_for_sale: !isSold,
        };
        if (input.price) structuredData.price = input.price;
        if (input.mileage) structuredData.mileage = input.mileage;
        if (input.transmission) structuredData.transmission = input.transmission;
        if (input.color) structuredData.color = input.color;
        if (input.seller_name) structuredData.seller_name = input.seller_name;
        if (input.location) structuredData.location = input.location;

        const contentText = [title, input.price ? `$${input.price}` : null, input.location].filter(Boolean).join(" ");

        // Look up source_id for facebook-saved
        const { data: srcRow } = await supabaseAdmin
          .from("observation_sources")
          .select("id")
          .eq("slug", "facebook-saved")
          .single();

        if (srcRow) {
          await supabaseAdmin.from("vehicle_observations").upsert({
            vehicle_id: match.vehicleId,
            vehicle_match_confidence: 1.0,
            observed_at: new Date().toISOString(),
            source_id: srcRow.id,
            source_url: listingUrl,
            source_identifier: `fb-saved-${match.vehicleId}`,
            kind: "listing",
            content_text: contentText,
            content_hash: await crypto.subtle.digest("SHA-256",
              new TextEncoder().encode(`facebook-saved:listing:${match.vehicleId}:${contentText}`)
            ).then(buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("")),
            structured_data: structuredData,
          }, { onConflict: "source_id,source_identifier,kind,content_hash", ignoreDuplicates: true });

          // Create field_evidence for each non-null spec
          const evidenceRows: Array<Record<string, unknown>> = [];
          const specs: Array<[string, unknown, string]> = [
            ["asking_price", input.price, "FB Marketplace listing price"],
            ["mileage", input.mileage, "Seller-reported mileage on FB listing"],
            ["transmission", input.transmission, "Seller-reported transmission on FB listing"],
            ["color", input.color, "Seller-reported color on FB listing"],
            ["year", parsed.year, "Year from FB listing title"],
            ["make", parsed.make, "Make from FB listing title"],
            ["model", parsed.model, "Model from FB listing title"],
            ["seller_name", input.seller_name, "FB Marketplace seller profile name"],
          ];
          for (const [field, val, ctx] of specs) {
            if (val) {
              evidenceRows.push({
                vehicle_id: match.vehicleId,
                field_name: field,
                proposed_value: String(val),
                source_type: "fb_marketplace_listing",
                source_confidence: 55,
                extraction_context: ctx,
                status: "accepted",
              });
            }
          }
          if (evidenceRows.length > 0) {
            await supabaseAdmin.from("field_evidence")
              .upsert(evidenceRows, {
                onConflict: "vehicle_id,field_name,source_type,proposed_value",
                ignoreDuplicates: true,
              });
          }
        }
      } catch (obsErr: any) {
        console.error("Observation creation error (non-fatal):", obsErr.message);
      }
    }

    // If flagged for review, mark the vehicle
    if (needsReview && match.vehicleId) {
      await supabaseAdmin.from("vehicles")
        .update({ needs_review: true })
        .eq("id", match.vehicleId);
    }

    // If this is a marketplace listing, upsert it and get the listing ID
    let marketplaceListingId: string | null = null;
    if (listingUrl && platform === "facebook_marketplace" && externalId) {
      const { data: listingData } = await supabaseAdmin
        .from("marketplace_listings")
        .upsert(
          {
            facebook_id: externalId,
            platform: "facebook_marketplace",
            url: listingUrl,
            title: parsed.year && parsed.make
              ? `${parsed.year} ${parsed.make} ${parsed.model || ""}`.trim()
              : null,
            price: input.price ? Math.round(input.price) : null,
            current_price: input.price || null,
            location: input.location || null,
            parsed_year: parsed.year,
            parsed_make: parsed.make?.toLowerCase() || null,
            parsed_model: parsed.model?.toLowerCase() || null,
            seller_name: input.seller_name || null,
            description: input.notes || null,
            image_url: input.image_url || null,
            vehicle_id: match.vehicleId,
            status: "active",
            first_seen_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
            scraped_at: new Date().toISOString(),
            search_query: "nuke-ingest",
          },
          { onConflict: "facebook_id" }
        )
        .select("id")
        .single();

      marketplaceListingId = listingData?.id || null;
    }

    // Link discovery to user profile
    let discoveryId: string | null = null;
    if (userId) {
      const discoveryTitle = parsed.year && parsed.make
        ? `${parsed.year} ${parsed.make} ${parsed.model || ""}`.trim()
        : input.text || listingUrl || "Unknown vehicle";

      const { data: discovery, error: discError } = await supabaseAdmin
        .from("user_vehicle_discoveries")
        .upsert(
          {
            user_id: userId,
            vehicle_id: match.vehicleId,
            source_platform: platform,
            source_url: listingUrl,
            source_external_id: externalId,
            discovered_price: input.price || null,
            discovered_location: input.location || null,
            discovered_seller_name: input.seller_name || null,
            discovered_title: discoveryTitle,
            interaction_status: "discovered",
            notes: input.notes || null,
            tags: input.tags || [],
            marketplace_listing_id: marketplaceListingId,
            discovered_at: new Date().toISOString(),
          },
          {
            onConflict: "user_id,vehicle_id,source_url",
            ignoreDuplicates: false,
          }
        )
        .select("id")
        .single();

      if (discError) {
        console.error("Discovery link error:", discError.message);
      } else {
        discoveryId = discovery?.id || null;
      }
    }

    // Enrichment failed but platform was recognized: created with honest
    // fields only — say so, and lower the quality score. No silent green.
    const qualityScore = enrichmentError
      ? Math.max(0, Math.round(gateResult.score * 0.7 * 100) / 100)
      : gateResult.score;

    return {
      status: match.isNew ? "created" : "matched",
      vehicle_id: match.vehicleId,
      discovery_id: discoveryId,
      is_new_vehicle: match.isNew,
      source: platform,
      external_id: externalId,
      enrichment_error: enrichmentError || undefined,
      quality_score: qualityScore,
      issues: gateResult.issues.length > 0 ? gateResult.issues : undefined,
      needs_review: needsReview || undefined,
    };
  } catch (err: any) {
    return {
      status: "error",
      error: err.message,
    };
  }
}

// ── Serve ───────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // GET → return schema documentation for agent self-discovery
  if (req.method === "GET") {
    return new Response(JSON.stringify({
      name: "nuke.ingest",
      description: "Universal vehicle ingestion endpoint. Accepts structured data, URLs, or free text.",
      methods: { POST: "Ingest vehicle(s)", GET: "This schema documentation" },
      fields: {
        url:          { type: "string",   required: false, example: "https://facebook.com/marketplace/item/123456", description: "Source listing URL — auto-detects platform" },
        text:         { type: "string",   required: false, example: "1980 Chevy C10 $27,500 Greeneville TN", description: "Free-text vehicle description — parsed for year/make/model/price/location" },
        year:         { type: "number",   required: false, example: 1978, description: "Model year (1885–current+2)" },
        make:         { type: "string",   required: false, example: "Chevrolet", description: "Manufacturer. Aliases normalized: Chevy→Chevrolet, VW→Volkswagen, etc." },
        model:        { type: "string",   required: false, example: "Caprice Classic", description: "Model name" },
        vin:          { type: "string",   required: false, example: "1GCEK14L9EJ147915", description: "VIN — checksum validated, cross-checked against make" },
        price:        { type: "number",   required: false, example: 10500, description: "Asking or sale price in USD" },
        location:     { type: "string",   required: false, example: "Sun City, AZ", description: "Seller location (City, ST)" },
        mileage:      { type: "number",   required: false, example: 83000, description: "Odometer reading in miles" },
        engine:       { type: "string",   required: false, example: "5.7L V8", description: "Engine description" },
        transmission: { type: "string",   required: false, example: "TH350 Automatic", description: "Normalized: auto→Automatic, 4x4→4WD, etc." },
        color:        { type: "string",   required: false, example: "White", description: "Exterior color" },
        condition:    { type: "string",   required: false, example: "Good", description: "Condition notes" },
        body_style:   { type: "string",   required: false, example: "Pickup", description: "Body style: Coupe, Sedan, Convertible, Pickup, SUV, etc." },
        title_status: { type: "string",   required: false, example: "clean", description: "Title status: clean, salvage, rebuilt, none" },
        description:  { type: "string",   required: false, example: "Original paint, matching numbers 350", description: "Full listing description" },
        image_url:    { type: "string",   required: false, description: "Primary image URL" },
        image_urls:   { type: "string[]", required: false, description: "Array of image URLs" },
        seller_name:  { type: "string",   required: false, description: "Seller display name" },
        notes:        { type: "string",   required: false, description: "User notes about the vehicle" },
        tags:         { type: "string[]", required: false, example: ["project", "barn find"], description: "User-defined tags" },
        enrich:       { type: "boolean",  required: false, default: true, description: "Auto-enrich from source URL extractors" },
        preview:      { type: "boolean",  required: false, default: false, description: "Parse-only: detect platform + parse identity, write NOTHING, return status 'preview' with {parsed, price, location}. For form prefill — creation stays at the caller's explicit submit." },
        batch:        { type: "array",    required: false, description: "Array of up to 50 items (each an object with fields above)" },
        user_id:      { type: "string",   required: false, description: "Explicit user ID (service role only)" },
      },
      validation: {
        description: "All submissions pass through a quality gate before DB write",
        checks: [
          "Make normalization (107 aliases: Chevy→Chevrolet, merc→Mercedes-Benz, etc.)",
          "VIN checksum validation (MOD11 for 17-char VINs)",
          "VIN-make cross-check (rejects Corvette VIN filed as Camaro)",
          "Year bounds (< 1885 or > currentYear+2 rejected)",
          "RPO codes in body_style moved to trim (L79 Pickup → body_style=Pickup, trim=L79)",
          "Transmission normalization (auto→Automatic, 4x4→4WD)",
          "HTML/pollution detection in text fields",
          "Cross-field sanity (year < 1990 + Electric fuel → flagged)",
          "Quality score 0-1 (reject < 0.2, review < 0.5, accept ≥ 0.5)",
        ],
      },
      responses: {
        created:  { description: "New vehicle created. If the source extractor failed, enrichment_error is set and quality_score is lowered — the row holds honest fields only.", fields: ["vehicle_id", "quality_score", "issues", "enrichment_error"] },
        matched:  { description: "Matched existing vehicle (enriched)", fields: ["vehicle_id", "quality_score"] },
        duplicate:{ description: "Same user+URL already ingested", fields: ["vehicle_id", "discovery_id"] },
        rejected: { description: "Failed validation or minimum-viability gate (need year+make+model AND a recognized platform or successful extraction)", fields: ["reason", "quality_score", "issues", "suggestions"] },
        preview:  { description: "preview:true — parsed identity only, nothing written", fields: ["parsed", "price", "location", "source", "external_id"] },
        error:    { description: "Server error", fields: ["error"] },
      },
      example_curl: 'curl -X POST .../functions/v1/ingest -H "Authorization: Bearer <key>" -H "Content-Type: application/json" -d \'{"year":1978,"make":"Chevrolet","model":"Caprice Classic","price":10500,"location":"Sun City, AZ"}\'',
    }, null, 2), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "GET or POST only" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Auth — determine the acting user
  let userId: string | null = null;
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const { data: { user } } = await supabaseAdmin.auth.getUser(token);
    if (user) userId = user.id;
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Allow service role to specify user_id explicitly
  if (body.user_id && !userId) {
    userId = body.user_id;
  }

  // Batch mode
  if (body.batch && Array.isArray(body.batch)) {
    if (body.batch.length > 50) {
      return new Response(JSON.stringify({ error: "Max 50 per batch" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results = await Promise.all(
      // Top-level preview:true propagates to every batch item (an explicit
      // item-level preview wins) — without this, {"preview":true,"batch":[...]}
      // silently ran the FULL write path (refuter finding, 2026-07-12).
      body.batch.map((item: IngestInput) =>
        ingestOne({ preview: body.preview === true, ...item }, userId)
      )
    );

    const summary = {
      total: results.length,
      created: results.filter(r => r.status === "created").length,
      matched: results.filter(r => r.status === "matched").length,
      duplicates: results.filter(r => r.status === "duplicate").length,
      rejected: results.filter(r => r.status === "rejected").length,
      errors: results.filter(r => r.status === "error").length,
    };

    return new Response(
      JSON.stringify({ results, summary }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // Single mode
  const result = await ingestOne(body as IngestInput, userId);

  const httpStatus = result.status === "error" ? 500 : 200;

  return new Response(JSON.stringify(result), {
    status: httpStatus,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
