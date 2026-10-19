import "jsr:@supabase/functions-js/edge-runtime.d.ts";
/**
 * Collecting Cars Discovery
 *
 * Uses Typesense API to discover active Collecting Cars listings.
 * No Firecrawl/Playwright needed - direct API access bypasses Cloudflare.
 *
 * Deploy: supabase functions deploy collecting-cars-discovery --no-verify-jwt
 *
 * Usage:
 *   POST {"action": "discover"}                    - discover all live listings
 *   POST {"action": "discover", "stage": "sold"}   - discover sold listings
 *   POST {"action": "status"}                      - check discovery stats
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireWriteAuth } from "../_shared/writeGuard.ts";
import { projectSecretKey } from "../_shared/supabaseKeys.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// The site's own public search-only client key, shipped in collectingcars.com's JS (_next/static chunks). The old
// collection "production_cars" was retired upstream (404 on 2026-10-15); the site now searches "production_listings".
const TYPESENSE_API_KEY = "0I2WvLvRUeeHNaDV74u0KRlkLnhhgH9S";
const TYPESENSE_COLLECTION = "production_listings";
const TYPESENSE_ENDPOINT = "https://dora.production.collecting.com/multi_search";
const BASE_URL = "https://collectingcars.com/for-sale/";

interface TypesenseDocument {
  auctionId: number;
  slug: string;
  title: string;
  makeName?: string;
  productMake?: string;
  tsPublishedUTC?: number;
  modelName?: string;
  productYear?: string;
  currentBid: number;
  noBids: number;
  dtStageEndsUTC: string;
  listingStage: string;
  lotType: string;
  location?: string;
  countryCode?: string;
  regionCode?: string;
  currencyCode?: string;
  noReserve?: string | boolean;
  reserveMet?: boolean;
  mainImageUrl?: string;
  features?: {
    modelYear?: string;
    mileage?: string;
    transmission?: string;
    fuelType?: string;
    driveSide?: string;
  };
}

interface TypesenseResponse {
  results: Array<{
    found: number;
    hits: Array<{
      document: TypesenseDocument;
    }>;
  }>;
}

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function typesenseSearch(search: Record<string, unknown>): Promise<any> {
  const response = await fetch(`${TYPESENSE_ENDPOINT}?x-typesense-api-key=${TYPESENSE_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ searches: [search] }),
  });
  if (!response.ok) {
    throw new Error(`Typesense API returned ${response.status}: ${await response.text()}`);
  }
  return (await response.json()).results?.[0];
}

async function fetchTypesenseListings(
  stage: string = "live",
  perPage: number = 250
): Promise<TypesenseDocument[]> {
  const result = await typesenseSearch({
    collection: TYPESENSE_COLLECTION,
    q: "*",
    filter_by: `listingStage:${stage}`,
    sort_by: "tsPublishedUTC:desc",
    per_page: perPage,
    page: 1,
    query_by: "title,productMake,vehicleMake,productYear",
  });
  return result?.hits?.map((hit: { document: TypesenseDocument }) => hit.document) || [];
}

async function getExistingUrls(supabase: any): Promise<Set<string>> {
  const existing = new Set<string>();

  // Check import_queue for Collecting Cars URLs
  const { data: queued } = await supabase
    .from("import_queue")
    .select("listing_url")
    .ilike("listing_url", "%collectingcars.com%");

  for (const row of queued || []) {
    if (row.listing_url) {
      existing.add(row.listing_url);
    }
  }

  return existing;
}

async function queueNewListings(
  supabase: any,
  listings: TypesenseDocument[],
  existingUrls: Set<string>,
  sourceId: string
): Promise<{ queued: number; skipped: number; errors: number }> {
  let queued = 0;
  let skipped = 0;
  let errors = 0;

  for (const listing of listings) {
    const url = `${BASE_URL}${listing.slug}`;

    // Skip if already exists
    if (existingUrls.has(url)) {
      skipped++;
      continue;
    }

    // Only queue cars (skip plates, parts, bikes for now)
    if (listing.lotType !== "car") {
      skipped++;
      continue;
    }

    try {
      const year = listing.productYear || listing.features?.modelYear;
      const { error } = await supabase.from("import_queue").insert({
        listing_url: url,
        source_id: sourceId,
        listing_title: listing.title,
        listing_year: year ? parseInt(year, 10) : null,
        listing_make: listing.productMake ?? listing.makeName,
        listing_model: listing.modelName,
        listing_price: listing.currentBid,
        thumbnail_url: listing.mainImageUrl,
        priority: listing.listingStage === "live" ? 70 : 50,
        raw_data: {
          collecting_cars_slug: listing.slug,
          auction_id: listing.auctionId,
          bid_count: listing.noBids,
          auction_end_date: listing.dtStageEndsUTC,
          stage: listing.listingStage,
          location: listing.location,
          country: listing.countryCode,
          region: listing.regionCode,
          currency: listing.currencyCode,
          no_reserve: listing.noReserve === "true" || listing.noReserve === true,
          reserve_met: listing.reserveMet,
          features: listing.features,
          published_at: listing.tsPublishedUTC ? new Date(listing.tsPublishedUTC * 1000).toISOString() : null,
          discovered_at: new Date().toISOString(),
          discovery_method: "typesense_api",
        },
      });

      if (error) {
        console.error(`Failed to queue ${listing.slug}:`, error.message);
        errors++;
      } else {
        queued++;
      }
    } catch (e) {
      console.error(`Error queueing ${listing.slug}:`, e);
      errors++;
    }
  }

  return { queued, skipped, errors };
}

Deno.serve(async (req) => {
  // Writes are never anonymous: service key, signed-in user, or nothing (P0.2, 2026-09-27).
  const denied = await requireWriteAuth(req);
  if (denied) return denied;
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    projectSecretKey() ?? ""
  );

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "discover";
    const stage = body.stage || "live"; // live, sold, comingsoon

    if (action === "status") {
      // Get Collecting Cars source ID
      const { data: sources } = await supabase
        .from("scrape_sources")
        .select("id, name")
        .ilike("url", "%collectingcars.com%");

      const sourceIds = (sources || []).map((s: any) => s.id);

      // Get stats
      const { count: queuedCount } = await supabase
        .from("import_queue")
        .select("*", { count: "exact", head: true })
        .in("source_id", sourceIds);

      return okJson({
        platform: "collecting_cars",
        sources: sources || [],
        queued: queuedCount || 0,
        api_endpoint: TYPESENSE_ENDPOINT,
      });
    }

    if (action === "census_daily") {
      // Listed per UTC day: cars whose tsPublishedUTC falls in that day, any stage (a car that already ended still
      // counts as listed that day). One count request per day, 2 s apart; writes one source_census row per day.
      const days = Math.min(Math.max(Number(body.days) || 3, 1), 14);
      const out: Array<{ day: string; listed: number }> = [];
      const today = new Date(); today.setUTCHours(0, 0, 0, 0);
      for (let i = 0; i < days; i++) {
        const start = new Date(today.getTime() - i * 86_400_000);
        const end = new Date(start.getTime() + 86_400_000);
        const found = (await typesenseSearch({
          collection: TYPESENSE_COLLECTION, q: "*", query_by: "title", per_page: 1,
          filter_by: `lotType:=car && tsPublishedUTC:>=${start.getTime() / 1000} && tsPublishedUTC:<${end.getTime() / 1000}`,
        }))?.found;
        if (typeof found !== "number") throw new Error("Typesense returned no count");
        out.push({ day: start.toISOString().slice(0, 10), listed: found });
        await new Promise((r) => setTimeout(r, 2000));
      }
      const { data: src } = await supabase.from("observation_sources").select("id").eq("slug", "collecting-cars").maybeSingle();
      if (!src) return okJson({ error: "observation source collecting-cars not found" }, 404);
      const censusAt = Date.now(); // source_census is unique on (source, census_at): one millisecond apart per day
      const { error } = await supabase.from("source_census").insert(out.map((o, i) => ({
        source_id: src.id, census_day: o.day, universe_total: o.listed, census_method: "enumerated", census_confidence: 0.9,
        census_url: TYPESENSE_ENDPOINT, census_at: new Date(censusAt + i).toISOString(),
        census_notes: `Cars published that UTC day (tsPublishedUTC), any stage, counted in the Collecting Cars search index (collection ${TYPESENSE_COLLECTION}).`,
      })));
      if (error) throw new Error(`source_census insert failed: ${error.message}`);
      return okJson({ success: true, days: out });
    }

    if (action === "discover") {
      console.log(`Discovering ${stage} listings from Typesense...`);

      // Get Collecting Cars source ID (use the auction one)
      const { data: source } = await supabase
        .from("scrape_sources")
        .select("id")
        .eq("url", "https://collectingcars.com/search/")
        .maybeSingle();

      if (!source) {
        return okJson({ error: "Collecting Cars source not found in scrape_sources" }, 404);
      }

      // Fetch from Typesense
      const listings = await fetchTypesenseListings(stage, 250);
      console.log(`Found ${listings.length} ${stage} listings`);

      // Get existing URLs
      const existingUrls = await getExistingUrls(supabase);
      console.log(`Existing URLs in database: ${existingUrls.size}`);

      // Queue new listings
      const stats = await queueNewListings(supabase, listings, existingUrls, source.id);

      return okJson({
        success: true,
        stage,
        total_found: listings.length,
        already_known: existingUrls.size,
        queued: stats.queued,
        skipped: stats.skipped,
        errors: stats.errors,
        sample_listing: listings[0] ? {
          title: listings[0].title,
          slug: listings[0].slug,
          url: `${BASE_URL}${listings[0].slug}`,
          current_bid: listings[0].currentBid,
          bids: listings[0].noBids,
          ends: listings[0].dtStageEndsUTC,
        } : null,
      });
    }

    return okJson({ error: "Invalid action. Use 'discover', 'census_daily' or 'status'." }, 400);
  } catch (error) {
    console.error("Error:", error);
    return okJson({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});
