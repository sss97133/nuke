/**
 * AUCTION TRENDS STATS - Market intelligence for auction activity
 *
 * Returns:
 * - Source leaderboard: Live auctions by platform over time
 * - Market sentiment: Hot/Soft indicator based on bid activity, price trends, reserve met %
 * - Daily activity: Auction endings per hour with peak time identification
 *
 * Uses S-tier/analysis_tier weighting for market sentiment calculations.
 *
 * GET /functions/v1/auction-trends-stats
 * POST /functions/v1/auction-trends-stats (with optional { days: number })
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Tier weights for market sentiment - higher tiers have more weight
const TIER_WEIGHTS: Record<number, number> = {
  0: 1.0,  // Base tier
  1: 1.5,  // Mid tier
  2: 2.5,  // High tier (S-tier equivalent)
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    let days = 30; // Default lookback
    if (req.method === "POST") {
      try {
        const body = await req.json();
        days = body?.days ?? 30;
      } catch {
        // Use default days if JSON parsing fails
      }
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const cutoff30d = new Date();
    cutoff30d.setDate(cutoff30d.getDate() - 30);
    const cutoff7d = new Date();
    cutoff7d.setDate(cutoff7d.getDate() - 7);
    const cutoff90d = new Date();
    cutoff90d.setDate(cutoff90d.getDate() - 90);
    const cutoffDays = new Date();
    cutoffDays.setDate(cutoffDays.getDate() - days);
    const now = new Date().toISOString();

    // Run all queries in parallel
    const [
      // Active listings for leaderboard
      activeListingsRes,
      // Recent listings for daily activity trends
      recentCreatedRes,
      // Recent bid metrics (last 7 days)
      recentBidsRes,
      // Historical bid metrics (30-90 days ago)
      historicalBidsRes,
      // Reserve/sell-through metrics
      completedRes,
      // Weekly price data
      soldListingsRes,
      // Hourly endings
      endedListingsRes,
      // Tier data - get listings with vehicle_id
      tierListingsRes,
    ] = await Promise.all([
      supabase
        .from("external_listings")
        .select("platform, bid_count, current_bid")
        .eq("listing_status", "active")
        .not("platform", "is", null),
      supabase
        .from("external_listings")
        .select("platform, created_at")
        .not("platform", "is", null)
        .gte("created_at", cutoffDays.toISOString())
        .limit(10000),
      supabase
        .from("external_listings")
        .select("bid_count")
        .lte("end_date", now)
        .gte("end_date", cutoff7d.toISOString())
        .not("bid_count", "is", null),
      supabase
        .from("external_listings")
        .select("bid_count")
        .lte("end_date", cutoff30d.toISOString())
        .gte("end_date", cutoff90d.toISOString())
        .not("bid_count", "is", null)
        .limit(5000),
      supabase
        .from("external_listings")
        .select("listing_status")
        .gte("end_date", cutoff30d.toISOString())
        .in("listing_status", ["sold", "ended", "unsold"]),
      supabase
        .from("external_listings")
        .select("end_date, final_price")
        .eq("listing_status", "sold")
        .gte("end_date", cutoffDays.toISOString())
        .not("final_price", "is", null)
        .limit(5000),
      supabase
        .from("external_listings")
        .select("end_date")
        .lte("end_date", now)
        .gte("end_date", cutoffDays.toISOString())
        .not("end_date", "is", null)
        .limit(10000),
      supabase
        .from("external_listings")
        .select("vehicle_id, bid_count, final_price")
        .gte("end_date", cutoff30d.toISOString())
        .in("listing_status", ["sold", "ended"])
        .not("vehicle_id", "is", null)
        .limit(5000),
    ]);

    // Process source leaderboard
    const platformMap: Record<string, { count: number; totalBids: number; totalPrice: number; bidRecords: number; priceRecords: number }> = {};
    for (const row of activeListingsRes.data || []) {
      const platform = row.platform;
      if (!platform) continue;
      if (!platformMap[platform]) {
        platformMap[platform] = { count: 0, totalBids: 0, totalPrice: 0, bidRecords: 0, priceRecords: 0 };
      }
      platformMap[platform].count++;
      if (row.bid_count != null) {
        platformMap[platform].totalBids += row.bid_count;
        platformMap[platform].bidRecords++;
      }
      if (row.current_bid != null) {
        platformMap[platform].totalPrice += Number(row.current_bid);
        platformMap[platform].priceRecords++;
      }
    }
    const sourceLeaderboard = Object.entries(platformMap)
      .map(([platform, stats]) => ({
        platform,
        active_auctions: stats.count,
        avg_bids: stats.bidRecords > 0 ? Number((stats.totalBids / stats.bidRecords).toFixed(1)) : 0,
        avg_current_bid: stats.priceRecords > 0 ? Math.round(stats.totalPrice / stats.priceRecords) : 0,
      }))
      .sort((a, b) => b.active_auctions - a.active_auctions);

    // Process daily activity by platform
    const dailyMap: Record<string, Record<string, number>> = {};
    for (const row of recentCreatedRes.data || []) {
      const day = row.created_at?.slice(0, 10);
      const platform = row.platform;
      if (!day || !platform) continue;
      if (!dailyMap[platform]) dailyMap[platform] = {};
      dailyMap[platform][day] = (dailyMap[platform][day] || 0) + 1;
    }
    const dailyByPlatform: Record<string, Array<{ day: string; count: number }>> = {};
    for (const [platform, daysData] of Object.entries(dailyMap)) {
      dailyByPlatform[platform] = Object.entries(daysData)
        .map(([day, count]) => ({ day, count }))
        .sort((a, b) => b.day.localeCompare(a.day));
    }

    // Calculate recent bid metrics
    const recentBids = (recentBidsRes.data || []).map(r => r.bid_count).filter(b => b != null).sort((a, b) => a - b);
    const recentBidSum = recentBids.reduce((s, b) => s + b, 0);
    const currentBidAvg = recentBids.length > 0 ? recentBidSum / recentBids.length : 0;

    // Calculate historical bid metrics
    const historicalBids = (historicalBidsRes.data || []).map(r => r.bid_count).filter(b => b != null);
    const historicalBidSum = historicalBids.reduce((s, b) => s + b, 0);
    const historicalBidAvg = historicalBids.length > 0 ? historicalBidSum / historicalBids.length : currentBidAvg || 1;

    const bidRatio = historicalBidAvg > 0 ? currentBidAvg / historicalBidAvg : 1;

    // Calculate reserve/sell-through metrics
    let soldCount = 0;
    let endedCount = 0;
    let unsoldCount = 0;
    for (const row of completedRes.data || []) {
      if (row.listing_status === "sold") soldCount++;
      else if (row.listing_status === "ended") endedCount++;
      else if (row.listing_status === "unsold") unsoldCount++;
    }
    const totalCompleted = soldCount + endedCount + unsoldCount;
    const sellThroughRate = totalCompleted > 0 ? soldCount / totalCompleted : 0;

    // Calculate weekly price trends
    const weekMap: Record<string, { total: number; count: number }> = {};
    for (const row of soldListingsRes.data || []) {
      if (!row.end_date || row.final_price == null || Number(row.final_price) <= 0) continue;
      const date = new Date(row.end_date);
      const startOfWeek = new Date(date);
      startOfWeek.setDate(date.getDate() - date.getDay());
      const weekKey = startOfWeek.toISOString().slice(0, 10);
      if (!weekMap[weekKey]) weekMap[weekKey] = { total: 0, count: 0 };
      weekMap[weekKey].total += Number(row.final_price);
      weekMap[weekKey].count++;
    }
    const weeklyPrices = Object.entries(weekMap)
      .map(([week, stats]) => ({
        week,
        avg_price: Math.round(stats.total / stats.count),
        sales_count: stats.count,
      }))
      .sort((a, b) => b.week.localeCompare(a.week))
      .slice(0, 8);

    // Calculate price direction
    let priceDirection = 0;
    if (weeklyPrices.length >= 2) {
      const recent = weeklyPrices[0]?.avg_price || 0;
      const older = weeklyPrices[Math.min(3, weeklyPrices.length - 1)]?.avg_price || 1;
      priceDirection = older > 0 ? (recent - older) / older : 0;
    }

    // Calculate hourly activity
    const hourMap: Record<number, number> = {};
    for (let h = 0; h < 24; h++) hourMap[h] = 0;
    for (const row of endedListingsRes.data || []) {
      if (!row.end_date) continue;
      const hour = new Date(row.end_date).getUTCHours();
      hourMap[hour]++;
    }
    const hourlyDistribution = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      endings: hourMap[hour],
    }));
    const sortedHours = [...hourlyDistribution].sort((a, b) => b.endings - a.endings);
    const peakHours = sortedHours.slice(0, 3).map(h => h.hour);

    // Get tier data - need to fetch vehicles separately
    const vehicleIds = [...new Set((tierListingsRes.data || []).map(l => l.vehicle_id).filter(Boolean))];
    let tierData: Array<{ tier: number; auction_count: number; avg_bids: number; avg_final_price: number; weight: number }> = [];

    if (vehicleIds.length > 0) {
      const { data: vehicles } = await supabase
        .from("vehicles")
        .select("id, analysis_tier")
        .in("id", vehicleIds.slice(0, 1000))
        .not("analysis_tier", "is", null);

      const tierLookup: Record<string, number> = {};
      for (const v of vehicles || []) {
        tierLookup[v.id] = v.analysis_tier;
      }

      const tierMap: Record<number, { count: number; totalBids: number; totalPrice: number; bidRecords: number; priceRecords: number }> = {};
      for (const listing of tierListingsRes.data || []) {
        const tier = tierLookup[listing.vehicle_id];
        if (tier == null) continue;
        if (!tierMap[tier]) {
          tierMap[tier] = { count: 0, totalBids: 0, totalPrice: 0, bidRecords: 0, priceRecords: 0 };
        }
        tierMap[tier].count++;
        if (listing.bid_count != null) {
          tierMap[tier].totalBids += listing.bid_count;
          tierMap[tier].bidRecords++;
        }
        if (listing.final_price != null) {
          tierMap[tier].totalPrice += Number(listing.final_price);
          tierMap[tier].priceRecords++;
        }
      }

      tierData = Object.entries(tierMap)
        .map(([tier, stats]) => ({
          tier: Number(tier),
          auction_count: stats.count,
          avg_bids: stats.bidRecords > 0 ? Number((stats.totalBids / stats.bidRecords).toFixed(1)) : 0,
          avg_final_price: stats.priceRecords > 0 ? Math.round(stats.totalPrice / stats.priceRecords) : 0,
          weight: TIER_WEIGHTS[Number(tier)] || 1.0,
        }))
        .sort((a, b) => a.tier - b.tier);
    }

    // Calculate tier-weighted bid average
    let tierWeightedBidScore = 0;
    let totalWeight = 0;
    for (const row of tierData) {
      tierWeightedBidScore += row.avg_bids * row.weight * row.auction_count;
      totalWeight += row.weight * row.auction_count;
    }
    const weightedAvgBids = totalWeight > 0 ? tierWeightedBidScore / totalWeight : currentBidAvg;

    // Calculate sentiment score (0-100)
    const bidScore = Math.min(100, Math.max(0, bidRatio * 50));
    const sellScore = sellThroughRate * 100;
    const priceScore = Math.min(100, Math.max(0, 50 + priceDirection * 100));
    const sentimentScore = Math.round(bidScore * 0.4 + sellScore * 0.3 + priceScore * 0.3);

    // Determine sentiment label
    let sentimentLabel: "hot" | "warm" | "neutral" | "cool" | "soft";
    if (sentimentScore >= 70) sentimentLabel = "hot";
    else if (sentimentScore >= 55) sentimentLabel = "warm";
    else if (sentimentScore >= 45) sentimentLabel = "neutral";
    else if (sentimentScore >= 30) sentimentLabel = "cool";
    else sentimentLabel = "soft";

    const result = {
      generated_at: new Date().toISOString(),
      lookback_days: days,
      source_leaderboard: sourceLeaderboard,
      daily_activity_by_platform: dailyByPlatform,
      market_sentiment: {
        score: sentimentScore,
        label: sentimentLabel,
        components: {
          bid_ratio: Number(bidRatio.toFixed(2)),
          bid_score: Math.round(bidScore),
          sell_through_rate: Number((sellThroughRate * 100).toFixed(1)),
          sell_score: Math.round(sellScore),
          price_direction: Number((priceDirection * 100).toFixed(1)),
          price_score: Math.round(priceScore),
        },
        current_metrics: {
          avg_bids: Number(currentBidAvg.toFixed(1)),
          historical_avg_bids: Number(historicalBidAvg.toFixed(1)),
          tier_weighted_avg_bids: Number(weightedAvgBids.toFixed(1)),
          sold_count: soldCount,
          unsold_count: endedCount + unsoldCount,
        },
        weekly_price_trend: weeklyPrices,
      },
      daily_activity: {
        hourly_distribution: hourlyDistribution,
        peak_hours: peakHours,
        total_recent_endings: hourlyDistribution.reduce((s, h) => s + h.endings, 0),
      },
      tier_weighted_data: tierData,
    };

    return new Response(JSON.stringify(result, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e: any) {
    console.error("Error in auction-trends-stats:", e);
    return new Response(JSON.stringify({ error: e.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
