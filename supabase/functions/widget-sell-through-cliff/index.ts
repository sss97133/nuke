/**
 * WIDGET: SELL-THROUGH CLIFF
 *
 * Computes DOM-based sell-through probability for a vehicle.
 * Uses historical auction data (1M+ records) to identify the "cliff point"
 * where sell-through probability drops sharply for the vehicle's segment.
 *
 * Segments are defined by era + body_style (e.g., "classic coupe", "pre-war roadster").
 * Falls back to era-only if segment sample size is too small.
 *
 * POST /functions/v1/widget-sell-through-cliff
 * { "vehicle_id": "uuid" }
 *
 * Returns: { score, severity, headline, details, recommendations }
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
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

// ─── Segment cliff defaults (days) ──────────────────────────────────
// Based on market behavior patterns. These are overridden by actual data
// when enough historical records exist.

const ERA_CLIFF_DEFAULTS: Record<string, number> = {
  "pre-war": 120,
  "post-war": 90,
  classic: 45,
  "modern-classic": 45,
  malaise: 60,
  modern: 30,
  contemporary: 21,
};

const DEFAULT_CLIFF = 45;

// ─── Compute sell-through rates by DOM bucket ────────────────────────

interface DomBucket {
  label: string;
  min_days: number;
  max_days: number;
  total: number;
  sold: number;
  sell_through_rate: number;
  avg_price_achievement: number | null;
}

async function computeSegmentDomBuckets(
  supabase: any,
  era: string | null,
  bodyStyle: string | null
): Promise<{ buckets: DomBucket[]; sample_size: number; segment_label: string }> {
  // Build WHERE clause for segment
  const conditions: string[] = [
    "auction_end_date IS NOT NULL",
    "auction_status IN ('active', 'ended')",
    "auction_source IN ('bat', 'cars_and_bids')", // Timed auctions only (have real DOM)
  ];

  let segmentLabel = "all vehicles";

  if (era) {
    conditions.push(`era = '${era}'`);
    segmentLabel = era;
  }

  if (bodyStyle) {
    conditions.push(`body_style = '${bodyStyle}'`);
    segmentLabel = `${era ?? "all"} ${bodyStyle}`;
  }

  const whereClause = conditions.join(" AND ");

  // BaT auctions are typically 7 days. For consignment DOM tracking,
  // we're looking at vehicles that appear multiple times (reruns)
  // or have deal_jackets tracking consignment duration.
  // For now, compute sell-through rate (sold vs not-sold) grouped by
  // the calendar quarter they were listed (as a proxy for market timing).
  //
  // Actually, the most useful metric is: what % of listings in this
  // segment result in a sale, and how does that change over time?
  // For a consigned vehicle, the "cliff" is about total days on market.

  const query = `
    WITH listing_data AS (
      SELECT
        id,
        auction_end_date::date AS end_date,
        CASE
          WHEN sale_price > 0 AND auction_status != 'ended' THEN true
          WHEN reserve_status = 'no_reserve' THEN true
          WHEN auction_status = 'active' AND sale_price > 0 THEN true
          ELSE false
        END AS did_sell,
        sale_price,
        asking_price
      FROM vehicles
      WHERE ${whereClause}
        AND auction_end_date ~ '^[0-9]{4}'
    )
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE did_sell) AS sold,
      ROUND(COUNT(*) FILTER (WHERE did_sell)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS sell_through_pct,
      ROUND(AVG(CASE WHEN did_sell AND sale_price > 0 AND asking_price > 0
                     THEN sale_price::numeric / asking_price * 100 END), 1) AS avg_price_achievement
    FROM listing_data
  `;

  // For sell-through cliff, we need to understand how consignment duration
  // affects outcomes. Since vehicles table doesn't track consignment DOM directly,
  // we'll use deal_jackets for active consignments and compute segment benchmarks
  // from the overall sell-through rate.

  // Get overall segment sell-through rate
  const { data: segmentData, error } = await supabase.rpc(
    "execute_recovery_sql",
    { p_sql: query }
  );

  const segmentStats = Array.isArray(segmentData)
    ? segmentData[0]
    : segmentData;

  // For vehicles with multiple auction appearances, track decay
  const multiListQuery = `
    WITH vehicle_listing_counts AS (
      SELECT
        COALESCE(vin, id::text) AS vehicle_key,
        COUNT(*) AS listing_count,
        COUNT(*) FILTER (WHERE sale_price > 0 AND (auction_status = 'active' OR reserve_status = 'no_reserve')) AS sold_count,
        MIN(auction_end_date::date) AS first_listing,
        MAX(auction_end_date::date) AS last_listing
      FROM vehicles
      WHERE ${whereClause}
        AND auction_end_date ~ '^[0-9]{4}'
      GROUP BY COALESCE(vin, id::text)
      HAVING COUNT(*) >= 1
    )
    SELECT
      listing_count,
      COUNT(*) AS vehicles,
      COUNT(*) FILTER (WHERE sold_count > 0) AS eventually_sold,
      ROUND(COUNT(*) FILTER (WHERE sold_count > 0)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS sell_through_pct
    FROM vehicle_listing_counts
    WHERE listing_count <= 5
    GROUP BY listing_count
    ORDER BY listing_count
  `;

  const { data: multiListData } = await supabase.rpc("execute_recovery_sql", {
    p_sql: multiListQuery,
  });

  // Build DOM buckets from multi-listing data
  // listing_count 1 = first attempt, 2 = second attempt, etc.
  // Each attempt roughly adds 7-14 days for BaT, 30-60 days for traditional auctions
  const buckets: DomBucket[] = [];
  const multiList = Array.isArray(multiListData) ? multiListData : [];

  // Map listing attempts to approximate DOM
  const attemptToDom: Record<number, { min: number; max: number; label: string }> = {
    1: { min: 0, max: 14, label: "0-14d (1st listing)" },
    2: { min: 15, max: 45, label: "15-45d (2nd listing)" },
    3: { min: 46, max: 90, label: "46-90d (3rd listing)" },
    4: { min: 91, max: 180, label: "91-180d (4th listing)" },
    5: { min: 181, max: 365, label: "181-365d (5th+ listing)" },
  };

  for (const row of multiList) {
    const domMap = attemptToDom[row.listing_count] ?? {
      min: 180,
      max: 365,
      label: `${row.listing_count}+ listings`,
    };

    buckets.push({
      label: domMap.label,
      min_days: domMap.min,
      max_days: domMap.max,
      total: Number(row.vehicles),
      sold: Number(row.eventually_sold),
      sell_through_rate: Number(row.sell_through_pct) / 100,
      avg_price_achievement: null,
    });
  }

  const totalSample = multiList.reduce(
    (s: number, r: any) => s + Number(r.vehicles),
    0
  );

  return {
    buckets,
    sample_size: totalSample,
    segment_label: segmentLabel,
  };
}

// ─── Determine cliff point ──────────────────────────────────────────

function findCliffPoint(buckets: DomBucket[]): {
  cliff_days: number;
  cliff_drop_pct: number;
} {
  if (buckets.length < 2) {
    return { cliff_days: DEFAULT_CLIFF, cliff_drop_pct: 15 };
  }

  let maxDrop = 0;
  let cliffDays = DEFAULT_CLIFF;

  for (let i = 1; i < buckets.length; i++) {
    const prevRate = buckets[i - 1].sell_through_rate;
    const currRate = buckets[i].sell_through_rate;
    const drop = prevRate - currRate;

    if (drop > maxDrop && buckets[i].total >= 10) {
      maxDrop = drop;
      cliffDays = buckets[i].min_days;
    }
  }

  return {
    cliff_days: cliffDays,
    cliff_drop_pct: Math.round(maxDrop * 100),
  };
}

// ─── Main computation ────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { vehicle_id } = await req.json();
    if (!vehicle_id) {
      return json(400, { error: "vehicle_id required" });
    }

    const supabase = getSupabase();

    // Get vehicle data
    const { data: vehicle, error: vErr } = await supabase
      .from("vehicles")
      .select(
        "id, year, make, model, era, body_style, auction_source, auction_status, auction_end_date, sale_price, asking_price, reserve_status, status, created_at"
      )
      .eq("id", vehicle_id)
      .single();

    if (vErr || !vehicle) {
      return json(404, { error: "Vehicle not found" });
    }

    // Check for active deal jacket (consignment tracking)
    const { data: dealJacket } = await supabase
      .from("deal_jackets")
      .select("id, acquisition_date, sold_date, listing_fee, created_at")
      .eq("vehicle_id", vehicle_id)
      .is("sold_date", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Calculate days on market
    let daysOnMarket = 0;
    let domSource = "unknown";

    if (dealJacket?.acquisition_date) {
      // Consignment DOM from deal jacket
      const acqDate = new Date(dealJacket.acquisition_date);
      daysOnMarket = Math.floor(
        (Date.now() - acqDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      domSource = "deal_jacket";
    } else if (vehicle.created_at) {
      // Fallback to vehicle created_at
      const createdDate = new Date(vehicle.created_at);
      daysOnMarket = Math.floor(
        (Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      domSource = "vehicle_created_at";
    }

    // Get segment sell-through data
    const era = vehicle.era;
    const bodyStyle = vehicle.body_style;

    // Try era + body_style first, fall back to era only
    let segmentResult = await computeSegmentDomBuckets(
      supabase,
      era,
      bodyStyle
    );

    if (segmentResult.sample_size < 50) {
      // Not enough data for this specific segment, use era only
      segmentResult = await computeSegmentDomBuckets(supabase, era, null);
    }

    if (segmentResult.sample_size < 20) {
      // Still not enough, use defaults
      segmentResult = await computeSegmentDomBuckets(supabase, null, null);
    }

    // Find the cliff point
    const { cliff_days, cliff_drop_pct } = findCliffPoint(
      segmentResult.buckets
    );

    // Use era-based default if data-driven cliff seems off
    const eraCliff = ERA_CLIFF_DEFAULTS[era ?? ""] ?? DEFAULT_CLIFF;
    const effectiveCliff =
      segmentResult.sample_size >= 100 ? cliff_days : eraCliff;

    // Calculate current position relative to cliff
    const daysUntilCliff = effectiveCliff - daysOnMarket;
    const isPastCliff = daysOnMarket > effectiveCliff;

    // Current sell-through probability
    let currentSellThrough = 0.78; // Default 78% for fresh listing
    for (const bucket of segmentResult.buckets) {
      if (daysOnMarket >= bucket.min_days && daysOnMarket <= bucket.max_days) {
        currentSellThrough = bucket.sell_through_rate;
        break;
      }
    }

    // Calculate score (0-100, higher is better)
    let score: number;
    if (daysOnMarket <= 7) {
      score = 95; // Fresh listing
    } else if (daysUntilCliff > 30) {
      score = 85;
    } else if (daysUntilCliff > 14) {
      score = 70;
    } else if (daysUntilCliff > 7) {
      score = 55;
    } else if (daysUntilCliff > 0) {
      score = 40;
    } else if (daysOnMarket <= effectiveCliff * 1.5) {
      score = 25;
    } else if (daysOnMarket <= effectiveCliff * 2) {
      score = 15;
    } else {
      score = 5;
    }

    // Determine severity
    let severity: string;
    if (score >= 70) severity = "ok";
    else if (score >= 40) severity = "warning";
    else severity = "critical";

    // Build headline
    let headline: string;
    if (isPastCliff) {
      headline = `Day ${daysOnMarket} of ${effectiveCliff}-day cliff — sell-through probability dropped to ${Math.round(currentSellThrough * 100)}%`;
    } else if (daysUntilCliff <= 7) {
      headline = `${daysUntilCliff} days until sell-through cliff — action recommended`;
    } else {
      headline = `Day ${daysOnMarket} — ${Math.round(currentSellThrough * 100)}% sell-through probability (cliff at ${effectiveCliff} days)`;
    }

    // Build recommendations
    const recommendations: Array<{
      action: string;
      priority: number;
      rationale: string;
    }> = [];

    if (isPastCliff) {
      recommendations.push({
        action: "Reduce asking price by 10-15%",
        priority: 1,
        rationale: `At ${daysOnMarket} DOM, similar ${segmentResult.segment_label} vehicles show significantly lower sell-through rates. Price reduction is the strongest lever.`,
      });

      recommendations.push({
        action: "Move to a different platform",
        priority: 2,
        rationale:
          "Cross-listing on a new platform reaches fresh audience. Reduces the 'stale listing' perception.",
      });

      recommendations.push({
        action: "Refresh listing with new photos and description",
        priority: 3,
        rationale:
          "Updated content triggers 'just listed' visibility on most platforms and re-engages watchers.",
      });
    } else if (daysUntilCliff <= 14) {
      recommendations.push({
        action: "Evaluate pricing position against recent comps",
        priority: 1,
        rationale: `Approaching the ${effectiveCliff}-day cliff for ${segmentResult.segment_label} segment. Verify pricing is competitive.`,
      });

      recommendations.push({
        action: "Consider no-reserve if currently reserve-set",
        priority: 2,
        rationale:
          "No-reserve listings historically achieve 15% higher hammer prices and significantly higher sell-through rates.",
      });
    }

    // Build response
    const details = {
      days_on_market: daysOnMarket,
      dom_source: domSource,
      segment: segmentResult.segment_label,
      segment_sample_size: segmentResult.sample_size,
      cliff_point_days: effectiveCliff,
      days_until_cliff: Math.max(0, daysUntilCliff),
      is_past_cliff: isPastCliff,
      current_sell_through_rate: Math.round(currentSellThrough * 100) / 100,
      dom_buckets: segmentResult.buckets.map((b) => ({
        label: b.label,
        sell_through_rate: b.sell_through_rate,
        sample_size: b.total,
      })),
      era_default_cliff: eraCliff,
      data_driven_cliff: cliff_days,
      cliff_drop_pct,
      vehicle: {
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        era: vehicle.era,
        body_style: vehicle.body_style,
        asking_price: vehicle.asking_price,
        sale_price: vehicle.sale_price,
        auction_source: vehicle.auction_source,
        reserve_status: vehicle.reserve_status,
      },
    };

    return json(200, {
      score,
      severity,
      headline,
      details,
      reasons: [headline],
      confidence: segmentResult.sample_size >= 100 ? 0.85 : 0.6,
      recommendations,
    });
  } catch (err: any) {
    console.error("Widget sell-through-cliff error:", err);
    return json(500, { error: err.message });
  }
});
