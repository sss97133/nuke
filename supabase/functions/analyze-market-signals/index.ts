/**
 * ANALYZE MARKET SIGNALS
 *
 * Aggregate market data to understand pricing trends, segments, and patterns.
 *
 * POST /functions/v1/analyze-market-signals
 * {
 *   "analysis": "segment_overview" | "price_trends" | "hot_segments" | "bidder_activity"
 *   "filters": { "make": "...", "year_min": ..., "year_max": ... }
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AnalysisRequest {
  analysis: "segment_overview" | "price_trends" | "hot_segments" | "bidder_activity" | "full_snapshot";
  filters?: {
    make?: string;
    year_min?: number;
    year_max?: number;
    price_min?: number;
    price_max?: number;
    limit?: number;
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body: AnalysisRequest = await req.json().catch(() => ({ analysis: "full_snapshot" }));
    const { analysis, filters } = body;

    const results: any = {
      generated_at: new Date().toISOString(),
      analysis_type: analysis,
    };

    // ============ SEGMENT OVERVIEW ============
    if (analysis === "segment_overview" || analysis === "full_snapshot") {
      // Top makes by volume
      const { data: makeData } = await supabase
        .from("vehicles")
        .select("make, sale_price")
        .not("sale_price", "is", null)
        .gt("sale_price", 1000)
        .limit(10000);

      if (makeData) {
        const makeStats: Record<string, { count: number; total: number; prices: number[] }> = {};
        for (const v of makeData) {
          const make = (v.make || "unknown").toLowerCase();
          if (!makeStats[make]) makeStats[make] = { count: 0, total: 0, prices: [] };
          makeStats[make].count++;
          makeStats[make].total += v.sale_price;
          makeStats[make].prices.push(v.sale_price);
        }

        // Calculate stats per make
        const segments = Object.entries(makeStats)
          .map(([make, stats]) => ({
            make,
            count: stats.count,
            avg_price: Math.round(stats.total / stats.count),
            median_price: stats.prices.sort((a, b) => a - b)[Math.floor(stats.prices.length / 2)],
            total_value: stats.total,
            price_range: {
              min: Math.min(...stats.prices),
              max: Math.max(...stats.prices),
            },
          }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 20);

        results.segment_overview = {
          total_vehicles_with_prices: makeData.length,
          top_makes: segments,
          market_total_value: makeData.reduce((sum, v) => sum + v.sale_price, 0),
        };
      }
    }

    // ============ BIDDER ACTIVITY ============
    if (analysis === "bidder_activity" || analysis === "full_snapshot") {
      const { data: bidData } = await supabase
        .from("vehicle_observations")
        .select("structured_data, vehicle_id")
        .eq("kind", "bid")
        .limit(50000);

      if (bidData) {
        const bidderStats: Record<string, {
          bids: number;
          total_value: number;
          vehicles: Set<string>;
          amounts: number[];
        }> = {};

        for (const b of bidData) {
          const username = b.structured_data?.author_username;
          const amount = b.structured_data?.bid_amount || 0;
          if (!username || amount <= 0) continue;

          if (!bidderStats[username]) {
            bidderStats[username] = { bids: 0, total_value: 0, vehicles: new Set(), amounts: [] };
          }
          bidderStats[username].bids++;
          bidderStats[username].total_value += amount;
          bidderStats[username].vehicles.add(b.vehicle_id);
          bidderStats[username].amounts.push(amount);
        }

        // Top bidders by activity
        const topBidders = Object.entries(bidderStats)
          .map(([username, stats]) => ({
            username,
            total_bids: stats.bids,
            unique_vehicles: stats.vehicles.size,
            total_bid_value: stats.total_value,
            avg_bid: Math.round(stats.total_value / stats.bids),
            max_bid: Math.max(...stats.amounts),
          }))
          .sort((a, b) => b.total_bids - a.total_bids)
          .slice(0, 30);

        results.bidder_activity = {
          total_bids_analyzed: bidData.length,
          unique_bidders: Object.keys(bidderStats).length,
          top_bidders_by_activity: topBidders.slice(0, 15),
          top_bidders_by_value: [...topBidders].sort((a, b) => b.total_bid_value - a.total_bid_value).slice(0, 15),
        };
      }
    }

    // ============ HOT SEGMENTS ============
    if (analysis === "hot_segments" || analysis === "full_snapshot") {
      // Recent high-activity vehicles
      const { data: recentObs } = await supabase
        .from("vehicle_observations")
        .select("vehicle_id, kind")
        .in("kind", ["comment", "bid"])
        .order("observed_at", { ascending: false })
        .limit(10000);

      if (recentObs) {
        const vehicleActivity: Record<string, { comments: number; bids: number }> = {};
        for (const obs of recentObs) {
          if (!vehicleActivity[obs.vehicle_id]) {
            vehicleActivity[obs.vehicle_id] = { comments: 0, bids: 0 };
          }
          if (obs.kind === "comment") vehicleActivity[obs.vehicle_id].comments++;
          if (obs.kind === "bid") vehicleActivity[obs.vehicle_id].bids++;
        }

        // Get top active vehicle IDs
        const topActiveIds = Object.entries(vehicleActivity)
          .map(([id, stats]) => ({ id, total: stats.comments + stats.bids, ...stats }))
          .sort((a, b) => b.total - a.total)
          .slice(0, 20)
          .map(v => v.id);

        // Fetch vehicle details
        const { data: hotVehicles } = await supabase
          .from("vehicles")
          .select("id, year, make, model, sale_price")
          .in("id", topActiveIds);

        if (hotVehicles) {
          results.hot_segments = {
            most_active_vehicles: hotVehicles.map(v => ({
              ...v,
              activity: vehicleActivity[v.id],
            })).sort((a, b) =>
              (b.activity.comments + b.activity.bids) - (a.activity.comments + a.activity.bids)
            ),
          };
        }
      }
    }

    // ============ PRICE TRENDS ============
    if (analysis === "price_trends" || analysis === "full_snapshot") {
      // Group sales by year sold (if we have sale_date)
      const { data: salesData } = await supabase
        .from("vehicles")
        .select("sale_price, sale_date, year, make")
        .not("sale_price", "is", null)
        .not("sale_date", "is", null)
        .gt("sale_price", 1000)
        .order("sale_date", { ascending: false })
        .limit(5000);

      if (salesData) {
        // Group by sale month
        const monthlyStats: Record<string, { count: number; total: number }> = {};
        for (const v of salesData) {
          const month = v.sale_date?.slice(0, 7); // YYYY-MM
          if (!month) continue;
          if (!monthlyStats[month]) monthlyStats[month] = { count: 0, total: 0 };
          monthlyStats[month].count++;
          monthlyStats[month].total += v.sale_price;
        }

        results.price_trends = {
          sales_analyzed: salesData.length,
          monthly_averages: Object.entries(monthlyStats)
            .map(([month, stats]) => ({
              month,
              sales: stats.count,
              avg_price: Math.round(stats.total / stats.count),
              total_value: stats.total,
            }))
            .sort((a, b) => b.month.localeCompare(a.month))
            .slice(0, 24), // Last 24 months
        };
      }
    }

    return new Response(JSON.stringify(results, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
