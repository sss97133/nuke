import "jsr:@supabase/functions-js/edge-runtime.d.ts";
/**
 * BONHAMS TYPESENSE EXTRACTOR
 *
 * Pulls vehicle data directly from Bonhams' public Typesense search API.
 * No web scraping or Firecrawl needed — structured JSON straight from the source.
 *
 * API details:
 *   Host: api01.bonhams.com
 *   Collection: lots (filter department.code:MOT-CAR for cars)
 *   ~33,500 cars available, ~24,500 with sold (hammer) prices
 *
 * Modes:
 *   POST { "mode": "search", "query": "ferrari", "batch_size": 50, "page": 1 }
 *     → Search and return results
 *
 *   POST { "mode": "ingest", "query": "*", "batch_size": 250 }
 *     → Paginate through ALL results and upsert into import_queue
 *
 *   POST { "mode": "ingest", "filter": "price.hammerPrice:>0", "batch_size": 250 }
 *     → Ingest only sold cars
 *
 *   POST { "mode": "stats" }
 *     → Return count of available cars and import_queue overlap
 *
 * Deploy: supabase functions deploy extract-bonhams-typesense --no-verify-jwt
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// ─── Typesense API config ─────────────────────────────────────────────────────

const TYPESENSE_HOST = "https://api01.bonhams.com";
const TYPESENSE_COLLECTION = "lots";
const TYPESENSE_API_KEY = "7YZqOyG0twgst4ACc2VuCyZxpGAYzM0weFTLCC20FQY";
const DEPARTMENT_FILTER = "department.code:MOT-CAR";

const EXTRACTOR_VERSION = "bonhams-typesense-v1";
const MAX_PER_PAGE = 250; // Typesense max

// ─── Known multi-word makes for title parsing ─────────────────────────────────

const KNOWN_MAKES = [
  "Alfa Romeo", "Aston Martin", "Austin-Healey", "Mercedes-Benz", "Rolls-Royce",
  "Land Rover", "De Tomaso", "Facel Vega", "Hispano-Suiza", "Brough Superior",
  "Pierce-Arrow", "De Dion-Bouton", "Isotta Fraschini", "Invicta",
  "AC", "BMW", "Bentley", "Bugatti", "Cadillac", "Chevrolet", "Chrysler",
  "Citroën", "Daimler", "Delage", "Delahaye", "Dodge", "Ferrari", "Fiat",
  "Ford", "Jaguar", "Jensen", "Lamborghini", "Lancia", "Lincoln", "Lotus",
  "Maserati", "McLaren", "MG", "Morgan", "Oldsmobile", "Packard", "Peugeot",
  "Plymouth", "Pontiac", "Porsche", "Renault", "Riley", "Rover", "Shelby",
  "Singer", "Studebaker", "Sunbeam", "Talbot", "Toyota", "Triumph",
  "TVR", "Vauxhall", "Volvo", "Volkswagen",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#\d+;/g, "")
    .replace(/&[a-z]+;/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── Title parser: "1966 Ferrari 330 GT Chassis no. 8023 Engine no. 8023" ─────

interface ParsedTitle {
  year: number | null;
  make: string | null;
  model: string | null;
  chassis: string | null;
}

function parseTitle(title: string): ParsedTitle {
  const result: ParsedTitle = { year: null, make: null, model: null, chassis: null };
  if (!title) return result;

  // Extract chassis/VIN from title
  // Patterns: "Chassis no. XXXXX", "Chassis no XXXXX", "VIN XXXXX"
  const chassisPatterns = [
    /Chassis\s+no\.?\s+([A-Z0-9*-]+(?:\s+[A-Z0-9*-]+)?)/i,
    /VIN[:\s]+([A-HJ-NPR-Z0-9]{17})/i,
    /Frame\s+no\.?\s+([A-Z0-9*-]+)/i,
  ];
  for (const pat of chassisPatterns) {
    const m = title.match(pat);
    if (m) {
      result.chassis = m[1].trim().toUpperCase();
      break;
    }
  }

  // Strip chassis/engine suffixes for cleaner parsing
  let clean = title
    .replace(/\s*Chassis\s+no\.?\s+.*/i, "")
    .replace(/\s*Engine\s+no\.?\s+.*/i, "")
    .replace(/\s*Frame\s+no\.?\s+.*/i, "")
    .replace(/\s*VIN[:\s]+.*/i, "")
    .trim();

  // Year: leading 4-digit year (1886-2030)
  const yearMatch = clean.match(/^(\d{4})\s+/);
  if (yearMatch) {
    const y = parseInt(yearMatch[1], 10);
    if (y >= 1886 && y <= 2030) {
      result.year = y;
      clean = clean.slice(yearMatch[0].length).trim();
    }
  }
  // Fallback: "c.1960" or "Circa 1960"
  if (!result.year) {
    const circaMatch = clean.match(/(?:c\.?\s*|circa\s+)(\d{4})/i);
    if (circaMatch) {
      const y = parseInt(circaMatch[1], 10);
      if (y >= 1886 && y <= 2030) {
        result.year = y;
        clean = clean.replace(circaMatch[0], "").trim();
      }
    }
  }

  // Make: check multi-word makes first, then take first word
  const lowerClean = clean.toLowerCase();
  let foundMake: string | null = null;
  for (const make of KNOWN_MAKES) {
    if (lowerClean.startsWith(make.toLowerCase())) {
      foundMake = make;
      clean = clean.slice(make.length).trim();
      break;
    }
  }
  if (!foundMake && clean.length > 0) {
    // Hyphenated makes: "Harley-Davidson", unknown compound
    const firstWordMatch = clean.match(/^([A-Za-zÀ-ÿ][\w-]*(?:\s[A-Za-zÀ-ÿ][\w-]*)?)\s/);
    if (firstWordMatch) {
      foundMake = firstWordMatch[1];
      clean = clean.slice(firstWordMatch[0].length).trim();
    } else {
      foundMake = clean;
      clean = "";
    }
  }
  result.make = foundMake;

  // Model: everything remaining (strip trailing punctuation)
  if (clean.length > 0) {
    result.model = clean.replace(/[,;]+$/, "").trim() || null;
  }

  return result;
}

// ─── Map Bonhams Typesense doc → our standard vehicle format ──────────────────

interface BonhamsDoc {
  id: string;
  title: string;
  slug: string;
  auctionId: string;
  lotId: string;
  lotNo: { full: string; number: number; letter: string };
  lotUniqueId: string;
  lotItemId: string;
  catalogDesc: string;
  styledDescription: string;
  footnotes: string;
  heading: string;
  brand: string;
  status: string;
  image: {
    url: string;
    caption: string;
    width: number;
    height: number;
  };
  price: {
    estimateLow: number;
    estimateHigh: number;
    hammerPrice: number;
    hammerPremium: number;
    currencySymbol: string;
    GBPLowEstimate: number;
    GBPHighEstimate: number;
  };
  currency: { iso_code: string; bonhams_code: string };
  country: { code: string; name: string };
  region: { code: string; name: string };
  department: { code: string; name: string };
  auctionType: string;
  auctionStatus: string;
  auctionEndDate: { datetime: string; timestamp: number };
  hammerTime: { datetime: string; timestamp: number };
  flags: {
    isAuctionEnded: boolean;
    isResultPublished: boolean;
    isToBeSold: boolean;
    isStarLot: boolean;
    isWithoutReserve: boolean;
  };
  updatedAt: { datetime: string; timestamp: number };
}

interface MappedVehicle {
  listing_url: string;
  listing_title: string | null;
  listing_year: number | null;
  listing_make: string | null;
  listing_model: string | null;
  listing_price: number | null;
  thumbnail_url: string | null;
  raw_data: Record<string, unknown>;
  status: string;
  extractor_version: string;
}

function buildLotUrl(doc: BonhamsDoc): string {
  // URL pattern: https://www.bonhams.com/auction/{auctionId}/lot/{lotId}/{slug}
  const slug = doc.slug || "";
  return `https://www.bonhams.com/auction/${doc.auctionId}/lot/${doc.lotId}/${slug}`;
}

function mapDocument(doc: BonhamsDoc): MappedVehicle {
  const parsed = parseTitle(doc.title || "");

  // Sale price: use hammerPremium (includes buyer's premium) if available,
  // otherwise hammerPrice, otherwise null
  let salePrice: number | null = null;
  if (doc.price) {
    if (doc.price.hammerPremium > 0) {
      salePrice = Math.round(doc.price.hammerPremium);
    } else if (doc.price.hammerPrice > 0) {
      salePrice = Math.round(doc.price.hammerPrice);
    }
  }

  // Prefer estimate as listing_price if no hammer price
  if (!salePrice && doc.price?.estimateLow > 0) {
    // Use low estimate as the price indicator for unsold/upcoming lots
    salePrice = Math.round(doc.price.estimateLow);
  }

  // Build description from catalogDesc + footnotes
  const descParts: string[] = [];
  if (doc.catalogDesc) descParts.push(stripHtml(doc.catalogDesc));
  if (doc.footnotes) descParts.push(stripHtml(doc.footnotes));
  const description = descParts.filter(Boolean).join("\n\n").slice(0, 8000) || null;

  // Image URL
  const imageUrl = doc.image?.url || null;

  // Currency for raw_data
  const currency = doc.currency?.iso_code || "USD";

  return {
    listing_url: buildLotUrl(doc),
    listing_title: doc.title || null,
    listing_year: parsed.year,
    listing_make: parsed.make,
    listing_model: parsed.model,
    listing_price: salePrice,
    thumbnail_url: imageUrl,
    raw_data: {
      bonhams_lot_id: doc.id,
      bonhams_auction_id: doc.auctionId,
      bonhams_lot_unique_id: doc.lotUniqueId,
      bonhams_lot_item_id: doc.lotItemId,
      lot_number: doc.lotNo?.full || doc.lotId,
      chassis: parsed.chassis,
      description,
      image_url: imageUrl,
      currency,
      estimate_low: doc.price?.estimateLow || null,
      estimate_high: doc.price?.estimateHigh || null,
      hammer_price: doc.price?.hammerPrice || null,
      hammer_premium: doc.price?.hammerPremium || null,
      gbp_low_estimate: doc.price?.GBPLowEstimate || null,
      gbp_high_estimate: doc.price?.GBPHighEstimate || null,
      country: doc.country?.name || null,
      country_code: doc.country?.code || null,
      region: doc.region?.name || null,
      auction_type: doc.auctionType || null,
      auction_status: doc.auctionStatus || null,
      auction_ended: doc.flags?.isAuctionEnded || false,
      is_sold: (doc.price?.hammerPrice || 0) > 0,
      is_star_lot: doc.flags?.isStarLot || false,
      without_reserve: doc.flags?.isWithoutReserve || false,
      sale_date: doc.hammerTime?.datetime || doc.auctionEndDate?.datetime || null,
      source: "bonhams-typesense",
      auction_source: "bonhams",
    },
    status: "pending",
    extractor_version: EXTRACTOR_VERSION,
  };
}

// ─── Typesense search ─────────────────────────────────────────────────────────

interface TypesenseResponse {
  found: number;
  hits: Array<{ document: BonhamsDoc }>;
  page: number;
  out_of: number;
  search_time_ms: number;
  request_params: Record<string, unknown>;
}

async function searchTypesense(
  query: string,
  page: number,
  perPage: number,
  extraFilter?: string,
): Promise<TypesenseResponse> {
  const params = new URLSearchParams({
    q: query,
    query_by: "title",
    per_page: String(Math.min(perPage, MAX_PER_PAGE)),
    page: String(page),
  });

  // Build filter: always include MOT-CAR department
  const filters = [DEPARTMENT_FILTER];
  if (extraFilter) filters.push(extraFilter);
  params.set("filter_by", filters.join(" && "));

  const url = `${TYPESENSE_HOST}/search-proxy/collections/${TYPESENSE_COLLECTION}/documents/search?${params}`;

  const res = await fetch(url, {
    headers: {
      "X-TYPESENSE-API-KEY": TYPESENSE_API_KEY,
      "Accept": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Typesense API returned HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  return await res.json() as TypesenseResponse;
}

// ─── HTTP handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const {
      mode = "search",
      query = "*",
      batch_size = 50,
      page = 1,
      filter = "",
      dry_run = false,
      max_pages = 0, // 0 = no limit (ingest all)
    } = body;

    const perPage = Math.min(Number(batch_size) || 50, MAX_PER_PAGE);
    const startPage = Math.max(Number(page) || 1, 1);

    // ─── MODE: stats ────────────────────────────────────────────────────
    if (mode === "stats") {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      );

      // Get Typesense totals
      const allCars = await searchTypesense("*", 1, 1);
      const soldCars = await searchTypesense("*", 1, 1, "price.hammerPrice:>0");

      // Count existing Bonhams imports in our queue
      const { count: queueCount } = await supabase
        .from("import_queue")
        .select("id", { count: "exact", head: true })
        .ilike("listing_url", "%bonhams.com/auction/%");

      // Count existing Bonhams vehicles
      const { count: vehicleCount } = await supabase
        .from("vehicles")
        .select("id", { count: "exact", head: true })
        .or("auction_source.ilike.%bonhams%,discovery_source.ilike.%bonhams%");

      return okJson({
        success: true,
        typesense: {
          total_cars: allCars.found,
          sold_cars: soldCars.found,
          unsold_or_upcoming: allCars.found - soldCars.found,
        },
        our_data: {
          import_queue_bonhams: queueCount ?? 0,
          vehicles_bonhams: vehicleCount ?? 0,
        },
        gap: {
          not_in_queue: (allCars.found) - (queueCount ?? 0),
          coverage_pct: queueCount ? ((queueCount / allCars.found) * 100).toFixed(1) + "%" : "0%",
        },
      });
    }

    // ─── MODE: search ───────────────────────────────────────────────────
    if (mode === "search") {
      const data = await searchTypesense(query, startPage, perPage, filter || undefined);

      const mapped = data.hits.map((h) => mapDocument(h.document));

      return okJson({
        success: true,
        mode: "search",
        query,
        page: startPage,
        per_page: perPage,
        found: data.found,
        returned: mapped.length,
        search_time_ms: data.search_time_ms,
        results: mapped.map((m) => ({
          listing_url: m.listing_url,
          title: m.listing_title,
          year: m.listing_year,
          make: m.listing_make,
          model: m.listing_model,
          price: m.listing_price,
          thumbnail: m.thumbnail_url,
          chassis: (m.raw_data as Record<string, unknown>).chassis || null,
          is_sold: (m.raw_data as Record<string, unknown>).is_sold || false,
          hammer_price: (m.raw_data as Record<string, unknown>).hammer_price || null,
          currency: (m.raw_data as Record<string, unknown>).currency || null,
          country: (m.raw_data as Record<string, unknown>).country || null,
          sale_date: (m.raw_data as Record<string, unknown>).sale_date || null,
        })),
      });
    }

    // ─── MODE: ingest ───────────────────────────────────────────────────
    if (mode === "ingest") {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      );

      const stats = {
        pages_fetched: 0,
        total_found: 0,
        total_fetched: 0,
        upserted: 0,
        skipped_no_title: 0,
        errors: [] as string[],
      };

      let currentPage = startPage;
      const maxPagesLimit = Number(max_pages) || 0;
      const startTime = Date.now();
      const TIMEOUT_MS = 55_000; // 55s safety margin (Supabase edge functions timeout at 60s)

      // Paginate through results
      while (true) {
        // Check timeout
        if (Date.now() - startTime > TIMEOUT_MS) {
          stats.errors.push(`Timeout after ${stats.pages_fetched} pages — resume from page ${currentPage}`);
          break;
        }

        // Check page limit
        if (maxPagesLimit > 0 && stats.pages_fetched >= maxPagesLimit) {
          break;
        }

        console.log(`[bonhams-typesense] Fetching page ${currentPage} (batch_size=${perPage})`);

        let data: TypesenseResponse;
        try {
          data = await searchTypesense(query, currentPage, perPage, filter || undefined);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          stats.errors.push(`Page ${currentPage}: ${msg}`);
          break;
        }

        if (stats.pages_fetched === 0) {
          stats.total_found = data.found;
        }

        if (!data.hits || data.hits.length === 0) {
          break; // No more results
        }

        stats.pages_fetched++;
        stats.total_fetched += data.hits.length;

        // Map and filter
        const rows: MappedVehicle[] = [];
        for (const hit of data.hits) {
          const doc = hit.document;
          // Skip docs with empty/useless titles
          if (!doc.title || doc.title.length < 3) {
            stats.skipped_no_title++;
            continue;
          }
          rows.push(mapDocument(doc));
        }

        if (rows.length > 0 && !dry_run) {
          // Upsert to import_queue in batches of 50 (avoid payload too large)
          for (let i = 0; i < rows.length; i += 50) {
            const batch = rows.slice(i, i + 50);
            const { error } = await supabase
              .from("import_queue")
              .upsert(batch, {
                onConflict: "listing_url",
                ignoreDuplicates: false, // Update existing with fresh data
              });
            if (error) {
              stats.errors.push(`Upsert batch at page ${currentPage}: ${error.message}`);
              console.error(`[bonhams-typesense] Upsert error:`, error.message);
            } else {
              stats.upserted += batch.length;
            }
          }
        } else if (dry_run) {
          stats.upserted += rows.length; // count what would be upserted
        }

        // If we got fewer results than requested, we've hit the end
        if (data.hits.length < perPage) {
          break;
        }

        currentPage++;
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      return okJson({
        success: true,
        mode: "ingest",
        dry_run,
        query,
        filter: filter || null,
        stats: {
          ...stats,
          elapsed_seconds: elapsed,
          resume_page: currentPage + 1,
        },
        next: stats.total_fetched < stats.total_found
          ? {
              message: `More results available. Resume with page=${currentPage + 1}`,
              remaining: stats.total_found - (startPage - 1) * perPage - stats.total_fetched,
            }
          : null,
      });
    }

    return okJson({ success: false, error: `Unknown mode: ${mode}. Use "search", "ingest", or "stats".` }, 400);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[bonhams-typesense] Fatal error:", message);
    return okJson({ success: false, error: message }, 500);
  }
});
