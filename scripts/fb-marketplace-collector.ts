#!/usr/bin/env npx tsx
/**
 * Facebook Marketplace Local Collector
 *
 * Tier-aware collection across year ranges. Each location is searched
 * per tier so high-priority eras get dedicated queries.
 *
 * Usage:
 *   dotenvx run -- npx tsx scripts/fb-marketplace-collector.ts
 *   dotenvx run -- npx tsx scripts/fb-marketplace-collector.ts --tier=64-72
 *   dotenvx run -- npx tsx scripts/fb-marketplace-collector.ts --state=TX --max-locations=20
 *   dotenvx run -- npx tsx scripts/fb-marketplace-collector.ts --skip-details
 *
 * Options:
 *   --tier=64-72        Focus on a single tier (64-72 | 73-87 | 88-00 | 01-07 | 08-13 | 55-63 | pre-55)
 *   --max-locations=N   Locations to sweep per run (default: 30)
 *   --state=TX          Filter to a single state
 *   --skip-details      Skip Firecrawl enrichment (just find IDs, faster)
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

const BOT_USER_AGENT = "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)";

// Year tiers in priority order (listed first = swept most)
// Priority is how often to include this tier in a given sweep pass:
//   3 = every run, 2 = every other run, 1 = every third run
const TIERS = [
  { id: "64-72",  label: "1964–1972 Muscle Era",    minYear: 1964, maxYear: 1972, priority: 3 },
  { id: "55-63",  label: "1955–1963 Golden Age",     minYear: 1955, maxYear: 1963, priority: 3 },
  { id: "pre-55", label: "Pre-1955 Antique",          minYear: 1900, maxYear: 1954, priority: 3 },
  { id: "73-87",  label: "1973–1987 Squarebody Era", minYear: 1973, maxYear: 1987, priority: 2 },
  { id: "88-00",  label: "1988–2000 OBS/Modern Classic", minYear: 1988, maxYear: 2000, priority: 2 },
  { id: "01-07",  label: "2001–2007",                minYear: 2001, maxYear: 2007, priority: 1 },
  { id: "08-13",  label: "2008–2013",                minYear: 2008, maxYear: 2013, priority: 1 },
] as const;

type TierId = typeof TIERS[number]["id"];

const CONFIG = {
  DELAY_BETWEEN_TIER_SEARCHES_MS: 8000,   // 8s between tier searches within a location
  DELAY_BETWEEN_LOCATIONS_MS: 25000,       // 25s between locations
  DELAY_BETWEEN_DETAILS_MS: 3000,
  MAX_DETAILS_PER_LOCATION: 5,
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

// Get current sweep pass number from DB to know which tiers to include
async function getSweepPassNumber(): Promise<number> {
  const { count } = await supabase
    .from("fb_sweep_jobs")
    .select("*", { count: "exact", head: true });
  return (count || 0) + 1;
}

async function main() {
  const args = process.argv.slice(2);
  const maxLocations = parseInt(args.find(a => a.startsWith("--max-locations="))?.split("=")[1] || "30");
  const stateFilter = args.find(a => a.startsWith("--state="))?.split("=")[1];
  const skipDetails = args.includes("--skip-details");
  const tierFilter = args.find(a => a.startsWith("--tier="))?.split("=")[1] as TierId | undefined;

  // Determine which tiers to run this pass based on priority
  const passNum = await getSweepPassNumber();
  const activeTiers = tierFilter
    ? TIERS.filter((t) => t.id === tierFilter)
    : TIERS.filter((t) => passNum % (4 - t.priority) === 0 || t.priority === 3);

  if (!activeTiers.length) {
    console.error("No matching tiers found.");
    process.exit(1);
  }

  console.log("FB Marketplace Collector");
  console.log("========================");
  console.log(`Pass #${passNum}  |  Locations: ${maxLocations}  |  State: ${stateFilter || "ALL"}`);
  console.log(`Active tiers: ${activeTiers.map((t) => t.id).join(", ")}`);
  console.log(`Detail extraction: ${skipDetails ? "off" : "on (Firecrawl)"}`);
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

  console.log(`Processing ${locations.length} locations\n`);

  const stats = {
    locations_processed: 0,
    listings_found: 0,
    new_listings: 0,
    details_extracted: 0,
    errors: 0,
    by_tier: {} as Record<string, number>,
  };

  for (let i = 0; i < locations.length; i++) {
    const location = locations[i];
    const progress = `[${i + 1}/${locations.length}]`;

    try {
      console.log(`\n${progress} ${location.name}, ${location.state_code}`);

      let locationNew = 0;

      for (let t = 0; t < activeTiers.length; t++) {
        const tier = activeTiers[t];
        process.stdout.write(`  ${tier.id}: `);

        try {
          const found = await findListingsInLocation(location.name, tier.minYear, tier.maxYear);
          stats.listings_found += found.length;

          // Filter to new only
          const existingIds = found.length > 0
            ? await getExistingIds(found.map((l) => l.facebook_id))
            : new Set<string>();

          const newListings = found.filter((l) => !existingIds.has(l.facebook_id));
          locationNew += newListings.length;
          stats.new_listings += newListings.length;
          stats.by_tier[tier.id] = (stats.by_tier[tier.id] || 0) + newListings.length;

          if (!newListings.length) {
            console.log(`${found.length} found, 0 new`);
          } else {
            console.log(`${found.length} found, ${newListings.length} new`);

            if (!skipDetails) {
              const toExtract = newListings.slice(0, CONFIG.MAX_DETAILS_PER_LOCATION);
              for (let j = 0; j < toExtract.length; j++) {
                const listing = toExtract[j];
                try {
                  process.stdout.write(`    extracting ${listing.facebook_id}... `);
                  const result = await extractFullDetails(listing.url);
                  if (result.success) {
                    console.log(`${result.year} ${result.make} ${result.model}`);
                    stats.details_extracted++;
                  } else {
                    console.log(`fail: ${result.error}`);
                  }
                  if (j < toExtract.length - 1) await sleep(CONFIG.DELAY_BETWEEN_DETAILS_MS);
                } catch (err: any) {
                  console.log(`error: ${err.message}`);
                  stats.errors++;
                }
              }
            } else {
              for (const listing of newListings) {
                await storeBasicListing(listing);
              }
            }
          }
        } catch (err: any) {
          console.log(`error: ${err.message}`);
          stats.errors++;
        }

        if (t < activeTiers.length - 1) {
          await sleep(CONFIG.DELAY_BETWEEN_TIER_SEARCHES_MS);
        }
      }

      await supabase
        .from("fb_marketplace_locations")
        .update({ last_sweep_at: new Date().toISOString(), last_sweep_listings: locationNew })
        .eq("id", location.id);

      stats.locations_processed++;

      if (i < locations.length - 1) {
        process.stdout.write(`  waiting ${CONFIG.DELAY_BETWEEN_LOCATIONS_MS / 1000}s...\r`);
        await sleep(CONFIG.DELAY_BETWEEN_LOCATIONS_MS);
      }
    } catch (err: any) {
      console.log(`  location error: ${err.message}`);
      stats.errors++;
    }
  }

  console.log("\n========================");
  console.log("Collection Complete");
  console.log("========================");
  console.log(`Locations: ${stats.locations_processed}/${locations.length}`);
  console.log(`Found: ${stats.listings_found}  New: ${stats.new_listings}  Enriched: ${stats.details_extracted}  Errors: ${stats.errors}`);
  if (Object.keys(stats.by_tier).length) {
    console.log("\nNew by tier:");
    const tierOrder = ["64-72", "55-63", "pre-55", "73-87", "88-00", "01-07", "08-13"];
    for (const id of tierOrder) {
      if (stats.by_tier[id]) console.log(`  ${id}: ${stats.by_tier[id]}`);
    }
  }
}

async function getExistingIds(facebookIds: string[]): Promise<Set<string>> {
  const { data } = await supabase
    .from("marketplace_listings")
    .select("facebook_id")
    .in("facebook_id", facebookIds);
  return new Set((data || []).map((r) => r.facebook_id));
}

/**
 * Phase 1: Find listings via bot user agent (runs locally)
 */
async function findListingsInLocation(locationName: string, minYear: number, maxYear: number): Promise<FoundListing[]> {
  const locationSlug = locationName.split(",")[0].toLowerCase().replace(/\s+/g, "");
  const url = `https://www.facebook.com/marketplace/${locationSlug}/vehicles?minYear=${minYear}&maxYear=${maxYear}&sortBy=creation_time_descend`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": BOT_USER_AGENT,
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

    // Only include listings in the requested year range
    if (parsed.year && parsed.year >= minYear && parsed.year <= maxYear) {
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
