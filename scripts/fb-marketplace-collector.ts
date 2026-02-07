#!/usr/bin/env npx tsx
/**
 * Facebook Marketplace Local Collector
 *
 * Two-phase collection:
 * 1. Bot UA scrapes search results (finds listing IDs locally - works from residential IPs)
 * 2. Calls extract-facebook-marketplace edge function (uses Firecrawl) for full details
 *
 * Usage:
 *   npx tsx scripts/fb-marketplace-collector.ts [--max-locations=50] [--state=TX] [--skip-details]
 *
 * Options:
 *   --skip-details  Skip Firecrawl detail extraction (just find IDs)
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
  DELAY_BETWEEN_LOCATIONS_MS: 30000, // 30 seconds between location searches
  DELAY_BETWEEN_DETAILS_MS: 3000, // 3 seconds between Firecrawl calls
  MAX_DETAILS_PER_LOCATION: 5, // Limit Firecrawl calls per location
};

interface Location {
  id: string;
  name: string;
  state_code: string;
}

interface FoundListing {
  facebook_id: string;
  title: string;
  price: number | null;
  year: number | null;
  make: string | null;
  model: string | null;
  url: string;
}

async function main() {
  const args = process.argv.slice(2);
  const maxLocations = parseInt(args.find(a => a.startsWith("--max-locations="))?.split("=")[1] || "50");
  const stateFilter = args.find(a => a.startsWith("--state="))?.split("=")[1];
  const skipDetails = args.includes("--skip-details");

  console.log("🚀 Facebook Marketplace Collector (Full Pipeline)");
  console.log("==================================================");
  console.log(`Max locations: ${maxLocations}`);
  console.log(`State filter: ${stateFilter || "ALL"}`);
  console.log(`Year range: ${CONFIG.YEAR_MIN}-${CONFIG.YEAR_MAX}`);
  console.log(`Detail extraction: ${skipDetails ? "DISABLED" : "ENABLED (Firecrawl)"}`);
  console.log();

  // Fetch locations
  let query = supabase
    .from("fb_marketplace_locations")
    .select("id, name, state_code")
    .eq("is_active", true)
    .order("last_sweep_at", { ascending: true, nullsFirst: true })
    .limit(maxLocations);

  if (stateFilter) {
    query = query.eq("state_code", stateFilter.toUpperCase());
  }

  const { data: locations, error } = await query;
  if (error || !locations?.length) {
    console.error("Failed to fetch locations:", error?.message || "none found");
    process.exit(1);
  }

  console.log(`📍 Processing ${locations.length} locations\n`);

  let stats = {
    locations_processed: 0,
    listings_found: 0,
    new_listings: 0,
    details_extracted: 0,
    errors: 0,
  };

  for (let i = 0; i < locations.length; i++) {
    const location = locations[i];
    const progress = `[${i + 1}/${locations.length}]`;

    try {
      console.log(`\n${progress} 📍 ${location.name}, ${location.state_code}`);

      // Phase 1: Find listings via bot scraper
      const found = await findListingsInLocation(location.name);
      console.log(`   Found ${found.length} vintage listings in search`);
      stats.listings_found += found.length;

      // Check which are new
      const newListings: FoundListing[] = [];
      for (const listing of found) {
        const { data: existing } = await supabase
          .from("marketplace_listings")
          .select("id")
          .eq("facebook_id", listing.facebook_id)
          .single();

        if (!existing) {
          newListings.push(listing);
        }
      }

      if (newListings.length === 0) {
        console.log(`   No new listings (all ${found.length} already tracked)`);
      } else {
        console.log(`   🆕 ${newListings.length} NEW listings to extract`);
        stats.new_listings += newListings.length;

        // Phase 2: Get full details via Firecrawl
        if (!skipDetails) {
          const toExtract = newListings.slice(0, CONFIG.MAX_DETAILS_PER_LOCATION);
          for (let j = 0; j < toExtract.length; j++) {
            const listing = toExtract[j];
            try {
              process.stdout.write(`   [${j + 1}/${toExtract.length}] Extracting ${listing.facebook_id}... `);

              const result = await extractFullDetails(listing.url);
              if (result.success) {
                console.log(`✓ ${result.year} ${result.make} ${result.model}`);
                stats.details_extracted++;
              } else {
                console.log(`✗ ${result.error}`);
              }

              if (j < toExtract.length - 1) {
                await sleep(CONFIG.DELAY_BETWEEN_DETAILS_MS);
              }
            } catch (err: any) {
              console.log(`✗ Error: ${err.message}`);
              stats.errors++;
            }
          }

          if (newListings.length > CONFIG.MAX_DETAILS_PER_LOCATION) {
            console.log(`   ⏭️  Skipped ${newListings.length - CONFIG.MAX_DETAILS_PER_LOCATION} (limit per location)`);
          }
        } else {
          // Just store basic info without Firecrawl
          for (const listing of newListings) {
            await storeBasicListing(listing);
          }
        }
      }

      // Update location sweep time
      await supabase
        .from("fb_marketplace_locations")
        .update({
          last_sweep_at: new Date().toISOString(),
          last_sweep_listings: found.length,
        })
        .eq("id", location.id);

      stats.locations_processed++;

      // Rate limit between locations
      if (i < locations.length - 1) {
        console.log(`   ⏳ Waiting ${CONFIG.DELAY_BETWEEN_LOCATIONS_MS / 1000}s...`);
        await sleep(CONFIG.DELAY_BETWEEN_LOCATIONS_MS);
      }
    } catch (err: any) {
      console.log(`   ✗ Location error: ${err.message}`);
      stats.errors++;
    }
  }

  console.log("\n==================================================");
  console.log("📊 Collection Complete");
  console.log("==================================================");
  console.log(`Locations processed: ${stats.locations_processed}/${locations.length}`);
  console.log(`Listings found in searches: ${stats.listings_found}`);
  console.log(`New listings discovered: ${stats.new_listings}`);
  console.log(`Full details extracted: ${stats.details_extracted}`);
  console.log(`Errors: ${stats.errors}`);
}

/**
 * Phase 1: Find listings via bot user agent (runs locally)
 */
async function findListingsInLocation(locationName: string): Promise<FoundListing[]> {
  const locationSlug = locationName.split(",")[0].toLowerCase().replace(/\s+/g, "");
  const url = `https://www.facebook.com/marketplace/${locationSlug}/vehicles?minYear=${CONFIG.YEAR_MIN}&maxYear=${CONFIG.YEAR_MAX}&sortBy=creation_time_descend`;

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

  if (!html.includes("marketplace_listing_title") && html.includes("login")) {
    throw new Error("Bot access blocked - got login page");
  }

  // Extract listings using context-aware matching
  // Find each title and search nearby for its ID and price to avoid positional misalignment
  const listings: FoundListing[] = [];
  const seenIds = new Set<string>();

  const titleRegex = /"marketplace_listing_title":"([^"]+)"/g;
  let titleMatch;

  while ((titleMatch = titleRegex.exec(html)) !== null) {
    const title = decodeUnicode(titleMatch[1]);
    const titlePos = titleMatch.index;

    // Search for ID and price within a reasonable window around the title
    // FB JSON blocks keep these fields within ~2000 chars of each other
    const windowStart = Math.max(0, titlePos - 2000);
    const windowEnd = Math.min(html.length, titlePos + 2000);
    const contextBlock = html.substring(windowStart, windowEnd);

    // Find the nearest listing ID (10+ digit number) in context
    const idMatch = contextBlock.match(/"id":"(\d{10,})"/);
    if (!idMatch || seenIds.has(idMatch[1])) continue;

    // Find the nearest price in context
    const priceMatch = contextBlock.match(/"amount_with_offset_in_currency":"(\d+)"/);
    // Also check for offset field to handle non-USD currencies
    const offsetMatch = contextBlock.match(/"offset":(\d+)/);
    const offset = offsetMatch ? parseInt(offsetMatch[1], 10) : 100;
    const price = priceMatch ? parseInt(priceMatch[1], 10) / offset : null;

    // Price sanity check: skip clearly invalid prices
    if (price !== null && (price < 1 || price > 1000000)) {
      console.warn(`  ⚠️ Suspicious price $${price} for "${title}" - skipping price`);
    }

    seenIds.add(idMatch[1]);
    const parsed = parseVehicleTitle(title);

    // Only include vintage
    if (parsed.year && parsed.year >= CONFIG.YEAR_MIN && parsed.year <= CONFIG.YEAR_MAX) {
      listings.push({
        facebook_id: idMatch[1],
        title,
        price: (price !== null && price >= 1 && price <= 1000000) ? price : null,
        year: parsed.year,
        make: parsed.make,
        model: parsed.model,
        url: `https://www.facebook.com/marketplace/item/${idMatch[1]}/`,
      });
    }
  }

  return listings;
}

/**
 * Phase 2: Extract full details via Firecrawl (edge function)
 */
async function extractFullDetails(listingUrl: string): Promise<{
  success: boolean;
  year?: number;
  make?: string;
  model?: string;
  error?: string;
}> {
  const { data, error } = await supabase.functions.invoke("extract-facebook-marketplace", {
    body: { url: listingUrl },
  });

  if (error) {
    return { success: false, error: error.message };
  }

  if (!data?.success) {
    return { success: false, error: data?.error || "Unknown error" };
  }

  return {
    success: true,
    year: data.extracted?.year,
    make: data.extracted?.make,
    model: data.extracted?.model,
  };
}

/**
 * Fallback: Store basic listing without Firecrawl (when --skip-details)
 */
async function storeBasicListing(listing: FoundListing): Promise<void> {
  await supabase.from("marketplace_listings").insert({
    facebook_id: listing.facebook_id,
    platform: "facebook_marketplace",
    url: listing.url,
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
}

function parseVehicleTitle(title: string): { year: number | null; make: string | null; model: string | null } {
  const yearMatch = title.match(/\b(19[2-9]\d|20[0-3]\d)\b/);
  if (!yearMatch) return { year: null, make: null, model: null };

  const year = parseInt(yearMatch[1]);
  const afterYear = title.split(String(year))[1]?.trim() || "";
  const words = afterYear.split(/\s+/).filter((w) => w.length > 0);

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
