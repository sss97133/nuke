import "jsr:@supabase/functions-js/edge-runtime.d.ts";
/**
 * Sync Live Auctions
 *
 * Monitors live auctions across multiple platforms and keeps our database in sync.
 * Designed to run every 15 minutes via cron.
 *
 * Sources:
 *   - BaT: Scrapes auctionsCurrentInitialData from /auctions/ page (no API key needed)
 *   - Collecting Cars: Uses Typesense API (public API key)
 *   - Cars & Bids: Uses Firecrawl (Cloudflare protected)
 *
 * Deploy: supabase functions deploy sync-live-auctions --no-verify-jwt
 *
 * Usage:
 *   POST {"action": "sync"}                      - sync all platforms
 *   POST {"action": "sync", "platform": "bat"}   - sync specific platform
 *   POST {"action": "status"}                    - get current live auction stats
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { firecrawlScrape } from "../_shared/firecrawl.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ============================================
// Types
// ============================================

interface LiveAuction {
  url: string;
  title: string;
  platform: string;
  auction_end_date: string;
  current_bid: number | null;
  bid_count: number | null;
  no_reserve: boolean;
  reserve_met: boolean | null;
  year: number | null;
  make: string | null;
  model: string | null;
  thumbnail_url: string | null;
  external_id: string | null;
  raw_data: Record<string, unknown>;
}

interface SyncResult {
  platform: string;
  success: boolean;
  live_count: number;
  new_count: number;
  updated_count: number;
  ended_count: number;
  error: string | null;
  duration_ms: number;
}

// ============================================
// BaT Sync
// ============================================

interface BaTAuctionItem {
  id: number;
  title: string;
  url: string;
  year: string;
  timestamp_end: number;
  current_bid: number;
  noreserve: boolean;
  thumbnail_url: string;
  country: string;
  currency: string;
  active: boolean;
}

async function syncBaT(): Promise<{ auctions: LiveAuction[]; error: string | null }> {
  try {
    console.log("[sync-live-auctions] Fetching BaT live auctions page...");

    const response = await fetch("https://bringatrailer.com/auctions/", {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!response.ok) {
      return { auctions: [], error: `BaT returned HTTP ${response.status}` };
    }

    const html = await response.text();

    // Extract the JSON data from the page
    const match = html.match(/var\s+auctionsCurrentInitialData\s*=\s*(\{[\s\S]*?\});/);
    if (!match) {
      return { auctions: [], error: "Could not find auctionsCurrentInitialData in BaT page" };
    }

    let data: { items: BaTAuctionItem[] };
    try {
      data = JSON.parse(match[1]);
    } catch (e) {
      return { auctions: [], error: `Failed to parse BaT JSON: ${e}` };
    }

    if (!data.items || !Array.isArray(data.items)) {
      return { auctions: [], error: "BaT data.items is not an array" };
    }

    console.log(`[sync-live-auctions] BaT: Found ${data.items.length} listings`);

    const auctions: LiveAuction[] = data.items
      .filter(item => item.active)
      .map(item => {
        // Parse year from title (e.g., "1996 Porsche 911 Turbo" -> 1996)
        const yearMatch = item.title.match(/^(\d{4})\s+/);
        const year = yearMatch ? parseInt(yearMatch[1]) : (item.year ? parseInt(item.year) : null);

        // Parse make/model from title
        const titleWithoutYear = item.title.replace(/^\d{4}\s+/, "");
        const parts = titleWithoutYear.split(" ");
        const make = parts[0] || null;
        const model = parts.slice(1).join(" ") || null;

        return {
          url: item.url.replace(/\/$/, ""),
          title: item.title,
          platform: "bringatrailer",
          auction_end_date: new Date(item.timestamp_end * 1000).toISOString(),
          current_bid: item.current_bid,
          bid_count: null, // Not available in initial data
          no_reserve: item.noreserve,
          reserve_met: null,
          year,
          make,
          model,
          thumbnail_url: item.thumbnail_url,
          external_id: String(item.id),
          raw_data: {
            source: "bat_auctions_page",
            timestamp_end: item.timestamp_end,
            country: item.country,
            currency: item.currency,
            synced_at: new Date().toISOString(),
          },
        };
      });

    return { auctions, error: null };
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    return { auctions: [], error: `BaT sync failed: ${error}` };
  }
}

// ============================================
// Collecting Cars Sync (Typesense API)
// ============================================

const TYPESENSE_API_KEY = "pHuIUBo3XGxHk9Ll9g4q71qXbTYAM2w1";
const TYPESENSE_ENDPOINT = "https://dora.production.collecting.com/multi_search";

interface TypesenseDocument {
  auctionId: number;
  slug: string;
  title: string;
  makeName?: string;
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
  noReserve?: string;
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

async function syncCollectingCars(): Promise<{ auctions: LiveAuction[]; error: string | null }> {
  try {
    console.log("[sync-live-auctions] Fetching Collecting Cars live auctions from Typesense...");

    const response = await fetch(`${TYPESENSE_ENDPOINT}?x-typesense-api-key=${TYPESENSE_API_KEY}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        searches: [{
          collection: "production_cars",
          q: "*",
          filter_by: "listingStage:live",
          per_page: 250,
          page: 1,
          query_by: "title,productMake,vehicleMake,productYear",
        }],
      }),
    });

    if (!response.ok) {
      return { auctions: [], error: `Collecting Cars Typesense returned HTTP ${response.status}` };
    }

    const data = await response.json();
    const documents: TypesenseDocument[] = data.results?.[0]?.hits?.map((hit: { document: TypesenseDocument }) => hit.document) || [];

    console.log(`[sync-live-auctions] Collecting Cars: Found ${documents.length} live auctions`);

    const auctions: LiveAuction[] = documents
      .filter(doc => doc.lotType === "car") // Only cars, not plates/parts/bikes
      .map(doc => {
        const year = doc.productYear ? parseInt(doc.productYear) : (doc.features?.modelYear ? parseInt(doc.features.modelYear) : null);

        return {
          url: `https://collectingcars.com/for-sale/${doc.slug}`,
          title: doc.title,
          platform: "collecting-cars",
          auction_end_date: doc.dtStageEndsUTC ? new Date(doc.dtStageEndsUTC).toISOString() : new Date().toISOString(),
          current_bid: doc.currentBid,
          bid_count: doc.noBids,
          no_reserve: doc.noReserve === "true",
          reserve_met: doc.reserveMet ?? null,
          year,
          make: doc.makeName || null,
          model: doc.modelName || null,
          thumbnail_url: doc.mainImageUrl || null,
          external_id: String(doc.auctionId),
          raw_data: {
            source: "typesense_api",
            slug: doc.slug,
            auction_id: doc.auctionId,
            location: doc.location,
            country: doc.countryCode,
            region: doc.regionCode,
            currency: doc.currencyCode,
            features: doc.features,
            synced_at: new Date().toISOString(),
          },
        };
      });

    return { auctions, error: null };
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    return { auctions: [], error: `Collecting Cars sync failed: ${error}` };
  }
}

// ============================================
// Cars & Bids Sync (Firecrawl)
// ============================================

async function syncCarsAndBids(): Promise<{ auctions: LiveAuction[]; error: string | null }> {
  try {
    console.log("[sync-live-auctions] Fetching Cars & Bids homepage via Firecrawl...");

    const result = await firecrawlScrape({
      url: "https://carsandbids.com/",
      formats: ["html"],
      onlyMainContent: false,
      waitFor: 3000,
      actions: [
        { type: "scroll", direction: "down", pixels: 2000 },
        { type: "wait", milliseconds: 1500 },
      ],
    }, {
      timeoutMs: 45000,
      maxAttempts: 2,
    });

    if (!result.success || !result.data.html) {
      return { auctions: [], error: `Firecrawl failed: ${result.error || "No HTML returned"}` };
    }

    const html = result.data.html;

    // Cars & Bids uses a different structure - look for auction cards
    // Pattern: /auctions/[id]/[slug] format
    const urlPattern = /href=["'](https:\/\/carsandbids\.com\/auctions\/([A-Za-z0-9]+)\/([a-z0-9-]+))['"]/gi;
    const foundUrls = new Map<string, { id: string; slug: string }>();

    let match;
    while ((match = urlPattern.exec(html)) !== null) {
      const url = match[1].replace(/\/$/, "");
      if (!foundUrls.has(url)) {
        foundUrls.set(url, { id: match[2], slug: match[3] });
      }
    }

    console.log(`[sync-live-auctions] Cars & Bids: Found ${foundUrls.size} auction URLs`);

    // Extract auction data from card elements
    // C&B typically has: data-auction-end, title, current bid in card structure
    const auctions: LiveAuction[] = [];

    for (const [url, { id, slug }] of foundUrls) {
      // Parse title from slug (e.g., "2022-porsche-911-gt3" -> "2022 Porsche 911 GT3")
      const titleParts = slug.split("-");
      const yearMatch = titleParts[0]?.match(/^\d{4}$/);
      const year = yearMatch ? parseInt(titleParts[0]) : null;

      // Title reconstruction from slug
      const title = titleParts
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");

      auctions.push({
        url,
        title,
        platform: "cars-and-bids",
        auction_end_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // Default 7 days, will be updated from actual listing
        current_bid: null,
        bid_count: null,
        no_reserve: false, // Would need to parse from page
        reserve_met: null,
        year,
        make: titleParts[1] ? titleParts[1].charAt(0).toUpperCase() + titleParts[1].slice(1) : null,
        model: titleParts.slice(2).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(" ") || null,
        thumbnail_url: null,
        external_id: id,
        raw_data: {
          source: "firecrawl_homepage",
          slug,
          synced_at: new Date().toISOString(),
        },
      });
    }

    return { auctions, error: null };
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    return { auctions: [], error: `Cars & Bids sync failed: ${error}` };
  }
}

// ============================================
// Database Sync
// ============================================

async function syncToDatabase(
  supabase: ReturnType<typeof createClient>,
  auctions: LiveAuction[],
  platform: string
): Promise<{ new_count: number; updated_count: number; ended_count: number }> {
  const stats = { new_count: 0, updated_count: 0, ended_count: 0 };

  if (auctions.length === 0) {
    return stats;
  }

  // Map platform name to URL pattern for matching
  const platformUrlPatterns: Record<string, string> = {
    "bringatrailer": "bringatrailer",
    "collecting-cars": "collectingcars",
    "cars-and-bids": "carsandbids",
  };
  const urlPattern = platformUrlPatterns[platform] || platform.replace("-", "");

  // Get existing vehicles for this platform that are currently marked as active
  const { data: existingActive } = await supabase
    .from("vehicles")
    .select("id, listing_url, bat_auction_url, auction_status, auction_end_date")
    .eq("auction_status", "active")
    .or(`listing_url.ilike.%${urlPattern}%,bat_auction_url.ilike.%${urlPattern}%`);

  // Get URL from either listing_url or bat_auction_url
  const getVehicleUrl = (v: { listing_url?: string | null; bat_auction_url?: string | null }) =>
    (v.listing_url || v.bat_auction_url || "").replace(/\/$/, "");

  const existingUrls = new Set(existingActive?.map(v => getVehicleUrl(v)).filter(Boolean) || []);
  const currentLiveUrls = new Set(auctions.map(a => a.url));

  // Find auctions that have ended (were active, now not in current list)
  const endedVehicles = existingActive?.filter(v => {
    const url = getVehicleUrl(v);
    return url && !currentLiveUrls.has(url);
  }) || [];

  // Mark ended auctions
  if (endedVehicles.length > 0) {
    const endedIds = endedVehicles.map(v => v.id);
    const { error } = await supabase
      .from("vehicles")
      .update({
        auction_status: "ended",
        updated_at: new Date().toISOString(),
      })
      .in("id", endedIds);

    if (!error) {
      stats.ended_count = endedVehicles.length;
      console.log(`[sync-live-auctions] Marked ${endedVehicles.length} ${platform} auctions as ended`);
    }
  }

  // Upsert current live auctions
  for (const auction of auctions) {
    const vehicleData = {
      listing_url: auction.url,
      title: auction.title,
      year: auction.year,
      make: auction.make,
      model: auction.model,
      auction_status: "active", // Use "active" to match existing data convention
      auction_end_date: auction.auction_end_date,
      sale_price: auction.current_bid,
      platform_source: platform,
      origin_metadata: {
        platform,
        external_id: auction.external_id,
        no_reserve: auction.no_reserve,
        reserve_met: auction.reserve_met,
        bid_count: auction.bid_count,
        thumbnail_url: auction.thumbnail_url,
        last_sync: new Date().toISOString(),
        ...auction.raw_data,
      },
      updated_at: new Date().toISOString(),
    };

    if (existingUrls.has(auction.url)) {
      // Update existing - try listing_url first, then bat_auction_url
      const { error } = await supabase
        .from("vehicles")
        .update(vehicleData)
        .or(`listing_url.eq.${auction.url},bat_auction_url.eq.${auction.url}`);

      if (!error) {
        stats.updated_count++;
      }
    } else {
      // Insert new
      const { error } = await supabase
        .from("vehicles")
        .insert({
          ...vehicleData,
          created_at: new Date().toISOString(),
        });

      if (!error) {
        stats.new_count++;
      } else if (error.code === "23505") {
        // Duplicate key - try update instead
        await supabase
          .from("vehicles")
          .update(vehicleData)
          .eq("external_url", auction.url);
        stats.updated_count++;
      }
    }
  }

  return stats;
}

async function updateSourceRegistry(
  supabase: ReturnType<typeof createClient>,
  platform: string,
  success: boolean
): Promise<void> {
  // Map platform to source_registry slug
  const slugMap: Record<string, string> = {
    "bringatrailer": "bringatrailer",
    "collecting-cars": "collecting-cars",
    "cars-and-bids": "cars-and-bids",
  };

  const slug = slugMap[platform];
  if (!slug) return;

  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (success) {
    updateData.last_successful_at = new Date().toISOString();
  }

  await supabase
    .from("source_registry")
    .update(updateData)
    .eq("slug", slug);
}

// ============================================
// Main Handler
// ============================================

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "sync";
    const targetPlatform = body.platform || null;

    if (action === "status") {
      // Get current active auction stats
      const { data: activeAuctions, count } = await supabase
        .from("vehicles")
        .select("listing_url, bat_auction_url, auction_status, auction_end_date", { count: "exact" })
        .eq("auction_status", "active");

      // Group by platform
      const byPlatform: Record<string, number> = {};
      for (const v of activeAuctions || []) {
        const url = v.listing_url || v.bat_auction_url || "";
        let platform = "unknown";
        if (url.includes("bringatrailer")) platform = "bringatrailer";
        else if (url.includes("collectingcars")) platform = "collecting-cars";
        else if (url.includes("carsandbids")) platform = "cars-and-bids";
        byPlatform[platform] = (byPlatform[platform] || 0) + 1;
      }

      // Get source registry status
      const { data: sources } = await supabase
        .from("source_registry")
        .select("slug, display_name, last_successful_at, status")
        .in("slug", ["bringatrailer", "collecting-cars", "cars-and-bids"]);

      return okJson({
        success: true,
        total_active: count || 0,
        by_platform: byPlatform,
        sources: sources || [],
      });
    }

    if (action === "sync") {
      const results: SyncResult[] = [];
      const platforms = targetPlatform ? [targetPlatform] : ["bringatrailer", "collecting-cars", "cars-and-bids"];

      for (const platform of platforms) {
        const startTime = Date.now();
        let syncResult: { auctions: LiveAuction[]; error: string | null };

        // Fetch from platform
        switch (platform) {
          case "bat":
          case "bringatrailer":
            syncResult = await syncBaT();
            break;
          case "cc":
          case "collecting-cars":
            syncResult = await syncCollectingCars();
            break;
          case "cab":
          case "cars-and-bids":
            syncResult = await syncCarsAndBids();
            break;
          default:
            syncResult = { auctions: [], error: `Unknown platform: ${platform}` };
        }

        const normalizedPlatform = platform.replace(/^(bat|cc|cab)$/, (m) =>
          ({ bat: "bringatrailer", cc: "collecting-cars", cab: "cars-and-bids" }[m] || m)
        );

        // Sync to database
        const dbStats = syncResult.error
          ? { new_count: 0, updated_count: 0, ended_count: 0 }
          : await syncToDatabase(supabase, syncResult.auctions, normalizedPlatform);

        // Update source registry
        await updateSourceRegistry(supabase, normalizedPlatform, !syncResult.error);

        results.push({
          platform: normalizedPlatform,
          success: !syncResult.error,
          live_count: syncResult.auctions.length,
          new_count: dbStats.new_count,
          updated_count: dbStats.updated_count,
          ended_count: dbStats.ended_count,
          error: syncResult.error,
          duration_ms: Date.now() - startTime,
        });
      }

      const totalLive = results.reduce((sum, r) => sum + r.live_count, 0);
      const totalNew = results.reduce((sum, r) => sum + r.new_count, 0);
      const totalUpdated = results.reduce((sum, r) => sum + r.updated_count, 0);
      const totalEnded = results.reduce((sum, r) => sum + r.ended_count, 0);
      const allSuccess = results.every(r => r.success);

      return okJson({
        success: allSuccess,
        summary: {
          total_live: totalLive,
          new_vehicles: totalNew,
          updated_vehicles: totalUpdated,
          ended_auctions: totalEnded,
        },
        results,
        synced_at: new Date().toISOString(),
      });
    }

    return okJson({ error: "Invalid action. Use 'sync' or 'status'." }, 400);
  } catch (error) {
    console.error("[sync-live-auctions] Error:", error);
    return okJson({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});
