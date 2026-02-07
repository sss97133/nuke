/**
 * CALCULATE MARKET TRENDS
 * Aggregates sentiment, demand signals, and price trends from AI-analyzed comments.
 * Uses canonical makes (post-normalization) and removes limit truncation.
 *
 * POST /functions/v1/calculate-market-trends
 * Body: {
 *   "platform"?: string,  // default 'all'
 *   "make"?: string        // limit to specific make
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface MarketSignals {
  demand?: 'high' | 'moderate' | 'low';
  rarity?: 'rare' | 'moderate' | 'common';
  price_trend?: 'rising' | 'stable' | 'declining';
}

interface Sentiment {
  score?: number;
  overall?: string;
}

interface RawExtraction {
  market_signals?: MarketSignals;
  sentiment?: Sentiment;
  discussion_themes?: string[];
  community_concerns?: string[];
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

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const targetPlatform = body.platform || 'all';
    const targetMake = body.make || null;

    // Use execute_sql to avoid .limit() truncation — get ALL discoveries
    const makeFilter = targetMake
      ? `AND COALESCE(cm.canonical_name, v.make) = '${targetMake.replace(/'/g, "''")}'`
      : '';

    const { data: rows, error: discError } = await supabase.rpc('execute_sql', {
      query: `
        SELECT
          cd.vehicle_id,
          cd.raw_extraction,
          cd.sentiment_score AS discovery_sentiment_score,
          cd.overall_sentiment,
          v.year,
          COALESCE(cm.canonical_name, v.make) AS make,
          v.model,
          v.sale_price,
          v.discovery_source
        FROM comment_discoveries cd
        JOIN vehicles v ON cd.vehicle_id = v.id AND v.deleted_at IS NULL
        LEFT JOIN canonical_makes cm ON v.canonical_make_id = cm.id
        WHERE cd.raw_extraction IS NOT NULL
        ${makeFilter}
        ORDER BY cd.discovered_at DESC
      `
    });

    if (discError) throw discError;

    const discoveries = rows || [];
    console.log(`[calculate-market-trends] Processing ${discoveries.length} discoveries`);

    // Aggregate by make
    const byMake: Record<string, {
      count: number;
      demand: Record<string, number>;
      price_trend: Record<string, number>;
      rarity: Record<string, number>;
      sentiment_total: number;
      sentiment_count: number;
      prices: number[];
      themes: Record<string, number>;
      concerns: Record<string, number>;
      platforms: Record<string, number>;
    }> = {};

    discoveries.forEach((d: any) => {
      const make = d.make?.trim();
      if (!make) return;

      const raw: RawExtraction = typeof d.raw_extraction === 'string'
        ? JSON.parse(d.raw_extraction)
        : d.raw_extraction ?? {};
      const signals = raw.market_signals;
      const platform = d.discovery_source || 'unknown';

      if (!byMake[make]) {
        byMake[make] = {
          count: 0, demand: {}, price_trend: {}, rarity: {},
          sentiment_total: 0, sentiment_count: 0, prices: [],
          themes: {}, concerns: {}, platforms: {},
        };
      }

      const m = byMake[make];
      m.count++;
      m.platforms[platform] = (m.platforms[platform] || 0) + 1;

      if (signals?.demand) m.demand[signals.demand] = (m.demand[signals.demand] || 0) + 1;
      if (signals?.price_trend) m.price_trend[signals.price_trend] = (m.price_trend[signals.price_trend] || 0) + 1;
      if (signals?.rarity) m.rarity[signals.rarity] = (m.rarity[signals.rarity] || 0) + 1;

      // Use discovery-level sentiment score (more reliable)
      const sentScore = d.discovery_sentiment_score ?? raw.sentiment?.score;
      if (sentScore != null) {
        m.sentiment_total += Number(sentScore);
        m.sentiment_count++;
      }

      if (d.sale_price && d.sale_price > 0) m.prices.push(d.sale_price);

      (raw.discussion_themes || []).forEach((theme: string) => {
        m.themes[theme] = (m.themes[theme] || 0) + 1;
      });
      (raw.community_concerns || []).forEach((concern: string) => {
        m.concerns[concern] = (m.concerns[concern] || 0) + 1;
      });
    });

    // Set period_start for proper upsert deduplication
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    // Convert to market_trends records
    const trendRecords = Object.entries(byMake).map(([make, stats]) => {
      const total = stats.count;
      const prices = stats.prices.sort((a, b) => a - b);

      const topThemes = Object.entries(stats.themes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([t]) => t);
      const topConcerns = Object.entries(stats.concerns)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([c]) => c);

      return {
        make,
        model: null,
        platform: targetPlatform,
        vehicle_count: total,
        analysis_count: total,
        demand_high_pct: total > 0 ? Number(((stats.demand['high'] || 0) / total * 100).toFixed(2)) : null,
        demand_moderate_pct: total > 0 ? Number(((stats.demand['moderate'] || 0) / total * 100).toFixed(2)) : null,
        demand_low_pct: total > 0 ? Number(((stats.demand['low'] || 0) / total * 100).toFixed(2)) : null,
        price_rising_pct: total > 0 ? Number(((stats.price_trend['rising'] || 0) / total * 100).toFixed(2)) : null,
        price_stable_pct: total > 0 ? Number(((stats.price_trend['stable'] || 0) / total * 100).toFixed(2)) : null,
        price_declining_pct: total > 0 ? Number(((stats.price_trend['declining'] || 0) / total * 100).toFixed(2)) : null,
        rarity_rare_pct: total > 0 ? Number(((stats.rarity['rare'] || 0) / total * 100).toFixed(2)) : null,
        rarity_moderate_pct: total > 0 ? Number(((stats.rarity['moderate'] || 0) / total * 100).toFixed(2)) : null,
        rarity_common_pct: total > 0 ? Number(((stats.rarity['common'] || 0) / total * 100).toFixed(2)) : null,
        avg_sentiment_score: stats.sentiment_count > 0 ? Number((stats.sentiment_total / stats.sentiment_count).toFixed(2)) : null,
        sentiment_samples: stats.sentiment_count,
        avg_sale_price: prices.length > 0 ? Number((prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2)) : null,
        min_sale_price: prices.length > 0 ? prices[0] : null,
        max_sale_price: prices.length > 0 ? prices[prices.length - 1] : null,
        median_sale_price: prices.length > 0 ? prices[Math.floor(prices.length / 2)] : null,
        top_discussion_themes: topThemes.length > 0 ? topThemes : null,
        top_community_concerns: topConcerns.length > 0 ? topConcerns : null,
        period_start: periodStart,
        calculated_at: now.toISOString(),
      };
    });

    // Upsert to market_trends
    const { error: upsertError } = await supabase
      .from("market_trends")
      .upsert(trendRecords, {
        onConflict: 'make,model,platform,period_start',
        ignoreDuplicates: false
      });

    if (upsertError) throw upsertError;

    // Get hot makes for response
    const { data: hotMakes } = await supabase
      .from("market_trends")
      .select("make, analysis_count, demand_high_pct, avg_sentiment_score, avg_sale_price")
      .is("model", null)
      .eq("period_start", periodStart)
      .order("demand_high_pct", { ascending: false, nullsFirst: false })
      .limit(10);

    return new Response(JSON.stringify({
      success: true,
      makes_analyzed: Object.keys(byMake).length,
      total_discoveries: discoveries.length,
      records_upserted: trendRecords.length,
      period_start: periodStart,
      hot_makes: hotMakes,
    }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e: any) {
    console.error("[calculate-market-trends] Error:", e);
    return new Response(JSON.stringify({ error: e.message, stack: e.stack }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
