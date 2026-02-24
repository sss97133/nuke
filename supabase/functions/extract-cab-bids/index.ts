/**
 * extract-cab-bids
 *
 * Extracts individual bid entries from Cars & Bids auction pages.
 * Uses Firecrawl to bypass Cloudflare, then parses bid history from HTML.
 *
 * Modes:
 *   single  — extract bids from one URL
 *   batch   — extract bids from up to 5 URLs (sequential)
 *   scan    — find C&B auction_events with bidders but no bid_history, scrape them
 *
 * Bid structure on C&B pages:
 *   <li class="bid"> contains:
 *     - <a class="user" href="/user/USERNAME">USERNAME</a>
 *     - <dd class="bid-value">$AMOUNT</dd>
 *   Bids are listed highest (most recent) to lowest (first).
 *
 * Output: inserts to external_auction_bids table
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";
import { firecrawlScrape } from "../_shared/firecrawl.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ExtractedBid {
  bidder_username: string;
  bid_amount: number;
  bid_number: number; // sequence (1 = first/lowest, N = highest/last)
  profile_url: string | null;
}

/**
 * Parse bid entries from C&B HTML.
 * Returns bids in chronological order (first bid = index 0).
 */
function parseBidsFromHtml(html: string): ExtractedBid[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) return [];

  const bids: ExtractedBid[] = [];
  const bidElements = doc.querySelectorAll("li.bid");

  for (const el of bidElements) {
    const userLink = el.querySelector("a.user");
    const bidValueEl = el.querySelector("dd.bid-value");

    if (!userLink || !bidValueEl) continue;

    const username = userLink.textContent?.trim() || "";
    const bidText = bidValueEl.textContent?.trim() || "";
    const amountMatch = bidText.match(/\$?([\d,]+)/);
    if (!username || !amountMatch) continue;

    const amount = parseInt(amountMatch[1].replace(/,/g, ""), 10);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const href = userLink.getAttribute("href") || "";
    const profileUrl = href.startsWith("http")
      ? href
      : href
        ? `https://carsandbids.com${href}`
        : null;

    bids.push({
      bidder_username: username,
      bid_amount: amount,
      bid_number: 0, // will be set after reversing
      profile_url: profileUrl,
    });
  }

  // C&B shows highest bid first — reverse to chronological order
  bids.reverse();
  bids.forEach((b, i) => {
    b.bid_number = i + 1;
  });

  return bids;
}

/**
 * Fallback: parse bids from markdown when HTML DOM parsing fails.
 * Pattern: lines like "Bid$46,300" preceded by "[username](url)" lines.
 */
function parseBidsFromMarkdown(markdown: string): ExtractedBid[] {
  const bids: ExtractedBid[] = [];
  const lines = markdown.split("\n");

  let lastUsername = "";
  let lastProfileUrl: string | null = null;

  for (const line of lines) {
    // Match username links: [username](https://carsandbids.com/user/username)
    const userMatch = line.match(
      /\[([^\]]+)\]\((https:\/\/carsandbids\.com\/user\/[^)]+)\)/,
    );
    if (userMatch) {
      lastUsername = userMatch[1].replace(/\\_/g, "_"); // unescape markdown
      lastProfileUrl = userMatch[2];
    }

    // Match bid amounts: Bid$46,300
    const bidMatch = line.match(/Bid\$?([\d,]+)/);
    if (bidMatch && lastUsername) {
      const amount = parseInt(bidMatch[1].replace(/,/g, ""), 10);
      if (Number.isFinite(amount) && amount > 0) {
        bids.push({
          bidder_username: lastUsername,
          bid_amount: amount,
          bid_number: 0,
          profile_url: lastProfileUrl,
        });
      }
    }
  }

  // C&B shows highest first — reverse to chronological
  bids.reverse();
  bids.forEach((b, i) => {
    b.bid_number = i + 1;
  });

  return bids;
}

async function extractBidsForUrl(
  supabase: any,
  firecrawlApiKey: string,
  url: string,
): Promise<{
  success: boolean;
  bids: number;
  error?: string;
  vehicle_id?: string;
}> {
  console.log(`\n--- Extracting bids from: ${url}`);

  // Resolve vehicle_id from auction_events or vehicles
  let vehicleId: string | null = null;
  let auctionEventId: string | null = null;

  const { data: ae } = await supabase
    .from("auction_events")
    .select("id, vehicle_id")
    .eq("source", "cars_and_bids")
    .eq("source_url", url)
    .limit(1)
    .maybeSingle();

  if (ae) {
    auctionEventId = ae.id;
    vehicleId = ae.vehicle_id;
  }

  if (!vehicleId) {
    // Try external_listings
    const { data: el } = await supabase
      .from("external_listings")
      .select("vehicle_id")
      .eq("platform", "carsandbids")
      .eq("listing_url", url)
      .limit(1)
      .maybeSingle();
    if (el?.vehicle_id) vehicleId = el.vehicle_id;
  }

  if (!vehicleId) {
    // Try vehicles.discovery_url
    const urlPath = url.replace(/^https?:\/\/[^/]+/, "");
    const { data: v } = await supabase
      .from("vehicles")
      .select("id")
      .ilike("discovery_url", `%${urlPath}%`)
      .limit(1)
      .maybeSingle();
    if (v?.id) vehicleId = v.id;
  }

  if (!vehicleId) {
    return { success: false, bids: 0, error: `No vehicle found for ${url}` };
  }

  // Check if we already have bids for this vehicle from C&B
  const { count: existingBids } = await supabase
    .from("external_auction_bids")
    .select("id", { count: "exact", head: true })
    .eq("vehicle_id", vehicleId)
    .eq("platform", "cars_and_bids");

  if (existingBids && existingBids > 2) {
    console.log(`  Already have ${existingBids} bids, skipping`);
    return { success: true, bids: existingBids, vehicle_id: vehicleId };
  }

  // Scrape with Firecrawl
  let html = "";
  let markdown = "";
  try {
    const result = await firecrawlScrape(
      {
        url,
        formats: ["html", "markdown"],
        onlyMainContent: false,
        waitFor: 3000,
        actions: [
          // Click "Bid History" tab to load bid list
          {
            type: "click",
            selector: '[data-filter="bids"], button:has-text("Bid History")',
          },
          { type: "wait", milliseconds: 2000 },
          // Scroll to load all bids
          { type: "scroll", direction: "down", pixels: 5000 },
          { type: "wait", milliseconds: 1500 },
        ],
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      },
      {
        apiKey: firecrawlApiKey,
        timeoutMs: 45000,
        maxAttempts: 1,
      },
    );

    html = result.data?.html || "";
    markdown = result.data?.markdown || "";
  } catch (e: any) {
    return {
      success: false,
      bids: 0,
      error: `Firecrawl failed: ${e.message}`,
      vehicle_id: vehicleId,
    };
  }

  if (!html || html.length < 1000) {
    return {
      success: false,
      bids: 0,
      error: `Insufficient HTML (${html.length} chars)`,
      vehicle_id: vehicleId,
    };
  }

  // Parse bids from HTML first, fallback to markdown
  let bids = parseBidsFromHtml(html);
  if (bids.length === 0 && markdown) {
    console.log("  HTML parsing found 0 bids, trying markdown...");
    bids = parseBidsFromMarkdown(markdown);
  }

  console.log(`  Found ${bids.length} bids for vehicle ${vehicleId}`);

  if (bids.length === 0) {
    return {
      success: true,
      bids: 0,
      vehicle_id: vehicleId,
    };
  }

  // Insert bids into external_auction_bids
  const rows = bids.map((b) => ({
    vehicle_id: vehicleId,
    external_listing_id: null,
    platform: "cars_and_bids",
    bid_amount: b.bid_amount,
    bid_timestamp: null, // C&B doesn't show individual bid timestamps
    bidder_username: b.bidder_username,
    bid_number: b.bid_number,
    is_winning_bid: b.bid_number === bids.length, // last bid = winning
    source: "extract-cab-bids",
    raw_data: {
      profile_url: b.profile_url,
      auction_url: url,
    },
  }));

  // Delete existing bids for this vehicle+platform first (idempotent)
  await supabase
    .from("external_auction_bids")
    .delete()
    .eq("vehicle_id", vehicleId)
    .eq("platform", "cars_and_bids");

  const { error: insertErr } = await supabase
    .from("external_auction_bids")
    .insert(rows);

  if (insertErr) {
    return {
      success: false,
      bids: 0,
      error: `Insert failed: ${insertErr.message}`,
      vehicle_id: vehicleId,
    };
  }

  // Update auction_event with bid_history
  if (auctionEventId) {
    const bidHistory = bids.map((b) => ({
      amount: b.bid_amount,
      bidder: b.bidder_username,
      bid_number: b.bid_number,
    }));

    await supabase
      .from("auction_events")
      .update({
        bid_history: bidHistory,
        raw_data: supabase.rpc ? undefined : undefined, // don't overwrite raw_data
      })
      .eq("id", auctionEventId);
  }

  console.log(
    `  Inserted ${bids.length} bids (${bids[0].bid_amount} → ${bids[bids.length - 1].bid_amount})`,
  );
  return { success: true, bids: bids.length, vehicle_id: vehicleId };
}

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").trim();
    const serviceRoleKey = (
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    ).trim();
    const firecrawlApiKey = (
      Deno.env.get("FIRECRAWL_API_KEY") ?? ""
    ).trim();

    if (!supabaseUrl || !serviceRoleKey || !firecrawlApiKey) {
      throw new Error("Missing required env vars");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const body = await req.json().catch(() => ({}));
    const mode = body.mode || "single";

    if (mode === "single") {
      const url = String(body.url || "").trim();
      if (!url || !url.includes("carsandbids.com")) {
        throw new Error("Invalid C&B URL");
      }
      const result = await extractBidsForUrl(supabase, firecrawlApiKey, url);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (mode === "batch") {
      const urls: string[] = body.urls || [];
      if (!Array.isArray(urls) || urls.length === 0) {
        throw new Error("Missing urls array");
      }
      const results = [];
      for (const url of urls.slice(0, 5)) {
        results.push(await extractBidsForUrl(supabase, firecrawlApiKey, url));
      }
      return new Response(
        JSON.stringify({ results, total: results.length }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (mode === "scan") {
      // Find C&B auction_events that have bidders in raw_data but no bid_history
      const limit = body.limit || 5;
      const { data: candidates } = await supabase
        .from("auction_events")
        .select("id, source_url, vehicle_id")
        .eq("source", "cars_and_bids")
        .not("source_url", "is", null)
        .or("bid_history.is.null,bid_history.eq.[]")
        .not("vehicle_id", "is", null)
        .limit(limit);

      if (!candidates || candidates.length === 0) {
        return new Response(
          JSON.stringify({ message: "No candidates found", results: [] }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const results = [];
      for (const c of candidates) {
        if (c.source_url) {
          results.push(
            await extractBidsForUrl(supabase, firecrawlApiKey, c.source_url),
          );
        }
      }

      return new Response(
        JSON.stringify({
          candidates: candidates.length,
          results,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    throw new Error(`Unknown mode: ${mode}`);
  } catch (error: any) {
    console.error("extract-cab-bids error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
