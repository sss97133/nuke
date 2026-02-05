#!/usr/bin/env npx tsx
/**
 * Facebook Marketplace Local Collector
 *
 * Runs locally (where bot UA works) and pushes data to Supabase.
 *
 * Usage:
 *   npx tsx scripts/fb-marketplace-collector.ts [--max-locations=50] [--state=TX]
 */

import { createClient } from "@supabase/supabase-js";

// Load env
const supabaseUrl = process.env.VITE_SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  console.error("Run with: dotenvx run -- npx tsx scripts/fb-marketplace-collector.ts");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const CONFIG = {
  BOT_USER_AGENT: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
  YEAR_MIN: 1960,
  YEAR_MAX: 1999,
  DELAY_MS: 60000, // 60 seconds between requests - spreads 582 locations over ~10 hours
};

interface Location {
  id: string;
  name: string;
  state_code: string;
  latitude: number;
  longitude: number;
}

interface Listing {
  id: string;
  title: string;
  price: number | null;
  year: number | null;
  make: string | null;
  model: string | null;
}

async function main() {
  const args = process.argv.slice(2);
  const maxLocations = parseInt(args.find(a => a.startsWith("--max-locations="))?.split("=")[1] || "50");
  const stateFilter = args.find(a => a.startsWith("--state="))?.split("=")[1];

  console.log("🚀 Facebook Marketplace Local Collector");
  console.log("========================================");
  console.log(`Max locations: ${maxLocations}`);
  console.log(`State filter: ${stateFilter || "ALL"}`);
  console.log(`Year range: ${CONFIG.YEAR_MIN}-${CONFIG.YEAR_MAX}`);
  console.log();

  // Fetch locations to process
  let query = supabase
    .from("fb_marketplace_locations")
    .select("id, name, state_code, latitude, longitude")
    .eq("is_active", true)
    .order("last_sweep_at", { ascending: true, nullsFirst: true })
    .limit(maxLocations);

  if (stateFilter) {
    query = query.eq("state_code", stateFilter.toUpperCase());
  }

  const { data: locations, error } = await query;

  if (error) {
    console.error("Failed to fetch locations:", error.message);
    process.exit(1);
  }

  if (!locations?.length) {
    console.log("No locations to process");
    process.exit(0);
  }

  console.log(`📍 Processing ${locations.length} locations\n`);

  let totalListings = 0;
  let totalNew = 0;
  let totalUpdates = 0;
  let totalErrors = 0;

  for (let i = 0; i < locations.length; i++) {
    const location = locations[i];
    const progress = `[${i + 1}/${locations.length}]`;

    try {
      process.stdout.write(`${progress} ${location.name}, ${location.state_code}... `);

      const result = await scrapeLocation(location.name);

      totalListings += result.listings_found;
      totalNew += result.new_count;
      totalUpdates += result.update_count;

      console.log(`✓ ${result.listings_found} listings (${result.new_count} new, ${result.update_count} updated)`);

      // Update location record
      await supabase
        .from("fb_marketplace_locations")
        .update({
          last_sweep_at: new Date().toISOString(),
          last_sweep_listings: result.listings_found,
        })
        .eq("id", location.id);

      // Rate limit
      if (i < locations.length - 1) {
        await sleep(CONFIG.DELAY_MS);
      }
    } catch (err: any) {
      console.log(`✗ Error: ${err.message}`);
      totalErrors++;
    }
  }

  console.log("\n========================================");
  console.log("📊 Collection Summary");
  console.log("========================================");
  console.log(`Locations processed: ${locations.length - totalErrors}/${locations.length}`);
  console.log(`Total listings found: ${totalListings}`);
  console.log(`New listings: ${totalNew}`);
  console.log(`Updated listings: ${totalUpdates}`);
  console.log(`Errors: ${totalErrors}`);
}

async function scrapeLocation(locationName: string): Promise<{
  listings_found: number;
  new_count: number;
  update_count: number;
}> {
  // Build URL
  const locationSlug = locationName
    .split(",")[0]
    .toLowerCase()
    .replace(/\s+/g, "");
  const url = `https://www.facebook.com/marketplace/${locationSlug}/vehicles?minYear=${CONFIG.YEAR_MIN}&maxYear=${CONFIG.YEAR_MAX}&sortBy=creation_time_descend`;

  // Fetch with bot UA
  const response = await fetch(url, {
    headers: {
      "User-Agent": CONFIG.BOT_USER_AGENT,
      Accept: "text/html",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const html = await response.text();

  // Check if we got a login page
  if (!html.includes("marketplace_listing_title") && html.includes("login")) {
    throw new Error("Got login page - bot access blocked");
  }

  // Extract listings
  const titleMatches = html.match(/"marketplace_listing_title":"([^"]+)"/g) || [];
  const priceMatches = html.match(/"amount_with_offset_in_currency":"(\d+)"/g) || [];
  const idMatches = html.match(/"id":"(\d{10,})"/g) || [];

  const listings: Listing[] = [];

  for (let i = 0; i < titleMatches.length; i++) {
    const titleMatch = titleMatches[i].match(/"marketplace_listing_title":"([^"]+)"/);
    const priceMatch = priceMatches[i]?.match(/"amount_with_offset_in_currency":"(\d+)"/);
    const idMatch = idMatches[i]?.match(/"id":"(\d+)"/);

    if (titleMatch && idMatch) {
      const title = decodeUnicode(titleMatch[1]);
      const price = priceMatch ? parseInt(priceMatch[1]) / 100 : null;
      const parsed = parseVehicleTitle(title);

      listings.push({
        id: idMatch[1],
        title,
        price,
        year: parsed.year,
        make: parsed.make,
        model: parsed.model,
      });
    }
  }

  // Filter to vintage
  const vintage = listings.filter(
    (l) => l.year && l.year >= CONFIG.YEAR_MIN && l.year <= CONFIG.YEAR_MAX
  );

  // Upsert to database
  let newCount = 0;
  let updateCount = 0;

  for (const listing of vintage) {
    const { data: existing } = await supabase
      .from("marketplace_listings")
      .select("id, current_price")
      .eq("facebook_id", listing.id)
      .single();

    if (!existing) {
      // Insert new
      await supabase.from("marketplace_listings").insert({
        facebook_id: listing.id,
        platform: "facebook_marketplace",
        url: `https://www.facebook.com/marketplace/item/${listing.id}`,
        title: listing.title,
        price: listing.price,
        current_price: listing.price,
        extracted_year: listing.year,
        parsed_year: listing.year,
        parsed_make: listing.make?.toLowerCase(),
        parsed_model: listing.model?.toLowerCase(),
        status: "active",
        first_seen_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      });
      newCount++;
    } else {
      // Update
      const updates: Record<string, any> = {
        last_seen_at: new Date().toISOString(),
        status: "active"
      };
      if (listing.price && existing.current_price !== listing.price) {
        updates.current_price = listing.price;
        updates.price = listing.price;
        updateCount++;
      }
      await supabase.from("marketplace_listings").update(updates).eq("id", existing.id);
    }
  }

  return {
    listings_found: vintage.length,
    new_count: newCount,
    update_count: updateCount,
  };
}

function parseVehicleTitle(title: string): { year: number | null; make: string | null; model: string | null } {
  const yearMatch = title.match(/^(\d{4})\s+/);
  if (!yearMatch) return { year: null, make: null, model: null };

  const year = parseInt(yearMatch[1]);
  const rest = title.substring(5).trim();
  const words = rest.split(/\s+/);

  return {
    year,
    make: words[0] || null,
    model: words.slice(1, 3).join(" ") || null,
  };
}

function decodeUnicode(str: string): string {
  return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch(console.error);
