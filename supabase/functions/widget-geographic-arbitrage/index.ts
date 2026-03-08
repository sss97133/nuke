/**
 * WIDGET: GEOGRAPHIC ARBITRAGE DETECTOR
 *
 * Compares regional pricing for the vehicle's segment.
 * Identifies buy-low/sell-high geographic opportunities
 * net of estimated transport costs.
 *
 * POST /functions/v1/widget-geographic-arbitrage
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { vehicle_id } = await req.json();
    if (!vehicle_id) return json(400, { error: "vehicle_id required" });

    const supabase = getSupabase();

    const { data: vehicle } = await supabase
      .from("vehicles")
      .select("id, year, make, model, era, body_style, asking_price, sale_price, nuke_estimate, location")
      .eq("id", vehicle_id)
      .single();

    if (!vehicle) return json(404, { error: "Vehicle not found" });

    // Query regional prices for same era with sale data in last 2 years
    const { data: regionData, error: sqlError } = await supabase.rpc("execute_readonly_query", {
      p_sql: `
        WITH regional_prices AS (
          SELECT
            v.location AS region,
            COUNT(*) AS sales,
            ROUND(AVG(v.sale_price)) AS avg_price,
            ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY v.sale_price)) AS median_price,
            MIN(v.sale_price) AS min_price,
            MAX(v.sale_price) AS max_price
          FROM vehicles v
          WHERE v.era = '${vehicle.era}'
            AND v.sale_price IS NOT NULL
            AND v.sale_price > 0
            AND v.location IS NOT NULL
            AND LENGTH(v.location) > 2
            AND v.auction_end_date IS NOT NULL
            AND v.auction_end_date ~ E'^\\\\d{4}-\\\\d{2}-\\\\d{2}'
            AND v.auction_end_date::date >= CURRENT_DATE - INTERVAL '2 years'
          GROUP BY v.location
          HAVING COUNT(*) >= 5
        ),
        overall AS (
          SELECT ROUND(AVG(median_price)) AS national_median FROM regional_prices
        )
        SELECT json_build_object(
          'regions', COALESCE((SELECT json_agg(row_to_json(r) ORDER BY r.median_price DESC) FROM regional_prices r), '[]'::json),
          'region_count', (SELECT COUNT(*) FROM regional_prices),
          'national_median', (SELECT national_median FROM overall),
          'highest_region', (SELECT row_to_json(r) FROM regional_prices r ORDER BY r.median_price DESC LIMIT 1),
          'lowest_region', (SELECT row_to_json(r) FROM regional_prices r ORDER BY r.median_price ASC LIMIT 1),
          'spread_pct', (SELECT ROUND(100.0 * (MAX(median_price) - MIN(median_price)) / NULLIF(AVG(median_price), 0), 1) FROM regional_prices)
        ) AS result
      `,
    });

    // Parse results
    const result = regionData?.result ?? regionData ?? {};
    const regions = result.regions ?? [];
    const regionCount = result.region_count ?? 0;
    const nationalMedian = result.national_median ?? 0;
    const highest = result.highest_region;
    const lowest = result.lowest_region;
    const spreadPct = result.spread_pct ?? 0;

    // Score based on arbitrage opportunity
    let score: number;
    const reasons: string[] = [];
    const recommendations: Array<{ action: string; priority: number; rationale: string }> = [];

    if (regionCount < 3) {
      score = 50;
      reasons.push("Insufficient regional data for arbitrage analysis");
    } else if (spreadPct > 30) {
      score = 85;
      reasons.push(`${Math.round(spreadPct)}% price spread across ${regionCount} regions — strong arbitrage potential`);
    } else if (spreadPct > 15) {
      score = 70;
      reasons.push(`${Math.round(spreadPct)}% price spread — moderate arbitrage opportunity`);
    } else {
      score = 55;
      reasons.push(`Only ${Math.round(spreadPct)}% price spread — limited geographic arbitrage`);
    }

    if (highest && lowest && spreadPct > 15) {
      const diff = Number(highest.median_price) - Number(lowest.median_price);
      recommendations.push({
        action: `Buy in ${lowest.region}, sell in ${highest.region}`,
        priority: 1,
        rationale: `$${diff.toLocaleString()} price differential. ${lowest.region}: $${Number(lowest.median_price).toLocaleString()} vs ${highest.region}: $${Number(highest.median_price).toLocaleString()}.`,
      });
    }

    // Show top 10 regions only
    const topRegions = regions.slice(0, 10);

    const severity =
      score >= 60 ? "ok" : score >= 35 ? "warning" : "critical";

    const headline =
      regionCount < 3
        ? "Insufficient regional data for arbitrage analysis"
        : `${Math.round(spreadPct)}% geographic price spread across ${regionCount} regions`;

    return json(200, {
      score,
      severity,
      headline,
      details: {
        region_count: regionCount,
        national_median: nationalMedian,
        spread_pct: Math.round(spreadPct),
        top_regions: topRegions,
        highest_region: highest,
        lowest_region: lowest,
        vehicle: { year: vehicle.year, make: vehicle.make, model: vehicle.model, location: vehicle.location },
      },
      reasons,
      confidence: regionCount >= 5 ? 0.7 : 0.4,
      recommendations,
    });
  } catch (err: any) {
    console.error("Widget geographic-arbitrage error:", err);
    return json(500, { error: err.message });
  }
});
