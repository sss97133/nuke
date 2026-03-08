/**
 * WIDGET: BROKER EXPOSURE TRACKER
 *
 * Tracks multi-platform listing exposure for a vehicle.
 * Each additional platform erodes 5-12% exclusivity premium.
 * Simultaneous multi-platform listing is worse than sequential.
 *
 * POST /functions/v1/widget-broker-exposure
 * { "vehicle_id": "uuid" }
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getSupabase() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// Exclusivity premium erosion per additional platform
const PREMIUM_EROSION_PER_PLATFORM = 0.07; // 7% average

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { vehicle_id } = await req.json();
    if (!vehicle_id) return json(400, { error: "vehicle_id required" });

    const supabase = getSupabase();

    const { data: vehicle } = await supabase
      .from("vehicles")
      .select("id, year, make, model, vin, asking_price, sale_price, auction_source")
      .eq("id", vehicle_id)
      .single();

    if (!vehicle) return json(404, { error: "Vehicle not found" });

    // Get vehicle events
    const { data: listings } = await supabase
      .from("vehicle_events")
      .select("id, source_platform, event_status, started_at, ended_at")
      .eq("vehicle_id", vehicle_id)
      .order("started_at", { ascending: true });

    // Get vehicles table entries (VIN-based multi-platform)
    const vinListings: Array<{ platform: string; status: string; date: string | null }> = [];
    if (vehicle.vin && vehicle.vin.length >= 11) {
      const { data: vinMatches } = await supabase
        .from("vehicles")
        .select("id, auction_source, auction_status, auction_end_date")
        .eq("vin", vehicle.vin)
        .not("auction_source", "is", null);

      if (vinMatches?.length) {
        for (const v of vinMatches) {
          vinListings.push({
            platform: v.auction_source,
            status: v.auction_status ?? "unknown",
            date: v.auction_end_date,
          });
        }
      }
    }

    // Combine platforms from both sources
    const allPlatforms = new Set<string>();
    const currentListings: Array<{ platform: string; status: string; start: string | null }> = [];

    for (const l of listings ?? []) {
      allPlatforms.add(l.platform);
      currentListings.push({
        platform: l.platform,
        status: l.listing_status,
        start: l.start_date,
      });
    }

    for (const v of vinListings) {
      allPlatforms.add(v.platform);
    }

    // If vehicle itself has an auction_source, add it
    if (vehicle.auction_source) {
      allPlatforms.add(vehicle.auction_source);
    }

    const uniquePlatforms = allPlatforms.size;

    // Check for simultaneous listings (worse than sequential)
    const activeListings = (listings ?? []).filter(
      (l) => l.listing_status === "active" || !l.end_date
    );
    const simultaneousCount = activeListings.length;
    const isSimultaneous = simultaneousCount > 1;

    // Count broker contacts
    const { count: brokerCount } = await supabase
      .from("deal_contacts")
      .select("*", { count: "exact", head: true })
      .eq("vehicle_id", vehicle_id);

    // Calculate exclusivity premium lost
    const extraPlatforms = Math.max(0, uniquePlatforms - 1);
    const premiumLostPct = Math.min(
      35,
      extraPlatforms * PREMIUM_EROSION_PER_PLATFORM * 100
    );
    const vehiclePrice = vehicle.asking_price || vehicle.sale_price || 0;
    const premiumLostDollars = Math.round(vehiclePrice * premiumLostPct / 100);

    // Simultaneous penalty
    const simultaneousPenalty = isSimultaneous ? 5 : 0;

    // Score
    let score: number;
    if (uniquePlatforms <= 1) score = 95;
    else if (uniquePlatforms === 2) score = 70;
    else if (uniquePlatforms === 3) score = 40;
    else score = 15;

    // Apply simultaneous penalty
    score = Math.max(5, score - simultaneousPenalty * simultaneousCount);

    const severity =
      score >= 70 ? "ok" : score >= 40 ? "warning" : "critical";

    let headline: string;
    if (uniquePlatforms <= 1) {
      headline = "Single platform — strong exclusivity position";
    } else if (isSimultaneous) {
      headline = `Listed on ${uniquePlatforms} platforms simultaneously — exclusivity premium eroded by ~${Math.round(premiumLostPct)}%`;
    } else {
      headline = `Vehicle seen on ${uniquePlatforms} platforms — ${Math.round(premiumLostPct)}% exclusivity premium erosion`;
    }

    const recommendations: Array<{ action: string; priority: number; rationale: string }> = [];

    if (uniquePlatforms >= 3) {
      recommendations.push({
        action: "Consolidate to single best platform for this segment",
        priority: 1,
        rationale: `${uniquePlatforms} platforms create perception of desperation. Single-platform exclusivity adds ${Math.round(PREMIUM_EROSION_PER_PLATFORM * 100 * extraPlatforms)}% premium.`,
      });
    }

    if (isSimultaneous) {
      recommendations.push({
        action: "Remove concurrent listings — list sequentially instead",
        priority: 1,
        rationale: "Simultaneous multi-platform listings are worse than sequential. Buyers seeing the same car everywhere assume seller is desperate.",
      });
    }

    if (uniquePlatforms >= 2) {
      recommendations.push({
        action: "If multi-listing, stagger by 2+ weeks",
        priority: 2,
        rationale: "Sequential listing avoids the 'shopping it around' perception and reaches fresh audiences.",
      });
    }

    return json(200, {
      score,
      severity,
      headline,
      details: {
        unique_platforms: uniquePlatforms,
        platforms: [...allPlatforms],
        simultaneous_active: simultaneousCount,
        is_simultaneous: isSimultaneous,
        broker_contacts: brokerCount ?? 0,
        exclusivity_premium_lost_pct: Math.round(premiumLostPct),
        exclusivity_premium_lost_dollars: premiumLostDollars,
        current_listings: currentListings,
        vehicle: {
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          asking_price: vehicle.asking_price,
        },
      },
      reasons: [headline],
      confidence: 0.8,
      recommendations,
    });
  } catch (err: any) {
    console.error("Widget broker-exposure error:", err);
    return json(500, { error: err.message });
  }
});
