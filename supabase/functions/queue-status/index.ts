/**
 * Queue Status
 *
 * Returns current import queue status with processing metrics.
 * Uses count queries for accurate totals.
 *
 * GET /functions/v1/queue-status
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, serviceKey);

    // Count by status using separate queries for accuracy
    const statuses = ["pending", "complete", "failed", "processing", "skipped", "duplicate"];
    const statusMap: Record<string, number> = {};

    for (const status of statuses) {
      const { count } = await supabase
        .from("import_queue")
        .select("id", { count: "exact", head: true })
        .eq("status", status);
      statusMap[status] = count || 0;
    }

    // Get pending items with source detection - sample for breakdown
    const { data: pendingItems } = await supabase
      .from("import_queue")
      .select("listing_url, attempts")
      .eq("status", "pending")
      .limit(100000);

    const pendingBySource: Record<string, { pending: number; extractable: number }> = {};
    pendingItems?.forEach((item: any) => {
      let source = "Other";
      if (item.listing_url?.includes("bringatrailer.com/listing/")) source = "BaT";
      else if (item.listing_url?.includes("carsandbids.com")) source = "Cars & Bids";
      else if (item.listing_url?.includes("collectingcars.com")) source = "Collecting Cars";
      else if (item.listing_url?.includes("classic.com")) source = "Classic.com";

      if (!pendingBySource[source]) {
        pendingBySource[source] = { pending: 0, extractable: 0 };
      }
      pendingBySource[source].pending++;
      if ((item.attempts || 0) < 5) {
        pendingBySource[source].extractable++;
      }
    });

    // Get recent completions for rate calculation
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const { count: recentCount } = await supabase
      .from("import_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "complete")
      .gte("processed_at", sixHoursAgo);

    const avgItemsPerHour = Math.round((recentCount || 0) / 6);

    // Get active workers
    const { data: processingItems } = await supabase
      .from("import_queue")
      .select("locked_by, locked_at")
      .eq("status", "processing")
      .not("locked_by", "is", null)
      .limit(1000);

    const workerMap: Record<string, { items: number; started: string }> = {};
    processingItems?.forEach((item: any) => {
      if (!workerMap[item.locked_by]) {
        workerMap[item.locked_by] = { items: 0, started: item.locked_at };
      }
      workerMap[item.locked_by].items++;
      if (item.locked_at < workerMap[item.locked_by].started) {
        workerMap[item.locked_by].started = item.locked_at;
      }
    });

    // Count stale locks
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count: staleLockCount } = await supabase
      .from("import_queue")
      .select("id", { count: "exact", head: true })
      .or(`status.eq.processing,and(status.eq.pending,locked_at.not.is.null)`)
      .lt("locked_at", tenMinAgo);

    // Build summary
    const total = Object.values(statusMap).reduce((a, b) => a + b, 0);
    const pending = statusMap["pending"] || 0;
    const complete = statusMap["complete"] || 0;
    const failed = statusMap["failed"] || 0;
    const processing = statusMap["processing"] || 0;

    // Estimate time to completion at current rate
    const extractable = Object.values(pendingBySource).reduce(
      (sum, s) => sum + s.extractable,
      0
    );
    const hoursToComplete = avgItemsPerHour > 0
      ? Math.round(extractable / avgItemsPerHour * 10) / 10
      : null;

    // Convert workerMap to array
    const activeWorkers = Object.entries(workerMap).map(([id, data]) => ({
      worker_id: id,
      ...data,
    }));

    // Convert pendingBySource to array
    const pendingBySourceArray = Object.entries(pendingBySource).map(
      ([source, data]) => ({ source, ...data })
    ).sort((a, b) => b.pending - a.pending);

    return new Response(
      JSON.stringify({
        summary: {
          total,
          pending,
          complete,
          failed,
          processing,
          extractable,
          completion_pct: total > 0 ? Math.round((complete / total) * 1000) / 10 : 0,
          items_per_hour: avgItemsPerHour,
          estimated_hours_remaining: hoursToComplete,
          stale_locks: staleLockCount || 0,
        },
        by_status: statusMap,
        pending_by_source: pendingBySourceArray,
        active_workers: activeWorkers,
        generated_at: new Date().toISOString(),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: e.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
