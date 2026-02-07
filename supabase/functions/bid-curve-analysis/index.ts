/**
 * BID CURVE ANALYSIS
 *
 * Three modes:
 * - vehicle: full bid timeline for one auction
 * - aggregate: average bid curve shape for a make/model segment
 * - bidder_profile: a bidder's history (win rate, preferred makes, avg bid)
 *
 * POST /functions/v1/bid-curve-analysis
 * Body: {
 *   "mode": "vehicle" | "aggregate" | "bidder_profile",
 *   // vehicle mode:
 *   "vehicle_id": "uuid",
 *   // aggregate mode:
 *   "make"?: string, "model"?: string, "year_min"?: number, "year_max"?: number,
 *   // bidder_profile mode:
 *   "bidder_username": string
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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
    const mode = body.mode || "vehicle";

    let result: any;

    switch (mode) {
      case "vehicle":
        result = await vehicleMode(supabase, body);
        break;
      case "aggregate":
        result = await aggregateMode(supabase, body);
        break;
      case "bidder_profile":
        result = await bidderProfileMode(supabase, body);
        break;
      default:
        return new Response(
          JSON.stringify({ error: `Unknown mode: ${mode}. Use vehicle, aggregate, or bidder_profile` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    return new Response(JSON.stringify({ success: true, mode, ...result }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[bid-curve-analysis] Error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/**
 * Vehicle mode: full bid timeline for one auction
 */
async function vehicleMode(supabase: any, body: any) {
  const vehicleId = body.vehicle_id;
  if (!vehicleId) throw new Error("vehicle_id is required for vehicle mode");

  // Get vehicle info
  const { data: vehicle, error: vErr } = await supabase
    .from("vehicles")
    .select("id, year, make, model, sale_price, winning_bid, high_bid")
    .eq("id", vehicleId)
    .single();

  if (vErr) throw vErr;

  // Get all bids for this vehicle, ordered by time
  const { data: bids, error: bErr } = await supabase
    .from("bat_bids")
    .select(
      "id, bid_amount, bid_timestamp, bat_username, is_winning_bid, is_final_bid"
    )
    .eq("vehicle_id", vehicleId)
    .order("bid_timestamp", { ascending: true });

  if (bErr) throw bErr;

  if (!bids || bids.length === 0) {
    return { vehicle, bids: [], summary: { bid_count: 0 } };
  }

  // Compute bid curve metrics
  const amounts = bids.map((b: any) => Number(b.bid_amount));
  const uniqueBidders = new Set(bids.map((b: any) => b.bat_username)).size;
  const openingBid = amounts[0];
  const finalBid = amounts[amounts.length - 1];
  const bidRange = finalBid - openingBid;

  // Time analysis
  const firstTime = new Date(bids[0].bid_timestamp).getTime();
  const lastTime = new Date(bids[bids.length - 1].bid_timestamp).getTime();
  const durationHours = (lastTime - firstTime) / (1000 * 60 * 60);

  // Snipe analysis (bids in last hour)
  const lastHourThreshold = lastTime - 60 * 60 * 1000;
  const snipeBids = bids.filter(
    (b: any) => new Date(b.bid_timestamp).getTime() >= lastHourThreshold
  );
  const snipePremium =
    snipeBids.length > 1
      ? Number(snipeBids[snipeBids.length - 1].bid_amount) -
        Number(snipeBids[0].bid_amount)
      : 0;

  // Bid velocity (bids per hour)
  const velocity = durationHours > 0 ? bids.length / durationHours : bids.length;

  return {
    vehicle,
    bid_count: bids.length,
    bids: bids.map((b: any) => ({
      amount: Number(b.bid_amount),
      timestamp: b.bid_timestamp,
      username: b.bat_username,
      is_winning: b.is_winning_bid,
    })),
    summary: {
      bid_count: bids.length,
      unique_bidders: uniqueBidders,
      opening_bid: openingBid,
      final_bid: finalBid,
      bid_range: bidRange,
      appreciation_pct:
        openingBid > 0
          ? Math.round(((finalBid - openingBid) / openingBid) * 100 * 10) / 10
          : null,
      duration_hours: Math.round(durationHours * 10) / 10,
      velocity_bids_per_hour: Math.round(velocity * 10) / 10,
      snipe_bids_last_hour: snipeBids.length,
      snipe_premium: snipePremium,
    },
  };
}

/**
 * Aggregate mode: average bid curve shape for a segment
 */
async function aggregateMode(supabase: any, body: any) {
  const conditions: string[] = ["b.vehicle_id = v.id", "v.deleted_at IS NULL"];

  if (body.make) {
    conditions.push(
      `UPPER(v.make) = '${body.make.toUpperCase().replace(/'/g, "''")}'`
    );
  }
  if (body.model) {
    conditions.push(
      `v.model ILIKE '%${body.model.replace(/'/g, "''")}%'`
    );
  }
  if (body.year_min) {
    conditions.push(`v.year >= ${parseInt(body.year_min)}`);
  }
  if (body.year_max) {
    conditions.push(`v.year <= ${parseInt(body.year_max)}`);
  }

  const whereClause = conditions.join(" AND ");

  // Aggregate bid curve stats — sample vehicles that have bids for performance
  const vConditions = conditions.filter(c => !c.startsWith('b.')).join(' AND ');
  const { data: stats, error: sErr } = await supabase.rpc("execute_sql", {
    query: `WITH sampled AS (SELECT DISTINCT b.vehicle_id FROM bat_bids b JOIN vehicles v ON b.vehicle_id = v.id WHERE ${vConditions} LIMIT 1000), vehicle_bids AS (SELECT b.vehicle_id, count(*) AS bid_count, count(DISTINCT b.bat_username) AS unique_bidders, min(b.bid_amount) AS opening_bid, max(b.bid_amount) AS final_bid, CASE WHEN min(b.bid_amount) > 0 THEN (max(b.bid_amount) - min(b.bid_amount)) / min(b.bid_amount) * 100 ELSE 0 END AS appreciation_pct, EXTRACT(EPOCH FROM max(b.bid_timestamp) - min(b.bid_timestamp)) / 3600 AS duration_hours FROM bat_bids b WHERE b.vehicle_id IN (SELECT vehicle_id FROM sampled) GROUP BY b.vehicle_id HAVING count(*) >= 3) SELECT count(*) AS auction_count, ROUND(avg(bid_count)::numeric, 1) AS avg_bids, ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY bid_count)::numeric, 0) AS median_bids, ROUND(avg(unique_bidders)::numeric, 1) AS avg_unique_bidders, ROUND(avg(opening_bid)::numeric, 0) AS avg_opening_bid, ROUND(avg(final_bid)::numeric, 0) AS avg_final_bid, ROUND(avg(appreciation_pct)::numeric, 1) AS avg_appreciation_pct, ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY appreciation_pct)::numeric, 1) AS median_appreciation_pct, ROUND(avg(duration_hours)::numeric, 1) AS avg_duration_hours, ROUND(avg(bid_count / GREATEST(duration_hours, 0.1))::numeric, 1) AS avg_velocity FROM vehicle_bids`,
  });

  if (sErr) throw sErr;

  // Price tier breakdown
  const { data: tiers, error: tErr } = await supabase.rpc("execute_sql", {
    query: `WITH sampled AS (SELECT DISTINCT b.vehicle_id FROM bat_bids b JOIN vehicles v ON b.vehicle_id = v.id WHERE ${vConditions} LIMIT 1000), vehicle_bids AS (SELECT b.vehicle_id, max(b.bid_amount) AS final_bid, count(*) AS bid_count, count(DISTINCT b.bat_username) AS unique_bidders FROM bat_bids b WHERE b.vehicle_id IN (SELECT vehicle_id FROM sampled) GROUP BY b.vehicle_id HAVING count(*) >= 3) SELECT CASE WHEN final_bid < 10000 THEN 'under_10k' WHEN final_bid < 25000 THEN '10k_25k' WHEN final_bid < 50000 THEN '25k_50k' WHEN final_bid < 100000 THEN '50k_100k' ELSE 'over_100k' END AS price_tier, count(*) AS auction_count, ROUND(avg(bid_count)::numeric, 1) AS avg_bids, ROUND(avg(unique_bidders)::numeric, 1) AS avg_bidders, ROUND(avg(final_bid)::numeric, 0) AS avg_final_price FROM vehicle_bids GROUP BY 1 ORDER BY avg_final_price`,
  });

  if (tErr) throw tErr;

  return {
    filters: {
      make: body.make || null,
      model: body.model || null,
      year_min: body.year_min || null,
      year_max: body.year_max || null,
    },
    aggregate: stats?.[0] ?? {},
    price_tiers: tiers ?? [],
  };
}

/**
 * Bidder profile mode: a bidder's history
 */
async function bidderProfileMode(supabase: any, body: any) {
  const username = body.bidder_username;
  if (!username) throw new Error("bidder_username is required for bidder_profile mode");

  const safeUsername = username.replace(/'/g, "''");

  const { data: profile, error: pErr } = await supabase.rpc("execute_sql", {
    query: `
      WITH bidder_activity AS (
        SELECT
          b.vehicle_id,
          b.bat_username,
          b.bid_amount,
          b.bid_timestamp,
          b.is_winning_bid,
          v.year,
          v.make,
          v.model,
          v.sale_price
        FROM bat_bids b
        JOIN vehicles v ON b.vehicle_id = v.id AND v.deleted_at IS NULL
        WHERE b.bat_username = '${safeUsername}'
      )
      SELECT
        bat_username AS username,
        count(DISTINCT vehicle_id) AS auctions_participated,
        count(*) AS total_bids,
        count(DISTINCT vehicle_id) FILTER (WHERE is_winning_bid = true) AS auctions_won,
        ROUND(
          count(DISTINCT vehicle_id) FILTER (WHERE is_winning_bid = true)::numeric /
          GREATEST(count(DISTINCT vehicle_id), 1) * 100, 1
        ) AS win_rate_pct,
        ROUND(avg(bid_amount)::numeric, 0) AS avg_bid_amount,
        ROUND(max(bid_amount)::numeric, 0) AS max_bid,
        ROUND(min(bid_amount)::numeric, 0) AS min_bid,
        min(bid_timestamp) AS first_bid_date,
        max(bid_timestamp) AS last_bid_date
      FROM bidder_activity
      GROUP BY bat_username
    `,
  });

  if (pErr) throw pErr;

  // Preferred makes
  const { data: makes, error: mErr } = await supabase.rpc("execute_sql", {
    query: `
      SELECT
        v.make,
        count(DISTINCT b.vehicle_id) AS auction_count,
        ROUND(avg(b.bid_amount)::numeric, 0) AS avg_bid
      FROM bat_bids b
      JOIN vehicles v ON b.vehicle_id = v.id AND v.deleted_at IS NULL
      WHERE b.bat_username = '${safeUsername}'
      GROUP BY v.make
      ORDER BY auction_count DESC
      LIMIT 10
    `,
  });

  if (mErr) throw mErr;

  // Recent activity
  const { data: recent, error: rErr } = await supabase.rpc("execute_sql", {
    query: `
      SELECT
        b.vehicle_id,
        v.year,
        v.make,
        v.model,
        max(b.bid_amount) AS highest_bid,
        bool_or(b.is_winning_bid) AS won,
        max(b.bid_timestamp) AS last_bid_at
      FROM bat_bids b
      JOIN vehicles v ON b.vehicle_id = v.id AND v.deleted_at IS NULL
      WHERE b.bat_username = '${safeUsername}'
      GROUP BY b.vehicle_id, v.year, v.make, v.model
      ORDER BY last_bid_at DESC
      LIMIT 20
    `,
  });

  if (rErr) throw rErr;

  return {
    profile: profile?.[0] ?? {},
    preferred_makes: makes ?? [],
    recent_activity: recent ?? [],
  };
}
