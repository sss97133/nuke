/**
 * monitor-fb-marketplace — Health monitoring for FB Marketplace pipeline
 *
 * Called via pg_cron every 6 hours. Also callable manually.
 *
 * Checks:
 *   1. Last successful sweep freshness
 *   2. Unlinked listing backlog
 *   3. Sweep error rate (7-day window)
 *   4. Data freshness (hours since newest listing)
 *   5. Refine backlog
 *
 * Creates admin_notifications on threshold breach (with 6h dedup).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const THRESHOLDS = {
  MAX_HOURS_WITHOUT_SWEEP: 24,
  MAX_UNLINKED_LISTINGS: 500,
  MAX_ERROR_RATE_PCT: 50,
  MAX_HOURS_WITHOUT_NEW_LISTING: 48,
  MAX_UNREFINED_LISTINGS: 1000,
};

interface HealthCheck {
  name: string;
  status: "ok" | "warning" | "critical";
  value: number | string | null;
  threshold: number | string;
  message: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const checks: HealthCheck[] = [];
    const issues: string[] = [];

    // ─── CHECK 1: Last successful sweep ───────────────────────────
    const { data: lastSweep } = await supabase
      .from("fb_sweep_jobs")
      .select("id, completed_at, listings_found, new_listings, errors, metadata")
      .eq("status", "completed")
      .gt("listings_found", 0)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const hoursSinceLastSweep = lastSweep?.completed_at
      ? (Date.now() - new Date(lastSweep.completed_at).getTime()) / 3600000
      : 999;

    checks.push({
      name: "sweep_freshness",
      status: hoursSinceLastSweep > THRESHOLDS.MAX_HOURS_WITHOUT_SWEEP ? "critical" : "ok",
      value: Math.round(hoursSinceLastSweep * 10) / 10,
      threshold: THRESHOLDS.MAX_HOURS_WITHOUT_SWEEP,
      message: hoursSinceLastSweep > THRESHOLDS.MAX_HOURS_WITHOUT_SWEEP
        ? `No successful sweep in ${Math.round(hoursSinceLastSweep)}h`
        : `Last successful sweep ${Math.round(hoursSinceLastSweep)}h ago`,
    });

    if (hoursSinceLastSweep > THRESHOLDS.MAX_HOURS_WITHOUT_SWEEP) {
      issues.push(`No successful FB sweep in ${Math.round(hoursSinceLastSweep)} hours`);
    }

    // ─── CHECK 2: Unlinked listings (only active — blocked ones are already processed)
    const { count: unlinkedCount } = await supabase
      .from("marketplace_listings")
      .select("id", { count: "exact", head: true })
      .is("vehicle_id", null)
      .eq("status", "active");

    checks.push({
      name: "unlinked_listings",
      status: (unlinkedCount || 0) > THRESHOLDS.MAX_UNLINKED_LISTINGS ? "warning" : "ok",
      value: unlinkedCount || 0,
      threshold: THRESHOLDS.MAX_UNLINKED_LISTINGS,
      message: `${unlinkedCount || 0} listings awaiting vehicle linking`,
    });

    if ((unlinkedCount || 0) > THRESHOLDS.MAX_UNLINKED_LISTINGS) {
      issues.push(`${unlinkedCount} unlinked FB listings (threshold: ${THRESHOLDS.MAX_UNLINKED_LISTINGS})`);
    }

    // ─── CHECK 3: Recent sweep error rate ─────────────────────────
    const { data: recentSweeps } = await supabase
      .from("fb_sweep_jobs")
      .select("status, listings_found, errors, locations_total")
      .gte("started_at", new Date(Date.now() - 7 * 24 * 3600000).toISOString())
      .order("started_at", { ascending: false })
      .limit(20);

    const totalSweeps = recentSweeps?.length || 0;
    const failedSweeps = recentSweeps?.filter(
      (s: any) => s.status === "failed" || (s.listings_found === 0 && (s.locations_total || 0) > 1)
    ).length || 0;
    const errorRate = totalSweeps > 0 ? Math.round((failedSweeps / totalSweeps) * 100) : 0;

    checks.push({
      name: "sweep_error_rate",
      status: errorRate > THRESHOLDS.MAX_ERROR_RATE_PCT ? "critical" : "ok",
      value: `${errorRate}% (${failedSweeps}/${totalSweeps})`,
      threshold: `${THRESHOLDS.MAX_ERROR_RATE_PCT}%`,
      message: `${errorRate}% sweep failure rate over last 7 days`,
    });

    if (errorRate > THRESHOLDS.MAX_ERROR_RATE_PCT) {
      issues.push(`FB sweep error rate ${errorRate}% exceeds ${THRESHOLDS.MAX_ERROR_RATE_PCT}% threshold`);
    }

    // ─── CHECK 4: Data freshness ──────────────────────────────────
    const { data: newestListing } = await supabase
      .from("marketplace_listings")
      .select("scraped_at")
      .order("scraped_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const hoursSinceNewListing = newestListing?.scraped_at
      ? (Date.now() - new Date(newestListing.scraped_at).getTime()) / 3600000
      : 999;

    checks.push({
      name: "data_freshness",
      status: hoursSinceNewListing > THRESHOLDS.MAX_HOURS_WITHOUT_NEW_LISTING ? "critical" : "ok",
      value: Math.round(hoursSinceNewListing * 10) / 10,
      threshold: THRESHOLDS.MAX_HOURS_WITHOUT_NEW_LISTING,
      message: `Newest listing scraped ${Math.round(hoursSinceNewListing)}h ago`,
    });

    if (hoursSinceNewListing > THRESHOLDS.MAX_HOURS_WITHOUT_NEW_LISTING) {
      issues.push(`No new FB listing in ${Math.round(hoursSinceNewListing)} hours`);
    }

    // ─── CHECK 5: Refine backlog ──────────────────────────────────
    const { count: unrefinedCount } = await supabase
      .from("marketplace_listings")
      .select("id", { count: "exact", head: true })
      .is("refined_at", null)
      .eq("status", "active");

    checks.push({
      name: "refine_backlog",
      status: (unrefinedCount || 0) > THRESHOLDS.MAX_UNREFINED_LISTINGS ? "warning" : "ok",
      value: unrefinedCount || 0,
      threshold: THRESHOLDS.MAX_UNREFINED_LISTINGS,
      message: `${unrefinedCount || 0} listings awaiting refinement`,
    });

    // ─── Summary stats ────────────────────────────────────────────
    const { count: totalListings } = await supabase
      .from("marketplace_listings")
      .select("id", { count: "exact", head: true });

    const { count: linkedCount } = await supabase
      .from("marketplace_listings")
      .select("id", { count: "exact", head: true })
      .not("vehicle_id", "is", null);

    // ─── CREATE NOTIFICATIONS FOR ISSUES ──────────────────────────
    if (issues.length > 0) {
      const severity = issues.some((i) => i.includes("No successful") || i.includes("error rate"))
        ? "critical"
        : "warning";

      // Dedup: skip if a similar notification was created in last 6h
      const { data: recentNotif } = await supabase
        .from("admin_notifications")
        .select("id")
        .eq("notification_type", "system_alert")
        .eq("status", "pending")
        .gte("created_at", new Date(Date.now() - 6 * 3600000).toISOString())
        .ilike("title", "%FB Marketplace%")
        .limit(1)
        .maybeSingle();

      if (!recentNotif) {
        await supabase
          .from("admin_notifications")
          .insert({
            notification_type: "system_alert",
            title: `FB Marketplace Pipeline ${severity === "critical" ? "CRITICAL" : "Warning"}`,
            message: issues.join("\n"),
            priority: severity === "critical" ? 4 : 2,
            action_required: "system_action",
            status: "pending",
            metadata: {
              source: "monitor-fb-marketplace",
              checks,
              total_listings: totalListings,
              linked: linkedCount,
              last_sweep_id: lastSweep?.id,
            },
          });
        console.log(`Created admin_notification: ${issues.join("; ")}`);
      } else {
        console.log("Suppressed duplicate notification (recent one exists)");
      }
    }

    // ─── Response ─────────────────────────────────────────────────
    const overallStatus = checks.some((c) => c.status === "critical")
      ? "critical"
      : checks.some((c) => c.status === "warning")
        ? "warning"
        : "healthy";

    return new Response(
      JSON.stringify({
        status: overallStatus,
        timestamp: new Date().toISOString(),
        summary: {
          total_listings: totalListings || 0,
          linked: linkedCount || 0,
          unlinked: unlinkedCount || 0,
          unrefined: unrefinedCount || 0,
          hours_since_sweep: Math.round(hoursSinceLastSweep * 10) / 10,
          hours_since_new_listing: Math.round(hoursSinceNewListing * 10) / 10,
          sweep_error_rate_7d: `${errorRate}%`,
        },
        checks,
        issues,
        last_successful_sweep: lastSweep
          ? {
              id: lastSweep.id,
              completed_at: lastSweep.completed_at,
              listings_found: lastSweep.listings_found,
              new_listings: lastSweep.new_listings,
              group: (lastSweep.metadata as any)?.group || "all",
            }
          : null,
      }),
      {
        status: overallStatus === "critical" ? 503 : 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("monitor-fb-marketplace error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
