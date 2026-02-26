/**
 * geocode-vehicle-locations
 *
 * Backfills gps_latitude/gps_longitude on vehicles that have a listing_location
 * but no coordinates. Also backfills vehicles where only the legacy `location`
 * column is populated (pre-pipeline-fix records).
 *
 * Geocoding strategy (no external API keys required):
 * 1. Parse location string → city + state
 * 2. Lookup in fb_marketplace_locations table (500+ US metros, lat/lng already stored)
 * 3. Fallback to Nominatim (OpenStreetMap) — free, no key, 1 req/sec
 *
 * Usage:
 *   POST /geocode-vehicle-locations
 *   { "batch_size": 500, "dry_run": false, "nominatim_delay_ms": 1100 }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parseLocation } from "../_shared/parseLocation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_USER_AGENT = "nuke-vehicle-geocoder/1.0 (contact@nuke.com)";

interface GeoResult {
  latitude: number;
  longitude: number;
  source: "lookup_table" | "nominatim";
  precision: "city" | "region";
  confidence: number;
}

async function geocodeFromLookupTable(
  supabase: ReturnType<typeof createClient>,
  city: string,
  state: string
): Promise<GeoResult | null> {
  // Match against fb_marketplace_locations: name like "Austin, TX"
  const { data, error } = await supabase
    .from("fb_marketplace_locations")
    .select("latitude, longitude, name")
    .eq("state_code", state.toUpperCase())
    .ilike("name", `${city}%`)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const lat = typeof data.latitude === "string" ? parseFloat(data.latitude) : Number(data.latitude);
  const lng = typeof data.longitude === "string" ? parseFloat(data.longitude) : Number(data.longitude);
  if (!isFinite(lat) || !isFinite(lng)) return null;

  return {
    latitude: lat,
    longitude: lng,
    source: "lookup_table",
    precision: "city",
    confidence: 0.75,
  };
}

async function geocodeFromNominatim(city: string, state: string): Promise<GeoResult | null> {
  const q = encodeURIComponent(`${city}, ${state}`);
  const url = `${NOMINATIM_URL}?q=${q}&format=json&countrycodes=us&limit=1&addressdetails=0`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": NOMINATIM_USER_AGENT },
    });
    if (!res.ok) return null;
    const results = await res.json();
    if (!Array.isArray(results) || results.length === 0) return null;

    const lat = parseFloat(results[0].lat);
    const lon = parseFloat(results[0].lon);
    if (!isFinite(lat) || !isFinite(lon)) return null;

    return {
      latitude: lat,
      longitude: lon,
      source: "nominatim",
      precision: "city",
      confidence: 0.65,
    };
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const body = await req.json().catch(() => ({}));
  const batchSize = Math.min(Number(body.batch_size) || 200, 1000);
  const dryRun = Boolean(body.dry_run);
  const nominatimDelayMs = Number(body.nominatim_delay_ms) || 1100;
  // method: "all" (default) | "lookup_only" | "nominatim_only"
  const method: string = body.method || "all";

  // Fetch vehicles needing geocoding.
  // Priority: vehicles with listing_location but no coords.
  // Also handle vehicles with only the legacy `location` column populated.
  let vehicleQuery = supabase
    .from("vehicles")
    .select("id, listing_location, location")
    .or("listing_location.not.is.null,location.not.is.null")
    .is("gps_latitude", null);

  // nominatim_only: skip records with common US cities (likely already handled by lookup)
  // by ordering by listing_location desc so we process diverse locations
  vehicleQuery = vehicleQuery.order("id", { ascending: true });

  const { data: vehicles, error: fetchError } = await vehicleQuery.limit(batchSize);

  if (fetchError) {
    return new Response(JSON.stringify({ error: fetchError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!vehicles || vehicles.length === 0) {
    return new Response(
      JSON.stringify({ processed: 0, remaining: 0, message: "No vehicles to geocode" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const stats = {
    processed: 0,
    geocoded_from_lookup: 0,
    geocoded_from_nominatim: 0,
    skipped_no_city_state: 0,
    failed: 0,
  };

  const nominatimQueue: Array<{ vehicleId: string; city: string; state: string; rawLoc: string }> = [];

  // Pass 1: lookup table (fast, no rate limiting)
  for (const vehicle of vehicles) {
    const rawLoc = vehicle.listing_location || vehicle.location;
    const parsed = parseLocation(rawLoc);

    if (!parsed.city || !parsed.state) {
      stats.skipped_no_city_state++;
      continue;
    }

    const geo = await geocodeFromLookupTable(supabase, parsed.city, parsed.state);

    if (geo && parsed.city) {
      if (!dryRun) {
        await supabase
          .from("vehicles")
          .update({
            gps_latitude: geo.latitude,
            gps_longitude: geo.longitude,
            // Also backfill listing_location_* if only legacy location column was set
            ...(vehicle.listing_location ? {} : {
              listing_location: parsed.clean,
              listing_location_raw: parsed.raw,
              listing_location_source: "geocode_backfill",
              listing_location_confidence: parsed.confidence,
              listing_location_observed_at: new Date().toISOString(),
            }),
          })
          .eq("id", vehicle.id);

        // Upsert into vehicle_location_observations
        await supabase.from("vehicle_location_observations").upsert(
          {
            vehicle_id: vehicle.id,
            source_type: "geocoded",
            source_platform: "fb_marketplace_locations",
            observed_at: new Date().toISOString(),
            location_text_raw: parsed.raw,
            location_text_clean: parsed.clean,
            city: parsed.city,
            region_code: parsed.state,
            postal_code: parsed.zip,
            latitude: geo.latitude,
            longitude: geo.longitude,
            precision: "city",
            confidence: geo.confidence,
            metadata: { geocode_source: "lookup_table" },
          },
          { onConflict: "vehicle_id,source_type,source_platform" }
        );
      }
      stats.geocoded_from_lookup++;
    } else {
      // Queue for Nominatim
      nominatimQueue.push({ vehicleId: vehicle.id, city: parsed.city, state: parsed.state, rawLoc });
    }
    stats.processed++;
  }

  // Pass 2: Nominatim fallback (rate-limited) — skip in dry_run or lookup_only mode
  for (const item of nominatimQueue) {
    if (dryRun || method === "lookup_only") { stats.geocoded_from_nominatim++; break; } // estimate/skip
    const parsed = parseLocation(item.rawLoc);
    const geo = await geocodeFromNominatim(item.city, item.state);

    if (geo) {
      await supabase
        .from("vehicles")
        .update({
          gps_latitude: geo.latitude,
          gps_longitude: geo.longitude,
          ...(vehicles.find(v => v.id === item.vehicleId)?.listing_location ? {} : {
            listing_location: parsed.clean,
            listing_location_raw: parsed.raw,
            listing_location_source: "geocode_backfill",
            listing_location_confidence: parsed.confidence,
            listing_location_observed_at: new Date().toISOString(),
          }),
        })
        .eq("id", item.vehicleId);

      await supabase.from("vehicle_location_observations").upsert(
        {
          vehicle_id: item.vehicleId,
          source_type: "geocoded",
          source_platform: "nominatim",
          observed_at: new Date().toISOString(),
          location_text_raw: parsed.raw,
          location_text_clean: parsed.clean,
          city: parsed.city,
          region_code: parsed.state,
          postal_code: parsed.zip,
          latitude: geo.latitude,
          longitude: geo.longitude,
          precision: "city",
          confidence: geo.confidence,
          metadata: { geocode_source: "nominatim" },
        },
        { onConflict: "vehicle_id,source_type,source_platform" }
      );

      if (!dryRun) stats.geocoded_from_nominatim++;
    } else if (!geo) {
      stats.failed++;
    }

    await sleep(nominatimDelayMs);
  }

  return new Response(
    JSON.stringify({ ...stats, dry_run: dryRun }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
