/**
 * Market Spread Calculator API
 *
 * Provides real-time auction venue fee comparisons.
 * Part of the "Wall Street of Car Trading" infrastructure.
 *
 * Endpoints:
 * - POST { action: "calculate", price: 500000 } - Get spreads for specific price
 * - POST { action: "compare", prices: [50000, 250000, 1000000] } - Compare across prices
 * - POST { action: "venues" } - Get all venue fee structures
 * - POST { action: "optimal", price: 500000 } - Get optimal venue recommendation
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

interface VenueSpread {
  venue_slug: string;
  venue_name: string;
  venue_type: string;
  buyer_fee: number;
  seller_fee: number;
  total_spread: number;
  effective_rate_pct: number;
  savings_vs_worst: number;
}

Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { action, price, prices } = body;

    // Get all venues
    if (action === "venues") {
      const { data: venues } = await supabase
        .from("auction_venues")
        .select("*")
        .order("name");

      return new Response(
        JSON.stringify({ venues }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calculate spread for single price
    if (action === "calculate" && price) {
      const { data: spreads } = await supabase
        .rpc("calculate_venue_spread", { hammer_price: price });

      return new Response(
        JSON.stringify({
          price,
          spreads,
          optimal: spreads?.[0],
          worst: spreads?.[spreads.length - 1],
          max_savings: spreads ? spreads[spreads.length - 1].total_spread - spreads[0].total_spread : 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Compare across multiple prices
    if (action === "compare" && prices?.length) {
      const results = await Promise.all(
        prices.map(async (p: number) => {
          const { data: spreads } = await supabase
            .rpc("calculate_venue_spread", { hammer_price: p });
          return {
            price: p,
            spreads,
            optimal: spreads?.[0]?.venue_name,
            optimal_rate: spreads?.[0]?.effective_rate_pct,
          };
        })
      );

      return new Response(
        JSON.stringify({ comparison: results }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get optimal venue for price
    if (action === "optimal" && price) {
      const { data: spreads } = await supabase
        .rpc("calculate_venue_spread", { hammer_price: price });

      const optimal = spreads?.[0];
      const worst = spreads?.[spreads.length - 1];

      if (!optimal || !worst) {
        return new Response(
          JSON.stringify({ error: "Could not calculate spreads" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
        );
      }

      // Determine friction level
      const rate = optimal.effective_rate_pct;
      let friction_level = "significant";
      if (rate < 1) friction_level = "trivial";
      else if (rate < 3) friction_level = "car_wash";
      else if (rate < 5) friction_level = "dinner_out";
      else if (rate < 10) friction_level = "vacation";

      return new Response(
        JSON.stringify({
          price,
          recommendation: {
            venue: optimal.venue_name,
            total_cost: optimal.total_spread,
            effective_rate: optimal.effective_rate_pct,
            friction_level,
            savings_vs_traditional: worst.total_spread - optimal.total_spread,
          },
          alternatives: spreads.slice(1, 4).map((s: VenueSpread) => ({
            venue: s.venue_name,
            total_cost: s.total_spread,
            extra_cost: s.total_spread - optimal.total_spread,
          })),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Quick insights for dashboard
    if (action === "insights") {
      // Key price points
      const keyPrices = [50000, 150000, 500000, 1000000, 2000000];
      const insights = await Promise.all(
        keyPrices.map(async (p) => {
          const { data: spreads } = await supabase
            .rpc("calculate_venue_spread", { hammer_price: p });
          return {
            price: p,
            bat_rate: spreads?.find((s: VenueSpread) => s.venue_slug === "bat")?.effective_rate_pct,
            rm_rate: spreads?.find((s: VenueSpread) => s.venue_slug === "rmsothebys")?.effective_rate_pct,
            savings: spreads ? spreads[spreads.length - 1].total_spread - spreads[0].total_spread : 0,
          };
        })
      );

      // Find cap zone
      const capZone = 7500 / 0.05; // BaT cap / rate = $150,000

      return new Response(
        JSON.stringify({
          insights,
          key_findings: {
            cap_zone_starts: capZone,
            max_savings_at_1m: insights.find(i => i.price === 1000000)?.savings,
            bat_advantage_multiplier: 50, // ~50x cheaper at high end
          },
          terminology: {
            hammer_price: "Final bid amount before fees",
            buyers_premium: "Fee charged to buyer on top of hammer",
            total_spread: "Combined buyer + seller transaction costs",
            cap_zone: "Price range where fee cap kicks in",
            friction_level: "How significant fees are relative to wealth",
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        error: "Unknown action",
        available_actions: ["calculate", "compare", "venues", "optimal", "insights"],
        example: { action: "calculate", price: 500000 },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );

  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
