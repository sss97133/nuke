/**
 * Facebook Marketplace Collection Orchestrator
 *
 * Master coordinator for FB Marketplace data collection.
 * Manages the full pipeline:
 * 1. Geographic sweeps across 580 US metro locations
 * 2. Vintage vehicle filtering (1960-1999)
 * 3. Listing tracking (new, price changes, disappeared)
 * 4. Seller profile extraction
 *
 * DISCOVERY: Using Bingbot user agent bypasses login requirement!
 * Facebook serves full listing data to search engine bots for SEO.
 *
 * Actions:
 * - brief: Get current collection status
 * - start_sweep: Begin a geographic sweep
 * - continue_sweep: Process next batch of locations
 * - run_collection: Full automated collection cycle
 * - detect_sales: Mark disappeared listings as sold
 * - stats: Overall statistics
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Configuration
const CONFIG = {
  BOT_USER_AGENT: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
  YEAR_MIN: 1960,
  YEAR_MAX: 1999,
  LOCATIONS_PER_BATCH: 20,
  DELAY_BETWEEN_LOCATIONS_MS: 3000,
  DAYS_BEFORE_PRESUMED_SOLD: 3,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "brief";

    switch (action) {
      case "brief":
        return await getBrief();
      case "start_sweep":
        return await startSweep(body.batch_size);
      case "continue_sweep":
        return await continueSweep(body.sweep_id, body.batch_size);
      case "run_collection":
        return await runCollectionCycle(body.max_locations);
      case "detect_sales":
        return await detectSales(body.days_threshold);
      case "stats":
        return await getStats();
      case "test_location":
        return await testLocation(body.location);
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error) {
    console.error("Orchestrator error:", error);
    return jsonResponse({ error: error.message }, 500);
  }
});

/**
 * Get current collection status brief
 */
async function getBrief(): Promise<Response> {
  // Get location coverage
  const { count: totalLocations } = await supabase
    .from("fb_marketplace_locations")
    .select("*", { count: "exact", head: true })
    .eq("is_active", true);

  const { count: sweptToday } = await supabase
    .from("fb_marketplace_locations")
    .select("*", { count: "exact", head: true })
    .gte("last_sweep_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  // Get listing stats
  const { count: totalListings } = await supabase
    .from("marketplace_listings")
    .select("*", { count: "exact", head: true })
    .eq("platform", "facebook_marketplace");

  const { count: activeListings } = await supabase
    .from("marketplace_listings")
    .select("*", { count: "exact", head: true })
    .eq("platform", "facebook_marketplace")
    .eq("status", "active");

  const { count: vintageListings } = await supabase
    .from("marketplace_listings")
    .select("*", { count: "exact", head: true })
    .eq("platform", "facebook_marketplace")
    .gte("extracted_year", CONFIG.YEAR_MIN)
    .lte("extracted_year", CONFIG.YEAR_MAX);

  const { count: soldListings } = await supabase
    .from("marketplace_listings")
    .select("*", { count: "exact", head: true })
    .eq("platform", "facebook_marketplace")
    .eq("status", "sold");

  // Get recent activity
  const { count: newToday } = await supabase
    .from("marketplace_listings")
    .select("*", { count: "exact", head: true })
    .eq("platform", "facebook_marketplace")
    .gte("first_seen_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  // Check for active sweep
  const { data: activeSweep } = await supabase
    .from("fb_sweep_jobs")
    .select("*")
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(1)
    .single();

  return jsonResponse({
    status: "ok",
    collection: {
      discovery_method: "Bingbot user agent (no auth required)",
      year_range: `${CONFIG.YEAR_MIN}-${CONFIG.YEAR_MAX}`,
    },
    locations: {
      total: totalLocations || 0,
      swept_today: sweptToday || 0,
      coverage_pct: totalLocations ? ((sweptToday || 0) / totalLocations * 100).toFixed(1) : 0,
    },
    listings: {
      total: totalListings || 0,
      active: activeListings || 0,
      vintage: vintageListings || 0,
      sold: soldListings || 0,
      new_today: newToday || 0,
    },
    active_sweep: activeSweep ? {
      id: activeSweep.id,
      started_at: activeSweep.started_at,
      progress: `${activeSweep.locations_processed}/${activeSweep.locations_total}`,
      listings_found: activeSweep.listings_found,
    } : null,
    recommended_actions: getRecommendedActions(
      totalLocations || 0,
      sweptToday || 0,
      activeListings || 0,
      !!activeSweep
    ),
  });
}

/**
 * Start a new geographic sweep
 */
async function startSweep(batchSize?: number): Promise<Response> {
  const size = batchSize || CONFIG.LOCATIONS_PER_BATCH;

  // Check for existing running sweep
  const { data: existingSweep } = await supabase
    .from("fb_sweep_jobs")
    .select("id")
    .eq("status", "running")
    .single();

  if (existingSweep) {
    return jsonResponse({
      status: "already_running",
      sweep_id: existingSweep.id,
      message: "A sweep is already in progress. Use continue_sweep to process more locations.",
    });
  }

  // Get locations to sweep (prioritize by last_sweep_at)
  const { data: locations } = await supabase
    .from("fb_marketplace_locations")
    .select("id, name")
    .eq("is_active", true)
    .order("last_sweep_at", { ascending: true, nullsFirst: true })
    .limit(size);

  if (!locations?.length) {
    return jsonResponse({
      status: "no_locations",
      message: "No active locations to sweep",
    });
  }

  // Create sweep job
  const { data: sweepJob, error: jobError } = await supabase
    .from("fb_sweep_jobs")
    .insert({
      status: "running",
      locations_total: locations.length,
      locations_processed: 0,
      listings_found: 0,
      new_listings: 0,
      price_changes: 0,
      errors: 0,
      metadata: {
        batch_size: size,
        year_range: [CONFIG.YEAR_MIN, CONFIG.YEAR_MAX],
        discovery_method: "bingbot",
      },
    })
    .select()
    .single();

  if (jobError) {
    throw new Error(`Failed to create sweep job: ${jobError.message}`);
  }

  // Process locations
  const results = await processLocations(sweepJob.id, locations);

  // Update sweep job
  await supabase
    .from("fb_sweep_jobs")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      locations_processed: results.processed,
      listings_found: results.listings,
      new_listings: results.new,
      price_changes: results.updates,
      errors: results.errors,
    })
    .eq("id", sweepJob.id);

  return jsonResponse({
    status: "completed",
    sweep_id: sweepJob.id,
    results,
  });
}

/**
 * Continue an existing sweep or start a new batch
 */
async function continueSweep(sweepId?: string, batchSize?: number): Promise<Response> {
  const size = batchSize || CONFIG.LOCATIONS_PER_BATCH;

  // If no sweep_id, just process next batch of oldest locations
  const { data: locations } = await supabase
    .from("fb_marketplace_locations")
    .select("id, name, latitude, longitude")
    .eq("is_active", true)
    .order("last_sweep_at", { ascending: true, nullsFirst: true })
    .limit(size);

  if (!locations?.length) {
    return jsonResponse({
      status: "no_locations",
      message: "All locations have been swept recently",
    });
  }

  // Create or get sweep job
  let jobId = sweepId;
  if (!jobId) {
    const { data: newJob } = await supabase
      .from("fb_sweep_jobs")
      .insert({
        status: "running",
        locations_total: locations.length,
        locations_processed: 0,
        metadata: { batch_size: size },
      })
      .select()
      .single();
    jobId = newJob?.id;
  }

  const results = await processLocations(jobId!, locations);

  // Update job
  await supabase
    .from("fb_sweep_jobs")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      locations_processed: results.processed,
      listings_found: results.listings,
      new_listings: results.new,
      price_changes: results.updates,
      errors: results.errors,
    })
    .eq("id", jobId);

  return jsonResponse({
    status: "completed",
    sweep_id: jobId,
    results,
  });
}

/**
 * Run a full collection cycle (multiple batches until all locations swept)
 */
async function runCollectionCycle(maxLocations?: number): Promise<Response> {
  const limit = maxLocations || 100; // Default to 100 locations per cycle
  const startTime = Date.now();

  let totalProcessed = 0;
  let totalListings = 0;
  let totalNew = 0;
  let totalUpdates = 0;
  let totalErrors = 0;
  let batchCount = 0;

  while (totalProcessed < limit) {
    const batchSize = Math.min(CONFIG.LOCATIONS_PER_BATCH, limit - totalProcessed);

    const { data: locations } = await supabase
      .from("fb_marketplace_locations")
      .select("id, name")
      .eq("is_active", true)
      .order("last_sweep_at", { ascending: true, nullsFirst: true })
      .limit(batchSize);

    if (!locations?.length) break;

    const results = await processLocations("cycle", locations);

    totalProcessed += results.processed;
    totalListings += results.listings;
    totalNew += results.new;
    totalUpdates += results.updates;
    totalErrors += results.errors;
    batchCount++;

    // Check if we've been running too long (edge functions have limits)
    if (Date.now() - startTime > 50000) { // 50 seconds
      break;
    }
  }

  return jsonResponse({
    status: "completed",
    duration_seconds: ((Date.now() - startTime) / 1000).toFixed(1),
    batches_processed: batchCount,
    totals: {
      locations_processed: totalProcessed,
      listings_found: totalListings,
      new_listings: totalNew,
      price_updates: totalUpdates,
      errors: totalErrors,
    },
  });
}

/**
 * Process a batch of locations
 */
async function processLocations(
  sweepId: string,
  locations: Array<{ id: string; name: string }>
): Promise<{ processed: number; listings: number; new: number; updates: number; errors: number }> {
  let processed = 0;
  let listings = 0;
  let newCount = 0;
  let updates = 0;
  let errors = 0;

  for (const location of locations) {
    console.log(`Processing: ${location.name}`);

    try {
      const result = await scrapeLocation(location.name);

      // Update location record
      await supabase
        .from("fb_marketplace_locations")
        .update({
          last_sweep_at: new Date().toISOString(),
          last_sweep_listings: result.listings_found,
          total_listings_found: supabase.rpc("increment", {
            x: result.new_count,
            row_id: location.id,
          }),
        })
        .eq("id", location.id);

      processed++;
      listings += result.listings_found;
      newCount += result.new_count;
      updates += result.update_count;

      // Rate limit
      await sleep(CONFIG.DELAY_BETWEEN_LOCATIONS_MS);
    } catch (error: any) {
      console.error(`Error processing ${location.name}:`, error.message);
      errors++;
    }
  }

  return { processed, listings, new: newCount, updates, errors };
}

/**
 * Scrape a single location using bot user agent
 */
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

  // Extract listings
  const titleMatches = html.match(/"marketplace_listing_title":"([^"]+)"/g) || [];
  const priceMatches = html.match(/"amount_with_offset_in_currency":"(\d+)"/g) || [];
  const idMatches = html.match(/"id":"(\d{10,})"/g) || [];

  const listings: Array<{
    id: string;
    title: string;
    price: number | null;
    year: number | null;
    make: string | null;
    model: string | null;
  }> = [];

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
      const updates: any = { last_seen_at: new Date().toISOString(), status: "active" };
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

/**
 * Detect disappeared listings and mark as sold
 */
async function detectSales(daysThreshold?: number): Promise<Response> {
  const days = daysThreshold || CONFIG.DAYS_BEFORE_PRESUMED_SOLD;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data: disappeared, error } = await supabase
    .from("marketplace_listings")
    .select("id, title, current_price, first_seen_at, last_seen_at")
    .eq("platform", "facebook_marketplace")
    .eq("status", "active")
    .lt("last_seen_at", cutoff);

  if (error) throw error;
  if (!disappeared?.length) {
    return jsonResponse({
      status: "no_changes",
      message: "No disappeared listings found",
    });
  }

  // Mark as sold
  const ids = disappeared.map((l) => l.id);
  await supabase
    .from("marketplace_listings")
    .update({
      status: "sold",
      removed_at: new Date().toISOString(),
      removal_reason: "disappeared",
      sold_price_source: "inferred",
    })
    .in("id", ids);

  return jsonResponse({
    status: "completed",
    marked_as_sold: disappeared.length,
    listings: disappeared.map((l) => ({
      title: l.title,
      last_price: l.current_price,
      days_listed: Math.round(
        (new Date().getTime() - new Date(l.first_seen_at).getTime()) / (1000 * 60 * 60 * 24)
      ),
    })),
  });
}

/**
 * Get overall statistics
 */
async function getStats(): Promise<Response> {
  const stats = await supabase.rpc("get_fb_marketplace_stats");
  return jsonResponse(stats.data || {});
}

/**
 * Test scraping a specific location with debug output
 */
async function testLocation(location: string): Promise<Response> {
  if (!location) {
    return jsonResponse({ error: "location required" }, 400);
  }

  try {
    // Build URL same as scrapeLocation
    const locationSlug = location
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

    const html = await response.text();
    const htmlLength = html.length;

    // Debug: look for various patterns
    const titleMatches = html.match(/"marketplace_listing_title":"([^"]+)"/g) || [];
    const priceMatches = html.match(/"amount_with_offset_in_currency":"(\d+)"/g) || [];
    const idMatches = html.match(/"id":"(\d{10,})"/g) || [];
    const hasLoginPrompt = html.includes("login") || html.includes("Log In");
    const hasListings = html.includes("marketplace_listing_title");

    // Try actual scrape
    const result = await scrapeLocation(location);

    return jsonResponse({
      status: "success",
      location,
      url_tested: url,
      http_status: response.status,
      html_length: htmlLength,
      debug: {
        title_matches: titleMatches.length,
        price_matches: priceMatches.length,
        id_matches: idMatches.length,
        has_login_prompt: hasLoginPrompt,
        has_listing_data: hasListings,
        sample_html: html.substring(0, 500),
      },
      ...result,
    });
  } catch (error: any) {
    return jsonResponse({
      status: "error",
      location,
      error: error.message,
      stack: error.stack,
    });
  }
}

// Helpers
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

function getRecommendedActions(
  totalLocs: number,
  sweptToday: number,
  activeListings: number,
  hasSweep: boolean
): string[] {
  const actions: string[] = [];

  if (hasSweep) {
    actions.push("Continue active sweep: POST {action: 'continue_sweep'}");
  } else if (sweptToday < totalLocs * 0.3) {
    actions.push("Start collection cycle: POST {action: 'run_collection', max_locations: 50}");
  }

  if (activeListings > 100) {
    actions.push("Detect sales: POST {action: 'detect_sales'}");
  }

  if (actions.length === 0) {
    actions.push("System healthy - sweeps running on schedule");
  }

  return actions;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
