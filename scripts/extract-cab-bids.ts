/**
 * extract-cab-bids.ts
 *
 * Local script to extract bid history from Cars & Bids auction pages.
 * Uses Firecrawl API to bypass Cloudflare, then parses bid entries.
 *
 * Usage:
 *   dotenvx run -- npx tsx scripts/extract-cab-bids.ts [url]
 *   dotenvx run -- npx tsx scripts/extract-cab-bids.ts --scan --limit 10
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const firecrawlKey = process.env.FIRECRAWL_API_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

interface ExtractedBid {
  bidder_username: string;
  bid_amount: number;
  bid_number: number;
  profile_url: string | null;
}

/**
 * Parse bids from C&B markdown.
 * Pattern: [username](url) lines followed by Bid$AMOUNT lines.
 */
function parseBidsFromMarkdown(markdown: string): ExtractedBid[] {
  const bids: ExtractedBid[] = [];
  const lines = markdown.split("\n");

  let lastUsername = "";
  let lastProfileUrl: string | null = null;

  for (const line of lines) {
    // Match username links
    const userMatch = line.match(
      /\[([^\]]+)\]\((https:\/\/carsandbids\.com\/user\/[^)]+)\)/,
    );
    if (userMatch) {
      lastUsername = userMatch[1].replace(/\\_/g, "_");
      lastProfileUrl = userMatch[2];
    }

    // Match bid amounts
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

async function scrapeWithFirecrawl(
  url: string,
): Promise<{ html: string; markdown: string }> {
  const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${firecrawlKey}`,
    },
    body: JSON.stringify({
      url,
      formats: ["html", "markdown"],
      waitFor: 3000,
      actions: [
        { type: "wait", milliseconds: 2000 },
        // Click the "Bid History" tab to switch from comments view to bid list
        // C&B uses data-filter="4" data-ga="bids" for the bid history button
        { type: "click", selector: 'button[data-ga="bids"]' },
        { type: "wait", milliseconds: 2000 },
        // Scroll down to load all bids
        { type: "scroll", direction: "down", amount: 5000 },
        { type: "wait", milliseconds: 1500 },
      ],
    }),
  });

  const data = await resp.json();
  if (!data.success) {
    throw new Error(data.error || `Firecrawl failed: ${resp.status}`);
  }

  return {
    html: data.data?.html || "",
    markdown: data.data?.markdown || "",
  };
}

async function extractBidsForUrl(url: string): Promise<{
  success: boolean;
  bids: number;
  error?: string;
  vehicle_id?: string;
}> {
  console.log(`\n--- Extracting bids from: ${url}`);

  // Resolve vehicle_id
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
    const { data: el } = await supabase
      .from("vehicle_events")
      .select("vehicle_id")
      .eq("source_platform", "carsandbids")
      .eq("source_url", url)
      .limit(1)
      .maybeSingle();
    if (el?.vehicle_id) vehicleId = el.vehicle_id;
  }

  if (!vehicleId) {
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
    console.log(`  No vehicle found, skipping`);
    return { success: false, bids: 0, error: `No vehicle for ${url}` };
  }

  // Check existing bids
  const { count: existingBids } = await supabase
    .from("external_auction_bids")
    .select("id", { count: "exact", head: true })
    .eq("vehicle_id", vehicleId)
    .eq("platform", "cars_and_bids")
    .eq("source", "extract-cab-bids");

  if (existingBids && existingBids > 2) {
    console.log(`  Already have ${existingBids} bids, skipping`);
    return { success: true, bids: existingBids, vehicle_id: vehicleId };
  }

  // Scrape
  let markdown = "";
  try {
    const result = await scrapeWithFirecrawl(url);
    markdown = result.markdown;
    console.log(
      `  Firecrawl: ${result.html.length} HTML, ${markdown.length} markdown`,
    );
  } catch (e: any) {
    console.error(`  Firecrawl error: ${e.message}`);
    return {
      success: false,
      bids: 0,
      error: e.message,
      vehicle_id: vehicleId,
    };
  }

  // Parse bids from markdown (more reliable than HTML for C&B)
  const bids = parseBidsFromMarkdown(markdown);
  console.log(`  Found ${bids.length} bids`);

  if (bids.length === 0) {
    return { success: true, bids: 0, vehicle_id: vehicleId };
  }

  // Get auction end date for synthetic timestamps
  let auctionEndDate = new Date();
  if (auctionEventId) {
    const { data: aeData } = await supabase
      .from("auction_events")
      .select("end_date")
      .eq("id", auctionEventId)
      .maybeSingle();
    if (aeData?.end_date) {
      auctionEndDate = new Date(aeData.end_date);
    }
  }

  // C&B doesn't show individual bid timestamps, so we create synthetic ones.
  // Assume 7-day auction with bids spread across the last 48 hours before end.
  const auctionEndMs = auctionEndDate.getTime();
  const bidWindowMs = 48 * 60 * 60 * 1000; // 48 hours
  const interval = bidWindowMs / (bids.length + 1);

  // Delete existing and insert new
  await supabase
    .from("external_auction_bids")
    .delete()
    .eq("vehicle_id", vehicleId)
    .eq("platform", "cars_and_bids");

  const rows = bids.map((b) => ({
    vehicle_id: vehicleId,
    platform: "cars_and_bids",
    bid_amount: b.bid_amount,
    bid_timestamp: new Date(
      auctionEndMs - bidWindowMs + b.bid_number * interval,
    ).toISOString(),
    bidder_username: b.bidder_username,
    bid_number: b.bid_number,
    is_winning_bid: b.bid_number === bids.length,
    source: "extract-cab-bids",
    raw_data: { profile_url: b.profile_url, auction_url: url },
  }));

  const { error: insertErr } = await supabase
    .from("external_auction_bids")
    .insert(rows);

  if (insertErr) {
    console.error(`  Insert error: ${insertErr.message}`);
    return {
      success: false,
      bids: 0,
      error: insertErr.message,
      vehicle_id: vehicleId,
    };
  }

  // Update auction_event bid_history
  if (auctionEventId) {
    await supabase
      .from("auction_events")
      .update({
        bid_history: bids.map((b) => ({
          amount: b.bid_amount,
          bidder: b.bidder_username,
          bid_number: b.bid_number,
        })),
      })
      .eq("id", auctionEventId);
  }

  console.log(
    `  Inserted ${bids.length} bids: $${bids[0].bid_amount} → $${bids[bids.length - 1].bid_amount}`,
  );
  return { success: true, bids: bids.length, vehicle_id: vehicleId };
}

async function scanMode(limit: number) {
  console.log(`Scanning for C&B auctions without bid history (limit: ${limit})...`);

  // Get C&B auction_events with source_url and vehicle_id but no/empty bid_history
  const { data: candidates, error } = await supabase
    .from("auction_events")
    .select("id, source_url, vehicle_id")
    .eq("source", "cars_and_bids")
    .not("source_url", "is", null)
    .not("vehicle_id", "is", null)
    .or("bid_history.is.null")
    .limit(limit);

  if (error) {
    console.error("Query error:", error.message);
    return;
  }

  console.log(`Found ${candidates?.length || 0} candidates`);

  let extracted = 0;
  let totalBids = 0;

  for (const c of candidates || []) {
    if (!c.source_url) continue;
    const result = await extractBidsForUrl(c.source_url);
    if (result.success && result.bids > 0) {
      extracted++;
      totalBids += result.bids;
    }
    // Rate limit: 1.5 seconds between requests
    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log(
    `\nDone: ${extracted} auctions extracted, ${totalBids} total bids`,
  );
}

async function fileMode(filePath: string) {
  const fs = await import("fs");
  const urls = fs
    .readFileSync(filePath, "utf-8")
    .split("\n")
    .map((l: string) => l.trim())
    .filter((l: string) => l.includes("carsandbids.com"));

  console.log(`Processing ${urls.length} URLs from ${filePath}`);

  let extracted = 0;
  let totalBids = 0;
  let failed = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log(`\n[${i + 1}/${urls.length}]`);
    try {
      const result = await extractBidsForUrl(url);
      if (result.success && result.bids > 0) {
        extracted++;
        totalBids += result.bids;
      } else if (!result.success) {
        failed++;
      }
    } catch (e: any) {
      console.error(`  Fatal error: ${e.message}`);
      failed++;
    }
    // Rate limit: 1.5 seconds between requests
    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log(
    `\nDone: ${extracted} extracted, ${totalBids} bids, ${failed} failed out of ${urls.length}`,
  );
}

// CLI
const args = process.argv.slice(2);
if (args.includes("--scan")) {
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 5;
  scanMode(limit).catch(console.error);
} else if (args.includes("--file")) {
  const fileIdx = args.indexOf("--file");
  const filePath = args[fileIdx + 1];
  if (!filePath) {
    console.log("Usage: --file <path-to-urls.txt>");
    process.exit(1);
  }
  fileMode(filePath).catch(console.error);
} else if (args[0] && args[0].includes("carsandbids.com")) {
  extractBidsForUrl(args[0]).then((r) => {
    console.log("\nResult:", JSON.stringify(r, null, 2));
  });
} else {
  console.log(
    "Usage:\n  dotenvx run -- npx tsx scripts/extract-cab-bids.ts <URL>\n  dotenvx run -- npx tsx scripts/extract-cab-bids.ts --scan --limit 10\n  dotenvx run -- npx tsx scripts/extract-cab-bids.ts --file urls.txt",
  );
}
