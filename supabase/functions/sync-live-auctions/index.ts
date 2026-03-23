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
import { archiveFetch } from "../_shared/archiveFetch.ts";

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

    // Use archiveFetch so the page is stored in listing_page_snapshots for replay.
    // skipCache: true because live auction data changes every ~15 min (this cron runs every 15 min).
    const { html: batHtml, error: fetchError } = await archiveFetch(
      "https://bringatrailer.com/auctions/",
      {
        platform: "bat",
        skipCache: true,
        callerName: "sync-live-auctions",
      }
    );

    if (fetchError || !batHtml) {
      return { auctions: [], error: `BaT fetch failed: ${fetchError ?? "no HTML returned"}` };
    }

    const html = batHtml;

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
        // Parse year/make/model from BaT title
        // Titles often have prefixes: "44k-Mile 2001 Chevrolet Suburban", "No Reserve: 2006 Porsche..."
        // Strategy: find the 4-digit year anywhere in the title, then parse make/model after it
        const cleanTitle = item.title.replace(/&#\d+;/g, "'").replace(/&amp;/g, "&");
        const yearMatch = cleanTitle.match(/\b(19\d{2}|20[0-2]\d)\s+/);
        const year = yearMatch ? parseInt(yearMatch[1], 10) : (item.year ? parseInt(item.year, 10) : null);

        // Everything after the year is "make model trim..."
        let make: string | null = null;
        let model: string | null = null;
        if (yearMatch) {
          const afterYear = cleanTitle.substring(yearMatch.index! + yearMatch[0].length).trim();
          const parts = afterYear.split(/\s+/);
          make = parts[0] || null;
          model = parts.slice(1).join(" ") || null;
        } else {
          const parts = cleanTitle.split(/\s+/);
          make = parts[0] || null;
          model = parts.slice(1).join(" ") || null;
        }

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

    // Try to extract end times from page data (C&B embeds auction end timestamps)
    // Pattern: data-end-time="...", endTime, auctionEnd, or ISO timestamps near auction IDs
    const endTimePatterns = [
      /data-(?:end|auction-end)(?:-time)?=["']([^"']+)["']/gi,
      /"endTime"\s*:\s*"([^"]+)"/gi,
      /"auction_end"\s*:\s*"([^"]+)"/gi,
    ];
    const globalEndTimes: string[] = [];
    for (const pattern of endTimePatterns) {
      let etMatch;
      while ((etMatch = pattern.exec(html)) !== null) {
        globalEndTimes.push(etMatch[1]);
      }
    }

    // Extract auction data from card elements
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

      // Try to find an end time from page data for this auction
      // C&B auctions typically last 7 days from listing; use parsed end time if found
      const endTimeRegex = new RegExp(`${id}[^}]*?"(?:endTime|end_time|auction_end)"\\s*:\\s*"([^"]+)"`, "i");
      const etMatch = endTimeRegex.exec(html);
      const endDate = etMatch ? etMatch[1] : (globalEndTimes.shift() || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString());

      auctions.push({
        url,
        title,
        platform: "cars-and-bids",
        auction_end_date: endDate,
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

  // Fast upsert: INSERT all auctions with ON CONFLICT DO UPDATE on listing_url.
  // This eliminates the expensive URL lookup phase entirely — one DB call per batch.
  const now = new Date().toISOString();

  console.log(`[sync-live-auctions] ${platform}: Upserting ${auctions.length} auctions to vehicles table`);

  const upsertRows = auctions.map(auction => ({
      listing_url: auction.url,
      title: auction.title,
      year: auction.year,
      make: auction.make,
      model: auction.model,
      auction_status: "active",
      sale_status: "auction_live",
      auction_end_date: auction.auction_end_date,
      sale_price: auction.current_bid,
      primary_image_url: auction.thumbnail_url || undefined,
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
    }));

    // Upsert in chunks of 100 — ON CONFLICT updates auction-critical fields only
    const UPSERT_BATCH = 100;
    for (let i = 0; i < upsertRows.length; i += UPSERT_BATCH) {
      const chunk = upsertRows.slice(i, i + UPSERT_BATCH);
      const { error, data } = await supabase
        .from("vehicles")
        .upsert(chunk, {
          onConflict: "listing_url",
          ignoreDuplicates: false,
        })
        .select("id");

      if (!error) {
        stats.new_count += data?.length ?? chunk.length;
      } else {
        // If upsert fails (e.g., no unique constraint on listing_url), fall back to insert-only
        console.warn(`[sync-live-auctions] Upsert error: ${error.message}, trying insert with ignore`);
        const { error: insErr, data: insData } = await supabase
          .from("vehicles")
          .upsert(chunk, {
            onConflict: "listing_url",
            ignoreDuplicates: true,
          })
          .select("id");
        if (!insErr) {
          stats.new_count += insData?.length ?? 0;
        } else {
          console.error(`[sync-live-auctions] Insert fallback also failed: ${insErr.message}`);
        }
      }
    }

  // Ensure vehicle_events rows exist for all live auctions (needed for bid snapshots + comments)
  // Uses upsert on (vehicle_id, source_platform, source_url) to avoid duplicates
  try {
    const eventRows = auctions
      .filter(a => a.url)
      .map(a => ({
        source_platform: platform === "bringatrailer" ? "bat" : platform,
        source_url: a.url,
        event_type: "auction",
        event_status: "active",
        current_price: a.current_bid ? String(a.current_bid) : null,
        bid_count: a.bid_count,
        ended_at: a.auction_end_date,
        updated_at: now,
      }));

    // Match against vehicles to get vehicle_ids
    const urls = auctions.map(a => a.url).filter(Boolean);
    const { data: vehRows } = await supabase
      .from("vehicles")
      .select("id, listing_url")
      .in("listing_url", urls.slice(0, 200));

    const urlToVehicle = new Map((vehRows ?? []).map(v => [v.listing_url, v.id]));

    const eventsToInsert = eventRows
      .filter(e => urlToVehicle.has(e.source_url))
      .map(e => ({ ...e, vehicle_id: urlToVehicle.get(e.source_url) }));

    if (eventsToInsert.length > 0) {
      // Batch upsert — only insert if no existing active event for this vehicle+platform
      for (let i = 0; i < eventsToInsert.length; i += 100) {
        await supabase.from("vehicle_events").upsert(
          eventsToInsert.slice(i, i + 100),
          { onConflict: "vehicle_id,source_platform,source_url", ignoreDuplicates: true }
        );
      }
    }
    console.log(`[sync-live-auctions] Ensured ${eventsToInsert.length} vehicle_events for ${platform}`);
  } catch (e) {
    console.error("[sync-live-auctions] vehicle_events creation error (non-fatal):", e);
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
  console.log(`[bid-debug] biddable: ${biddable.length}/${auctions.length} auctions have current_bid > 0`);
  if (biddable.length === 0) return 0;

  // Build URL-to-auction map
  const auctionByUrl = new Map<string, LiveAuction>();
  for (const a of biddable) auctionByUrl.set(a.url, a);
  if (biddable.length > 0) {
    console.log(`[bid-debug] sample auction URL: ${biddable[0].url} bid: ${biddable[0].current_bid}`);
  }

  // Query ALL active BaT vehicle_events (including id for direct use as bat_listing_id)
  const { data: extListings, error: veErr } = await supabase
    .from("vehicle_events")
    .select("id, vehicle_id, source_url")
    .eq("source_platform", "bat")
    .eq("event_status", "active")
    .limit(10000);

  console.log(`[bid-debug] vehicle_events query: ${extListings?.length ?? 0} rows, error: ${veErr?.message ?? 'none'}`);
  if (!extListings || extListings.length === 0) return 0;

  if (extListings.length > 0) {
    console.log(`[bid-debug] sample vehicle_event URL: ${extListings[0].source_url}`);
  }

  // Filter to only those with matching sync URLs
  const matched = extListings.filter(el => el.source_url && auctionByUrl.has(el.source_url));
  console.log(`[bid-debug] URL matched: ${matched.length} vehicle_events match scraped auction URLs`);
  if (matched.length === 0) {
    // Debug: check for near-misses (trailing slash differences)
    const sampleVE = extListings.slice(0, 3).map(e => e.source_url);
    const sampleAuction = [...auctionByUrl.keys()].slice(0, 3);
    console.log(`[bid-debug] NO MATCH. Sample VE URLs: ${JSON.stringify(sampleVE)}`);
    console.log(`[bid-debug] NO MATCH. Sample auction URLs: ${JSON.stringify(sampleAuction)}`);
    return 0;
  }

  // Build batch of bid rows directly from matched results (id already selected)
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
    const auction = auctionByUrl.get(el.source_url || "");
    if (!auction || !auction.current_bid) continue;

    bidRows.push({
      bat_listing_id: el.id, // vehicle_events.id directly (FK dropped)
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
    console.error("[sync-live-auctions] Error recording bid snapshots:", JSON.stringify(error));
    console.error(`[sync-live-auctions] Attempted to insert ${bidRows.length} rows. Sample:`, JSON.stringify(bidRows[0]));
    return 0;
  }

  console.log(`[sync-live-auctions] Recorded ${bidRows.length} bid snapshots for BaT auctions`);
  return bidRows.length;
}

/**
 * Updates vehicle_events with fresh bid data from the BaT sync.
 * The prediction engine reads current_price from vehicle_events, so keeping
 * this fresh is critical for accuracy. Only ~48 active BaT rows — very fast.
 */
async function updateVehicleEvents(
  supabase: ReturnType<typeof createClient>,
  auctions: LiveAuction[]
): Promise<number> {
  const biddable = auctions.filter(a => a.current_bid && a.current_bid > 0);
  if (biddable.length === 0) return 0;

  const auctionByUrl = new Map<string, LiveAuction>();
  for (const a of biddable) auctionByUrl.set(a.url, a);

  // Get all active BaT vehicle_events (small set ~48 rows)
  const { data: events } = await supabase
    .from("vehicle_events")
    .select("id, source_url")
    .eq("source_platform", "bat")
    .eq("event_status", "active");

  if (!events || events.length === 0) return 0;

  let updated = 0;
  const now = new Date().toISOString();

  for (const ve of events) {
    const auction = ve.source_url ? auctionByUrl.get(ve.source_url) : null;
    if (!auction) continue;

    const updateData: Record<string, unknown> = {
      current_price: auction.current_bid,
      updated_at: now,
    };
    if (auction.bid_count !== null) updateData.bid_count = auction.bid_count;

    const { error } = await supabase
      .from("vehicle_events")
      .update(updateData)
      .eq("id", ve.id);

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

        // Record bid snapshots + update vehicle_events FIRST (fast, critical for predictions)
        let bidSnapshotCount = 0;
        if (normalizedPlatform === "bringatrailer" && !syncResult.error && syncResult.auctions.length > 0) {
          try {
            bidSnapshotCount = await recordBidSnapshots(supabase, syncResult.auctions);
            console.log(`[sync-live-auctions] Recorded ${bidSnapshotCount} BaT bid snapshots`);
          } catch (e) {
            console.error("[sync-live-auctions] Bid snapshot error (non-fatal):", e);
          }
          try {
            const veUpdated = await updateVehicleEvents(supabase, syncResult.auctions);
            console.log(`[sync-live-auctions] Updated ${veUpdated} vehicle_events rows`);
          } catch (e) {
            console.error("[sync-live-auctions] Vehicle events update error (non-fatal):", e);
          }
        }

        // Trigger comment extraction for BaT auctions ending within 6 hours
        if (normalizedPlatform === "bringatrailer" && !syncResult.error && syncResult.auctions.length > 0) {
          try {
            const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
            const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
            const endingSoon = syncResult.auctions.filter(a => {
              const hoursLeft = (new Date(a.auction_end_date).getTime() - Date.now()) / (1000 * 60 * 60);
              return hoursLeft > 0 && hoursLeft <= 6 && a.current_bid && a.current_bid > 0;
            });
            const toExtract = endingSoon.slice(0, 10);
            if (toExtract.length > 0) {
              console.log(`[sync-live-auctions] Triggering comment extraction for ${toExtract.length} auctions ending within 6h`);
              for (const auction of toExtract) {
                fetch(`${supabaseUrl}/functions/v1/extract-auction-comments`, {
                  method: "POST",
                  headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
                  body: JSON.stringify({ auction_url: auction.url }),
                }).catch(() => {});
              }
            }
          } catch (e) {
            console.error("[sync-live-auctions] Comment extraction trigger error (non-fatal):", e);
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
          bid_snapshots: bidSnapshotCount,
          error: syncResult.error,
          duration_ms: Date.now() - startTime,
        });
      }

      // Cleanup: mark expired auctions as ended (catches C&B 7-day defaults and any stale auctions)
      try {
        const { count: endedCount } = await supabase
          .from("vehicles")
          .update({ auction_status: "ended", sale_status: "not_sold" })
          .eq("auction_status", "active")
          .lt("auction_end_date", new Date().toISOString())
          .not("auction_end_date", "is", null)
          .select("id", { count: "exact", head: true });

        if (endedCount && endedCount > 0) {
          console.log(`[sync-live-auctions] Cleanup: marked ${endedCount} expired auctions as ended`);
        }
      } catch (e) {
        console.error("[sync-live-auctions] Cleanup error (non-fatal):", e);
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
