/**
 * WIDGET: TIME KILLS DEALS CLOCK
 *
 * Master aggregator that combines all sub-signals into a composite
 * deal health score. This is the "dashboard in a number" for any
 * active consignment or listing.
 *
 * Sub-signal weights:
 *   DOM / sell-through cliff:  0.25
 *   Engagement cooling:        0.20
 *   Price reductions:          0.15
 *   Seasonal factor:           0.10
 *   Competitive pressure:      0.10
 *   Rerun decay:               0.10
 *   Broker exposure:           0.10
 *
 * POST /functions/v1/widget-time-kills-deals
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

// ─── Sub-signal weights ─────────────────────────────────────────────

const WEIGHTS = {
  dom: 0.25,
  engagement: 0.2,
  price_reductions: 0.15,
  seasonal: 0.1,
  competition: 0.1,
  rerun_decay: 0.1,
  broker_exposure: 0.1,
};

// ─── Seasonal calendar (month -> multiplier for collector cars) ──────

const SEASONAL_SCORES: Record<number, number> = {
  1: 35, // Jan — slow
  2: 40, // Feb — slow
  3: 65, // Mar — warming up
  4: 80, // Apr — spring peak
  5: 85, // May — strong
  6: 75, // Jun — good
  7: 55, // Jul — summer lull
  8: 50, // Aug — slow
  9: 70, // Sep — auction season starts
  10: 75, // Oct — Scottsdale season builds
  11: 60, // Nov — tapering
  12: 40, // Dec — holiday slow
};

// ─── Sub-signal computations ────────────────────────────────────────

interface SubSignal {
  score: number; // 0-100
  status: string;
  weight: number;
}

async function computeDomSignal(
  supabase: any,
  vehicleId: string
): Promise<SubSignal> {
  // Check for existing sell-through-cliff signal
  const { data: cliffSignal } = await supabase
    .from("analysis_signals")
    .select("score, severity, value_json")
    .eq("vehicle_id", vehicleId)
    .eq("widget_slug", "sell-through-cliff")
    .maybeSingle();

  if (cliffSignal?.score !== null && cliffSignal?.score !== undefined) {
    return {
      score: Number(cliffSignal.score),
      status: cliffSignal.value_json?.headline ??
        `Score: ${cliffSignal.score}`,
      weight: WEIGHTS.dom,
    };
  }

  // Fallback: compute from deal jacket or vehicle age
  const { data: dj } = await supabase
    .from("deal_jackets")
    .select("acquisition_date")
    .eq("vehicle_id", vehicleId)
    .is("sold_date", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (dj?.acquisition_date) {
    const dom = Math.floor(
      (Date.now() - new Date(dj.acquisition_date).getTime()) / 86400000
    );
    let score = 95;
    if (dom > 90) score = 10;
    else if (dom > 60) score = 25;
    else if (dom > 45) score = 40;
    else if (dom > 30) score = 60;
    else if (dom > 14) score = 80;

    return {
      score,
      status: `Day ${dom} on consignment`,
      weight: WEIGHTS.dom,
    };
  }

  return { score: 75, status: "No DOM data available", weight: WEIGHTS.dom };
}

async function computeEngagementSignal(
  supabase: any,
  vehicleId: string
): Promise<SubSignal> {
  // Check vehicle_events for bid/view data
  const { data: listings } = await supabase
    .from("vehicle_events")
    .select("bid_count, view_count, watcher_count, started_at, event_status")
    .eq("vehicle_id", vehicleId)
    .order("started_at", { ascending: false })
    .limit(3);

  if (!listings?.length) {
    // Check for auction comments as engagement proxy
    const { count } = await supabase
      .from("auction_comments")
      .select("*", { count: "exact", head: true })
      .eq("vehicle_id", vehicleId);

    if (count && count > 0) {
      const score = Math.min(95, 40 + count * 2);
      return {
        score,
        status: `${count} comments — ${count > 20 ? "strong" : "moderate"} engagement`,
        weight: WEIGHTS.engagement,
      };
    }

    return {
      score: 50,
      status: "No engagement data available",
      weight: WEIGHTS.engagement,
    };
  }

  const latest = listings[0];
  const bidCount = latest.bid_count ?? 0;
  const viewCount = latest.view_count ?? 0;
  const watcherCount = latest.watcher_count ?? 0;

  // Score based on engagement metrics
  let score = 50;

  if (bidCount >= 30) score = 95;
  else if (bidCount >= 15) score = 80;
  else if (bidCount >= 5) score = 60;
  else if (bidCount >= 1) score = 45;
  else score = 25;

  // Boost for watchers/views
  if (viewCount > 10000) score = Math.min(100, score + 10);
  if (watcherCount > 50) score = Math.min(100, score + 5);

  return {
    score,
    status: `${bidCount} bids, ${viewCount} views, ${watcherCount} watchers`,
    weight: WEIGHTS.engagement,
  };
}

async function computePriceReductionSignal(
  supabase: any,
  vehicleId: string,
  currentAsk: number | null
): Promise<SubSignal> {
  // Check for price reduction observations
  const { data: priceObs } = await supabase
    .from("vehicle_observations")
    .select("structured_data, observed_at")
    .eq("vehicle_id", vehicleId)
    .eq("kind", "price_change")
    .order("observed_at", { ascending: true });

  if (!priceObs?.length) {
    return {
      score: 85,
      status: "No price reductions recorded",
      weight: WEIGHTS.price_reductions,
    };
  }

  const reductionCount = priceObs.length;
  let totalReductionPct = 0;

  // Calculate total reduction from first price to current
  const firstPrice = priceObs[0]?.structured_data?.original_price;
  if (firstPrice && currentAsk && firstPrice > currentAsk) {
    totalReductionPct = ((firstPrice - currentAsk) / firstPrice) * 100;
  }

  // Score degrades with each reduction
  let score = 80;
  if (reductionCount >= 3) score = 20;
  else if (reductionCount === 2) score = 40;
  else if (reductionCount === 1) score = 60;

  // Further degrade if total reduction is large
  if (totalReductionPct > 25) score = Math.min(score, 15);
  else if (totalReductionPct > 15) score = Math.min(score, 30);

  return {
    score,
    status: `${reductionCount} price reduction${reductionCount > 1 ? "s" : ""}, ${Math.round(totalReductionPct)}% total`,
    weight: WEIGHTS.price_reductions,
  };
}

function computeSeasonalSignal(): SubSignal {
  const month = new Date().getMonth() + 1;
  const score = SEASONAL_SCORES[month] ?? 50;

  const monthNames = [
    "",
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  let status: string;
  if (score >= 75) status = `${monthNames[month]} — strong selling season`;
  else if (score >= 55)
    status = `${monthNames[month]} — moderate selling season`;
  else status = `${monthNames[month]} — slow selling season`;

  return { score, status, weight: WEIGHTS.seasonal };
}

async function computeCompetitionSignal(
  supabase: any,
  year: number | null,
  make: string | null,
  model: string | null
): Promise<SubSignal> {
  if (!make || !model) {
    return {
      score: 50,
      status: "Cannot assess competition without make/model",
      weight: WEIGHTS.competition,
    };
  }

  // Count similar vehicles currently active
  const { count } = await supabase
    .from("vehicles")
    .select("*", { count: "exact", head: true })
    .eq("make", make)
    .eq("model", model)
    .eq("auction_status", "active")
    .neq("status", "sold");

  const activeComps = count ?? 0;

  let score: number;
  let status: string;

  if (activeComps === 0) {
    score = 95;
    status = "No competing listings — exclusive market position";
  } else if (activeComps <= 2) {
    score = 75;
    status = `${activeComps} similar vehicle${activeComps > 1 ? "s" : ""} currently listed`;
  } else if (activeComps <= 5) {
    score = 50;
    status = `${activeComps} similar vehicles listed — moderate competition`;
  } else {
    score = 25;
    status = `${activeComps} similar vehicles listed — crowded market`;
  }

  return { score, status, weight: WEIGHTS.competition };
}

async function getRerunDecaySignal(
  supabase: any,
  vehicleId: string
): Promise<SubSignal> {
  const { data: signal } = await supabase
    .from("analysis_signals")
    .select("score, value_json")
    .eq("vehicle_id", vehicleId)
    .eq("widget_slug", "rerun-decay")
    .maybeSingle();

  if (signal?.score !== null && signal?.score !== undefined) {
    return {
      score: Number(signal.score),
      status:
        signal.value_json?.headline ??
        `Rerun score: ${signal.score}`,
      weight: WEIGHTS.rerun_decay,
    };
  }

  return {
    score: 80,
    status: "No rerun data",
    weight: WEIGHTS.rerun_decay,
  };
}

async function getBrokerExposureSignal(
  supabase: any,
  vehicleId: string
): Promise<SubSignal> {
  const { data: signal } = await supabase
    .from("analysis_signals")
    .select("score, value_json")
    .eq("vehicle_id", vehicleId)
    .eq("widget_slug", "broker-exposure")
    .maybeSingle();

  if (signal?.score !== null && signal?.score !== undefined) {
    return {
      score: Number(signal.score),
      status:
        signal.value_json?.headline ??
        `Exposure score: ${signal.score}`,
      weight: WEIGHTS.broker_exposure,
    };
  }

  // Fallback: check vehicle_events count
  const { count } = await supabase
    .from("vehicle_events")
    .select("*", { count: "exact", head: true })
    .eq("vehicle_id", vehicleId);

  const platforms = count ?? 0;
  if (platforms <= 1) {
    return {
      score: 90,
      status: "Single platform — good exclusivity",
      weight: WEIGHTS.broker_exposure,
    };
  }

  return {
    score: Math.max(20, 90 - platforms * 20),
    status: `Listed on ${platforms} platforms`,
    weight: WEIGHTS.broker_exposure,
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
        "id, year, make, model, era, body_style, asking_price, sale_price, auction_source, auction_status, status"
      )
      .eq("id", vehicle_id)
      .single();

    if (vErr || !vehicle) {
      return json(404, { error: "Vehicle not found" });
    }

    // Compute all sub-signals in parallel
    const [dom, engagement, priceReductions, seasonal, competition, rerunDecay, brokerExposure] =
      await Promise.all([
        computeDomSignal(supabase, vehicle_id),
        computeEngagementSignal(supabase, vehicle_id),
        computePriceReductionSignal(supabase, vehicle_id, vehicle.asking_price ? Number(vehicle.asking_price) : null),
        Promise.resolve(computeSeasonalSignal()),
        computeCompetitionSignal(supabase, vehicle.year, vehicle.make, vehicle.model),
        getRerunDecaySignal(supabase, vehicle_id),
        getBrokerExposureSignal(supabase, vehicle_id),
      ]);

    // Weighted composite
    const subSignals = {
      dom,
      engagement,
      price_reductions: priceReductions,
      seasonal,
      competition,
      rerun_decay: rerunDecay,
      broker_exposure: brokerExposure,
    };

    const compositeScore = Math.round(
      dom.score * dom.weight +
        engagement.score * engagement.weight +
        priceReductions.score * priceReductions.weight +
        seasonal.score * seasonal.weight +
        competition.score * competition.weight +
        rerunDecay.score * rerunDecay.weight +
        brokerExposure.score * brokerExposure.weight
    );

    // Count warnings
    const warningCount = Object.values(subSignals).filter(
      (s) => s.score < 40
    ).length;
    const criticalSignals = Object.entries(subSignals)
      .filter(([, s]) => s.score < 25)
      .map(([key]) => key);

    // Determine trend (would need historical data, using static for now)
    const trend =
      compositeScore >= 70
        ? "stable"
        : compositeScore >= 40
          ? "deteriorating"
          : "critical";

    // Severity
    let severity: string;
    if (compositeScore >= 70) severity = "ok";
    else if (compositeScore >= 40) severity = "warning";
    else severity = "critical";

    // Headline
    let headline: string;
    if (severity === "critical") {
      headline = `Deal health critical (${compositeScore}/100) — ${warningCount} warning signals triggered`;
    } else if (severity === "warning") {
      headline = `Deal health declining (${compositeScore}/100) — attention needed on ${warningCount} signal${warningCount > 1 ? "s" : ""}`;
    } else {
      headline = `Deal health good (${compositeScore}/100) — all signals stable`;
    }

    // Recommendations based on weakest signals
    const recommendations: Array<{
      action: string;
      priority: number;
      rationale: string;
    }> = [];

    // Sort sub-signals by score (weakest first)
    const sortedSignals = Object.entries(subSignals).sort(
      ([, a], [, b]) => a.score - b.score
    );

    for (const [key, signal] of sortedSignals.slice(0, 3)) {
      if (signal.score >= 60) continue; // Only recommend for weak signals

      switch (key) {
        case "dom":
          recommendations.push({
            action: "Address DOM urgently — consider price reduction or platform change",
            priority: 1,
            rationale: signal.status,
          });
          break;
        case "engagement":
          recommendations.push({
            action: "Boost engagement — refresh photos, update description, promote listing",
            priority: 2,
            rationale: signal.status,
          });
          break;
        case "price_reductions":
          recommendations.push({
            action: "Stop incremental reductions — make one decisive price correction",
            priority: 1,
            rationale: `Multiple small reductions signal desperation. ${signal.status}`,
          });
          break;
        case "seasonal":
          recommendations.push({
            action: "Consider holding until favorable season",
            priority: 3,
            rationale: signal.status,
          });
          break;
        case "competition":
          recommendations.push({
            action: "Differentiate from competing listings",
            priority: 2,
            rationale: signal.status,
          });
          break;
        case "rerun_decay":
          recommendations.push({
            action: "Address rerun decay — change platform or wait before relisting",
            priority: 1,
            rationale: signal.status,
          });
          break;
        case "broker_exposure":
          recommendations.push({
            action: "Consolidate to fewer platforms for exclusivity",
            priority: 2,
            rationale: signal.status,
          });
          break;
      }
    }

    return json(200, {
      score: compositeScore,
      severity,
      headline,
      details: {
        composite_health: compositeScore,
        trend,
        warning_count: warningCount,
        critical_signals: criticalSignals,
        sub_signals: Object.fromEntries(
          Object.entries(subSignals).map(([key, signal]) => [
            key,
            { score: signal.score, weight: signal.weight, status: signal.status },
          ])
        ),
        vehicle: {
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          asking_price: vehicle.asking_price,
          auction_source: vehicle.auction_source,
          status: vehicle.status,
        },
      },
      reasons: [headline],
      confidence: 0.75,
      recommendations,
    });
  } catch (err: any) {
    console.error("Widget time-kills-deals error:", err);
    return json(500, { error: err.message });
  }
});
