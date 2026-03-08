/**
 * WIDGET: RERUN DECAY RATE
 *
 * Tracks price decay across multiple listing attempts for a vehicle.
 * Uses VIN-based matching to find vehicles that appeared at auction
 * multiple times, and calculates the cumulative decay per rerun.
 *
 * Historical benchmarks:
 * - BaT reruns: 8-12% decay per failed attempt
 * - Barrett-Jackson: 5-8% (different audience each event)
 * - Cars & Bids: 10-15% (high audience overlap with BaT)
 * - Cross-platform moves: 0-5% (fresh audience)
 *
 * POST /functions/v1/widget-rerun-decay
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
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

// ─── Platform decay benchmarks ──────────────────────────────────────

const PLATFORM_DECAY_RATES: Record<string, number> = {
  bat: 0.10,
  cars_and_bids: 0.12,
  "barrett-jackson": 0.06,
  mecum: 0.08,
  "rm-sothebys": 0.07,
  bonhams: 0.07,
  gooding: 0.06,
  default: 0.10,
};

const CROSS_PLATFORM_DECAY = 0.03; // Only 3% when moving to a new platform

// ─── Find all auction appearances ───────────────────────────────────

interface AuctionAppearance {
  id: string;
  auction_source: string;
  auction_end_date: string | null;
  auction_status: string | null;
  sale_price: number | null;
  asking_price: number | null;
  reserve_status: string | null;
  did_sell: boolean;
}

async function findAuctionHistory(
  supabase: any,
  vehicleId: string,
  vin: string | null,
  year: number | null,
  make: string | null,
  model: string | null
): Promise<AuctionAppearance[]> {
  const appearances: AuctionAppearance[] = [];

  // Strategy 1: VIN match (most reliable)
  if (vin && vin.length >= 11) {
    const { data } = await supabase
      .from("vehicles")
      .select(
        "id, auction_source, auction_end_date, auction_status, sale_price, asking_price, reserve_status"
      )
      .eq("vin", vin)
      .not("auction_end_date", "is", null)
      .order("auction_end_date", { ascending: true });

    if (data?.length) {
      for (const row of data) {
        const didSell =
          (row.sale_price > 0 && row.auction_status !== "ended") ||
          row.reserve_status === "no_reserve";
        appearances.push({ ...row, did_sell: didSell });
      }
    }
  }

  // Strategy 2: Check vehicle_events for this vehicle_id
  if (appearances.length <= 1) {
    const { data: listings } = await supabase
      .from("vehicle_events")
      .select(
        "id, source_platform, event_status, started_at, ended_at, final_price, buy_now_price, reserve_price"
      )
      .eq("vehicle_id", vehicleId)
      .order("started_at", { ascending: true });

    if (listings?.length) {
      for (const listing of listings) {
        appearances.push({
          id: listing.id,
          auction_source: listing.source_platform,
          auction_end_date: listing.ended_at ?? listing.started_at,
          auction_status: listing.event_status,
          sale_price: listing.final_price
            ? Number(listing.final_price)
            : null,
          asking_price: listing.buy_now_price
            ? Number(listing.buy_now_price)
            : null,
          reserve_status: null,
          did_sell: listing.event_status === "sold",
        });
      }
    }
  }

  // Deduplicate by id
  const seen = new Set<string>();
  return appearances.filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });
}

// ─── Compute segment decay benchmarks ───────────────────────────────

async function getSegmentDecayBenchmarks(
  supabase: any,
  era: string | null
): Promise<{
  avg_decay_per_rerun: number;
  sample_size: number;
}> {
  // Query vehicles with multiple appearances (by VIN)
  const eraFilter = era ? `AND era = '${era}'` : "";

  const query = `
    WITH multi_appearance AS (
      SELECT
        vin,
        COUNT(*) AS appearances,
        MAX(sale_price) FILTER (WHERE sale_price > 0) AS highest_price,
        MIN(sale_price) FILTER (WHERE sale_price > 0) AS lowest_price,
        ARRAY_AGG(sale_price ORDER BY auction_end_date) AS price_history
      FROM vehicles
      WHERE vin IS NOT NULL
        AND LENGTH(vin) >= 11
        AND auction_end_date IS NOT NULL
        AND auction_source IN ('bat', 'cars_and_bids', 'mecum', 'barrett-jackson')
        ${eraFilter}
      GROUP BY vin
      HAVING COUNT(*) >= 2
        AND COUNT(*) FILTER (WHERE sale_price > 0) >= 2
    )
    SELECT
      COUNT(*) AS sample_size,
      ROUND(AVG(
        CASE WHEN highest_price > 0
          THEN (highest_price - lowest_price)::numeric / highest_price * 100
          ELSE NULL
        END
      ), 1) AS avg_price_spread_pct,
      AVG(appearances) AS avg_appearances
    FROM multi_appearance
  `;

  const { data } = await supabase.rpc("execute_recovery_sql", {
    p_sql: query,
  });

  const row = Array.isArray(data) ? data[0] : data;

  if (!row || Number(row.sample_size) < 10) {
    return { avg_decay_per_rerun: 0.10, sample_size: 0 };
  }

  // Price spread divided by avg appearances gives approximate per-rerun decay
  const avgAppearances = Number(row.avg_appearances) || 2;
  const spreadPct = Number(row.avg_price_spread_pct) || 10;
  const perRerun = spreadPct / 100 / (avgAppearances - 1);

  return {
    avg_decay_per_rerun: Math.min(0.25, Math.max(0.03, perRerun)),
    sample_size: Number(row.sample_size),
  };
}

// ─── Main ───────────────────────────────────────────────────────────

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

    // Get vehicle
    const { data: vehicle, error: vErr } = await supabase
      .from("vehicles")
      .select(
        "id, vin, year, make, model, era, body_style, auction_source, sale_price, asking_price, reserve_status, auction_status, auction_end_date"
      )
      .eq("id", vehicle_id)
      .single();

    if (vErr || !vehicle) {
      return json(404, { error: "Vehicle not found" });
    }

    // Find all auction appearances
    const history = await findAuctionHistory(
      supabase,
      vehicle_id,
      vehicle.vin,
      vehicle.year,
      vehicle.make,
      vehicle.model
    );

    const listingCount = history.length;

    // If only one listing, this widget doesn't apply yet
    if (listingCount <= 1) {
      return json(200, {
        score: 95,
        severity: "ok",
        headline: "First listing attempt — no decay to track",
        details: {
          listing_count: listingCount,
          status: "first_listing",
          vehicle: {
            year: vehicle.year,
            make: vehicle.make,
            model: vehicle.model,
          },
        },
        reasons: ["First listing attempt — no decay to track"],
        confidence: 0.9,
        recommendations: [],
      });
    }

    // Analyze decay across appearances
    const failedListings = history.filter((h) => !h.did_sell);
    const soldListings = history.filter((h) => h.did_sell);
    const lastSold = soldListings.length > 0;

    // Calculate price trajectory
    const pricesWithValues = history.filter(
      (h) => (h.sale_price ?? 0) > 0 || (h.asking_price ?? 0) > 0
    );

    let cumulativeDecayPct = 0;
    let perRerunDecay = 0;
    const priceTrajectory: Array<{
      platform: string;
      date: string | null;
      price: number;
      status: string;
    }> = [];

    if (pricesWithValues.length >= 2) {
      const firstPrice =
        pricesWithValues[0].sale_price || pricesWithValues[0].asking_price || 0;
      const latestPrice =
        pricesWithValues[pricesWithValues.length - 1].sale_price ||
        pricesWithValues[pricesWithValues.length - 1].asking_price ||
        0;

      if (firstPrice > 0) {
        cumulativeDecayPct = Math.round(
          ((firstPrice - latestPrice) / firstPrice) * 100
        );
        perRerunDecay =
          cumulativeDecayPct / Math.max(1, pricesWithValues.length - 1);
      }

      for (const p of pricesWithValues) {
        priceTrajectory.push({
          platform: p.auction_source,
          date: p.auction_end_date,
          price: p.sale_price || p.asking_price || 0,
          status: p.did_sell ? "sold" : "unsold",
        });
      }
    }

    // Check if platforms changed (cross-platform = less decay)
    const platforms = [...new Set(history.map((h) => h.auction_source))];
    const isCrossPlatform = platforms.length > 1;

    // Get segment benchmarks
    const benchmarks = await getSegmentDecayBenchmarks(supabase, vehicle.era);

    // Use platform-specific or benchmark decay rate
    const lastPlatform =
      history[history.length - 1]?.auction_source ?? "default";
    const expectedDecayRate = isCrossPlatform
      ? CROSS_PLATFORM_DECAY
      : PLATFORM_DECAY_RATES[lastPlatform] ?? benchmarks.avg_decay_per_rerun;

    // Calculate floor price (if we have deal jacket data)
    const { data: dealJacket } = await supabase
      .from("deal_jackets")
      .select("acquisition_price, listing_fee")
      .eq("vehicle_id", vehicle_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const floorPrice = dealJacket
      ? (Number(dealJacket.acquisition_price) || 0) +
        (Number(dealJacket.listing_fee) || 0)
      : null;

    // Estimate reruns until floor
    let rerunsUntilFloor: number | null = null;
    const currentPrice =
      vehicle.asking_price || vehicle.sale_price || pricesWithValues[pricesWithValues.length - 1]?.price;

    if (floorPrice && currentPrice && currentPrice > floorPrice && expectedDecayRate > 0) {
      let projectedPrice = currentPrice;
      let reruns = 0;
      while (projectedPrice > floorPrice && reruns < 20) {
        projectedPrice *= 1 - expectedDecayRate;
        reruns++;
      }
      rerunsUntilFloor = reruns;
    }

    // Score: higher listing count = lower score
    let score: number;
    if (listingCount === 1) {
      score = 95;
    } else if (listingCount === 2 && !lastSold) {
      score = 55;
    } else if (listingCount === 2 && lastSold) {
      score = 80; // Sold on 2nd try is okay
    } else if (listingCount === 3) {
      score = 30;
    } else if (listingCount === 4) {
      score = 15;
    } else {
      score = 5;
    }

    // Adjust score up if cross-platform (less decay)
    if (isCrossPlatform && score < 80) {
      score = Math.min(score + 15, 80);
    }

    // Severity
    let severity: string;
    if (score >= 70) severity = "ok";
    else if (score >= 40) severity = "warning";
    else severity = "critical";

    // Headline
    let headline: string;
    if (listingCount === 1) {
      headline = "First listing — no rerun decay";
    } else if (cumulativeDecayPct > 0) {
      headline = `Listing attempt #${listingCount} — ${cumulativeDecayPct}% cumulative decay from original`;
    } else {
      headline = `Listing attempt #${listingCount} — price trajectory tracking`;
    }

    // Recommendations
    const recommendations: Array<{
      action: string;
      priority: number;
      rationale: string;
    }> = [];

    if (listingCount >= 3) {
      recommendations.push({
        action: `Drop reserve or go no-reserve`,
        priority: 1,
        rationale: `${listingCount - 1} failed attempts signal reserve is above market. No-reserve listings sell at 15% higher hammer than reserve listings historically.`,
      });

      recommendations.push({
        action: "Wait 4-6 months before relisting",
        priority: 2,
        rationale:
          "Market memory fades. Buyers who saw prior failed listings discount more aggressively on immediate relist.",
      });
    }

    if (listingCount >= 2 && !isCrossPlatform) {
      recommendations.push({
        action: "Try a different platform",
        priority: isCrossPlatform ? 3 : 1,
        rationale: `Cross-platform moves show only ${Math.round(CROSS_PLATFORM_DECAY * 100)}% decay vs ${Math.round(expectedDecayRate * 100)}% same-platform. Fresh audience reduces rerun stigma.`,
      });
    }

    if (listingCount >= 2 && perRerunDecay > 15) {
      recommendations.push({
        action: "Invest in presentation before relisting",
        priority: 2,
        rationale:
          "High per-rerun decay suggests presentation or pricing issue. Professional photos and detailing can offset decay.",
      });
    }

    return json(200, {
      score,
      severity,
      headline,
      details: {
        listing_count: listingCount,
        failed_listings: failedListings.length,
        cumulative_decay_pct: cumulativeDecayPct,
        per_rerun_decay_pct: Math.round(perRerunDecay * 10) / 10,
        expected_decay_rate: Math.round(expectedDecayRate * 100),
        is_cross_platform: isCrossPlatform,
        platforms_used: platforms,
        price_trajectory: priceTrajectory,
        floor_price: floorPrice,
        reruns_until_floor: rerunsUntilFloor,
        segment_benchmark: {
          avg_decay_per_rerun: Math.round(benchmarks.avg_decay_per_rerun * 100),
          sample_size: benchmarks.sample_size,
        },
        vehicle: {
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          vin: vehicle.vin,
          current_ask: vehicle.asking_price,
          last_sale: vehicle.sale_price,
        },
      },
      reasons: [headline],
      confidence: benchmarks.sample_size >= 50 ? 0.8 : 0.55,
      recommendations,
    });
  } catch (err: any) {
    console.error("Widget rerun-decay error:", err);
    return json(500, { error: err.message });
  }
});
