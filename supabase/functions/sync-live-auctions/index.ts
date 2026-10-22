import "jsr:@supabase/functions-js/edge-runtime.d.ts";
/**
 * Sync Live Auctions
 *
 * Monitors live auctions across multiple platforms and keeps our database in sync.
 * Designed to run every 15 minutes via cron.
 *
 * Sources:
 *   - BaT: Scrapes auctionsCurrentInitialData from /auctions/ page (no API key needed)
 *   - Collecting Cars: the site's public Typesense listing collection (production_listings)
 *   - PCarMarket: its server-rendered live auction board (direct fetch); bids of lots that moved from the lot page
 *   - Bonhams: its public Typesense sale and lot index; bids of its online (timed) sales from its bidding platform
 *     (live.bonhams.com); lots of in-room catalog sales are written 'upcoming', never live
 *   - Broad Arrow: its bidding site's timed online sales (sale list hourly, lot list with top bids every run)
 *   - Gooding: its bidding platform's open timed lots (bid.goodingco.com /ajax/lots JSON), identity from its catalog
 *   - Cars & Bids: Uses Firecrawl (Cloudflare protected)
 *   - Mecum, Barrett-Jackson: Firecrawl scrape + extract; RM Sotheby's has no readable live bid (see syncRMSothebys)
 * Collecting Cars, PCarMarket, Bonhams, Broad Arrow and Gooding boards are complete lists: after the vehicles upsert each is handed to
 * live_auction_board_sync, the monitored_auctions schedule writer for those houses (BaT's is bat_live_pull_run).
 *
 * Deploy: supabase functions deploy sync-live-auctions --no-verify-jwt
 *
 * Usage:
 *   POST {"action": "sync"}                      - sync all platforms
 *   POST {"action": "sync", "platform": "bat"}   - sync specific platform (bat, cc, cab, pcarmarket, mecum, barrett-jackson, rm-sothebys, gooding, bonhams, broad-arrow)
 *   POST {"action": "sync", "platforms": ["collecting-cars", "pcarmarket", "bonhams"]} - sync several
 *   POST {"action": "status"}                    - get current live auction stats
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { firecrawlScrape } from "../_shared/firecrawl.ts";
import { archiveFetch } from "../_shared/archiveFetch.ts";
import { requireWriteAuth } from "../_shared/writeGuard.ts";
import { parseBatIdentityFromUrl, parseBatIdentityFromTitle } from "../_shared/batParser.ts";
import { projectSecretKey } from "../_shared/supabaseKeys.ts";
import { mustWrite, softWrite } from '../_shared/writeResult.ts';
import {
  type BonhamsBidState, type BonhamsLotDoc, type BonhamsSaleDoc, bonhamsLot, bonhamsLotPhase, bonhamsSaleKind,
  type PcarBoardItem, parseBonhamsBidStates, parsePcarBids, parsePcarBoard,
} from "./boards.ts";
import { type AmLotDoc, amOpenTimedSales, amSales, amTimedLot, BROAD_ARROW_BID } from "./boards.ts";
import {
  goodingBoardLot, type GoodingCatalogLot, goodingCatalogFor, goodingLinkPlan, type GoodingLot, goodingUrlVariants,
  type GoodingVehicleRow, goodingWithBidState, parseGoodingLots,
} from "./boards.ts";

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
  /** The house's close for this lot. null when the source does not give one: never estimated (2026-10-22). */
  auction_end_date: string | null;
  /** Why auction_end_date is null; written to origin_metadata.auction_end_date_missing_reason. */
  end_date_missing_reason?: string | null;
  current_bid: number | null;
  bid_count: number | null;
  no_reserve: boolean;
  reserve_met: boolean | null;
  year: number | null;
  make: string | null;
  model: string | null;
  thumbnail_url: string | null;
  external_id: string | null;
  currency?: string | null;
  /** auction_live unless the house says otherwise: a catalog lot is 'upcoming', a lot whose bidding closed 'ended'. */
  sale_status?: "auction_live" | "upcoming" | "ended";
  raw_data: Record<string, unknown>;
}

interface SyncResult {
  platform: string;
  success: boolean;
  live_count: number;
  new_count: number;
  updated_count: number;
  ended_count: number;
  write_errors?: string[];
  board?: Record<string, unknown> | null;
  bid_snapshots?: number;
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
        // Identity. BaT's feed carries the year as its own field; the lot slug is BaT's "year-make-model"
        // (parseBatIdentityFromUrl — descriptors before the year skipped, multi-word makes joined); the title,
        // once the make is known, gives the full model and covers a slug without a year
        // ("coyote-powered-ford-mustang-gt-fastback-by-revology"). A title's first word is never the make: the
        // old first-word split left 8 live rows reading "Coyote-Powered" / "LS3-Powered" / "Pair" (2026-09-27).
        const cleanTitle = item.title.replace(/&#\d+;/g, "'").replace(/&amp;/g, "&");
        const ident = parseBatIdentityFromUrl(item.url);
        const fromTitle = parseBatIdentityFromTitle(cleanTitle, ident.make);
        const feedYear = /^\d{4}$/.test(String(item.year || "")) ? parseInt(item.year, 10) : null;
        const year = feedYear ?? ident.year ?? fromTitle.year;
        const make = ident.make ?? fromTitle.make;
        const model = (ident.make && fromTitle.model) ? fromTitle.model : (ident.model ?? fromTitle.model);

        return {
          url: item.url.replace(/\/$/, ""),
          title: item.title,
          platform: "bringatrailer",
          auction_end_date: new Date(item.timestamp_end * 1000).toISOString(),
          // BaT sends current_bid: false for no-bid lots — that is "no bid yet",
          // not a number. 'false'::int aborted whole upsert chunks (2026-07-11).
          current_bid: typeof item.current_bid === "number" ? item.current_bid : null,
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

// The site's public search-only key and collection (collecting-cars-discovery reads the same). The old collection
// "production_cars" was retired upstream: it answered 404 "Collection not found" from 2026-02 until this change.
const TYPESENSE_API_KEY = "0I2WvLvRUeeHNaDV74u0KRlkLnhhgH9S";
const TYPESENSE_COLLECTION = "production_listings";
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

const CC_PAGE_SIZE = 250;
const CC_MAX_PAGES = 40; // 250 * 40 = 10k cap for scale toward 4k-10k live

async function syncCollectingCars(): Promise<{ auctions: LiveAuction[]; error: string | null }> {
  try {
    console.log("[sync-live-auctions] Fetching Collecting Cars live auctions from Typesense...");

    const documents: TypesenseDocument[] = [];
    let page = 1;

    while (page <= CC_MAX_PAGES) {
      const response = await fetch(`${TYPESENSE_ENDPOINT}?x-typesense-api-key=${TYPESENSE_API_KEY}`, { // guardrail-allow: raw-fetch (house JSON API)
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          searches: [{
            collection: TYPESENSE_COLLECTION,
            q: "*",
            filter_by: "stage:=live && lotType:=car",
            per_page: CC_PAGE_SIZE,
            page,
            query_by: "title",
          }],
        }),
      });

      if (!response.ok) {
        return { auctions: [], error: `Collecting Cars Typesense returned HTTP ${response.status}` };
      }

      const data = await response.json();
      if (data.results?.[0]?.error) {
        return { auctions: [], error: `Collecting Cars Typesense: ${data.results[0].error}` };
      }
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
        // dtStageEndsUTC is "YYYY-MM-DD HH:MM:SS" in UTC with no zone mark
        const ends = doc.dtStageEndsUTC ? new Date(`${doc.dtStageEndsUTC.replace(" ", "T")}Z`) : null;

        return {
          url: `https://collectingcars.com/for-sale/${doc.slug}`,
          title: doc.title,
          platform: "collecting-cars",
          auction_end_date: ends && Number.isFinite(ends.getTime()) ? ends.toISOString() : "",
          current_bid: doc.currentBid > 0 ? doc.currentBid : null,
          bid_count: doc.noBids,
          currency: doc.currencyCode ?? null,
          no_reserve: doc.noReserve === true || doc.noReserve === "true",
          reserve_met: doc.reserveMet ?? null,
          year,
          make: doc.makeName || null,
          model: doc.modelName || null,
          thumbnail_url: doc.mainImageUrl || null,
          external_id: String(doc.auctionId),
          raw_data: {
            source: "typesense_production_listings",
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
        // The extract carries no close time. It used to write now + 7 days, an invented date that comps and the
        // live board read as the lot's real close (266 Cars & Bids rows superseded 2026-10-22). Unknown stays null.
        auction_end_date: null,
        end_date_missing_reason: "firecrawl extract gives no close time",
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
// PCarMarket Sync (server-rendered live board, direct fetch)
// ============================================

const PCAR_MAX_PAGES = 8;

/** Year / make / model from a lot slug (descriptor-safe, multi-word makes) and its title, as for BaT. */
function identityFromSlugAndTitle(slug: string, title: string) {
  const ident = parseBatIdentityFromUrl(`https://x.invalid/listing/${slug.replace(/-\d{10,}$/, "")}`);
  const fromTitle = parseBatIdentityFromTitle(title, ident.make);
  return {
    year: ident.year ?? fromTitle.year,
    make: ident.make ?? fromTitle.make,
    model: (ident.make && fromTitle.model) ? fromTitle.model : (ident.model ?? fromTitle.model),
  };
}

async function syncPCarMarket(): Promise<{ auctions: LiveAuction[]; error: string | null }> {
  try {
    const items: PcarBoardItem[] = [];
    let pages = 1;
    for (let page = 1; page <= Math.min(pages, PCAR_MAX_PAGES); page++) {
      // /auctions is the live board; ?page=1 and the old ?auctionType=live redirect, which the direct fetcher refuses
      const { html, error } = await archiveFetch(page === 1 ? "https://www.pcarmarket.com/auctions" : `https://www.pcarmarket.com/auctions?page=${page}`, {
        platform: "pcarmarket",
        skipCache: true,
        useFirecrawl: false, // the board is server-rendered; archiveFetch would otherwise route pcarmarket.com to Firecrawl
        callerName: "sync-live-auctions",
      });
      if (error || !html) return { auctions: [], error: `PCarMarket board page ${page}: ${error ?? "no HTML"}` };
      const board = parsePcarBoard(html);
      if (page === 1 && board.items.length === 0) return { auctions: [], error: "PCarMarket board: no items parsed" };
      items.push(...board.items);
      pages = board.totalPages ?? 1;
    }
    console.log(`[sync-live-auctions] PCarMarket: ${items.length} open items on ${pages} board pages`);
    const auctions: LiveAuction[] = items
      .filter((it) => it.status === "ITEM_OPEN" && it.schema === "Vehicle")
      .map((it) => {
        const ident = identityFromSlugAndTitle(it.slug, it.title);
        return {
          url: it.url,
          title: it.title,
          platform: "pcarmarket",
          auction_end_date: it.ends ?? "",
          current_bid: it.current_bid,
          bid_count: it.bid_count,
          currency: it.currency,
          no_reserve: false,
          reserve_met: null,
          year: ident.year,
          make: ident.make,
          model: ident.model,
          thumbnail_url: null,
          external_id: it.slug,
          raw_data: { source: "pcarmarket_live_board", basta_item_id: it.id, image_count: it.image_count, synced_at: new Date().toISOString() },
        };
      });
    return { auctions, error: null };
  } catch (e: unknown) {
    return { auctions: [], error: `PCarMarket sync failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * Bids of PCarMarket lots whose bid count moved, from the lot page's own bid history (Basta id, time, amount,
 * bidder), admitted through ingest-observation as kind 'bid' with observed_at = the bid's own time. A bid already
 * held for the vehicle is not posted again.
 */
async function ingestPcarBids(
  supabase: ReturnType<typeof createClient>,
  moved: { url: string; vehicle_id: string | null }[],
  maxLots: number,
): Promise<{ lots: number; posted: number; errors: string[] }> {
  const out = { lots: 0, posted: 0, errors: [] as string[] };
  const base = Deno.env.get("SUPABASE_URL") ?? "";
  const key = projectSecretKey() ?? "";
  const linked = moved.flatMap((m) => (m.vehicle_id ? [{ url: m.url, vehicle_id: m.vehicle_id }] : []));
  for (const lot of linked.slice(0, maxLots)) {
    const { html, error } = await archiveFetch(lot.url.replace("https://pcarmarket.com/", "https://www.pcarmarket.com/"), {
      platform: "pcarmarket", skipCache: true, useFirecrawl: false, callerName: "sync-live-auctions",
    });
    if (error || !html) { out.errors.push(`${lot.url}: ${error ?? "no HTML"}`); continue; }
    out.lots++;
    const bids = parsePcarBids(html);
    if (!bids.length) continue;
    const ids = bids.map((b) => `pcarmarket-bid:${b.id}`);
    const { data: held } = await supabase.from("vehicle_observations").select("source_identifier")
      .eq("vehicle_id", lot.vehicle_id).eq("kind", "bid").in("source_identifier", ids);
    const have = new Set((held ?? []).map((r: { source_identifier: string }) => r.source_identifier));
    for (const b of bids) {
      const sid = `pcarmarket-bid:${b.id}`;
      if (have.has(sid)) continue;
      const res = await fetch(`${base}/functions/v1/ingest-observation`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          source_slug: "pcarmarket",
          kind: "bid",
          observed_at: b.at,
          source_url: lot.url,
          source_identifier: sid,
          content_text: `Bid $${b.amount.toLocaleString("en-US")}`,
          structured_data: { bid_id: b.id, amount: b.amount, currency: "USD", bidder: b.bidder, bid_status: b.status, clock: "source_event_time" },
          vehicle_id: lot.vehicle_id,
          extraction_method: "pcarmarket_ssr_bids_v1",
        }),
      });
      if (res.ok) out.posted++;
      else out.errors.push(`${sid}: HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
    }
  }
  return out;
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
// RM Sotheby's: no live-bid source
// ============================================

// RM's timed online sales list their lots publicly (api/search/SearchLots: estimate, scheduled close, no-reserve), but
// a lot's current bid reaches its page only over RM's bid socket (wss://bid-service-*.rmsothebys.com/ws/timed/listen/),
// which closes every connection whose Origin is not RM's own site: "1003 Invalid origin" with no Origin and with
// https://nuke.ag (2026-10-20). The Firecrawl extract this replaced wrote auction pages as lots with an invented
// seven-day close. RM's catalog lots come from extract-rmsothebys.
async function syncRMSothebys(): Promise<{ auctions: LiveAuction[]; error: string | null }> {
  return { auctions: [], error: "RM Sotheby's: no live-bid source (its bid socket admits only rmsothebys.com origins); lots come from extract-rmsothebys" };
}

// ============================================
// Gooding Sync (its bidding platform's open timed lots, direct JSON; identity from its catalog)
// ============================================

const GOODING_BID = "https://bid.goodingco.com";
const GOODING_CATALOG = "https://cdn.goodingco.com/graphql";
const GOODING_UA = "NukeListingCollector/1.0 (+https://nuke.ag)";
const GOODING_LOT_FIELDS = "timed-auction reserve-status absentee-bid highest-live-bid summary";
const GOODING_BLOCKED = "blocked or rate-limited";
const GOODING_CATALOG_QUERY = `query GetVehiclesAndFilters($filtersInput: FiltersInput!, $pageNumber: Int, $sortBy: SortBy!, $hitsPerPage: Int) {
  getVehicles(filtersInput: $filtersInput, pageNumber: $pageNumber, sortBy: $sortBy, updateFilters: false, hitsPerPage: $hitsPerPage) {
    vehicles { slug title itemType make model modelYear lotNumber hasReservePrice upcomingAuctionEndDate lotAuctionMobilityId auctionAuctionMobilityId cloudinaryImages { public_id } }
  }
}`;

// deno-lint-ignore no-explicit-any
type GoodingDb = { from: (table: string) => any }; // the vehicles reads and fill-only writes below

/** One JSON read from Gooding, politely: our own user agent, one request at a time, a block or rate limit stops the read. */
async function goodingJson(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<unknown> {
  const res = await fetch(url, { method: init.method, body: init.body, signal: AbortSignal.timeout(20_000), // guardrail-allow: raw-fetch (house JSON API)
    headers: { "User-Agent": GOODING_UA, Accept: "application/json", ...init.headers } });
  if (res.status === 403 || res.status === 429) throw new Error(`${new URL(url).host} answered ${res.status} (${GOODING_BLOCKED}); read stopped`);
  if (!res.ok) throw new Error(`${new URL(url).host} HTTP ${res.status}`);
  return await res.json();
}

/**
 * Gooding's open timed lots (Geared Online and any timed sale) from its bidding platform, bid.goodingco.com: every lot of
 * a timed sale that has not ended (the lot list), then the open lots' bid box state (leading bid, bid count, the close
 * each extension moved). Nothing open costs two small requests. In-room sales (Pebble Beach, Amelia, the
 * Gooding Christie's sales registered through christies.com) take bids only in the room and are not read here. Each open
 * vehicle lot carries its catalog identity and the catalog lot URL in the spelling vehicles hold; a vehicle that holds the
 * lot only as discovery_url gets it as listing_url first, so the live upsert updates that vehicle rather than minting a
 * twin (goodingLinkPlan). The list is complete: lots that left it leave the schedule in live_auction_board_sync.
 */
async function syncGooding(
  supabase: GoodingDb,
  link: boolean,
): Promise<{ auctions: LiveAuction[]; error: string | null; write_errors?: string[] }> {
  try {
    const now = Date.now();
    const page = (params: Record<string, string>, o: number) => goodingJson(`${GOODING_BID}/ajax/lots/?${new URLSearchParams({
      n: "100", order_by: "auction_date lot_number", order: "asc asc", fieldset: GOODING_LOT_FIELDS, paramsType: "server", ...params, o: String(o),
    })}`);
    const readAll = async (params: Record<string, string>) => {
      const out: GoodingLot[] = [];
      for (let o: number | null = 0, i = 0; o !== null && i < 10; i++) {
        const p = parseGoodingLots(await page(params, o), now);
        out.push(...p.lots);
        o = p.next;
      }
      return out;
    };
    // the platform's "upcoming" lots are those of sales whose end is still ahead, running sales included
    const lots = await readAll({ lotsRange: "upcoming", auction_type: "timed timed_then_live" });
    // the newest timed sale filed as past is read whole only if it still has active lots
    const newest = parseGoodingLots(await page({ lotsRange: "past", auction_type: "timed timed_then_live", n: "1", order: "desc asc" }, 0), now).lots[0];
    if (newest?.am_auction_id && (newest.auction_active_lots ?? 0) > 0 && !lots.some((l) => l.am_auction_id === newest.am_auction_id)) {
      lots.push(...await readAll({ auctionId: newest.am_auction_id }));
    }
    const listed = lots.filter((l) => l.phase === "open");
    const phases = lots.reduce((m, l) => ({ ...m, [l.phase]: (m[l.phase] ?? 0) + 1 }), {} as Record<string, number>);
    console.log(`[sync-live-auctions] Gooding: ${lots.length} timed-sale lots on bid.goodingco.com ${JSON.stringify(phases)}`);
    if (!listed.length) return { auctions: [], error: null };

    // The open lots' bid box state (widget/lots, the call the lot page makes; 50 lots a call, 0.6 s apart): the leading
    // bid, the bid count and the close each extension moved. If it fails, the lot list's bids stand without a count.
    const states = new Map<string, BonhamsBidState>();
    let widgetError: string | null = null;
    try {
      const bySale = new Map<string, string[]>();
      for (const l of listed) if (l.am_auction_id) bySale.set(l.am_auction_id, [...(bySale.get(l.am_auction_id) ?? []), l.am_lot_id]);
      let calls = 0;
      for (const [sale, ids] of bySale) {
        for (let i = 0; i < ids.length; i += 50) {
          if (calls++) await new Promise((r) => setTimeout(r, 600));
          const body = await goodingJson(`${GOODING_BID}/widget/lots/${encodeURIComponent(sale)}`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lot_ids: ids.slice(i, i + 50) }),
          });
          for (const s of parseBonhamsBidStates(body)) states.set(s.am_lot_id, s);
        }
      }
    } catch (e) {
      widgetError = e instanceof Error ? e.message : String(e);
      if (widgetError.includes(GOODING_BLOCKED)) throw e; // a refusal stops the read and is recorded, never worked around
    }
    const open = listed.map((l) => goodingWithBidState(l, states.get(l.am_lot_id), now)).filter((l) => l.phase === "open");

    // Catalog identity. ENDING_SOONEST lists lots of sales still ahead first; read until every open lot is matched.
    const catalog: GoodingCatalogLot[] = [];
    let catalogError: string | null = null;
    try {
      for (let p = 0; p < 8; p++) {
        const r = await goodingJson(GOODING_CATALOG, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer" },
          body: JSON.stringify({ query: GOODING_CATALOG_QUERY, variables: { filtersInput: {}, pageNumber: p, sortBy: "ENDING_SOONEST", hitsPerPage: 100 } }),
        }) as { data?: { getVehicles?: { vehicles?: GoodingCatalogLot[] } }; errors?: { message?: string }[] };
        if (r.errors?.length) throw new Error(r.errors[0].message ?? "GraphQL error");
        const vs = r.data?.getVehicles?.vehicles ?? [];
        catalog.push(...vs);
        if (open.every((l) => goodingCatalogFor(l, catalog)) || vs.length < 100 || vs.some((v) => Number(v.upcomingAuctionEndDate) >= 9_999_999_999_999)) break;
      }
    } catch (e) {
      catalogError = e instanceof Error ? e.message : String(e); // the lots still read, under the platform's lot pages
      if (catalogError.includes(GOODING_BLOCKED)) throw e;
    }
    const rows = open.map((lot) => ({ lot, cat: goodingCatalogFor(lot, catalog) }))
      .map((r) => ({ ...r, ...goodingBoardLot(r.lot, r.cat) }))
      .filter((r) => r.vehicle && r.url);

    // The vehicles already holding these lots, under either URL column and every spelling.
    const held: GoodingVehicleRow[] = [];
    const spellings = [...new Set(rows.flatMap((r) => goodingUrlVariants(r.url!)))];
    for (let i = 0; i < spellings.length; i += 50) {
      const chunk = spellings.slice(i, i + 50);
      for (const column of ["listing_url", "discovery_url"]) {
        const { data, error } = await supabase.from("vehicles").select("id, listing_url, discovery_url").in(column, chunk).is("deleted_at", null);
        if (error) throw new Error(`Gooding vehicle lookup: ${error.message}`);
        held.push(...(data ?? []) as GoodingVehicleRow[]);
      }
    }
    const writeErrors: string[] = [];
    const auctions: LiveAuction[] = [];
    for (const r of rows) {
      const plan = goodingLinkPlan(r.url!, held);
      if (plan.link === "claim" && link) {
        // fill only: the vehicle holds this lot as discovery_url and has no listing_url
        const claimed = await supabase.from("vehicles").update({ listing_url: plan.url }).eq("id", plan.vehicle_id!).is("listing_url", null);
        if (softWrite(`gooding listing_url claim ${plan.vehicle_id}`, claimed, writeErrors)) continue; // never write a twin
      }
      const ident = r.cat ? { year: r.year, make: r.make, model: r.model } : parseBatIdentityFromTitle(r.title, null);
      auctions.push({
        url: plan.url,
        title: r.title,
        platform: "gooding",
        auction_end_date: r.lot.ends ?? "",
        current_bid: r.lot.current_bid,
        bid_count: r.lot.bid_count,
        currency: r.lot.currency,
        no_reserve: r.no_reserve,
        reserve_met: r.lot.reserve_met,
        year: ident.year,
        make: ident.make,
        model: ident.model,
        thumbnail_url: r.image,
        external_id: r.lot.am_lot_id,
        raw_data: {
          source: "gooding_am_lots", sale: r.lot.sale, am_auction_id: r.lot.am_auction_id, lot_number: r.lot.lot_number,
          bid_url: r.lot.bid_url, bid_at: r.lot.bid_at, opening_bid: r.lot.opening_bid, estimate_low: r.lot.estimate_low,
          estimate_high: r.lot.estimate_high, item_type: r.item_type, catalog: r.cat ? "matched" : (catalogError ?? "unmatched"),
          bid_state: states.has(r.lot.am_lot_id) ? "bid_box" : (widgetError ?? "lot_list"),
          link: plan.link, state_sequence: r.lot.state_sequence, synced_at: new Date().toISOString(),
        },
      });
    }
    console.log(`[sync-live-auctions] Gooding: ${open.length} open lots, ${auctions.length} vehicles on the board` +
      `${catalogError ? ` (catalog: ${catalogError})` : ""}${widgetError ? ` (bid box: ${widgetError})` : ""}`);
    return { auctions, error: null, write_errors: writeErrors };
  } catch (e: unknown) {
    return { auctions: [], error: `Gooding sync failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * Gooding lots no vehicle held were just written under their catalog URL: give that row the same discovery_url (fill only),
 * so extract-gooding, which resolves a lot by discovery_url, enriches the row instead of inserting a twin.
 */
async function goodingFillDiscovery(supabase: GoodingDb, auctions: LiveAuction[]): Promise<string[]> {
  const errors: string[] = [];
  // catalog lot URLs only: a lot the catalog did not match is written under the platform's lot page, which no intake keys on
  for (const a of auctions.filter((x) => x.raw_data.link === "new" && goodingUrlVariants(x.url).length > 1)) {
    softWrite(`gooding discovery_url fill ${a.url}`, await supabase.from("vehicles").update({ discovery_url: a.url })
      .eq("listing_url", a.url).is("discovery_url", null).is("deleted_at", null), errors);
  }
  return errors;
}

// ============================================
// Bonhams Motoring Sync (public Typesense sale + lot index; bids from its bidding platform)
// ============================================

const BONHAMS_TS_HOST = "https://api01.bonhams.com/search-proxy/collections";
const BONHAMS_TS_KEY = "7YZqOyG0twgst4ACc2VuCyZxpGAYzM0weFTLCC20FQY"; // the site's public search-only key (extract-bonhams-typesense)
// Bonhams' bidding platform (Auction Mobility): the call the lot page's own bid box makes for a sale's lots
const BONHAMS_BIDS_URL = "https://live.bonhams.com/widget/lots/";
const BONHAMS_UA = "NukeLiveBidReader/1.0 (+https://nuke.ag)";

/**
 * Only an online (timed) sale with bidding open carries live bids: each lot's leading bid, bid count and its own close
 * (moved by extensions) come from the bidding platform, 50 lots a call, 0.6 s apart; a refused call stops the read.
 * An in-room sale (Typesense auctionType PUBLIC; the platform's sale type 'live') has estimates and a sale date only:
 * its lots are written 'upcoming' and stay on the auction calendar, never on the live board.
 */
async function syncBonhams(): Promise<{ auctions: LiveAuction[]; error: string | null }> {
  try {
    const get = async (collection: string, params: Record<string, string>) => {
      const res = await fetch(`${BONHAMS_TS_HOST}/${collection}/documents/search?${new URLSearchParams(params)}`, { // guardrail-allow: raw-fetch (house JSON API)
        headers: { "X-TYPESENSE-API-KEY": BONHAMS_TS_KEY, Accept: "application/json", "User-Agent": BONHAMS_UA },
      });
      if (!res.ok) throw new Error(`Bonhams Typesense ${collection} HTTP ${res.status}`);
      return await res.json();
    };
    const bidStates = async (amSale: string, amLots: string[]) => {
      const out = new Map<string, BonhamsBidState>();
      for (let i = 0; i < amLots.length; i += 50) {
        if (i > 0) await new Promise((r) => setTimeout(r, 600));
        const res = await fetch(`${BONHAMS_BIDS_URL}${encodeURIComponent(amSale)}`, { // guardrail-allow: raw-fetch (house JSON API)
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": BONHAMS_UA },
          body: JSON.stringify({ lot_ids: amLots.slice(i, i + 50) }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`Bonhams bidding platform sale ${amSale} HTTP ${res.status}`);
        for (const s of parseBonhamsBidStates(await res.json())) out.set(s.am_lot_id, s);
      }
      return out;
    };
    const today = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    const a = await get("auctions", { q: "*", query_by: "brand", per_page: "60", filter_by: "departments.code:=[MOT-CAR,MOT-CYC]", sort_by: "dates.end.timestamp:desc" });
    // deno-lint-ignore no-explicit-any
    const sales = (a.hits ?? []).map((h: any) => h.document as BonhamsSaleDoc)
      .filter((d: BonhamsSaleDoc) => bonhamsSaleKind(d) !== "ended" && String(d.dates?.end?.datetime ?? "").slice(0, 10) >= today);
    const auctions: LiveAuction[] = [];
    const kinds: string[] = [];
    for (const sale of sales) {
      const kind = bonhamsSaleKind(sale);
      kinds.push(`${sale.id}:${kind}`);
      // an online sale's motorcycles bid live too; in-room catalog lots are read for cars only, as before
      const depts = kind === "live_bid" ? "[MOT-CAR,MOT-CYC]" : "MOT-CAR";
      const docs: BonhamsLotDoc[] = [];
      for (let page = 1; page <= 4; page++) {
        const r = await get("lots", { q: "*", query_by: "title", per_page: "250", page: String(page), filter_by: `auctionId:=${sale.id} && department.code:=${depts}` });
        // deno-lint-ignore no-explicit-any
        docs.push(...(r.hits ?? []).map((h: any) => h.document as BonhamsLotDoc));
        if ((r.hits ?? []).length < 250) break;
      }
      const lots = docs.filter((d) => d.lotId && d.lotId !== "0") // not yet catalogued: no lot number, no lot page
        .map(bonhamsLot).filter((l) => l.title && l.url.includes("/lot/"));
      const amSale = lots.find((l) => l.am_sale_id)?.am_sale_id;
      const states = kind === "live_bid" && amSale
        ? await bidStates(amSale, lots.flatMap((l) => (l.am_lot_id ? [l.am_lot_id] : [])))
        : new Map<string, BonhamsBidState>();
      for (const lot of lots) {
        const bid = lot.am_lot_id ? states.get(lot.am_lot_id) : undefined;
        const phase = bonhamsLotPhase(kind, bid, now);
        const ident = parseBatIdentityFromTitle(lot.title.replace(/\s+(Chassis|Registration|Frame|Engine) no\..*$/i, ""), null);
        auctions.push({
          url: lot.url,
          title: lot.title,
          platform: "bonhams",
          auction_end_date: (phase === "upcoming" ? null : bid?.ends) ?? lot.ends ?? "",
          current_bid: phase === "upcoming" ? null : bid?.current_bid ?? null, // a bid placed; the opening bid is not one
          bid_count: phase === "upcoming" ? null : bid?.bid_count ?? null,
          currency: lot.currency ?? bid?.currency ?? null,
          sale_status: phase === "live" ? "auction_live" : phase === "closed" ? "ended" : "upcoming",
          no_reserve: lot.no_reserve,
          reserve_met: null,
          year: ident.year,
          make: ident.make,
          model: ident.model,
          thumbnail_url: lot.image ?? bid?.image ?? null,
          external_id: lot.external_id,
          raw_data: { source: "bonhams_typesense_lots", sale_id: sale.id, sale_title: sale.auctionTitle ?? null, sale_kind: kind,
                      status: lot.status, estimate_low: lot.estimate_low, estimate_high: lot.estimate_high,
                      ...(bid ? { bid_source: "bonhams_bidding_platform", bid_status: bid.status, bid_at: bid.bid_at, opening_bid: bid.opening_bid } : {}),
                      synced_at: new Date().toISOString() },
        });
      }
    }
    const live = auctions.filter((x) => x.sale_status === "auction_live");
    console.log(`[sync-live-auctions] Bonhams: ${sales.length} open motoring sales (${kinds.join(", ")}), ${auctions.length} lots, ${live.length} live (${live.filter((x) => x.current_bid).length} with a bid)`);
    return { auctions, error: null };
  } catch (e: unknown) {
    return { auctions: [], error: `Bonhams sync failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ============================================
// Broad Arrow Sync (timed online sales on its bidding site)
// ============================================

// Its in-room sales are bid only in the room; its timed online sales (car sales such as "Global Icons: Zoute Online",
// and memorabilia and art sales, whose lots are not vehicles) show each lot's top bid and its soft-close end. The sale
// list changes when a sale is scheduled, so an hour-old capture of it serves; each open sale's lot list is read fresh.
const BA_UA = "NukeListingCollector/1.0 (+https://nuke.ag)";

async function syncBroadArrow(): Promise<{ auctions: LiveAuction[]; error: string | null }> {
  try {
    const now = Date.now();
    // A direct fetch, not archiveFetch: the shared fetcher mistakes this page's own "log in" strings for a login wall
    // (AUTH_REQUIRED, 9 failed runs on 2026-10-20) and the page is public.
    const home = await fetch(`${BROAD_ARROW_BID}/`, { headers: { "User-Agent": BA_UA, Accept: "text/html" }, redirect: "manual", signal: AbortSignal.timeout(20_000) }); // guardrail-allow: raw-fetch (house public page)
    if (!home.ok) return { auctions: [], error: `Broad Arrow sale list: HTTP ${home.status}` };
    const html = await home.text();
    const all = amSales(html);
    if (all.length === 0) return { auctions: [], error: "Broad Arrow sale list: no sales parsed" };
    const sales = amOpenTimedSales(all, now);
    const auctions: LiveAuction[] = [];
    for (const sale of sales) {
      for (let o = 0, total = 1; o < total && o < 1000; o += 100) {
        const q = new URLSearchParams({ n: "100", o: String(o), order_by: "auction_date lot_number", order: "desc asc",
          fieldset: "timed-auction reserve-status summary", auctionId: sale.row_id, paramsType: "server" });
        const res = await fetch(`${BROAD_ARROW_BID}/ajax/lots/?${q}`, { headers: { "User-Agent": BA_UA, Accept: "application/json" } }); // guardrail-allow: raw-fetch (house JSON API)
        if (!res.ok) throw new Error(`lots of sale ${sale.row_id}: HTTP ${res.status}`);
        const page = await res.json();
        total = Number(page?.query_info?.total_num_results ?? 0);
        for (const doc of (page?.result_page ?? []) as AmLotDoc[]) {
          const lot = amTimedLot(doc, sale, now);
          if (!lot.open || !lot.vehicle) continue;
          const ident = parseBatIdentityFromTitle(lot.title, null);
          auctions.push({
            url: lot.url,
            title: lot.title,
            platform: "broad-arrow",
            auction_end_date: lot.ends ?? "",
            current_bid: lot.current_bid,
            bid_count: null, // the lot list states no bid count
            currency: lot.currency,
            no_reserve: false, // not stated on the lot list (reserve_met is kept)
            reserve_met: lot.reserve_met,
            year: ident.year,
            make: ident.make,
            model: ident.model,
            thumbnail_url: lot.image_url,
            external_id: lot.external_id,
            raw_data: { source: "broad_arrow_timed_lots", sale_id: sale.row_id, sale_title: sale.title ?? null, lot_number: lot.lot_number,
                        status: lot.status, bid_at: lot.bid_at, opening_bid: lot.opening_bid, estimate_low: lot.estimate_low,
                        estimate_high: lot.estimate_high, synced_at: new Date().toISOString() },
          });
        }
      }
    }
    console.log(`[sync-live-auctions] Broad Arrow: ${all.length} sales listed, ${sales.length} timed sales open, ${auctions.length} vehicle lots open`);
    return { auctions, error: null };
  } catch (e: unknown) {
    return { auctions: [], error: `Broad Arrow sync failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** The houses whose open board is read complete and scheduled by live_auction_board_sync (slug per platform). */
const BOARD_SOURCES: Record<string, string> = { "collecting-cars": "collecting-cars", pcarmarket: "pcarmarket", bonhams: "bonhams", "broad-arrow": "broad-arrow", gooding: "gooding" };

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
      // Only a time keyed to this lot's id is its close. A page-wide list of end times (removed) is not tied to any lot:
      // shifting from it handed one lot another's close, and with none left it invented now + 7 days (2026-10-22).
      const endDate = etMatch ? etMatch[1] : null;

      auctions.push({
        url,
        title,
        platform: "cars-and-bids",
        auction_end_date: endDate,
        end_date_missing_reason: endDate ? null : "C&B homepage gives no close time for this lot",
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
): Promise<{ new_count: number; updated_count: number; ended_count: number; write_errors: string[] }> {
  const stats = { new_count: 0, updated_count: 0, ended_count: 0, write_errors: [] as string[] };

  if (auctions.length === 0) {
    return stats;
  }

  // Fast upsert: INSERT all auctions with ON CONFLICT DO UPDATE on listing_url.
  // This eliminates the expensive URL lookup phase entirely — one DB call per batch.
  const now = new Date().toISOString();

  console.log(`[sync-live-auctions] ${platform}: Upserting ${auctions.length} auctions to vehicles table`);

  // No auction we sync runs longer than 14 days (BaT 7, Collecting Cars 7–14, Cars & Bids 7): a later end date
  // is a feed or parse fault, not a live lot, and must not become an auction_live placeholder nothing ever ends
  // (a Collecting Cars row read 2027-02-25 for six months, 2026-09-27). Such lots are skipped and named, not capped.
  const horizon = Date.now() + 14 * 86_400_000;
  // A lot whose source gives no close (auction_end_date null, with end_date_missing_reason) is written with a null
  // end and the reason, never a made-up one; the upsert keeps a close already on record (20261023101500).
  const impossible = auctions.filter(a => {
    if (a.auction_end_date === null) return false;
    const t = Date.parse(a.auction_end_date);
    return !Number.isFinite(t) || t > horizon;
  });
  if (impossible.length > 0) {
    console.warn(`[sync-live-auctions] ${platform}: ${impossible.length} lots skipped, auction_end_date unparseable or more than 14 days out: ${impossible.slice(0, 3).map(a => `${a.url} ${a.auction_end_date}`).join(", ")}`);
  }
  const writable = impossible.length > 0 ? auctions.filter(a => !impossible.includes(a)) : auctions;

  const upsertRows = writable.map(auction => ({
      listing_url: auction.url,
      title: auction.title,
      year: auction.year,
      make: auction.make,
      model: auction.model,
      auction_status: auction.sale_status === "ended" ? "ended" : "active",
      sale_status: auction.sale_status ?? "auction_live",
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
        currency: auction.currency ?? null,
        thumbnail_url: auction.thumbnail_url,
        last_sync: now,
        auction_end_date_missing_reason: auction.auction_end_date === null
          ? (auction.end_date_missing_reason ?? "source gives no close time")
          : null,
        ...auction.raw_data,
      },
      updated_at: now,
    }));

    // Upsert via RPC in chunks of 500. supabase-js .upsert({onConflict:'listing_url'})
    // CANNOT be used here: the unique index on vehicles.listing_url is PARTIAL
    // (WHERE deleted_at IS NULL AND listing_url<>''), which a bare ON CONFLICT
    // (listing_url) can't match — it silently errored and dropped every live auction.
    // upsert_live_auction_vehicles() runs the ON CONFLICT ... WHERE <predicate> that
    // matches the partial index, and marks new live auctions is_public for the floor.
    const UPSERT_BATCH = 100; // 500 hit the 60 s statement limit under the vehicles trigger chain (2026-09-27)
    for (let i = 0; i < upsertRows.length; i += UPSERT_BATCH) {
      const chunk = upsertRows.slice(i, i + UPSERT_BATCH);
      const { data, error } = await supabase.rpc("upsert_live_auction_vehicles", {
        p_rows: chunk,
      });
      if (!error) {
        stats.new_count += typeof data === "number" ? data : chunk.length;
      } else {
        console.error(`[sync-live-auctions] upsert_live_auction_vehicles failed: ${error.message}`);
        stats.write_errors.push(`upsert_live_auction_vehicles: ${error.message}`);
      }
    }

    // No mirror into vehicle_listings (removed 2026-09-27; homepage owner's decision, approved by Skylar):
    // vehicle_listings is Nuke's native-listing table — its readers (CreateAuctionListing, AuctionListing,
    // AuctionMarketplace, myAuctionsService, OrganizationProfile, LiveAuctionBanner) treat rows as Nuke's own
    // auctions, so mirrored BaT lots would read as Nuke auctions. The mirror had written nothing since 2026-07-12
    // (search_path failures, then 60 s timeouts) and cost ~2 min of DB time per run. Live BaT state lives on
    // vehicles (sale_status 'auction_live', high_bid), which market_pulse_live() and the vehicle page read.

  // vehicle_events rows for live lots were ensured inside upsert_live_auction_listings(), whose call is gone (see
  // above; it had failed since 2026-07-12, so nothing that worked changes). The old supabase-js upsert here used a bare
  // ON CONFLICT (vehicle_id,source_platform,source_url) which can NEVER match the
  // PARTIAL unique index idx_vehicle_events_dedup_url (WHERE source_url IS NOT NULL
  // AND source_listing_id IS NULL) — it errored on every run. Removed 2026-07-11.

  // A lot that left the live list is no longer live (2026-09-27). BaT's /auctions/ page and Collecting
  // Cars' feed are the complete live sets, so a row of this platform that is absent from them ends
  // here — sale_status/auction_status 'ended', no sale claim; settlement records the result. The RPC
  // ends nothing for a short (partial) list. Homepage-scraped platforms are not complete lists.
  if (platform === "bringatrailer" || platform === "collecting-cars" || platform === "pcarmarket") {
    const { data: ended, error: endErr } = await supabase.rpc("end_live_auctions_absent", {
      p_platform: platform,
      p_live_urls: auctions.map(a => a.url),
    });
    if (endErr) {
      console.error(`[sync-live-auctions] end_live_auctions_absent failed: ${endErr.message}`);
      stats.write_errors.push(`end_live_auctions_absent: ${endErr.message}`);
    }
    else {
      stats.ended_count = Number(ended) || 0;
      if (stats.ended_count > 0) console.log(`[sync-live-auctions] ${platform}: ${stats.ended_count} live rows ended (absent from the live list)`);
    }
  }

  return stats;
}

// Bid snapshots (retired 2026-09-29). recordBidSnapshots matched the live list against vehicle_events rows with
// event_status 'active', which live lots no longer get (upsert_live_auction_listings' call is gone, see above), so it
// wrote 0 rows on every run since 2026-07-22 (86 of 86 runs on 2026-09-29) while reading up to 10,000 stale rows per
// run. A lot's bid history comes from its comment thread: extract-bat-core writes every bid with its timestamp
// (bat-data coverage audit, docs/ledger/2026-09-30_bat-data-coverage-audit.md).

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
    "broad-arrow": "broadarrow",
  };

  const slug = slugMap[platform];
  if (!slug) return;

  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (success) {
    updateData.last_successful_at = new Date().toISOString();
  }

  mustWrite('source_registry update', await supabase
    .from("source_registry")
    .update(updateData)
    .eq("slug", slug));
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
  // Writes are never anonymous: service key, signed-in user, or nothing (P0.2, 2026-09-27).
  const denied = await requireWriteAuth(req);
  if (denied) return denied;
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    projectSecretKey() ?? "",
    { global: { headers: { "X-Nuke-Writer": "sync-live-auctions" } } },
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
        else if (/^https?:\/\/([a-z0-9-]+\.)*broadarrowauctions\.com\//i.test(url)) platform = "broad-arrow";
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
        "broad-arrow",
      ];
      const platforms: string[] = Array.isArray(body.platforms) && body.platforms.length
        ? body.platforms.map(String)
        : targetPlatform ? [targetPlatform] : allPlatforms;

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
        let syncResult: { auctions: LiveAuction[]; error: string | null; write_errors?: string[] };

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
            syncResult = await syncGooding(supabase, !skipVehicleSync);
            break;
          case "bonhams":
            syncResult = await syncBonhams();
            break;
          case "broad-arrow":
            syncResult = await syncBroadArrow();
            break;
          default:
            syncResult = { auctions: [], error: `Unknown platform: ${platform}` };
        }

        const normalizedPlatform = platformAliases[platform] || platform;

        // Refresh the live lots' event rows first (fast, read by predictions). Bid snapshots are retired (see above).
        const bidSnapshotCount = 0;
        if (normalizedPlatform === "bringatrailer" && !syncResult.error && syncResult.auctions.length > 0) {
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
            const serviceKey = projectSecretKey() ?? "";
            const endingSoon = syncResult.auctions.filter(a => {
              if (!a.auction_end_date) return false;
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
        let dbStats = { new_count: 0, updated_count: 0, ended_count: 0, write_errors: [] as string[] };
        if (!skipVehicleSync && !syncResult.error) {
          dbStats = await syncToDatabase(supabase, syncResult.auctions, normalizedPlatform);
        }
        if (normalizedPlatform === "gooding" && !skipVehicleSync && !syncResult.error) {
          dbStats.write_errors.push(...(syncResult.write_errors ?? []), ...await goodingFillDiscovery(supabase, syncResult.auctions));
        }

        // Board-synced houses: the same complete board goes to the monitored_auctions schedule writer; lots whose bid
        // count moved have their bids read with their own clocks where the house publishes them (PCarMarket).
        let board: Record<string, unknown> | null = null;
        const boardSlug = BOARD_SOURCES[normalizedPlatform];
        if (boardSlug) {
          const { data: bs, error: bsErr } = await supabase.rpc("live_auction_board_sync", syncResult.error
            ? { p_slug: boardSlug, p_lots: [], p_complete: false, p_error: syncResult.error }
            : {
              p_slug: boardSlug,
              p_lots: syncResult.auctions.map((a) => ({
                url: a.url, external_id: a.external_id, ends: a.auction_end_date || null,
                current_bid: a.current_bid, bid_count: a.bid_count, currency: a.currency ?? null,
              })),
              p_complete: true,
            });
          if (bsErr) dbStats.write_errors.push(`live_auction_board_sync: ${bsErr.message}`);
          board = (bs as Record<string, unknown>) ?? null;
          const moved = Array.isArray(board?.moved) ? board!.moved as { url: string; vehicle_id: string | null }[] : [];
          if (normalizedPlatform === "pcarmarket" && moved.length && Date.now() - functionStartTime < 30_000) {
            const bids = await ingestPcarBids(supabase, moved, 8);
            board = { ...board, moved: moved.length, bid_reads: bids };
            if (bids.errors.length) console.warn(`[sync-live-auctions] PCarMarket bid reads: ${bids.errors.slice(0, 3).join("; ")}`);
          } else if (board) {
            board = { ...board, moved: moved.length };
          }
        }

        // Update source registry
        await updateSourceRegistry(supabase, normalizedPlatform, !syncResult.error);

        results.push({
          board,
          platform: normalizedPlatform,
          success: !syncResult.error && dbStats.write_errors.length === 0,
          live_count: syncResult.auctions.length,
          write_errors: dbStats.write_errors,
          new_count: dbStats.new_count,
          updated_count: dbStats.updated_count,
          ended_count: dbStats.ended_count,
          bid_snapshots: bidSnapshotCount,
          error: syncResult.error,
          duration_ms: Date.now() - startTime,
        });
      }

      // Cleanup: mark expired auctions as ended (catches C&B 7-day defaults and any stale auctions). 'ended' says the
      // clock ran out; no reader observed a result here, so it is never written as 'not_sold'.
      try {
        const { count: endedCount } = await supabase
          .from("vehicles")
          .update({ auction_status: "ended", sale_status: "ended" })
          .eq("auction_status", "active")
          // BaT soft-close clocks require a native terminal record. eBay Motors lots are ended by their own reader
          // (extract-ebay-motors auctions) as 'ended': eBay's API cannot say sold or unsold, so 'not_sold' would be invented.
          .not("platform_source", "in", "(bringatrailer,ebay-motors)")
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
      const writeFailed = results.some(r => (r.write_errors?.length ?? 0) > 0);

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
      }, writeFailed ? 500 : 200);
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
