/**
 * SYSTEM HEALTH MONITOR - Comprehensive platform health check
 *
 * Designed to be called by cron (pg_cron or GitHub Actions) to detect
 * degraded states before they become user-visible.
 *
 * GET  /functions/v1/system-health-monitor           — full health check
 * POST /functions/v1/system-health-monitor            — same, body ignored
 *
 * Returns:
 *   status: "healthy" | "degraded" | "critical"
 *   checks: individual check results
 *   alerts: issues needing attention
 *   timestamp: ISO 8601
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CheckResult {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
  value?: unknown;
  duration_ms?: number;
}

interface HealthResponse {
  status: "healthy" | "degraded" | "critical";
  checks: CheckResult[];
  alerts: string[];
  timestamp: string;
  duration_ms: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function elapsed(start: number): number {
  return Math.round(performance.now() - start);
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

async function checkTableSizes(
  supabase: ReturnType<typeof createClient>
): Promise<CheckResult> {
  const t = performance.now();
  try {
    // Use estimated count for vehicle_images (1M+ rows, exact count times out)
    const [vehiclesRes, imagesRes, observationsRes] = await Promise.all([
      supabase
        .from("vehicles")
        .select("id", { count: "estimated", head: true }),
      supabase
        .from("vehicle_images")
        .select("id", { count: "estimated", head: true }),
      supabase
        .from("vehicle_observations")
        .select("id", { count: "estimated", head: true }),
    ]);

    const vehicles = vehiclesRes.count ?? 0;
    const images = imagesRes.count ?? 0;
    const observations = observationsRes.count ?? 0;

    // Sanity: if vehicles is 0 something is very wrong
    const status = vehicles === 0 ? "fail" : "pass";

    return {
      name: "table_sizes",
      status,
      message:
        status === "fail"
          ? "Vehicles table returned 0 rows — possible DB issue"
          : `vehicles=~${vehicles.toLocaleString()}, images=~${images.toLocaleString()}, observations=~${observations.toLocaleString()} (estimated)`,
      value: { vehicles, images, observations, note: "estimated counts" },
      duration_ms: elapsed(t),
    };
  } catch (e: any) {
    return {
      name: "table_sizes",
      status: "fail",
      message: `Error counting tables: ${e.message}`,
      duration_ms: elapsed(t),
    };
  }
}

async function checkImportQueue(
  supabase: ReturnType<typeof createClient>
): Promise<CheckResult> {
  const t = performance.now();
  try {
    // Pending items
    const { count: pendingCount } = await supabase
      .from("import_queue")
      .select("id", { count: "estimated", head: true })
      .eq("status", "pending");

    // Stuck jobs: status = 'processing' AND updated_at < now() - 30 min
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { count: stuckCount } = await supabase
      .from("import_queue")
      .select("id", { count: "estimated", head: true })
      .eq("status", "processing")
      .lt("updated_at", thirtyMinAgo);

    const pending = pendingCount ?? 0;
    const stuck = stuckCount ?? 0;

    let status: CheckResult["status"] = "pass";
    const messages: string[] = [];

    if (stuck > 0) {
      status = "warn";
      messages.push(`${stuck} stuck job(s) in processing > 30min`);
    }
    if (pending > 500) {
      status = stuck > 0 ? "fail" : "warn";
      messages.push(`queue depth is high: ${pending} pending`);
    }

    return {
      name: "import_queue",
      status,
      message:
        messages.length > 0
          ? messages.join("; ")
          : `${pending} pending, 0 stuck`,
      value: { pending, stuck },
      duration_ms: elapsed(t),
    };
  } catch (e: any) {
    return {
      name: "import_queue",
      status: "fail",
      message: `Error checking import queue: ${e.message}`,
      duration_ms: elapsed(t),
    };
  }
}

async function checkFeedPerformance(
  supabase: ReturnType<typeof createClient>
): Promise<CheckResult> {
  const t = performance.now();
  try {
    // Simulate the feed query that powers the homepage
    // Fetch a small page from vehicle_valuation_feed ordered by feed_rank_score
    // Use AbortSignal to prevent this check from blocking the entire health report
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);

    const feedPromise = supabase
      .from("vehicle_valuation_feed")
      .select("vehicle_id, make, model, year, feed_rank_score")
      .order("feed_rank_score", { ascending: false })
      .limit(20)
      .abortSignal(controller.signal);

    let data: any[] | null = null;
    let error: any = null;

    try {
      const result = await feedPromise;
      data = result.data;
      error = result.error;
    } catch (abortErr: any) {
      clearTimeout(timeout);
      const ms = elapsed(t);
      return {
        name: "feed_performance",
        status: "warn",
        message: `Feed query timed out after ${ms}ms (7s client-side limit). View may need refresh.`,
        value: { ms, timed_out: true },
        duration_ms: ms,
      };
    }

    clearTimeout(timeout);
    const ms = elapsed(t);

    if (error) {
      // Distinguish timeout from other errors
      const isTimeout = error.message?.includes("timeout") || error.message?.includes("cancel") || error.message?.includes("abort");
      return {
        name: "feed_performance",
        status: isTimeout ? "warn" : "fail",
        message: isTimeout
          ? `Feed query timed out (${ms}ms). Materialized view may need refresh.`
          : `Feed query failed: ${error.message}`,
        value: { ms, timed_out: isTimeout },
        duration_ms: ms,
      };
    }

    const rowCount = data?.length ?? 0;
    let status: CheckResult["status"] = "pass";
    let message = `Feed query returned ${rowCount} rows in ${ms}ms`;

    if (ms > 10000) {
      status = "fail";
      message = `Feed query critically slow: ${ms}ms (> 10s threshold)`;
    } else if (ms > 5000) {
      status = "warn";
      message = `Feed query slow: ${ms}ms (> 5s threshold). Consider refreshing materialized view.`;
    } else if (ms > 3000) {
      status = "warn";
      message = `Feed query slow: ${ms}ms (> 3s threshold)`;
    }

    return {
      name: "feed_performance",
      status,
      message,
      value: { rows: rowCount, ms },
      duration_ms: ms,
    };
  } catch (e: any) {
    return {
      name: "feed_performance",
      status: "fail",
      message: `Feed query error: ${e.message}`,
      duration_ms: elapsed(t),
    };
  }
}

async function checkExtractionRate(
  supabase: ReturnType<typeof createClient>
): Promise<CheckResult> {
  const t = performance.now();
  try {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [last24hRes, last7dRes] = await Promise.all([
      supabase
        .from("vehicles")
        .select("id", { count: "estimated", head: true })
        .gte("created_at", oneDayAgo),
      supabase
        .from("vehicles")
        .select("id", { count: "estimated", head: true })
        .gte("created_at", sevenDaysAgo),
    ]);

    const last24h = last24hRes.count ?? 0;
    const last7d = last7dRes.count ?? 0;
    const dailyAvg7d = last7d / 7;

    let status: CheckResult["status"] = "pass";
    let message = `${last24h} vehicles created in last 24h (7d avg: ${dailyAvg7d.toFixed(1)}/day)`;

    // Flag if today's rate is less than 50% of 7-day average
    // But only if the 7-day average is meaningful (> 5/day)
    if (dailyAvg7d > 5 && last24h < dailyAvg7d * 0.5) {
      status = "warn";
      message = `Extraction rate drop: ${last24h} in 24h vs ${dailyAvg7d.toFixed(1)}/day avg (< 50% of normal)`;
    }

    // If zero vehicles in 24h and the platform normally creates them, that is a fail
    if (dailyAvg7d > 10 && last24h === 0) {
      status = "fail";
      message = `Zero vehicles created in last 24h (7d avg: ${dailyAvg7d.toFixed(1)}/day) — extraction may be down`;
    }

    return {
      name: "extraction_rate",
      status,
      message,
      value: { last_24h: last24h, last_7d: last7d, daily_avg_7d: Math.round(dailyAvg7d * 10) / 10 },
      duration_ms: elapsed(t),
    };
  } catch (e: any) {
    return {
      name: "extraction_rate",
      status: "fail",
      message: `Error checking extraction rate: ${e.message}`,
      duration_ms: elapsed(t),
    };
  }
}

async function checkDataQuality(
  supabase: ReturnType<typeof createClient>
): Promise<CheckResult> {
  const t = performance.now();
  try {
    // Recent vehicles = created in last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Count recent vehicles
    const { count: recentTotal } = await supabase
      .from("vehicles")
      .select("id", { count: "estimated", head: true })
      .gte("created_at", sevenDaysAgo);

    const total = recentTotal ?? 0;

    if (total === 0) {
      return {
        name: "data_quality",
        status: "pass",
        message: "No recent vehicles to assess quality on",
        value: { recent_vehicles: 0 },
        duration_ms: elapsed(t),
      };
    }

    // Recent vehicles that have at least one image
    // We check by looking for vehicles WITHOUT images
    const { count: withoutImagesCount } = await supabase
      .from("vehicles")
      .select("id", { count: "estimated", head: true })
      .gte("created_at", sevenDaysAgo)
      .is("primary_image_url", null);

    // Vehicles missing year, make, or model
    const [noYearRes, noMakeRes, noModelRes] = await Promise.all([
      supabase
        .from("vehicles")
        .select("id", { count: "estimated", head: true })
        .gte("created_at", sevenDaysAgo)
        .is("year", null),
      supabase
        .from("vehicles")
        .select("id", { count: "estimated", head: true })
        .gte("created_at", sevenDaysAgo)
        .is("make", null),
      supabase
        .from("vehicles")
        .select("id", { count: "estimated", head: true })
        .gte("created_at", sevenDaysAgo)
        .is("model", null),
    ]);

    const withoutImages = withoutImagesCount ?? 0;
    const noYear = noYearRes.count ?? 0;
    const noMake = noMakeRes.count ?? 0;
    const noModel = noModelRes.count ?? 0;
    const missingYMM = Math.max(noYear, noMake, noModel); // worst case

    const pctNoImages = total > 0 ? (withoutImages / total) * 100 : 0;
    const pctMissingYMM = total > 0 ? (missingYMM / total) * 100 : 0;

    let status: CheckResult["status"] = "pass";
    const issues: string[] = [];

    if (pctNoImages > 50) {
      status = "warn";
      issues.push(`${pctNoImages.toFixed(0)}% of recent vehicles have no thumbnail`);
    }
    if (pctMissingYMM > 30) {
      status = status === "warn" ? "fail" : "warn";
      issues.push(
        `${pctMissingYMM.toFixed(0)}% of recent vehicles missing year/make/model (year=${noYear}, make=${noMake}, model=${noModel})`
      );
    }

    return {
      name: "data_quality",
      status,
      message:
        issues.length > 0
          ? issues.join("; ")
          : `${total} recent vehicles — ${withoutImages} without thumbnail, ${missingYMM} missing YMM`,
      value: {
        recent_vehicles: total,
        without_thumbnail: withoutImages,
        pct_no_thumbnail: Math.round(pctNoImages * 10) / 10,
        missing_year: noYear,
        missing_make: noMake,
        missing_model: noModel,
        pct_missing_ymm: Math.round(pctMissingYMM * 10) / 10,
      },
      duration_ms: elapsed(t),
    };
  } catch (e: any) {
    return {
      name: "data_quality",
      status: "fail",
      message: `Error checking data quality: ${e.message}`,
      duration_ms: elapsed(t),
    };
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const overallStart = performance.now();

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Run all checks in parallel
    const checks = await Promise.all([
      checkTableSizes(supabase),
      checkImportQueue(supabase),
      checkFeedPerformance(supabase),
      checkExtractionRate(supabase),
      checkDataQuality(supabase),
    ]);

    // Derive overall status
    const hasFail = checks.some((c) => c.status === "fail");
    const hasWarn = checks.some((c) => c.status === "warn");

    let status: HealthResponse["status"] = "healthy";
    if (hasFail) status = "critical";
    else if (hasWarn) status = "degraded";

    // Collect alerts (any non-pass check)
    const alerts = checks
      .filter((c) => c.status !== "pass")
      .map((c) => `[${c.status.toUpperCase()}] ${c.name}: ${c.message}`);

    const response: HealthResponse = {
      status,
      checks,
      alerts,
      timestamp: new Date().toISOString(),
      duration_ms: elapsed(overallStart),
    };

    // Log alerts for Supabase function logs visibility
    if (alerts.length > 0) {
      console.warn(
        `system-health-monitor: ${status.toUpperCase()} — ${alerts.length} alert(s):\n` +
          alerts.map((a) => `  ${a}`).join("\n")
      );
    }

    return new Response(JSON.stringify(response, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: status === "critical" ? 503 : 200,
    });
  } catch (e: any) {
    const response: HealthResponse = {
      status: "critical",
      checks: [],
      alerts: [`Unhandled error: ${e.message}`],
      timestamp: new Date().toISOString(),
      duration_ms: elapsed(overallStart),
    };

    return new Response(JSON.stringify(response, null, 2), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
