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
 *   POST { "mode": "archive", "batch_size": 50, "max_pages": 2 }
 *     → Typesense discovers URLs → archiveFetch (Firecrawl) archives raw HTML/markdown
 *     → Stored in listing_page_snapshots. "Fetch once, extract forever."
 *
 *   POST { "mode": "land", "batch_size": 100 }
 *     → One Typesense request (sorted oldest auction first), mapped and landed through extract-bonhams
 *       (vehicles + vehicle_events + vehicle_observations with the source document retained). The page cursor is
 *       the last landed page, read back from vehicle_events.metadata.ts_page; it wraps to page 1 after the last page
 *       (a revisit). Run by pg_cron job bonhams-typesense-land. At most 1 request to Bonhams per run.
 *
 *   POST { "mode": "stats" }
 *     → Return count of available cars and import_queue overlap
 *
 * Deploy: supabase functions deploy extract-bonhams-typesense --no-verify-jwt
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { archiveFetch } from "../_shared/archiveFetch.ts";
import { requireWriteAuth } from "../_shared/writeGuard.ts";
import { projectSecretKey } from "../_shared/supabaseKeys.ts";

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
    /Chassis\s+no\.?\s+([A-Z0-9*][A-Z0-9*./-]*)/i,
    /VIN[:\s]+([A-HJ-NPR-Z0-9]{17})/i,
    /Frame\s+no\.?\s+([A-Z0-9*][A-Z0-9*./-]*)/i,
  ];
  for (const pat of chassisPatterns) {
    const m = title.match(pat);
    if (m) {
      result.chassis = m[1].trim().replace(/[./-]+$/, "").toUpperCase();
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
  // Writes are never anonymous: service key, signed-in user, or nothing (P0.2, 2026-09-27).
  const denied = await requireWriteAuth(req);
  if (denied) return denied;
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
        projectSecretKey() ?? "",
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

    // ─── MODE: land ─────────────────────────────────────────────────────
    if (mode === "land") {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        projectSecretKey() ?? "",
      );
      const size = Math.min(Number(batch_size) || 100, 100);
      const SORT = "auctionEndDate.timestamp:asc";

      let pageNo = Number(page) > 1 ? Number(page) : 0;
      if (!pageNo) {
        const { data: last } = await supabase
          .from("vehicle_events")
          .select("metadata")
          .eq("source_platform", "bonhams")
          .eq("extraction_source", "bonhams-typesense")
          .order("updated_at", { ascending: false })
          .limit(1);
        const lastPage = Number((last?.[0]?.metadata as Record<string, unknown> | undefined)?.ts_page);
        pageNo = Number.isFinite(lastPage) && lastPage > 0 ? lastPage + 1 : 1;
      }

      const fetchPage = (n: number) => {
        const params = new URLSearchParams({
          q: "*", query_by: "title", per_page: String(size), page: String(n),
          filter_by: DEPARTMENT_FILTER, sort_by: SORT,
        });
        return fetch(`${TYPESENSE_HOST}/search-proxy/collections/${TYPESENSE_COLLECTION}/documents/search?${params}`, {
          headers: { "X-TYPESENSE-API-KEY": TYPESENSE_API_KEY, "Accept": "application/json" },
        });
      };
      let res = await fetchPage(pageNo);
      if (res.status === 403 || res.status === 429) {
        // Back off: nothing more is asked of Bonhams this run; the next scheduled run tries again.
        return okJson({ success: false, backoff: true, upstream_status: res.status, page: pageNo });
      }
      if (!res.ok) return okJson({ success: false, error: `Typesense HTTP ${res.status}`, page: pageNo }, 502);
      let data = await res.json() as TypesenseResponse;
      if (!data.hits?.length && pageNo > 1) {
        // Past the last page: wrap to page 1 (a revisit), 2 s after the previous request.
        await new Promise((r) => setTimeout(r, 2000));
        pageNo = 1;
        res = await fetchPage(pageNo);
        if (res.status === 403 || res.status === 429) return okJson({ success: false, backoff: true, upstream_status: res.status, page: pageNo });
        if (!res.ok) return okJson({ success: false, error: `Typesense HTTP ${res.status}`, page: pageNo }, 502);
        data = await res.json() as TypesenseResponse;
      }

      const totalPages = Math.max(1, Math.ceil(data.found / size));
      if (!data.hits?.length) {
        return okJson({ success: true, mode: "land", page: pageNo, landed: 0, found: data.found });
      }

      const observedAt = new Date().toISOString();
      const lots = data.hits.filter((h) => h.document?.title && h.document.title.length >= 3).map((h) => {
        const doc = h.document;
        const m = mapDocument(doc);
        const raw = m.raw_data as Record<string, unknown>;
        const hammer = doc.price?.hammerPrice > 0 ? Math.round(doc.price.hammerPrice) : null;
        const ended = !!doc.flags?.isAuctionEnded;
        return {
          url: m.listing_url,
          title: m.listing_title,
          year: m.listing_year,
          make: m.listing_make,
          model: m.listing_model,
          vin: null,
          chassis_number: (raw.chassis as string | null) ?? null,
          mileage: null, engine: null, transmission: null, exterior_color: null, interior_color: null, body_style: null,
          description: (raw.description as string | null) ?? null,
          sale_price: hammer,
          price_currency: doc.currency?.iso_code ?? null,
          auction_status: hammer ? "sold" : (ended ? "unsold" : "upcoming"),
          lot_number: doc.lotNo?.full || doc.lotId || null,
          sale_id: doc.auctionId || null,
          sale_name: null,
          sale_date: doc.hammerTime?.datetime || doc.auctionEndDate?.datetime || null,
          sale_location: doc.region?.name || doc.country?.name || null,
          estimate_low: doc.price?.estimateLow > 0 ? doc.price.estimateLow : null,
          estimate_high: doc.price?.estimateHigh > 0 ? doc.price.estimateHigh : null,
          estimate_currency: doc.currency?.iso_code ?? null,
          image_urls: doc.image?.url ? [doc.image.url] : [],
          fetch_source: "bonhams-typesense",
          cost_cents: 0,
          event_key: doc.id,
          ts_page: pageNo,
          extra_metadata: {
            sale_key: `bonhams-${doc.auctionId}`,
            auction_session_days: (doc.hammerTime?.datetime || doc.auctionEndDate?.datetime)
              ? [String(doc.hammerTime?.datetime || doc.auctionEndDate?.datetime).slice(0, 10)] : [],
            sale_starts_on: (doc as unknown as { biddableFrom?: { datetime?: string } }).biddableFrom?.datetime?.slice(0, 10) ?? null,
            sale_ends_on: doc.auctionEndDate?.datetime?.slice(0, 10) ?? null,
            sale_location: doc.region?.name || doc.country?.name || null,
            country_code: doc.country?.code ?? null,
            lot_unique_id: doc.lotUniqueId ?? null,
            engine_number: (doc.catalogDesc || "").match(/Engine\s+no\.?\s*:?\s*([A-Z0-9*][A-Z0-9*./-]*)/i)?.[1]?.toUpperCase() ?? null,
            registration: (doc.catalogDesc || "").match(/Registration\s+no\.?\s*:?\s*([^<\n]{2,20})/i)?.[1]?.trim() ?? null,
            without_reserve: !!doc.flags?.isWithoutReserve,
            bonhams_status: doc.status ?? null,
          },
          hammer_price: hammer,
          hammer_premium: doc.price?.hammerPremium > 0 ? Math.round(doc.price.hammerPremium) : null,
          // The source document is retained on the observation (raw_data); the page is stamped for the cursor.
          raw_document: { ...doc, styledDescription: undefined, _capture: { source: "bonhams-typesense", observed_at: observedAt, ts_page: pageNo, sort: SORT } },
        };
      });

      // Two calls of 50: one 100-lot call hit WORKER_RESOURCE_LIMIT (2026-10-15 01:41Z).
      const landed: Record<string, unknown>[] = [];
      let landOk = true;
      for (let i = 0; i < lots.length; i += 50) {
        const landRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/extract-bonhams`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: req.headers.get("authorization") ?? "" },
          body: JSON.stringify({ action: "land_lots", lots: lots.slice(i, i + 50), observed_at: observedAt }),
        });
        landOk = landOk && landRes.ok;
        landed.push(await landRes.json().catch(() => ({ error: `HTTP ${landRes.status}` })));
      }

      // The cursor is metadata.ts_page on each landed vehicle_events row (set by the lander).
      return okJson({
        success: landOk, mode: "land", page: pageNo, total_pages: totalPages, found: data.found,
        next_page: pageNo >= totalPages ? 1 : pageNo + 1, lander: landed,
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
        projectSecretKey() ?? "",
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

    // ─── MODE: archive ──────────────────────────────────────────────────
    // Typesense for URL discovery → archiveFetch (Firecrawl) for raw page archival.
    // "Fetch once, extract forever." Stores raw HTML/markdown in listing_page_snapshots.
    if (mode === "archive") {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        projectSecretKey() ?? "",
      );

      const stats = {
        pages_fetched: 0,
        urls_discovered: 0,
        archived: 0,
        already_cached: 0,
        archive_errors: 0,
        errors: [] as string[],
      };

      const startTime = Date.now();
      const TIMEOUT_MS = 50_000; // 50s — leave room for final archiveFetch calls

      // Phase 1: Get URLs from Typesense (free, fast)
      let currentPage = startPage;
      const maxPagesLimit = Number(max_pages) || 2; // default 2 pages for archive
      const urls: Array<{ url: string; title: string }> = [];

      while (urls.length < perPage * maxPagesLimit) {
        if (Date.now() - startTime > TIMEOUT_MS / 2) break; // save half the time for archiving
        if (maxPagesLimit > 0 && stats.pages_fetched >= maxPagesLimit) break;

        let data: TypesenseResponse;
        try {
          data = await searchTypesense(query, currentPage, perPage, filter || undefined);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          stats.errors.push(`Typesense page ${currentPage}: ${msg}`);
          break;
        }

        stats.pages_fetched++;
        if (!data.hits || data.hits.length === 0) break;

        for (const hit of data.hits) {
          const doc = hit.document;
          if (!doc.title || doc.title.length < 3) continue;
          urls.push({ url: buildLotUrl(doc), title: doc.title });
        }

        if (data.hits.length < perPage) break;
        currentPage++;
      }

      stats.urls_discovered = urls.length;

      // Phase 2: Check which URLs are already archived
      const urlList = urls.map((u) => u.url);
      const { data: existing } = await supabase
        .from("listing_page_snapshots")
        .select("listing_url")
        .in("listing_url", urlList.slice(0, 500)) // Supabase IN limit
        .eq("success", true);

      const alreadyArchived = new Set((existing ?? []).map((r: any) => r.listing_url));
      const toArchive = urls.filter((u) => !alreadyArchived.has(u.url));
      stats.already_cached = urls.length - toArchive.length;

      // Phase 3: archiveFetch each unarchived URL (Firecrawl for Bonhams SPA)
      for (const item of toArchive) {
        if (Date.now() - startTime > TIMEOUT_MS) {
          stats.errors.push(`Timeout after archiving ${stats.archived} pages`);
          break;
        }

        try {
          const result = await archiveFetch(item.url, {
            platform: "bonhams",
            useFirecrawl: true,
            includeMarkdown: true,
            waitForJs: 5000,
            maxAgeSec: 86400 * 30, // 30 day cache — Bonhams lots don't change often
            callerName: "extract-bonhams-typesense",
            metadata: { title: item.title, source: "typesense-discovery" },
          });

          if (result.cached) {
            stats.already_cached++;
          } else if (result.html && result.html.length > 1000) {
            stats.archived++;
          } else {
            stats.archive_errors++;
            stats.errors.push(`${item.url}: empty or garbage HTML (${result.html?.length ?? 0} bytes)`);
          }
        } catch (err: unknown) {
          stats.archive_errors++;
          const msg = err instanceof Error ? err.message : String(err);
          stats.errors.push(`${item.url}: ${msg}`);
        }
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      return okJson({
        success: true,
        mode: "archive",
        query,
        filter: filter || null,
        stats: {
          ...stats,
          elapsed_seconds: elapsed,
          resume_page: currentPage + 1,
        },
        next: toArchive.length > stats.archived
          ? { message: `More URLs to archive. Resume with page=${currentPage + 1}` }
          : null,
      });
    }

    return okJson({ success: false, error: `Unknown mode: ${mode}. Use "search", "ingest", "archive", "land" or "stats".` }, 400);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[bonhams-typesense] Fatal error:", message);
    return okJson({ success: false, error: message }, 500);
  }
});
