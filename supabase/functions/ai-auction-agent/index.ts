import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface AuctionOpportunity {
  vehicle_id: string;
  owner_id: string;
  opportunity_type: 'scheduled_lot' | 'trending_category' | 'price_match' | 'similar_sold';
  scheduled_auction_id?: string;
  pitch_reason: string;
  suggested_reserve?: number;
  suggested_duration?: number;
  confidence_score: number;
  market_data: {
    similar_sold_price?: number;
    similar_sold_date?: string;
    trending_category?: string;
    average_time_to_sell?: number;
  };
}

/**
 * AI Auction Agent - Proactive Marketplace Intelligence
 * 
 * Watches all auctions, analyzes trends, and proactively suggests
 * opportunities to vehicle owners. Like having an AI sales agent
 * that's always working.
 */
async function analyzeMarketplaceOpportunities(
  supabase: any
): Promise<AuctionOpportunity[]> {
  const opportunities: AuctionOpportunity[] = [];

  // =====================================================
  // OPPORTUNITY 1: Scheduled Auction Lots
  // =====================================================
  // Find upcoming scheduled auctions and match vehicles
  const { data: scheduledAuctions } = await supabase
    .from("vehicle_listings")
    .select("id, auction_start_time, metadata")
    .eq("sale_type", "live_auction")
    .eq("status", "draft")
    .gte("auction_start_time", new Date().toISOString())
    .order("auction_start_time", { ascending: true })
    .limit(10);

  if (scheduledAuctions && scheduledAuctions.length > 0) {
    // Get vehicles that match scheduled auction themes
    for (const auction of scheduledAuctions) {
      const theme = auction.metadata?.theme || auction.metadata?.category;
      
      if (theme) {
        // Find vehicles matching this theme that aren't listed
        const { data: matchingVehicles } = await supabase
          .from("vehicles")
          .select(`
            id,
            user_id,
            make,
            model,
            year,
            current_value,
            sale_status
          `)
          .eq("sale_status", "not_for_sale")
          .ilike("make", `%${theme}%`)
          .limit(5);

        if (matchingVehicles) {
          for (const vehicle of matchingVehicles) {
            opportunities.push({
              vehicle_id: vehicle.id,
              owner_id: vehicle.user_id,
              opportunity_type: "scheduled_lot",
              scheduled_auction_id: auction.id,
              pitch_reason: `Upcoming ${theme} auction scheduled for ${new Date(auction.auction_start_time).toLocaleDateString()}. Your ${vehicle.year} ${vehicle.make} ${vehicle.model} would be a perfect fit.`,
              suggested_reserve: vehicle.current_value ? Math.floor(vehicle.current_value * 100) : undefined,
              suggested_duration: 10, // 10-minute live auction
              confidence_score: 85,
              market_data: {
                trending_category: theme,
              },
            });
          }
        }
      }
    }
  }

  // =====================================================
  // OPPORTUNITY 2: Trending Categories
  // =====================================================
  // Analyze what's selling well right now
  const { data: recentSales } = await supabase
    .from("vehicle_listings")
    .select("vehicle_id, sold_price_cents, sold_at")
    .eq("status", "sold")
    .gte("sold_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()) // Last 7 days
    .limit(50);

  if (recentSales && recentSales.length > 0) {
    // Get vehicle details for sold listings
    const vehicleIds = recentSales.map((s: any) => s.vehicle_id);
    const { data: soldVehicles } = await supabase
      .from("vehicles")
      .select("make, model, year")
      .in("id", vehicleIds);

    // Find trending makes/models
    const makeCounts: Record<string, number> = {};
    soldVehicles?.forEach((v: any) => {
      const key = `${v.make} ${v.model}`;
      makeCounts[key] = (makeCounts[key] || 0) + 1;
    });

    // Find top 3 trending
    const trending = Object.entries(makeCounts)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 3);

    // Find vehicles matching trending categories
    for (const [makeModel, count] of trending) {
      const [make, model] = makeModel.split(" ");
      
      const { data: matchingVehicles } = await supabase
        .from("vehicles")
        .select(`
          id,
          user_id,
          make,
          model,
          year,
          current_value,
          sale_status
        `)
        .eq("sale_status", "not_for_sale")
        .eq("make", make)
        .ilike("model", `%${model}%`)
        .limit(3);

      if (matchingVehicles && matchingVehicles.length > 0) {
        for (const vehicle of matchingVehicles) {
          opportunities.push({
            vehicle_id: vehicle.id,
            owner_id: vehicle.user_id,
            opportunity_type: "trending_category",
            pitch_reason: `${count} ${makeModel}${count > 1 ? 's' : ''} sold in the last week. Your ${vehicle.year} ${vehicle.make} ${vehicle.model} is in high demand right now.`,
            suggested_reserve: vehicle.current_value ? Math.floor(vehicle.current_value * 100) : undefined,
            suggested_duration: 7 * 24 * 60, // 7 days
            confidence_score: 75,
            market_data: {
              trending_category: makeModel,
              average_time_to_sell: 3, // days
            },
          });
        }
      }
    }
  }

  // =====================================================
  // OPPORTUNITY 3: Similar Vehicles Just Sold
  // =====================================================
  // Find vehicles similar to ones that just sold well
  const { data: highValueSales } = await supabase
    .from("vehicle_listings")
    .select(`
      vehicle_id,
      sold_price_cents,
      sold_at,
      vehicle:vehicles(make, model, year, current_value)
    `)
    .eq("status", "sold")
    .gte("sold_at", new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
    .order("sold_price_cents", { ascending: false })
    .limit(10);

  if (highValueSales && highValueSales.length > 0) {
    for (const sale of highValueSales) {
      const vehicle = sale.vehicle;
      if (!vehicle) continue;

      // Find similar vehicles (same make/model, similar year)
      const { data: similarVehicles } = await supabase
        .from("vehicles")
        .select(`
          id,
          user_id,
          make,
          model,
          year,
          current_value,
          sale_status
        `)
        .eq("sale_status", "not_for_sale")
        .eq("make", vehicle.make)
        .eq("model", vehicle.model)
        .gte("year", (vehicle.year || 0) - 3)
        .lte("year", (vehicle.year || 0) + 3)
        .neq("id", sale.vehicle_id)
        .limit(2);

      if (similarVehicles && similarVehicles.length > 0) {
        for (const similar of similarVehicles) {
          opportunities.push({
            vehicle_id: similar.id,
            owner_id: similar.user_id,
            opportunity_type: "similar_sold",
            pitch_reason: `A ${vehicle.year} ${vehicle.make} ${vehicle.model} just sold for $${((sale.sold_price_cents || 0) / 100).toFixed(2)}. Your ${similar.year} ${similar.make} ${similar.model} could fetch a similar price.`,
            suggested_reserve: sale.sold_price_cents ? Math.floor(sale.sold_price_cents * 0.9) : undefined, // 90% of similar sale
            suggested_duration: 7 * 24 * 60, // 7 days
            confidence_score: 80,
            market_data: {
              similar_sold_price: sale.sold_price_cents,
              similar_sold_date: sale.sold_at,
            },
          });
        }
      }
    }
  }

  // =====================================================
  // OPPORTUNITY 4: Price Match Opportunities
  // =====================================================
  // Find vehicles where current value matches active auction prices
  const { data: activeAuctions } = await supabase
    .from("vehicle_listings")
    .select(`
      current_high_bid_cents,
      reserve_price_cents,
      vehicle:vehicles(make, model, year, current_value)
    `)
    .eq("status", "active")
    .eq("sale_type", "auction")
    .limit(20);

  if (activeAuctions && activeAuctions.length > 0) {
    const avgActivePrice = activeAuctions.reduce((sum: number, a: any) => {
      const price = a.current_high_bid_cents || a.reserve_price_cents || 0;
      return sum + price;
    }, 0) / activeAuctions.length;

    // Find vehicles with similar current_value that aren't listed
    const { data: priceMatchVehicles } = await supabase
      .from("vehicles")
      .select(`
        id,
        user_id,
        make,
        model,
        year,
        current_value,
        sale_status
      `)
      .eq("sale_status", "not_for_sale")
      .gte("current_value", (avgActivePrice / 100) * 0.8)
      .lte("current_value", (avgActivePrice / 100) * 1.2)
      .limit(5);

    if (priceMatchVehicles && priceMatchVehicles.length > 0) {
      for (const vehicle of priceMatchVehicles) {
        opportunities.push({
          vehicle_id: vehicle.id,
          owner_id: vehicle.user_id,
          opportunity_type: "price_match",
          pitch_reason: `Vehicles in your price range ($${((avgActivePrice / 100).toFixed(0))}) are actively selling. Your ${vehicle.year} ${vehicle.make} ${vehicle.model} could be next.`,
          suggested_reserve: vehicle.current_value ? Math.floor(vehicle.current_value * 100) : undefined,
          suggested_duration: 7 * 24 * 60, // 7 days
          confidence_score: 70,
          market_data: {},
        });
      }
    }
  }

  return opportunities;
}

/**
 * Generate personalized pitch message
 */
function generatePitch(opportunity: AuctionOpportunity, vehicle: any): string {
  const vehicleName = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
  const reserveText = opportunity.suggested_reserve
    ? `Suggested reserve: $${(opportunity.suggested_reserve / 100).toFixed(2)}`
    : "";

  switch (opportunity.opportunity_type) {
    case "scheduled_lot":
      return `🚀 Perfect Timing: Your ${vehicleName} would be a great fit for an upcoming scheduled auction. ${opportunity.pitch_reason} ${reserveText}`;

    case "trending_category":
      return `🔥 Hot Market: ${opportunity.pitch_reason} Strike while the iron is hot! ${reserveText}`;

    case "similar_sold":
      return `💰 Proven Demand: ${opportunity.pitch_reason} This is the perfect time to list. ${reserveText}`;

    case "price_match":
      return `📈 Market Opportunity: ${opportunity.pitch_reason} Your ${vehicleName} is in the sweet spot. ${reserveText}`;

    default:
      return `Your ${vehicleName} has a great opportunity to sell. ${opportunity.pitch_reason}`;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Use service role for full access
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Analyze marketplace for opportunities
    const opportunities = await analyzeMarketplaceOpportunities(supabaseAdmin);

    // Filter out opportunities for vehicles already listed
    const { data: activeListings } = await supabaseAdmin
      .from("vehicle_listings")
      .select("vehicle_id")
      .in("status", ["active", "draft"]);

    const activeVehicleIds = new Set(
      activeListings?.map((l: any) => l.vehicle_id) || []
    );

    const filteredOpportunities = opportunities.filter(
      (opp) => !activeVehicleIds.has(opp.vehicle_id)
    );

    // Get vehicle details and create suggestions
    const suggestionsCreated = [];
    
    for (const opportunity of filteredOpportunities) {
      // Check if we already sent a suggestion recently (within 7 days)
      const { data: recentSuggestions } = await supabaseAdmin
        .from("auction_suggestions")
        .select("id")
        .eq("vehicle_id", opportunity.vehicle_id)
        .eq("opportunity_type", opportunity.opportunity_type)
        .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .limit(1);

      if (recentSuggestions && recentSuggestions.length > 0) {
        continue; // Skip if we already suggested this recently
      }

      // Get vehicle details
      const { data: vehicle } = await supabaseAdmin
        .from("vehicles")
        .select("*")
        .eq("id", opportunity.vehicle_id)
        .single();

      if (!vehicle) continue;

      // Generate pitch
      const pitch = generatePitch(opportunity, vehicle);

      // Create suggestion record
      const { data: suggestion, error } = await supabaseAdmin
        .from("auction_suggestions")
        .insert({
          vehicle_id: opportunity.vehicle_id,
          owner_id: opportunity.owner_id,
          opportunity_type: opportunity.opportunity_type,
          scheduled_auction_id: opportunity.scheduled_auction_id,
          pitch_message: pitch,
          pitch_reason: opportunity.pitch_reason,
          suggested_reserve_cents: opportunity.suggested_reserve,
          suggested_duration_minutes: opportunity.suggested_duration,
          confidence_score: opportunity.confidence_score,
          market_data: opportunity.market_data,
          status: "pending", // Owner hasn't responded yet
        })
        .select()
        .single();

      if (suggestion && !error) {
        // Create notification for owner
        await supabaseAdmin.from("user_notifications").insert({
          user_id: opportunity.owner_id,
          event_id: null,
          channel_type: "in_app",
          notification_title: "Auction Opportunity",
          notification_body: pitch,
          action_url: `/suggestions/${suggestion.id}`,
          metadata: {
            suggestion_id: suggestion.id,
            vehicle_id: opportunity.vehicle_id,
            opportunity_type: opportunity.opportunity_type,
          },
        });

        suggestionsCreated.push(suggestion);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        opportunities_found: filteredOpportunities.length,
        suggestions_created: suggestionsCreated.length,
        suggestions: suggestionsCreated,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("AI Agent error:", error);
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

