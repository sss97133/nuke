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
 *   - PCarMarket, Mecum, Barrett-Jackson, RM Sotheby's, Gooding, Bonhams: Firecrawl scrape + extract
 *
 * Deploy: supabase functions deploy sync-live-auctions --no-verify-jwt
 *
 * Usage:
 *   POST {"action": "sync"}                      - sync all platforms
 *   POST {"action": "sync", "platform": "bat"}   - sync specific platform (bat, cc, cab, pcarmarket, mecum, barrett-jackson, rm-sothebys, gooding, bonhams)
 *   POST {"action": "status"}                    - get current live auction stats
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { firecrawlScrape } from "../_shared/firecrawl.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Strip characters that could inject into PostgREST .or() filter strings */
function escapePostgrestValue(s: string): string {
  return s.replace(/[",().\\]/g, "");
}

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
        const year = yearMatch ? parseInt(yearMatch[1], 10) : (item.year ? parseInt(item.year, 10) : null);

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

const CC_PAGE_SIZE = 250;
const CC_MAX_PAGES = 40; // 250 * 40 = 10k cap for scale toward 4k-10k live

async function syncCollectingCars(): Promise<{ auctions: LiveAuction[]; error: string | null }> {
  try {
    console.log("[sync-live-auctions] Fetching Collecting Cars live auctions from Typesense...");

    const documents: TypesenseDocument[] = [];
    let page = 1;

    while (page <= CC_MAX_PAGES) {
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
            per_page: CC_PAGE_SIZE,
            page,
            query_by: "title,productMake,vehicleMake,productYear",
          }],
        }),
      });

      if (!response.ok) {
        return { auctions: [], error: `Collecting Cars Typesense returned HTTP ${response.status}` };
      }

      const data = await response.json();
      const hits = data.results?.[0]?.hits ?? [];
      const pageDocs = hits.map((hit: { document: TypesenseDocument }) => hit.document);
      documents.push(...pageDocs);

      if (pageDocs.length < CC_PAGE_SIZE) break;
      page++;
    }

    console.log(`[sync-live-auctions] Collecting Cars: Found ${documents.length} live auctions`);

    const auctions: LiveAuction[] = documents
      .filter(doc => doc.lotType === "car") // Only cars, not plates/parts/bikes
      .map(doc => {
        const year = doc.productYear ? parseInt(doc.productYear, 10) : (doc.features?.modelYear ? parseInt(doc.features.modelYear, 10) : null);

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
// Shared: Firecrawl scrape + extract live auctions from listing pages
// ============================================

const LIVE_AUCTIONS_EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    auctions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          url: { type: "string", description: "Full URL to the auction/lot page" },
          title: { type: "string", description: "Vehicle or lot title" },
        },
        required: ["url", "title"],
      },
    },
  },
  required: ["auctions"],
};

async function syncViaFirecrawlExtract(
  platform: string,
  discoveryUrl: string,
  urlPattern: RegExp,
  options: { useProxy?: boolean; waitFor?: number } = {}
): Promise<{ auctions: LiveAuction[]; error: string | null }> {
  try {
    console.log(`[sync-live-auctions] Fetching ${platform} live auctions from ${discoveryUrl}...`);

    const result = await firecrawlScrape(
      {
        url: discoveryUrl,
        formats: ["markdown", "html"],
        onlyMainContent: false,
        waitFor: options.waitFor ?? 4000,
        ...(options.useProxy ? { proxy: "stealth" as const } : {}),
        actions: [
          { type: "scroll", direction: "down", pixels: 2000 },
          { type: "wait", milliseconds: 1500 },
          { type: "scroll", direction: "down", pixels: 2000 },
          { type: "wait", milliseconds: 1000 },
        ],
        extract: {
          schema: LIVE_AUCTIONS_EXTRACT_SCHEMA,
          prompt:
            "List every currently live auction or lot on this page. For each one extract the full URL to the lot/auction page and the vehicle or lot title. Only include live/current auctions or lots that can be bid on, not past sales or closed listings.",
        },
      },
      { timeoutMs: 60000, maxAttempts: 2 }
    );

    if (!result.success && !result.data.html && !result.data.markdown) {
      return { auctions: [], error: `Firecrawl failed: ${result.error || "No content"}` };
    }

    const extract = result.data.extract ?? result.raw?.data?.extract;
    let auctions: { url: string; title: string }[] = [];

    if (extract?.auctions && Array.isArray(extract.auctions)) {
      auctions = extract.auctions.filter(
        (a: any) => a?.url && a?.title && urlPattern.test(String(a.url))
      );
    }

    if (auctions.length === 0) {
      const html = result.data.html || result.data.markdown || "";
      const hrefRegex = /href=["'](https?:\/\/[^"'\s]+)["']/gi;
      const seen = new Set<string>();
      let m;
      while ((m = hrefRegex.exec(html)) !== null) {
        const u = m[1].replace(/#.*$/, "").replace(/\?.*$/, "").trim();
        if (urlPattern.test(u) && !seen.has(u)) {
          seen.add(u);
          auctions.push({ url: u, title: "" });
        }
      }
      for (const a of auctions) {
        if (!a.title) {
          const yearMatch = a.url.match(/(\d{4})/);
          a.title = yearMatch ? `${yearMatch[1]} Vehicle` : "Auction Lot";
        }
      }
    }

    const liveAuctions: LiveAuction[] = auctions.map((a) => {
      const url = a.url.replace(/\/$/, "");
      const titleParts = (a.title || "").trim().split(/\s+/);
      const yearMatch = (a.title || "").match(/^(\d{4})\s+/);
      const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
      const make = titleParts[0] || null;
      const model = titleParts.slice(1).join(" ") || null;
      const externalId = url.split("/").filter(Boolean).pop() || url;
      return {
        url,
        title: a.title || externalId,
        platform,
        auction_end_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        current_bid: null,
        bid_count: null,
        no_reserve: false,
        reserve_met: null,
        year,
        make,
        model,
        thumbnail_url: null,
        external_id: externalId,
        raw_data: { source: "firecrawl_extract", synced_at: new Date().toISOString() },
      };
    });

    console.log(`[sync-live-auctions] ${platform}: Found ${liveAuctions.length} live auctions`);
    return { auctions: liveAuctions, error: null };
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    return { auctions: [], error: `${platform} sync failed: ${error}` };
  }
}

// ============================================
// PCarMarket Sync (Firecrawl)
// ============================================

async function syncPCarMarket(): Promise<{ auctions: LiveAuction[]; error: string | null }> {
  return syncViaFirecrawlExtract(
    "pcarmarket",
    "https://www.pcarmarket.com/listings/",
    /pcarmarket\.com\/auction\//i,
    { waitFor: 5000 }
  );
}

// ============================================
// Mecum Sync (Firecrawl, stealth proxy for Cloudflare)
// ============================================

async function syncMecum(): Promise<{ auctions: LiveAuction[]; error: string | null }> {
  return syncViaFirecrawlExtract(
    "mecum",
    "https://www.mecum.com/lots/",
    /mecum\.com\/lots\//i,
    { useProxy: true, waitFor: 5000 }
  );
}

// ============================================
// Barrett-Jackson Sync (Firecrawl, stealth proxy)
// ============================================

async function syncBarrettJackson(): Promise<{ auctions: LiveAuction[]; error: string | null }> {
  return syncViaFirecrawlExtract(
    "barrett-jackson",
    "https://www.barrett-jackson.com/Events/",
    /barrett-jackson\.com\//i,
    { useProxy: true, waitFor: 5000 }
  );
}

// ============================================
// RM Sotheby's Sync (Firecrawl)
// ============================================

async function syncRMSothebys(): Promise<{ auctions: LiveAuction[]; error: string | null }> {
  return syncViaFirecrawlExtract(
    "rm-sothebys",
    "https://rmsothebys.com/en/auctions",
    /rmsothebys\.com\//i,
    { waitFor: 4000 }
  );
}

// ============================================
// Gooding Sync (Firecrawl)
// ============================================

async function syncGooding(): Promise<{ auctions: LiveAuction[]; error: string | null }> {
  return syncViaFirecrawlExtract(
    "gooding",
    "https://www.goodingco.com/auctions/",
    /goodingco\.com\//i,
    { waitFor: 4000 }
  );
}

// ============================================
// Bonhams Motoring Sync (Firecrawl)
// ============================================

async function syncBonhams(): Promise<{ auctions: LiveAuction[]; error: string | null }> {
  return syncViaFirecrawlExtract(
    "bonhams",
    "https://www.bonhams.com/departments/mot/",
    /bonhams\.com\//i,
    { waitFor: 4000 }
  );
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
      const year = yearMatch ? parseInt(titleParts[0], 10) : null;

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
    "pcarmarket": "pcarmarket",
    "mecum": "mecum",
    "barrett-jackson": "barrett-jackson",
    "rm-sothebys": "rmsothebys",
    "gooding": "goodingco",
    "bonhams": "bonhams",
  };
  const urlPattern = platformUrlPatterns[platform] || platform.replace(/-/g, "");

  // Look up which of the current live auction URLs already exist in the DB.
  // Query by specific URLs (fast indexed lookup) instead of scanning all 355k+ active vehicles.
  const currentLiveUrls = auctions.map(a => a.url);
  const existingUrlSet = new Set<string>();

  // Check in batches of 50 URLs to stay under query param limits
  const URL_BATCH = 50;
  for (let i = 0; i < currentLiveUrls.length; i += URL_BATCH) {
    const urlBatch = currentLiveUrls.slice(i, i + URL_BATCH);
    const { data: existing } = await supabase
      .from("vehicles")
      .select("listing_url, bat_auction_url")
      .or(urlBatch.map(u => `listing_url.eq.${escapePostgrestValue(u)}`).join(","));

    if (existing) {
      for (const v of existing) {
        if (v.listing_url) existingUrlSet.add(v.listing_url);
        if (v.bat_auction_url) existingUrlSet.add(v.bat_auction_url);
      }
    }
  }

  // Skip ended-auction detection during regular sync cycles. The 355k+ stale "active"
  // vehicles can't be processed in a single edge function call. Ended detection is
  // handled separately by the extraction pipeline (external_listings.listing_status).

  // Batch upsert current live auctions
  // Split into updates (existing URLs) and inserts (new URLs), process in batches
  const now = new Date().toISOString();
  const toUpdate: LiveAuction[] = [];
  const toInsert: LiveAuction[] = [];

  for (const auction of auctions) {
    if (existingUrlSet.has(auction.url)) {
      toUpdate.push(auction);
    } else {
      toInsert.push(auction);
    }
  }

  // Batch update existing vehicles in chunks of 20
  const UPDATE_BATCH = 20;
  for (let i = 0; i < toUpdate.length; i += UPDATE_BATCH) {
    const batch = toUpdate.slice(i, i + UPDATE_BATCH);
    const promises = batch.map(auction => {
      const vehicleData = {
        listing_url: auction.url,
        title: auction.title,
        year: auction.year,
        make: auction.make,
        model: auction.model,
        auction_status: "active",
        sale_status: "auction_live",
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
          last_sync: now,
          ...auction.raw_data,
        },
        updated_at: now,
      };
      return supabase
        .from("vehicles")
        .update(vehicleData)
        .or(`listing_url.eq."${escapePostgrestValue(auction.url)}",bat_auction_url.eq."${escapePostgrestValue(auction.url)}"`)
        .then(({ error }) => !error);
    });
    const results = await Promise.all(promises);
    stats.updated_count += results.filter(Boolean).length;
  }

  // Batch insert new vehicles
  if (toInsert.length > 0) {
    const insertRows = toInsert.map(auction => ({
      listing_url: auction.url,
      title: auction.title,
      year: auction.year,
      make: auction.make,
      model: auction.model,
      auction_status: "active",
      sale_status: "auction_live",
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
        last_sync: now,
        ...auction.raw_data,
      },
      created_at: now,
      updated_at: now,
    }));

    // Insert in chunks of 20
    for (let i = 0; i < insertRows.length; i += UPDATE_BATCH) {
      const chunk = insertRows.slice(i, i + UPDATE_BATCH);
      const { error, data } = await supabase
        .from("vehicles")
        .insert(chunk)
        .select("id");

      if (!error) {
        stats.new_count += data?.length ?? chunk.length;
      } else if (error.code === "23505") {
        // Some duplicates — fall back to individual updates for this chunk
        for (const row of chunk) {
          const { error: upErr } = await supabase
            .from("vehicles")
            .update({ ...row, created_at: undefined })
            .eq("listing_url", row.listing_url);
          if (!upErr) stats.updated_count++;
        }
      }
    }
  }

  return stats;
}

// ============================================
// Bid Snapshot Recording (for backtesting)
// ============================================

/**
 * Records current bid snapshots for BaT auctions into bat_bids.
 * This provides the bid history needed for backtesting at all time windows.
 * Runs every 15 minutes when sync-live-auctions cron fires.
 */
async function recordBidSnapshots(
  supabase: ReturnType<typeof createClient>,
  auctions: LiveAuction[]
): Promise<number> {
  // Only record bids for BaT auctions that have a current_bid
  const biddable = auctions.filter(a => a.current_bid && a.current_bid > 0);
  if (biddable.length === 0) return 0;

  // Build URL-to-auction map
  const auctionByUrl = new Map<string, LiveAuction>();
  for (const a of biddable) auctionByUrl.set(a.url, a);

  // Query ALL active BaT external_listings (small set ~50), then match in memory
  const { data: extListings } = await supabase
    .from("external_listings")
    .select("vehicle_id, listing_url")
    .eq("platform", "bat")
    .eq("listing_status", "active");

  if (!extListings || extListings.length === 0) return 0;

  // Filter to only those with matching sync URLs
  const matched = extListings.filter(el => el.listing_url && auctionByUrl.has(el.listing_url));
  if (matched.length === 0) return 0;

  const vehicleIds = matched.map(el => el.vehicle_id);

  // Get bat_listing_ids for these vehicles
  const { data: batListings } = await supabase
    .from("bat_listings")
    .select("id, vehicle_id")
    .in("vehicle_id", vehicleIds);

  if (!batListings || batListings.length === 0) return 0;

  const vehicleToBatListing = new Map<string, string>();
  for (const bl of batListings) {
    vehicleToBatListing.set(bl.vehicle_id, bl.id);
  }

  // Build batch of bid rows to insert
  const now = new Date().toISOString();
  const bidRows: Array<{
    bat_listing_id: string;
    vehicle_id: string;
    bat_username: string;
    bid_amount: number;
    bid_timestamp: string;
    source: string;
    metadata: Record<string, unknown>;
  }> = [];

  for (const el of matched) {
    const auction = auctionByUrl.get(el.listing_url || "");
    if (!auction || !auction.current_bid) continue;

    const batListingId = vehicleToBatListing.get(el.vehicle_id);
    if (!batListingId) continue;

    bidRows.push({
      bat_listing_id: batListingId,
      vehicle_id: el.vehicle_id,
      bat_username: "bid_snapshot",
      bid_amount: auction.current_bid,
      bid_timestamp: now,
      source: "bid_history",
      metadata: { source: "sync_live_auctions" },
    });
  }

  if (bidRows.length === 0) return 0;

  // Bulk insert — duplicates impossible since timestamp is unique per run
  const { error } = await supabase.from("bat_bids").insert(bidRows);

  if (error) {
    console.error("[sync-live-auctions] Error recording bid snapshots:", error);
    return 0;
  }

  console.log(`[sync-live-auctions] Recorded ${bidRows.length} bid snapshots for BaT auctions`);
  return bidRows.length;
}

/**
 * Updates external_listings with fresh bid data from the BaT sync.
 * The prediction engine reads current_bid from external_listings, so keeping
 * this fresh is critical for accuracy. Only ~48 active BaT rows — very fast.
 */
async function updateExternalListings(
  supabase: ReturnType<typeof createClient>,
  auctions: LiveAuction[]
): Promise<number> {
  const biddable = auctions.filter(a => a.current_bid && a.current_bid > 0);
  if (biddable.length === 0) return 0;

  const auctionByUrl = new Map<string, LiveAuction>();
  for (const a of biddable) auctionByUrl.set(a.url, a);

  // Get all active BaT external_listings (small set ~48 rows)
  const { data: extListings } = await supabase
    .from("external_listings")
    .select("id, listing_url")
    .eq("platform", "bat")
    .eq("listing_status", "active");

  if (!extListings || extListings.length === 0) return 0;

  let updated = 0;
  const now = new Date().toISOString();

  for (const el of extListings) {
    const auction = el.listing_url ? auctionByUrl.get(el.listing_url) : null;
    if (!auction) continue;

    const updateData: Record<string, unknown> = {
      current_bid: auction.current_bid,
      updated_at: now,
    };
    if (auction.bid_count !== null) updateData.bid_count = auction.bid_count;

    const { error } = await supabase
      .from("external_listings")
      .update(updateData)
      .eq("id", el.id);

    if (!error) updated++;
  }

  return updated;
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
    "pcarmarket": "pcarmarket",
    "mecum": "mecum",
    "barrett-jackson": "barrett-jackson",
    "rm-sothebys": "rm-sothebys",
    "gooding": "gooding",
    "bonhams": "bonhams",
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
      // Get current active auction stats (auction_status and sale_status for UI parity)
      const { data: activeAuctions, count } = await supabase
        .from("vehicles")
        .select("listing_url, bat_auction_url, auction_status, sale_status, auction_end_date", { count: "exact" })
        .eq("auction_status", "active");

      const saleStatusLiveCount = (activeAuctions || []).filter(v => v.sale_status === "auction_live").length;

      // Group by platform
      const byPlatform: Record<string, number> = {};
      for (const v of activeAuctions || []) {
        const url = v.listing_url || v.bat_auction_url || "";
        let platform = "unknown";
        if (url.includes("bringatrailer")) platform = "bringatrailer";
        else if (url.includes("collectingcars")) platform = "collecting-cars";
        else if (url.includes("carsandbids")) platform = "cars-and-bids";
        else if (url.includes("pcarmarket")) platform = "pcarmarket";
        else if (url.includes("mecum.com")) platform = "mecum";
        else if (url.includes("barrett-jackson")) platform = "barrett-jackson";
        else if (url.includes("rmsothebys")) platform = "rm-sothebys";
        else if (url.includes("goodingco")) platform = "gooding";
        else if (url.includes("bonhams.com")) platform = "bonhams";
        byPlatform[platform] = (byPlatform[platform] || 0) + 1;
      }

      // Get source registry status for all main auction houses
      const { data: sources } = await supabase
        .from("source_registry")
        .select("slug, display_name, last_successful_at, status")
        .in("slug", [
          "bringatrailer",
          "collecting-cars",
          "cars-and-bids",
          "pcarmarket",
          "mecum",
          "barrett-jackson",
          "rm-sothebys",
          "gooding",
          "bonhams",
        ]);

      return okJson({
        success: true,
        total_active: count || 0,
        sale_status_live_count: saleStatusLiveCount,
        by_platform: byPlatform,
        sources: sources || [],
      });
    }

    if (action === "sync") {
      const results: SyncResult[] = [];
      const skipVehicleSync = body.skip_vehicle_sync ?? false;
      const allPlatforms = [
        "bringatrailer",
        "collecting-cars",
        "cars-and-bids",
        "pcarmarket",
        "mecum",
        "barrett-jackson",
        "rm-sothebys",
        "gooding",
        "bonhams",
      ];
      const platforms = targetPlatform ? [targetPlatform] : allPlatforms;

      const platformAliases: Record<string, string> = {
        bat: "bringatrailer",
        cc: "collecting-cars",
        cab: "cars-and-bids",
        pcar: "pcarmarket",
        bj: "barrett-jackson",
        rm: "rm-sothebys",
      };

      const functionStartTime = Date.now();
      const TIME_BUDGET_MS = 50_000; // 50s budget (edge function max ~60s)

      for (const platform of platforms) {
        // Time guard: skip remaining platforms if we've used most of the budget
        const elapsed = Date.now() - functionStartTime;
        if (elapsed > TIME_BUDGET_MS && results.length > 0) {
          console.log(`[sync-live-auctions] Time budget exceeded (${elapsed}ms), skipping remaining platforms`);
          results.push({
            platform: platformAliases[platform] || platform,
            success: false,
            live_count: 0,
            new_count: 0,
            updated_count: 0,
            ended_count: 0,
            error: `Skipped: time budget exceeded (${elapsed}ms)`,
            duration_ms: 0,
          });
          continue;
        }

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
          case "pcar":
          case "pcarmarket":
            syncResult = await syncPCarMarket();
            break;
          case "mecum":
            syncResult = await syncMecum();
            break;
          case "bj":
          case "barrett-jackson":
            syncResult = await syncBarrettJackson();
            break;
          case "rm":
          case "rm-sothebys":
            syncResult = await syncRMSothebys();
            break;
          case "gooding":
            syncResult = await syncGooding();
            break;
          case "bonhams":
            syncResult = await syncBonhams();
            break;
          default:
            syncResult = { auctions: [], error: `Unknown platform: ${platform}` };
        }

        const normalizedPlatform = platformAliases[platform] || platform;

        // Record bid snapshots + update external_listings FIRST (fast, critical for predictions)
        if (normalizedPlatform === "bringatrailer" && !syncResult.error && syncResult.auctions.length > 0) {
          try {
            const bidCount = await recordBidSnapshots(supabase, syncResult.auctions);
            console.log(`[sync-live-auctions] Recorded ${bidCount} BaT bid snapshots`);
          } catch (e) {
            console.error("[sync-live-auctions] Bid snapshot error (non-fatal):", e);
          }
          try {
            const elUpdated = await updateExternalListings(supabase, syncResult.auctions);
            console.log(`[sync-live-auctions] Updated ${elUpdated} external_listings rows`);
          } catch (e) {
            console.error("[sync-live-auctions] External listings update error (non-fatal):", e);
          }
        }

        // Sync to database (skip during cron to avoid timeout — 355k+ active vehicles make this slow)
        let dbStats = { new_count: 0, updated_count: 0, ended_count: 0 };
        if (!skipVehicleSync && !syncResult.error) {
          dbStats = await syncToDatabase(supabase, syncResult.auctions, normalizedPlatform);
        }

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
