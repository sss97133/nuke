/**
 * HEALTH CHECK — lightweight endpoint for uptime monitoring and load balancers
 *
 * Checks three things in parallel:
 *   1. DB connection — simple round-trip to verify Postgres is reachable
 *   2. Recent extractions — vehicles created in the last 1h and 24h
 *   3. Queue depth — pending / processing / stuck counts from import_queue
 *
 * GET /functions/v1/health
 *
 * Returns:
 *   status: "ok" | "degraded" | "down"
 *   checks: { db, extractions, queue }
 *   timestamp: ISO 8601
 *   duration_ms: number
 *
 * HTTP 200  → ok / degraded
 * HTTP 503  → down (any check is "error")
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CheckStatus = "ok" | "warn" | "error";

interface DbCheck {
  status: CheckStatus;
  latency_ms: number;
  message: string;
}

interface ExtractionsCheck {
  status: CheckStatus;
  last_1h: number;
  last_24h: number;
  rate_per_hour: number;
  message: string;
  latency_ms: number;
}

interface QueueCheck {
  status: CheckStatus;
  depth: number;
  pending: number;
  processing: number;
  stuck: number;
  message: string;
  latency_ms: number;
}

interface HealthResponse {
  status: "ok" | "degraded" | "down";
  checks: {
    db: DbCheck;
    extractions: ExtractionsCheck;
    queue: QueueCheck;
  };
  timestamp: string;
  duration_ms: number;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

async function checkDb(
  supabase: ReturnType<typeof createClient>
): Promise<DbCheck> {
  const t = performance.now();
  try {
    // Minimal query — estimated count on a small slice of vehicles.
    // Any successful response proves the DB connection is alive.
    const { error } = await supabase
      .from("vehicles")
      .select("id", { count: "estimated", head: true })
      .limit(1);

    const latency_ms = Math.round(performance.now() - t);

    if (error) {
      return {
        status: "error",
        latency_ms,
        message: `DB query failed: ${error.message}`,
      };
    }

    return {
      status: latency_ms > 5000 ? "warn" : "ok",
      latency_ms,
      message:
        latency_ms > 5000
          ? `DB reachable but slow: ${latency_ms}ms`
          : `connected (${latency_ms}ms)`,
    };
  } catch (e: any) {
    return {
      status: "error",
      latency_ms: Math.round(performance.now() - t),
      message: `DB unreachable: ${e.message}`,
    };
  }
}

async function checkExtractions(
  supabase: ReturnType<typeof createClient>
): Promise<ExtractionsCheck> {
  const t = performance.now();
  try {
    const now = Date.now();
    const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const [last1hRes, last24hRes] = await Promise.all([
      supabase
        .from("vehicles")
        .select("id", { count: "estimated", head: true })
        .gte("created_at", oneHourAgo),
      supabase
        .from("vehicles")
        .select("id", { count: "estimated", head: true })
        .gte("created_at", oneDayAgo),
    ]);

    const last_1h = last1hRes.count ?? 0;
    const last_24h = last24hRes.count ?? 0;
    // Use 24h data to compute a per-hour average for context
    const rate_per_hour = Math.round(last_24h / 24);
    const latency_ms = Math.round(performance.now() - t);

    // Warn if last-hour intake is less than 20% of the 24h per-hour average
    // (only when the average is meaningful — at least 5/h)
    let status: CheckStatus = "ok";
    let message = `${last_1h} extractions in last 1h, ${last_24h} in last 24h (avg ${rate_per_hour}/h)`;

    if (rate_per_hour > 5 && last_1h < rate_per_hour * 0.2) {
      status = "warn";
      message = `Low extraction rate: ${last_1h} in last 1h vs avg ${rate_per_hour}/h — pipeline may be stalled`;
    }

    if (rate_per_hour > 10 && last_1h === 0) {
      status = "error";
      message = `Zero extractions in last 1h — pipeline appears down (avg was ${rate_per_hour}/h)`;
    }

    return { status, last_1h, last_24h, rate_per_hour, message, latency_ms };
  } catch (e: any) {
    return {
      status: "error",
      last_1h: 0,
      last_24h: 0,
      rate_per_hour: 0,
      message: `Extraction check failed: ${e.message}`,
      latency_ms: Math.round(performance.now() - t),
    };
  }
}

async function checkQueue(
  supabase: ReturnType<typeof createClient>
): Promise<QueueCheck> {
  const t = performance.now();
  try {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    const [pendingRes, processingRes, stuckRes] = await Promise.all([
      supabase
        .from("import_queue")
        .select("id", { count: "estimated", head: true })
        .eq("status", "pending"),
      supabase
        .from("import_queue")
        .select("id", { count: "estimated", head: true })
        .eq("status", "processing"),
      supabase
        .from("import_queue")
        .select("id", { count: "estimated", head: true })
        .eq("status", "processing")
        .lt("updated_at", thirtyMinAgo),
    ]);

    const pending = pendingRes.count ?? 0;
    const processing = processingRes.count ?? 0;
    const stuck = stuckRes.count ?? 0;
    const depth = pending + processing;
    const latency_ms = Math.round(performance.now() - t);

    let status: CheckStatus = "ok";
    const issues: string[] = [];

    if (stuck > 10) {
      status = "warn";
      issues.push(`${stuck} jobs stuck in processing > 30min`);
    }
    if (depth > 50000) {
      status = status === "warn" ? "error" : "warn";
      issues.push(`queue depth is high: ${depth.toLocaleString()} items`);
    }

    const message =
      issues.length > 0
        ? issues.join("; ")
        : `depth=${depth.toLocaleString()} (pending=${pending.toLocaleString()}, processing=${processing}, stuck=${stuck})`;

    return { status, depth, pending, processing, stuck, message, latency_ms };
  } catch (e: any) {
    return {
      status: "error",
      depth: 0,
      pending: 0,
      processing: 0,
      stuck: 0,
      message: `Queue check failed: ${e.message}`,
      latency_ms: Math.round(performance.now() - t),
    };
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const start = performance.now();

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Run all three checks in parallel
    const [db, extractions, queue] = await Promise.all([
      checkDb(supabase),
      checkExtractions(supabase),
      checkQueue(supabase),
    ]);

    // Derive overall status
    const allStatuses = [db.status, extractions.status, queue.status];
    let status: HealthResponse["status"] = "ok";
    if (allStatuses.includes("error")) status = "down";
    else if (allStatuses.includes("warn")) status = "degraded";

    const response: HealthResponse = {
      status,
      checks: { db, extractions, queue },
      timestamp: new Date().toISOString(),
      duration_ms: Math.round(performance.now() - start),
    };

    if (status !== "ok") {
      console.warn(
        `health: ${status.toUpperCase()} — db=${db.status}, extractions=${extractions.status}, queue=${queue.status}`
      );
    }

    return new Response(JSON.stringify(response, null, 2), {
      status: status === "down" ? 503 : 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const response: HealthResponse = {
      status: "down",
      checks: {
        db: { status: "error", latency_ms: 0, message: "handler crashed" },
        extractions: {
          status: "error",
          last_1h: 0,
          last_24h: 0,
          rate_per_hour: 0,
          message: "handler crashed",
          latency_ms: 0,
        },
        queue: {
          status: "error",
          depth: 0,
          pending: 0,
          processing: 0,
          stuck: 0,
          message: "handler crashed",
          latency_ms: 0,
        },
      },
      timestamp: new Date().toISOString(),
      duration_ms: Math.round(performance.now() - start),
    };

    console.error(`health: unhandled error — ${e.message}`);

    return new Response(JSON.stringify(response, null, 2), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
