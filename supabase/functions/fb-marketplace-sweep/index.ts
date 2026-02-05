/**
 * Facebook Marketplace Geographic Sweep Engine
 *
 * Orchestrates continuous sweeps across US metro areas for vintage vehicles.
 *
 * Actions:
 * - start: Begin a new sweep job
 * - status: Get current sweep status
 * - process_location: Process a single location (called by queue)
 * - detect_disappeared: Find listings that have disappeared (presumed sold)
 * - stats: Get overall collection stats
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Configuration
const CONFIG = {
  // Vintage vehicle year range
  YEAR_MIN: 1960,
  YEAR_MAX: 1999,

  // Rate limiting
  DELAY_BETWEEN_LOCATIONS_MS: 5000,
  MAX_LOCATIONS_PER_SWEEP: 50, // Process in batches

  // Disappearance detection
  SWEEPS_BEFORE_PRESUMED_SOLD: 3,

  // GraphQL endpoint (will be updated based on testing)
  FB_GRAPHQL_ENDPOINT: "https://www.facebook.com/api/graphql/",
  FB_DOC_ID: "3456763434364354", // MarketplaceSearchResultsPageContainerNewQuery
};

interface SweepJob {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  started_at: string;
  completed_at?: string;
  locations_total: number;
  locations_processed: number;
  listings_found: number;
  new_listings: number;
  price_changes: number;
  errors: number;
}

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { action, ...params } = await req.json();

    switch (action) {
      case "start":
        return await startSweep(params);
      case "status":
        return await getSweepStatus(params);
      case "process_location":
        return await processLocation(params);
      case "process_batch":
        return await processBatch(params);
      case "detect_disappeared":
        return await detectDisappeared(params);
      case "stats":
        return await getStats();
      case "test_query":
        return await testFBQuery(params);
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error) {
    console.error("Sweep error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * Start a new sweep job
 */
async function startSweep(params: { batch_size?: number }) {
  const batchSize = params.batch_size || CONFIG.MAX_LOCATIONS_PER_SWEEP;

  // Check for existing running sweep
  const { data: existingSweep } = await supabase
    .from("fb_sweep_jobs")
    .select("id, status, started_at")
    .eq("status", "running")
    .single();

  if (existingSweep) {
    return jsonResponse({
      status: "already_running",
      sweep_id: existingSweep.id,
      started_at: existingSweep.started_at,
      message: "A sweep is already in progress"
    });
  }

  // Get locations to sweep (prioritize by last_sweep_at)
  const { data: locations, error: locError } = await supabase
    .from("fb_marketplace_locations")
    .select("id, name, latitude, longitude, radius_miles")
    .eq("is_active", true)
    .order("last_sweep_at", { ascending: true, nullsFirst: true })
    .limit(batchSize);

  if (locError || !locations?.length) {
    return jsonResponse({
      status: "error",
      message: "No locations to sweep",
      error: locError?.message
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
        batch_size: batchSize,
        year_range: [CONFIG.YEAR_MIN, CONFIG.YEAR_MAX]
      }
    })
    .select()
    .single();

  if (jobError) {
    throw new Error(`Failed to create sweep job: ${jobError.message}`);
  }

  // Queue locations for processing
  const queueInserts = locations.map((loc, index) => ({
    sweep_job_id: sweepJob.id,
    location_id: loc.id,
    priority: index,
    status: "pending"
  }));

  await supabase.from("fb_sweep_queue").insert(queueInserts);

  return jsonResponse({
    status: "started",
    sweep_id: sweepJob.id,
    locations_queued: locations.length,
    message: `Sweep started with ${locations.length} locations`
  });
}

/**
 * Process a batch of locations from the queue
 */
async function processBatch(params: { sweep_id: string; batch_size?: number }) {
  const { sweep_id, batch_size = 10 } = params;

  // Get pending locations from queue
  const { data: queueItems } = await supabase
    .from("fb_sweep_queue")
    .select(`
      id,
      location_id,
      fb_marketplace_locations (
        id, name, latitude, longitude, radius_miles
      )
    `)
    .eq("sweep_job_id", sweep_id)
    .eq("status", "pending")
    .order("priority", { ascending: true })
    .limit(batch_size);

  if (!queueItems?.length) {
    // No more items - mark sweep as complete
    await supabase
      .from("fb_sweep_jobs")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", sweep_id);

    return jsonResponse({
      status: "sweep_complete",
      sweep_id,
      message: "All locations processed"
    });
  }

  const results = [];

  for (const item of queueItems) {
    // Mark as processing
    await supabase
      .from("fb_sweep_queue")
      .update({ status: "processing", started_at: new Date().toISOString() })
      .eq("id", item.id);

    try {
      const location = item.fb_marketplace_locations;
      const result = await queryFBMarketplace(location, sweep_id);

      // Mark as complete
      await supabase
        .from("fb_sweep_queue")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          listings_found: result.listings_count
        })
        .eq("id", item.id);

      // Update location last_sweep
      await supabase
        .from("fb_marketplace_locations")
        .update({
          last_sweep_at: new Date().toISOString(),
          last_sweep_listings: result.listings_count
        })
        .eq("id", location.id);

      results.push({ location: location.name, ...result });

      // Rate limit delay
      await sleep(CONFIG.DELAY_BETWEEN_LOCATIONS_MS);

    } catch (error) {
      // Mark as failed
      await supabase
        .from("fb_sweep_queue")
        .update({
          status: "failed",
          error: error.message
        })
        .eq("id", item.id);

      results.push({ location: item.fb_marketplace_locations?.name, error: error.message });
    }
  }

  // Update sweep job stats
  await updateSweepStats(sweep_id);

  return jsonResponse({
    status: "batch_complete",
    sweep_id,
    processed: results.length,
    results
  });
}

/**
 * Query Facebook Marketplace for a location
 */
async function queryFBMarketplace(
  location: { id: string; name: string; latitude: number; longitude: number; radius_miles: number },
  sweep_id: string
): Promise<{ listings_count: number; new_count: number; updated_count: number }> {

  // Build query variables
  const variables = {
    params: {
      bqf: {
        callsite: "COMMERCE_MKTPLACE_WWW",
        query: ""
      },
      browse_request_params: {
        filter_location_latitude: location.latitude,
        filter_location_longitude: location.longitude,
        filter_radius_km: Math.round(location.radius_miles * 1.60934),
        commerce_search_sort_by: "CREATION_TIME_DESCEND",
        filter_category_ids: ["vehicles"],
        vehicle_year_min: CONFIG.YEAR_MIN,
        vehicle_year_max: CONFIG.YEAR_MAX
      },
      custom_request_params: {
        surface: "SEARCH",
        search_vertical: "C2C"
      }
    },
    MARKETPLACE_FEED_ITEM_IMAGE_WIDTH: 196,
    count: 24
  };

  // Attempt GraphQL query
  // Note: This may require authentication - we'll adapt based on test results
  const response = await fetch(CONFIG.FB_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "Accept": "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Origin": "https://www.facebook.com",
      "Referer": "https://www.facebook.com/marketplace/"
    },
    body: new URLSearchParams({
      doc_id: CONFIG.FB_DOC_ID,
      variables: JSON.stringify(variables)
    }).toString()
  });

  if (!response.ok) {
    throw new Error(`FB API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  // Parse response and extract listings
  const listings = extractListingsFromResponse(data);

  // Process each listing
  let newCount = 0;
  let updatedCount = 0;

  for (const listing of listings) {
    const result = await upsertListing(listing, location.id, sweep_id);
    if (result === "new") newCount++;
    if (result === "updated") updatedCount++;
  }

  return {
    listings_count: listings.length,
    new_count: newCount,
    updated_count: updatedCount
  };
}

/**
 * Extract listings from FB GraphQL response
 */
function extractListingsFromResponse(data: any): any[] {
  try {
    // Navigate the GraphQL response structure
    // This path may need adjustment based on actual response
    const edges = data?.data?.marketplace_search?.feed_units?.edges || [];

    return edges.map((edge: any) => {
      const node = edge.node?.listing || edge.node;
      return {
        external_id: node?.id,
        title: node?.marketplace_listing_title,
        price: parsePrice(node?.listing_price?.formatted_amount || node?.listing_price?.amount),
        location: node?.location?.reverse_geocode?.city_page?.display_name,
        image_url: node?.primary_listing_photo?.image?.uri,
        url: `https://www.facebook.com/marketplace/item/${node?.id}`,
        seller_name: node?.marketplace_listing_seller?.name,
        created_time: node?.creation_time,
        // Vehicle-specific fields
        vehicle_info: {
          year: node?.vehicle_info?.year,
          make: node?.vehicle_info?.make,
          model: node?.vehicle_info?.model,
          mileage: node?.vehicle_info?.mileage?.value,
          transmission: node?.vehicle_info?.transmission,
          body_style: node?.vehicle_info?.body_style
        }
      };
    }).filter((l: any) => l.external_id);
  } catch (error) {
    console.error("Failed to parse FB response:", error);
    return [];
  }
}

/**
 * Insert or update a listing in marketplace_listings
 */
async function upsertListing(
  listing: any,
  locationId: string,
  sweepId: string
): Promise<"new" | "updated" | "unchanged"> {

  if (!listing.external_id) return "unchanged";

  // Check if listing exists
  const { data: existing } = await supabase
    .from("marketplace_listings")
    .select("id, current_price, status")
    .eq("external_id", listing.external_id)
    .eq("platform", "facebook_marketplace")
    .single();

  const vehicleInfo = listing.vehicle_info || {};

  if (!existing) {
    // New listing - insert
    const { error } = await supabase
      .from("marketplace_listings")
      .insert({
        external_id: listing.external_id,
        platform: "facebook_marketplace",
        url: listing.url,
        title: listing.title,
        asking_price: listing.price,
        current_price: listing.price,
        first_price: listing.price,
        extracted_year: vehicleInfo.year,
        extracted_make: vehicleInfo.make,
        extracted_model: vehicleInfo.model,
        extracted_mileage: vehicleInfo.mileage,
        location_city: listing.location,
        seller_name: listing.seller_name,
        thumbnail_url: listing.image_url,
        image_urls: listing.image_url ? [listing.image_url] : [],
        status: "active",
        first_seen_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        raw_scrape_data: listing
      });

    if (error) {
      console.error("Insert error:", error);
      return "unchanged";
    }

    return "new";
  }

  // Existing listing - update last_seen and check for price change
  const updates: any = {
    last_seen_at: new Date().toISOString(),
    status: "active" // Re-activate if it was marked as removed
  };

  let result: "updated" | "unchanged" = "unchanged";

  if (existing.current_price !== listing.price && listing.price) {
    updates.current_price = listing.price;
    result = "updated";
  }

  await supabase
    .from("marketplace_listings")
    .update(updates)
    .eq("id", existing.id);

  // Record sighting
  await supabase
    .from("fb_listing_sightings")
    .insert({
      listing_id: existing.id,
      sweep_job_id: sweepId,
      price_at_sighting: listing.price
    });

  return result;
}

/**
 * Detect disappeared listings and mark as presumed sold
 */
async function detectDisappeared(params: { days_threshold?: number }) {
  const daysThreshold = params.days_threshold || 3;

  // Find active listings not seen in recent sweeps
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysThreshold);

  const { data: disappeared, error } = await supabase
    .from("marketplace_listings")
    .select("id, external_id, title, current_price, first_seen_at, last_seen_at")
    .eq("platform", "facebook_marketplace")
    .eq("status", "active")
    .lt("last_seen_at", cutoffDate.toISOString());

  if (error || !disappeared?.length) {
    return jsonResponse({
      status: "complete",
      disappeared_count: 0,
      message: "No disappeared listings found"
    });
  }

  // Mark as removed (presumed sold)
  const ids = disappeared.map(l => l.id);

  await supabase
    .from("marketplace_listings")
    .update({
      status: "sold",
      removed_at: new Date().toISOString(),
      removal_reason: "disappeared",
      sold_price_source: "inferred"
    })
    .in("id", ids);

  return jsonResponse({
    status: "complete",
    disappeared_count: disappeared.length,
    listings: disappeared.map(l => ({
      id: l.id,
      title: l.title,
      last_price: l.current_price,
      days_listed: Math.round((new Date().getTime() - new Date(l.first_seen_at).getTime()) / (1000 * 60 * 60 * 24))
    }))
  });
}

/**
 * Get collection stats
 */
async function getStats() {
  const { data: stats } = await supabase.rpc("get_fb_marketplace_stats");

  // Fallback if RPC doesn't exist
  if (!stats) {
    const [
      { count: totalListings },
      { count: activeListings },
      { count: soldListings },
      { count: locations }
    ] = await Promise.all([
      supabase.from("marketplace_listings").select("*", { count: "exact", head: true }).eq("platform", "facebook_marketplace"),
      supabase.from("marketplace_listings").select("*", { count: "exact", head: true }).eq("platform", "facebook_marketplace").eq("status", "active"),
      supabase.from("marketplace_listings").select("*", { count: "exact", head: true }).eq("platform", "facebook_marketplace").eq("status", "sold"),
      supabase.from("fb_marketplace_locations").select("*", { count: "exact", head: true }).eq("is_active", true)
    ]);

    return jsonResponse({
      total_listings: totalListings,
      active_listings: activeListings,
      sold_listings: soldListings,
      locations_configured: locations,
      vintage_focus: `${CONFIG.YEAR_MIN}-${CONFIG.YEAR_MAX}`
    });
  }

  return jsonResponse(stats);
}

/**
 * Get sweep status
 */
async function getSweepStatus(params: { sweep_id?: string }) {
  if (params.sweep_id) {
    const { data: sweep } = await supabase
      .from("fb_sweep_jobs")
      .select("*")
      .eq("id", params.sweep_id)
      .single();

    return jsonResponse(sweep);
  }

  // Get most recent sweep
  const { data: sweep } = await supabase
    .from("fb_sweep_jobs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(1)
    .single();

  return jsonResponse(sweep);
}

/**
 * Test FB query directly (for debugging)
 */
async function testFBQuery(params: { latitude: number; longitude: number }) {
  const location = {
    id: "test",
    name: "Test Location",
    latitude: params.latitude || 30.2672,
    longitude: params.longitude || -97.7431,
    radius_miles: 40
  };

  try {
    const result = await queryFBMarketplace(location, "test");
    return jsonResponse({
      status: "success",
      ...result
    });
  } catch (error) {
    return jsonResponse({
      status: "error",
      error: error.message
    });
  }
}

/**
 * Update sweep job aggregate stats
 */
async function updateSweepStats(sweepId: string) {
  const { data: queueStats } = await supabase
    .from("fb_sweep_queue")
    .select("status, listings_found")
    .eq("sweep_job_id", sweepId);

  if (!queueStats) return;

  const completed = queueStats.filter(q => q.status === "completed").length;
  const failed = queueStats.filter(q => q.status === "failed").length;
  const totalListings = queueStats.reduce((sum, q) => sum + (q.listings_found || 0), 0);

  await supabase
    .from("fb_sweep_jobs")
    .update({
      locations_processed: completed,
      errors: failed,
      listings_found: totalListings
    })
    .eq("id", sweepId);
}

// Helpers
function parsePrice(priceStr: string | number | undefined): number | null {
  if (!priceStr) return null;
  if (typeof priceStr === "number") return priceStr;
  const cleaned = priceStr.replace(/[^0-9.]/g, "");
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function jsonResponse(data: any, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    }
  );
}
