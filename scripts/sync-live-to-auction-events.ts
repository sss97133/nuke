#!/usr/bin/env npx tsx
/**
 * Sync Live Auctions to auction_events table
 *
 * Takes active vehicles and creates auction_events records with outcome='live'
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function syncBaTToAuctionEvents() {
  console.log("[BaT] Fetching active BaT vehicles...");

  // Fetch all BaT vehicles with pagination
  const allBatVehicles: any[] = [];
  let page = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from("vehicles")
      .select("id, listing_url, bat_auction_url, auction_end_date, sale_price, year, make, model")
      .eq("auction_status", "active")
      .eq("platform_source", "bringatrailer")
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) {
      console.error("[BaT] Error fetching vehicles:", error);
      break;
    }

    if (!data || data.length === 0) break;

    allBatVehicles.push(...data);
    page++;

    if (data.length < pageSize) break;
  }

  const batVehicles = allBatVehicles;

  console.log(`[BaT] Found ${batVehicles?.length || 0} active BaT vehicles`);

  let inserted = 0;
  const batchSize = 100;

  for (let i = 0; i < (batVehicles?.length || 0); i += batchSize) {
    const batch = batVehicles!.slice(i, i + batchSize);

    const records = batch.map(v => ({
      vehicle_id: v.id,
      source: "bringatrailer",
      source_url: v.listing_url || v.bat_auction_url,
      auction_end_date: v.auction_end_date,
      outcome: "live",
      high_bid: v.sale_price
    }));

    const { error: insertError } = await supabase
      .from("auction_events")
      .upsert(records, {
        onConflict: "vehicle_id,source_url",
        ignoreDuplicates: false
      });

    if (insertError) {
      console.error(`[BaT] Batch ${i} error:`, insertError.message);
    } else {
      inserted += batch.length;
    }
  }

  console.log(`[BaT] Inserted/updated ${inserted} auction_events`);
  return inserted;
}

async function syncCCToAuctionEvents() {
  console.log("[CC] Fetching active Collecting Cars vehicles...");

  const { data: ccVehicles, error } = await supabase
    .from("vehicles")
    .select("id, listing_url, auction_end_date, sale_price")
    .eq("auction_status", "active")
    .eq("platform_source", "collecting-cars");

  if (error) {
    console.error("[CC] Error fetching vehicles:", error);
    return 0;
  }

  console.log(`[CC] Found ${ccVehicles?.length || 0} active CC vehicles`);

  let inserted = 0;
  const batchSize = 100;

  for (let i = 0; i < (ccVehicles?.length || 0); i += batchSize) {
    const batch = ccVehicles!.slice(i, i + batchSize);

    const records = batch.map(v => ({
      vehicle_id: v.id,
      source: "collecting-cars",
      source_url: v.listing_url,
      auction_end_date: v.auction_end_date,
      outcome: "live",
      high_bid: v.sale_price
    }));

    const { error: insertError } = await supabase
      .from("auction_events")
      .upsert(records, {
        onConflict: "vehicle_id,source_url",
        ignoreDuplicates: false
      });

    if (insertError) {
      console.error(`[CC] Batch ${i} error:`, insertError.message);
    } else {
      inserted += batch.length;
    }
  }

  console.log(`[CC] Inserted/updated ${inserted} auction_events`);
  return inserted;
}

async function fetchAndInsertPCarMarket() {
  console.log("[PCM] Fetching PCarMarket live auctions...");

  // Scrape homepage for listings
  const response = await fetch("https://www.pcarmarket.com/", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
  });

  const html = await response.text();

  // Find auction URLs
  const urlMatches = html.match(/href="\/listing\/[^"]+/g) || [];
  const uniqueUrls = [...new Set(urlMatches.map(m => "https://www.pcarmarket.com" + m.replace('href="', '')))];

  console.log(`[PCM] Found ${uniqueUrls.length} unique listing URLs`);

  // For each URL, create vehicle and auction_event
  let inserted = 0;
  for (const url of uniqueUrls.slice(0, 50)) { // Limit to 50 for now
    // Parse year/make/model from URL
    // Format: /listing/YYYY-make-model-details
    const pathMatch = url.match(/\/listing\/(\d{4})-([^/]+)/);
    if (!pathMatch) continue;

    const year = parseInt(pathMatch[1]);
    const titleParts = pathMatch[2].split('-');
    const make = titleParts[0]?.charAt(0).toUpperCase() + titleParts[0]?.slice(1);
    const model = titleParts.slice(1, 4).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');

    // Insert vehicle
    const { data: vehicle, error: vehicleError } = await supabase
      .from("vehicles")
      .upsert({
        listing_url: url,
        year,
        make,
        model,
        title: `${year} ${make} ${model}`,
        platform_source: "pcarmarket",
        auction_status: "active"
      }, {
        onConflict: "listing_url"
      })
      .select("id")
      .single();

    if (vehicleError || !vehicle) continue;

    // Insert auction_event
    const { error: eventError } = await supabase
      .from("auction_events")
      .upsert({
        vehicle_id: vehicle.id,
        source: "pcarmarket",
        source_url: url,
        outcome: "live",
        auction_end_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      }, {
        onConflict: "vehicle_id,source_url",
        ignoreDuplicates: false
      });

    if (!eventError) inserted++;
  }

  console.log(`[PCM] Inserted ${inserted} PCarMarket auction_events`);
  return inserted;
}

async function fetchHagerty() {
  console.log("[Hagerty] Checking Hagerty Marketplace...");

  try {
    const response = await fetch("https://www.hagerty.com/marketplace/", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });

    const html = await response.text();

    // Find marketplace listing URLs
    const urlMatches = html.match(/href="\/marketplace\/\d+[^"]*"/g) || [];
    const uniqueUrls = [...new Set(urlMatches.map(m => "https://www.hagerty.com" + m.replace(/href="([^"]+)"/, '$1')))];

    console.log(`[Hagerty] Found ${uniqueUrls.length} marketplace listings`);
    return uniqueUrls.length;
  } catch (e) {
    console.error("[Hagerty] Error:", e);
    return 0;
  }
}

async function fetchCollectingCarsDirectly() {
  console.log("[CC-API] Fetching ALL Collecting Cars live auctions from Typesense...");

  const TYPESENSE_API_KEY = "pHuIUBo3XGxHk9Ll9g4q71qXbTYAM2w1";
  const TYPESENSE_ENDPOINT = "https://dora.production.collecting.com/multi_search";

  const allAuctions: any[] = [];
  let page = 1;
  const perPage = 250;

  while (page <= 10) { // Max 2500 auctions
    const response = await fetch(`${TYPESENSE_ENDPOINT}?x-typesense-api-key=${TYPESENSE_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        searches: [{
          collection: "production_cars",
          q: "*",
          filter_by: "listingStage:live",
          per_page: perPage,
          page: page,
          query_by: "title"
        }]
      })
    });

    const data = await response.json();
    const hits = data.results?.[0]?.hits || [];

    if (hits.length === 0) break;

    allAuctions.push(...hits.map((h: any) => h.document));
    console.log(`[CC-API] Page ${page}: got ${hits.length} auctions (total: ${allAuctions.length})`);

    if (hits.length < perPage) break;
    page++;
  }

  console.log(`[CC-API] Total: ${allAuctions.length} Collecting Cars live auctions`);

  // Insert vehicles and auction_events for each
  let inserted = 0;
  for (const a of allAuctions) {
    const url = `https://collectingcars.com/for-sale/${a.slug}`;
    const year = a.productYear ? parseInt(a.productYear) : (a.features?.modelYear ? parseInt(a.features.modelYear) : null);

    // Insert/update vehicle
    const { data: vehicle, error: vehicleError } = await supabase
      .from("vehicles")
      .upsert({
        listing_url: url,
        year,
        make: a.makeName || null,
        model: a.modelName || null,
        title: a.title,
        platform_source: "collecting-cars",
        auction_status: "active",
        auction_end_date: a.dtStageEndsUTC,
        sale_price: a.currentBid || null
      }, {
        onConflict: "listing_url"
      })
      .select("id")
      .single();

    if (vehicleError || !vehicle) continue;

    // Insert auction_event
    const { error: eventError } = await supabase
      .from("auction_events")
      .upsert({
        vehicle_id: vehicle.id,
        source: "collecting-cars",
        source_url: url,
        source_listing_id: String(a.auctionId),
        outcome: "live",
        auction_end_date: a.dtStageEndsUTC,
        high_bid: a.currentBid || null,
        total_bids: a.noBids || null
      }, {
        onConflict: "vehicle_id,source_url",
        ignoreDuplicates: false
      });

    if (!eventError) inserted++;
  }

  console.log(`[CC-API] Inserted/updated ${inserted} auction_events`);
  return inserted;
}

async function fetchBaTDirectly() {
  console.log("[BaT-API] Fetching ALL BaT live auctions from homepage...");

  const response = await fetch("https://bringatrailer.com/auctions/", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
  });

  const html = await response.text();

  // Extract the JSON data from the page
  const match = html.match(/var\s+auctionsCurrentInitialData\s*=\s*(\{[\s\S]*?\});/);
  if (!match) {
    console.error("[BaT-API] Could not find auctionsCurrentInitialData");
    return 0;
  }

  let data: { items: any[] };
  try {
    data = JSON.parse(match[1]);
  } catch (e) {
    console.error("[BaT-API] Failed to parse JSON:", e);
    return 0;
  }

  const items = data.items.filter((item: any) => item.active);
  console.log(`[BaT-API] Found ${items.length} active BaT auctions`);

  let inserted = 0;
  const batchSize = 50;

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);

    for (const item of batch) {
      const url = item.url.replace(/\/$/, "");
      const yearMatch = item.title.match(/^(\d{4})\s+/);
      const year = yearMatch ? parseInt(yearMatch[1]) : (item.year ? parseInt(item.year) : null);
      const titleWithoutYear = item.title.replace(/^\d{4}\s+/, "");
      const parts = titleWithoutYear.split(" ");

      // Insert/update vehicle
      const { data: vehicle, error: vehicleError } = await supabase
        .from("vehicles")
        .upsert({
          listing_url: url,
          year,
          make: parts[0] || null,
          model: parts.slice(1).join(" ") || null,
          title: item.title,
          platform_source: "bringatrailer",
          auction_status: "active",
          auction_end_date: new Date(item.timestamp_end * 1000).toISOString(),
          sale_price: item.current_bid || null
        }, {
          onConflict: "listing_url"
        })
        .select("id")
        .single();

      if (vehicleError || !vehicle) continue;

      // Insert auction_event
      const { error: eventError } = await supabase
        .from("auction_events")
        .upsert({
          vehicle_id: vehicle.id,
          source: "bringatrailer",
          source_url: url,
          source_listing_id: String(item.id),
          outcome: "live",
          auction_end_date: new Date(item.timestamp_end * 1000).toISOString(),
          high_bid: item.current_bid || null
        }, {
          onConflict: "vehicle_id,source_url",
          ignoreDuplicates: false
        });

      if (!eventError) inserted++;
    }

    console.log(`[BaT-API] Progress: ${Math.min(i + batchSize, items.length)}/${items.length}`);
  }

  console.log(`[BaT-API] Inserted/updated ${inserted} auction_events`);
  return inserted;
}

async function main() {
  console.log("=== Syncing Live Auctions to auction_events ===\n");

  // First sync from existing vehicles table
  const batDbCount = await syncBaTToAuctionEvents();
  const ccDbCount = await syncCCToAuctionEvents();

  // Then fetch fresh data from APIs directly
  const batApiCount = await fetchBaTDirectly();
  const ccApiCount = await fetchCollectingCarsDirectly();
  const pcmCount = await fetchAndInsertPCarMarket();
  await fetchHagerty();

  // Final count
  const { count } = await supabase
    .from("auction_events")
    .select("*", { count: "exact", head: true })
    .eq("outcome", "live");

  console.log(`\n=== FINAL COUNT: ${count} live auction_events ===`);
  console.log(`BaT (DB): ${batDbCount}, BaT (API): ${batApiCount}`);
  console.log(`CC (DB): ${ccDbCount}, CC (API): ${ccApiCount}`);
  console.log(`PCM: ${pcmCount}`);
}

main().catch(console.error);
