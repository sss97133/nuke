/**
 * Extraction Watchdog - Automated Health Monitoring & Recovery
 *
 * Monitors extraction queue health and automatically fixes issues:
 * - Clears stale locks (workers that crashed/timed out)
 * - Retries stuck items
 * - Triggers new processors when queue stalls
 * - Sends Telegram alerts on issues
 *
 * Run via pg_cron every 5 minutes, or call manually.
 *
 * GET  /functions/v1/extraction-watchdog - Status dashboard data
 * POST /functions/v1/extraction-watchdog - Run health check + recovery
 * Body: { action: "check" | "recover" | "status" | "alert_test" }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface QueueHealth {
  pending: number;
  processing: number;
  complete: number;
  failed: number;
  skipped: number;
  stale_locks: number;
  stuck_items: number; // Items with many attempts but still pending
  processing_rate: number; // Items completed in last hour
  error_rate: number; // % of recent items that failed
  oldest_pending_hours: number;
  top_errors: Array<{ pattern: string; count: number }>;
  workers_active: number;
}

interface WatchdogResult {
  timestamp: string;
  health: QueueHealth;
  issues: string[];
  actions_taken: string[];
  alerts_sent: boolean;
  next_check: string;
}

// Thresholds for alerts
const THRESHOLDS = {
  stale_lock_minutes: 15, // Lock older than this = stale
  stuck_attempts: 3, // Items with this many attempts that are still pending
  min_processing_rate: 10, // Alert if less than this per hour
  max_error_rate: 20, // Alert if error rate exceeds this %
  max_pending_hours: 6, // Alert if oldest pending item is older than this
  min_workers: 1, // Alert if fewer workers than this
};

async function sendTelegramAlert(message: string): Promise<boolean> {
  const botToken = Deno.env.get("NUKE_TELEGRAM_BOT_TOKEN") || Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");

  if (!botToken || !chatId) {
    console.log("[Watchdog] Telegram not configured");
    return false;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    const result = await response.json();
    if (!result.ok) {
      console.error("[Watchdog] Telegram error:", result);
      return false;
    }
    console.log("[Watchdog] Alert sent");
    return true;
  } catch (e) {
    console.error("[Watchdog] Telegram send error:", e);
    return false;
  }
}

async function getQueueHealth(supabase: any): Promise<QueueHealth> {
  // Get queue status counts via count queries (faster than selecting all rows)
  const [
    { count: pending },
    { count: processing },
    { count: complete },
    { count: failed },
    { count: skipped },
  ] = await Promise.all([
    supabase.from("import_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("import_queue").select("id", { count: "exact", head: true }).eq("status", "processing"),
    supabase.from("import_queue").select("id", { count: "exact", head: true }).eq("status", "complete"),
    supabase.from("import_queue").select("id", { count: "exact", head: true }).eq("status", "failed"),
    supabase.from("import_queue").select("id", { count: "exact", head: true }).eq("status", "skipped"),
  ]);

  const statusCounts = {
    pending: pending || 0,
    processing: processing || 0,
    complete: complete || 0,
    failed: failed || 0,
    skipped: skipped || 0,
  };

  // Get stale locks (processing for > 15 minutes)
  const staleCutoff = new Date(Date.now() - THRESHOLDS.stale_lock_minutes * 60 * 1000).toISOString();
  const { count: staleLocks } = await supabase
    .from("import_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "processing")
    .lt("locked_at", staleCutoff);

  // Get stuck items (high attempts, still pending)
  const { count: stuckItems } = await supabase
    .from("import_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .gte("attempts", THRESHOLDS.stuck_attempts);

  // Get processing rate (completed in last hour)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: completedLastHour } = await supabase
    .from("import_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "complete")
    .gte("processed_at", oneHourAgo);

  // Get error rate (failed / (completed + failed) in last hour)
  const { count: failedLastHour } = await supabase
    .from("import_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "failed")
    .gte("processed_at", oneHourAgo);

  const totalRecent = (completedLastHour || 0) + (failedLastHour || 0);
  const errorRate = totalRecent > 0 ? ((failedLastHour || 0) / totalRecent) * 100 : 0;

  // Get oldest pending item age
  const { data: oldestPending } = await supabase
    .from("import_queue")
    .select("created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  const oldestPendingHours = oldestPending
    ? (Date.now() - new Date(oldestPending.created_at).getTime()) / (1000 * 60 * 60)
    : 0;

  // Get top error patterns
  const { data: errorPatterns } = await supabase
    .from("import_queue")
    .select("error_message")
    .eq("status", "failed")
    .gte("processed_at", oneHourAgo)
    .limit(100);

  const errorCounts: Record<string, number> = {};
  for (const row of errorPatterns || []) {
    if (row.error_message) {
      // Normalize error messages
      let pattern = row.error_message.slice(0, 100);
      pattern = pattern.replace(/\d{10,}/g, "[ID]"); // Replace long numbers
      pattern = pattern.replace(/https?:\/\/[^\s]+/g, "[URL]"); // Replace URLs
      errorCounts[pattern] = (errorCounts[pattern] || 0) + 1;
    }
  }
  const topErrors = Object.entries(errorCounts)
    .map(([pattern, count]) => ({ pattern, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Get active workers (distinct locked_by in last 15 min)
  const { data: activeWorkers } = await supabase
    .from("import_queue")
    .select("locked_by")
    .eq("status", "processing")
    .gte("locked_at", staleCutoff);

  const uniqueWorkers = new Set((activeWorkers || []).map((w: any) => w.locked_by).filter(Boolean));

  return {
    pending: statusCounts?.pending || 0,
    processing: statusCounts?.processing || 0,
    complete: statusCounts?.complete || 0,
    failed: statusCounts?.failed || 0,
    skipped: statusCounts?.skipped || 0,
    stale_locks: staleLocks || 0,
    stuck_items: stuckItems || 0,
    processing_rate: completedLastHour || 0,
    error_rate: Math.round(errorRate * 10) / 10,
    oldest_pending_hours: Math.round(oldestPendingHours * 10) / 10,
    top_errors: topErrors,
    workers_active: uniqueWorkers.size,
  };
}

async function runRecoveryActions(supabase: any, health: QueueHealth): Promise<string[]> {
  const actions: string[] = [];

  // 1. Clear stale locks
  if (health.stale_locks > 0) {
    const staleCutoff = new Date(Date.now() - THRESHOLDS.stale_lock_minutes * 60 * 1000).toISOString();
    const { data: cleared } = await supabase
      .from("import_queue")
      .update({
        status: "pending",
        locked_by: null,
        locked_at: null,
      })
      .eq("status", "processing")
      .lt("locked_at", staleCutoff)
      .select("id");

    const clearedCount = cleared?.length || 0;
    if (clearedCount > 0) {
      actions.push(`Cleared ${clearedCount} stale locks`);
    }
  }

  // 2. Reset rate-limited items that have cooled off
  const { data: rateLimited } = await supabase
    .from("import_queue")
    .update({
      status: "pending",
      next_attempt_at: null,
      attempts: 0, // Reset attempts for rate limits - not a real failure
    })
    .eq("status", "pending")
    .like("error_message", "%RATE_LIMITED%")
    .lt("next_attempt_at", new Date().toISOString())
    .select("id");

  if (rateLimited?.length > 0) {
    actions.push(`Reset ${rateLimited.length} rate-limited items (cooled off)`);
  }

  // 3. Convert old "Extraction failed" to pending for retry with new extractor
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: genericFails } = await supabase
    .from("import_queue")
    .update({
      status: "pending",
      attempts: 0,
      error_message: "Retrying with improved extractor",
      next_attempt_at: null,
    })
    .or("error_message.eq.Extraction failed,error_message.eq.extraction failed")
    .in("status", ["failed", "pending"])
    .lt("processed_at", oneHourAgo)
    .select("id")
    .limit(500); // Batch to avoid overwhelming

  if (genericFails?.length > 0) {
    actions.push(`Reset ${genericFails.length} generic failures for retry`);
  }

  // 4. Skip items that are truly gone (410/404)
  const { data: goneItems } = await supabase
    .from("import_queue")
    .update({
      status: "skipped",
    })
    .eq("status", "pending")
    .or("error_message.ilike.%410%,error_message.ilike.%Gone%,error_message.ilike.%404%,error_message.ilike.%not found%")
    .select("id");

  if (goneItems?.length > 0) {
    actions.push(`Skipped ${goneItems.length} gone/deleted listings`);
  }

  // 5. Reset stuck items that have been waiting too long
  if (health.stuck_items > 0) {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: reset } = await supabase
      .from("import_queue")
      .update({
        next_attempt_at: new Date().toISOString(),
      })
      .eq("status", "pending")
      .gte("attempts", THRESHOLDS.stuck_attempts)
      .or(`next_attempt_at.is.null,next_attempt_at.lt.${twoHoursAgo}`)
      .select("id")
      .limit(200);

    const resetCount = reset?.length || 0;
    if (resetCount > 0) {
      actions.push(`Reset ${resetCount} stuck items for retry`);
    }
  }

  // 6. Trigger queue processor if queue has items but no workers
  if (health.pending > 100 && health.workers_active === 0 && health.processing === 0) {
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

      const response = await fetch(`${supabaseUrl}/functions/v1/continuous-queue-processor`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          batch_size: 20,
          source: "all",
          continuous: false, // Just do one batch to get things moving
        }),
      });

      if (response.ok) {
        actions.push("Triggered queue processor to restart extraction");
      }
    } catch (e) {
      console.error("[Watchdog] Failed to trigger processor:", e);
    }
  }

  // 4. Log recovery to sentinel_alerts table
  if (actions.length > 0) {
    try {
      await supabase.from("sentinel_alerts").insert({
        severity: "info",
        type: "watchdog_recovery",
        message: actions.join("; "),
        data: { health, actions },
      });
    } catch { /* Ignore if table doesn't exist */ }
  }

  return actions;
}

function analyzeIssues(health: QueueHealth): string[] {
  const issues: string[] = [];

  if (health.stale_locks > 0) {
    issues.push(`${health.stale_locks} stale locks (workers may have crashed)`);
  }

  if (health.stuck_items > 10) {
    issues.push(`${health.stuck_items} items stuck after ${THRESHOLDS.stuck_attempts}+ attempts`);
  }

  if (health.processing_rate < THRESHOLDS.min_processing_rate && health.pending > 100) {
    issues.push(`Low throughput: only ${health.processing_rate}/hour (${health.pending} pending)`);
  }

  if (health.error_rate > THRESHOLDS.max_error_rate) {
    issues.push(`High error rate: ${health.error_rate}%`);
  }

  if (health.oldest_pending_hours > THRESHOLDS.max_pending_hours) {
    issues.push(`Oldest pending item is ${health.oldest_pending_hours}h old`);
  }

  if (health.workers_active < THRESHOLDS.min_workers && health.pending > 0) {
    issues.push(`No active workers (${health.pending} items pending)`);
  }

  return issues;
}

function formatAlertMessage(health: QueueHealth, issues: string[], actions: string[]): string {
  let msg = `<b>🚨 Nuke Extraction Alert</b>\n\n`;

  msg += `<b>Issues:</b>\n`;
  for (const issue of issues) {
    msg += `• ${issue}\n`;
  }

  if (actions.length > 0) {
    msg += `\n<b>Auto-Recovery:</b>\n`;
    for (const action of actions) {
      msg += `✅ ${action}\n`;
    }
  }

  msg += `\n<b>Queue Status:</b>\n`;
  msg += `Pending: ${health.pending.toLocaleString()}\n`;
  msg += `Processing: ${health.processing}\n`;
  msg += `Completed/hr: ${health.processing_rate}\n`;
  msg += `Error rate: ${health.error_rate}%\n`;

  if (health.top_errors.length > 0) {
    msg += `\n<b>Top Errors:</b>\n`;
    for (const err of health.top_errors.slice(0, 3)) {
      msg += `• (${err.count}x) ${err.pattern.slice(0, 50)}...\n`;
    }
  }

  return msg;
}

function formatStatusMessage(health: QueueHealth): string {
  const isHealthy = health.stale_locks === 0 &&
    health.error_rate < THRESHOLDS.max_error_rate &&
    (health.pending === 0 || health.workers_active > 0);

  let msg = isHealthy
    ? `<b>✅ Nuke Extraction Status</b>\n\n`
    : `<b>⚠️ Nuke Extraction Status</b>\n\n`;

  msg += `<b>Queue:</b>\n`;
  msg += `📥 Pending: ${health.pending.toLocaleString()}\n`;
  msg += `⚙️ Processing: ${health.processing}\n`;
  msg += `✅ Complete: ${health.complete.toLocaleString()}\n`;
  msg += `❌ Failed: ${health.failed.toLocaleString()}\n`;

  msg += `\n<b>Performance:</b>\n`;
  msg += `🚀 Rate: ${health.processing_rate}/hour\n`;
  msg += `📉 Error rate: ${health.error_rate}%\n`;
  msg += `👷 Workers: ${health.workers_active}\n`;

  if (health.pending > 0) {
    const etaHours = health.processing_rate > 0
      ? Math.round((health.pending / health.processing_rate) * 10) / 10
      : "∞";
    msg += `⏱️ ETA: ${etaHours} hours\n`;
  }

  return msg;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    // Parse action from body or default to "check"
    let action = "check";
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      action = body.action || "check";
    } else if (req.method === "GET") {
      action = "status";
    }

    // Get current health
    const health = await getQueueHealth(supabase);
    const issues = analyzeIssues(health);

    let actions_taken: string[] = [];
    let alerts_sent = false;

    if (action === "alert_test") {
      // Test alert functionality
      alerts_sent = await sendTelegramAlert(formatStatusMessage(health));
      return new Response(
        JSON.stringify({ success: true, alerts_sent, health }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "status") {
      // Just return status for dashboard
      return new Response(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          health,
          issues,
          healthy: issues.length === 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // For "check" and "recover" actions, run recovery if needed
    if (issues.length > 0) {
      actions_taken = await runRecoveryActions(supabase, health);

      // Only alert if there are issues that weren't auto-fixed
      // or if there are critical issues
      const criticalIssues = issues.filter(i =>
        i.includes("error rate") ||
        i.includes("No active workers") ||
        i.includes("Low throughput")
      );

      if (criticalIssues.length > 0 || (issues.length > 0 && action === "recover")) {
        const alertMsg = formatAlertMessage(health, issues, actions_taken);
        alerts_sent = await sendTelegramAlert(alertMsg);
      }
    }

    const result: WatchdogResult = {
      timestamp: new Date().toISOString(),
      health,
      issues,
      actions_taken,
      alerts_sent,
      next_check: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };

    // Log result
    try {
      await supabase.from("watchdog_runs").insert({
        health,
        issues,
        actions_taken,
        alerts_sent,
      });
    } catch { /* Ignore if table doesn't exist */ }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[Watchdog] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
