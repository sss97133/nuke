import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Create SSS Tier Ultra-Fast Auction Lot
 * 
 * Requirements:
 * - Sellers must be SSS tier
 * - No reserve auctions only
 * - 3-minute duration
 * - Rapid-fire (one after another)
 * - Can handle 14 cars, 140 cars, or 1400 cars
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { lot_name, scheduled_start_time, vehicle_ids, theme } = await req.json();

    if (!lot_name || !scheduled_start_time || !vehicle_ids || vehicle_ids.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing required fields: lot_name, scheduled_start_time, vehicle_ids",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Validate all vehicles belong to SSS tier sellers
    const { data: vehicles, error: vehiclesError } = await supabaseAdmin
      .from("vehicles")
      .select(`
        id,
        user_id,
        make,
        model,
        year,
        seller_tiers!inner(tier, no_reserve_qualification)
      `)
      .in("id", vehicle_ids);

    if (vehiclesError || !vehicles || vehicles.length !== vehicle_ids.length) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Some vehicles not found or sellers don't qualify",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check all sellers are SSS tier and qualified for no-reserve
    for (const vehicle of vehicles) {
      const sellerTier = vehicle.seller_tiers;
      if (!sellerTier || sellerTier.tier !== "SSS" || !sellerTier.no_reserve_qualification) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `Vehicle ${vehicle.id} seller is not SSS tier or not qualified for no-reserve`,
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    // Create listings for all vehicles (no reserve, 3 minutes)
    const listings = [];
    const startTime = new Date(scheduled_start_time);
    
    for (let i = 0; i < vehicles.length; i++) {
      const vehicle = vehicles[i];
      const vehicleStartTime = new Date(startTime.getTime() + i * 3 * 60 * 1000); // 3 minutes apart
      const vehicleEndTime = new Date(vehicleStartTime.getTime() + 3 * 60 * 1000); // 3 minutes duration

      // Create listing
      const { data: listing, error: listingError } = await supabaseAdmin
        .from("vehicle_listings")
        .insert({
          vehicle_id: vehicle.id,
          seller_id: vehicle.user_id,
          sale_type: "live_auction",
          reserve_price_cents: null, // NO RESERVE
          auction_start_time: vehicleStartTime.toISOString(),
          auction_end_time: vehicleEndTime.toISOString(),
          auction_duration_minutes: 3,
          sniping_protection_minutes: 0, // No sniping protection for ultra-fast
          status: "draft",
          description: `${vehicle.year} ${vehicle.make} ${vehicle.model} - SSS Tier No Reserve Auction`,
          metadata: {
            sss_tier: true,
            no_reserve: true,
            rapid_fire: true,
          },
        })
        .select()
        .single();

      if (listingError || !listing) {
        console.error(`Error creating listing for vehicle ${vehicle.id}:`, listingError);
        continue;
      }

      listings.push({
        listing_id: listing.id,
        vehicle_id: vehicle.id,
        sequence_number: i + 1,
        start_time: vehicleStartTime.toISOString(),
        end_time: vehicleEndTime.toISOString(),
      });
    }

    if (listings.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Failed to create any listings",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Create auction lot
    const { data: lot, error: lotError } = await supabaseAdmin
      .from("auction_lots")
      .insert({
        lot_name,
        lot_type: "rapid_fire",
        minimum_seller_tier: "SSS",
        minimum_buyer_tier: "SSS", // Only SSS buyers can bid
        auction_duration_minutes: 3,
        sniping_protection_minutes: 0,
        allow_reserve: false,
        no_reserve_only: true,
        scheduled_start_time: scheduled_start_time,
        status: "scheduled",
        theme: theme || "SSS Tier Ultra-Fast",
        description: `SSS Tier No Reserve Rapid-Fire Auction - ${listings.length} vehicles, 3 minutes each`,
        metadata: {
          vehicle_count: listings.length,
          total_duration_minutes: listings.length * 3,
        },
      })
      .select()
      .single();

    if (lotError || !lot) {
      return new Response(
        JSON.stringify({
          success: false,
          error: lotError?.message || "Failed to create lot",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Link vehicles to lot
    const lotVehicles = listings.map((l) => ({
      lot_id: lot.id,
      listing_id: l.listing_id,
      sequence_number: l.sequence_number,
      start_time: l.start_time,
      end_time: l.end_time,
      status: "pending",
    }));

    const { error: linkError } = await supabaseAdmin
      .from("auction_lot_vehicles")
      .insert(lotVehicles);

    if (linkError) {
      console.error("Error linking vehicles to lot:", linkError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        lot_id: lot.id,
        lot_name: lot.lot_name,
        vehicle_count: listings.length,
        scheduled_start_time: scheduled_start_time,
        total_duration_minutes: listings.length * 3,
        listings: listings.map((l) => ({
          sequence: l.sequence_number,
          start_time: l.start_time,
          end_time: l.end_time,
        })),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error creating SSS tier lot:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Internal server error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

