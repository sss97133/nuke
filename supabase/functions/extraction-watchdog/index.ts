/**
 * Extraction Watchdog - Autonomous Health Recovery
 *
 * Philosophy: Fix it silently. Only notify humans when you genuinely can't.
 *
 * Every 5 minutes (via pg_cron):
 * 1. Analyze queue health PER SOURCE (not just global averages)
 * 2. Circuit-break sources that are failing consistently
 * 3. Bulk-skip items that will never succeed
 * 4. Restart workers aggressively when queue is stalled
 * 5. Log everything to watchdog_runs for audit
 * 6. ONLY send Telegram if recovery failed across multiple cycles
 *
 * GET  /extraction-watchdog - Status dashboard
 * POST /extraction-watchdog - Run health check + recovery
 * Body: { action: "check" | "recover" | "status" | "alert_test" }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SourceHealth {
  source: string;
  pending: number;
  failed_last_hour: number;
  completed_last_hour: number;
  error_rate: number;
  top_error: string | null;
  top_error_count: number;
  stuck_items: number; // 5+ attempts, still pending
}

interface QueueHealth {
  pending: number;
  processing: number;
  complete: number;
  failed: number;
  skipped: number;
  stale_locks: number;
  stuck_items: number;
  processing_rate: number;
  error_rate: number;
  oldest_pending_hours: number;
  top_errors: Array<{ pattern: string; count: number }>;
  workers_active: number;
  by_source: SourceHealth[];
}

interface WatchdogResult {
  timestamp: string;
  health: QueueHealth;
  issues: string[];
  actions_taken: string[];
  alerts_sent: boolean;
  next_check: string;
}

const THRESHOLDS = {
  stale_lock_minutes: 15,
  stuck_attempts: 3,
  min_processing_rate: 10,
  max_error_rate: 20,
  max_pending_hours: 6,
  min_workers: 1,
  // Per-source circuit breaker
  source_error_rate_trip: 60,      // >60% error rate = circuit break this source
  source_min_sample: 5,            // Need at least 5 recent items to judge a source
  source_cooldown_hours: 2,        // How long to pause a tripped source
  // Hopeless item thresholds — must match processor's claim limit (p_max_attempts: 5)
  max_attempts_before_skip: 5,     // Skip items that hit the processor's retry ceiling
  max_same_error_before_bulk_skip: 50, // If 50+ items have the exact same error, skip them all
  // Notification - only after repeated recovery failures
  recovery_fail_cycles_before_alert: 3, // Alert after 3 consecutive cycles with unresolved issues
  alert_cooldown_minutes: 120,     // Minimum time between alerts
};

// Known sources for per-source analysis
const KNOWN_SOURCES = [
  "bringatrailer.com", "carsandbids.com", "collectingcars.com",
  "craigslist.org", "pcarmarket.com", "hagerty.com", "classic.com",
  "barnfinds.com", "mecum.com", "barrett-jackson.com",
  "broadarrowauctions.com", "ksl.com", "bonhams.com",
  "rmsothebys.com", "goodingco.com", "gaaclassiccars.com", "ebay.com",
];

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
      signal: AbortSignal.timeout(10000),
    });

    const result = await response.json();
    if (!result.ok) {
      console.error("[Watchdog] Telegram error:", result);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[Watchdog] Telegram send error:", e);
    return false;
  }
}

function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace("www.", "");
    // Match to known sources
    for (const source of KNOWN_SOURCES) {
      if (hostname.includes(source)) return source;
    }
    return hostname;
  } catch {
    return "unknown";
  }
}

async function getQueueHealth(supabase: any): Promise<QueueHealth> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const staleCutoff = new Date(Date.now() - THRESHOLDS.stale_lock_minutes * 60 * 1000).toISOString();

  // Parallel queries for speed
  const [
    { count: pending },
    { count: processing },
    { count: complete },
    { count: failed },
    { count: skipped },
    { count: staleLocks },
    { count: stuckItems },
    { count: completedLastHour },
    { count: failedLastHour },
    { data: oldestPending },
    { data: activeWorkers },
  ] = await Promise.all([
    supabase.from("import_queue").select("id", { count: "estimated", head: true }).eq("status", "pending"),
    supabase.from("import_queue").select("id", { count: "estimated", head: true }).eq("status", "processing"),
    supabase.from("import_queue").select("id", { count: "estimated", head: true }).eq("status", "complete"),
    supabase.from("import_queue").select("id", { count: "estimated", head: true }).eq("status", "failed"),
    supabase.from("import_queue").select("id", { count: "estimated", head: true }).eq("status", "skipped"),
    supabase.from("import_queue").select("id", { count: "estimated", head: true }).eq("status", "processing").lt("locked_at", staleCutoff),
    supabase.from("import_queue").select("id", { count: "estimated", head: true }).eq("status", "pending").gte("attempts", THRESHOLDS.stuck_attempts),
    supabase.from("import_queue").select("id", { count: "estimated", head: true }).eq("status", "complete").gte("processed_at", oneHourAgo),
    supabase.from("import_queue").select("id", { count: "estimated", head: true }).eq("status", "failed").gte("processed_at", oneHourAgo),
    supabase.from("import_queue").select("created_at").eq("status", "pending").order("created_at", { ascending: true }).limit(1).maybeSingle(),
    supabase.from("import_queue").select("locked_by").eq("status", "processing").gte("locked_at", staleCutoff),
  ]);

  const totalRecent = (completedLastHour || 0) + (failedLastHour || 0);
  const errorRate = totalRecent > 0 ? ((failedLastHour || 0) / totalRecent) * 100 : 0;
  const oldestPendingHours = oldestPending
    ? (Date.now() - new Date(oldestPending.created_at).getTime()) / (1000 * 60 * 60)
    : 0;
  const uniqueWorkers = new Set((activeWorkers || []).map((w: any) => w.locked_by).filter(Boolean));

  // Per-source error analysis — query recent failures grouped by domain
  const { data: recentFailed } = await supabase
    .from("import_queue")
    .select("listing_url, error_message, failure_category")
    .eq("status", "failed")
    .gte("processed_at", oneHourAgo)
    .limit(500);

  const { data: recentComplete } = await supabase
    .from("import_queue")
    .select("listing_url")
    .eq("status", "complete")
    .gte("processed_at", oneHourAgo)
    .limit(500);

  // Build per-source stats
  const sourceStats: Record<string, { failed: number; completed: number; errors: Record<string, number> }> = {};
  for (const row of recentFailed || []) {
    const domain = extractDomain(row.listing_url || "");
    if (!sourceStats[domain]) sourceStats[domain] = { failed: 0, completed: 0, errors: {} };
    sourceStats[domain].failed++;
    if (row.error_message) {
      const normalized = row.error_message.slice(0, 80).replace(/\d{10,}/g, "[ID]").replace(/https?:\/\/[^\s]+/g, "[URL]");
      sourceStats[domain].errors[normalized] = (sourceStats[domain].errors[normalized] || 0) + 1;
    }
  }
  for (const row of recentComplete || []) {
    const domain = extractDomain(row.listing_url || "");
    if (!sourceStats[domain]) sourceStats[domain] = { failed: 0, completed: 0, errors: {} };
    sourceStats[domain].completed++;
  }

  // Get pending counts per source (sample-based to avoid slow full scan)
  const { data: pendingSample } = await supabase
    .from("import_queue")
    .select("listing_url")
    .eq("status", "pending")
    .limit(1000);

  const pendingBySource: Record<string, number> = {};
  for (const row of pendingSample || []) {
    const domain = extractDomain(row.listing_url || "");
    pendingBySource[domain] = (pendingBySource[domain] || 0) + 1;
  }

  // Get stuck items per source
  const { data: stuckSample } = await supabase
    .from("import_queue")
    .select("listing_url")
    .eq("status", "pending")
    .gte("attempts", 5)
    .limit(1000);

  const stuckBySource: Record<string, number> = {};
  for (const row of stuckSample || []) {
    const domain = extractDomain(row.listing_url || "");
    stuckBySource[domain] = (stuckBySource[domain] || 0) + 1;
  }

  // Compile per-source health
  const allDomains = new Set([...Object.keys(sourceStats), ...Object.keys(pendingBySource)]);
  const bySource: SourceHealth[] = [];
  for (const domain of allDomains) {
    const stats = sourceStats[domain] || { failed: 0, completed: 0, errors: {} };
    const total = stats.failed + stats.completed;
    const topErrorEntry = Object.entries(stats.errors).sort((a, b) => b[1] - a[1])[0];
    bySource.push({
      source: domain,
      pending: pendingBySource[domain] || 0,
      failed_last_hour: stats.failed,
      completed_last_hour: stats.completed,
      error_rate: total >= THRESHOLDS.source_min_sample ? Math.round((stats.failed / total) * 100) : 0,
      top_error: topErrorEntry ? topErrorEntry[0] : null,
      top_error_count: topErrorEntry ? topErrorEntry[1] : 0,
      stuck_items: stuckBySource[domain] || 0,
    });
  }
  bySource.sort((a, b) => b.failed_last_hour - a.failed_last_hour);

  // Global top errors
  const errorCounts: Record<string, number> = {};
  for (const row of recentFailed || []) {
    if (row.error_message) {
      let pattern = row.error_message.slice(0, 100);
      pattern = pattern.replace(/\d{10,}/g, "[ID]").replace(/https?:\/\/[^\s]+/g, "[URL]");
      errorCounts[pattern] = (errorCounts[pattern] || 0) + 1;
    }
  }
  const topErrors = Object.entries(errorCounts)
    .map(([pattern, count]) => ({ pattern, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    pending: pending || 0,
    processing: processing || 0,
    complete: complete || 0,
    failed: failed || 0,
    skipped: skipped || 0,
    stale_locks: staleLocks || 0,
    stuck_items: stuckItems || 0,
    processing_rate: completedLastHour || 0,
    error_rate: Math.round(errorRate * 10) / 10,
    oldest_pending_hours: Math.round(oldestPendingHours * 10) / 10,
    top_errors: topErrors,
    workers_active: uniqueWorkers.size,
    by_source: bySource,
  };
}

async function runRecoveryActions(supabase: any, health: QueueHealth): Promise<string[]> {
  const actions: string[] = [];
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  // ── 1. Clear stale locks ──
  if (health.stale_locks > 0) {
    const staleCutoff = new Date(Date.now() - THRESHOLDS.stale_lock_minutes * 60 * 1000).toISOString();
    const { data: cleared } = await supabase
      .from("import_queue")
      .update({ status: "pending", locked_by: null, locked_at: null })
      .eq("status", "processing")
      .lt("locked_at", staleCutoff)
      .select("id");
    if (cleared?.length > 0) {
      actions.push(`Cleared ${cleared.length} stale locks`);
    }
  }

  // Use RPC for bulk updates — Supabase JS .update().in() is unreliable and .limit() doesn't work on updates.
  // These run as raw SQL through a simple RPC wrapper for reliability.

  // ── 2. Skip hopeless items (too many attempts, will never work) ──
  try {
    const { data: skipResult } = await supabase.rpc("execute_recovery_sql", {
      p_sql: `UPDATE import_queue SET status = 'skipped', error_message = 'Skipped: exceeded max attempts'
              WHERE status = 'pending' AND attempts >= ${THRESHOLDS.max_attempts_before_skip}`,
    });
    const skipCount = skipResult?.[0]?.affected ?? 0;
    if (skipCount > 0) {
      actions.push(`Skipped ${skipCount} items that failed ${THRESHOLDS.max_attempts_before_skip}+ times — they'll never succeed`);
    }
  } catch {
    // Fallback to Supabase JS if RPC doesn't exist
    const { data: hopeless, error: hopelessErr } = await supabase
      .from("import_queue")
      .update({ status: "skipped", error_message: "Skipped: exceeded max attempts" })
      .eq("status", "pending")
      .gte("attempts", THRESHOLDS.max_attempts_before_skip)
      .select("id");
    if (hopelessErr) console.error("[Watchdog] Skip hopeless error:", hopelessErr.message);
    if (hopeless?.length > 0) {
      actions.push(`Skipped ${hopeless.length} items that failed ${THRESHOLDS.max_attempts_before_skip}+ times`);
    }
  }

  // ── 3. Mark duplicates as complete (data already exists) ──
  try {
    const { data: dupeResult } = await supabase.rpc("execute_recovery_sql", {
      p_sql: `UPDATE import_queue SET status = 'complete', error_message = 'Duplicate - data already exists'
              WHERE status IN ('failed', 'pending') AND failure_category = 'duplicate'`,
    });
    const dupeCount = dupeResult?.[0]?.affected ?? 0;
    if (dupeCount > 0) {
      actions.push(`Resolved ${dupeCount} duplicates — we already have this data`);
    }
  } catch {
    const { data: dupes, error: dupeErr } = await supabase
      .from("import_queue")
      .update({ status: "complete", error_message: "Duplicate - data already exists" })
      .eq("failure_category", "duplicate")
      .eq("status", "failed")
      .select("id");
    if (dupeErr) console.error("[Watchdog] Dupe resolve error:", dupeErr.message);
    if (dupes?.length > 0) {
      actions.push(`Resolved ${dupes.length} duplicates`);
    }
  }

  // ── 4. Skip gone/deleted items (404, 410, taken down) ──
  try {
    const { data: goneResult } = await supabase.rpc("execute_recovery_sql", {
      p_sql: `UPDATE import_queue SET status = 'skipped'
              WHERE status IN ('pending', 'failed')
              AND (error_message ILIKE '%410%' OR error_message ILIKE '%Gone%'
                   OR error_message ILIKE '%404%' OR error_message ILIKE '%not found%'
                   OR error_message ILIKE '%listing has ended%' OR error_message ILIKE '%no longer available%')`,
    });
    const goneCount = goneResult?.[0]?.affected ?? 0;
    if (goneCount > 0) {
      actions.push(`Skipped ${goneCount} listings that no longer exist`);
    }
  } catch {
    const { data: goneItems, error: goneErr } = await supabase
      .from("import_queue")
      .update({ status: "skipped" })
      .eq("status", "pending")
      .or("error_message.ilike.%410%,error_message.ilike.%404%,error_message.ilike.%not found%")
      .select("id");
    if (goneErr) console.error("[Watchdog] Gone skip error:", goneErr.message);
    if (goneItems?.length > 0) {
      actions.push(`Skipped ${goneItems.length} deleted listings`);
    }
  }

  // ── 5. Unstick retryable items with no next_attempt_at ──
  try {
    const { data: orphanResult } = await supabase.rpc("execute_recovery_sql", {
      p_sql: `UPDATE import_queue SET next_attempt_at = now()
              WHERE status = 'pending' AND attempts >= 1
              AND attempts < ${THRESHOLDS.max_attempts_before_skip}
              AND next_attempt_at IS NULL`,
    });
    const orphanCount = orphanResult?.[0]?.affected ?? 0;
    if (orphanCount > 0) {
      actions.push(`Unstuck ${orphanCount} items that were stuck with no retry time — queued for retry now`);
    }
  } catch {
    const { data: orphaned, error: orphanErr } = await supabase
      .from("import_queue")
      .update({ next_attempt_at: new Date().toISOString() })
      .eq("status", "pending")
      .lt("attempts", THRESHOLDS.max_attempts_before_skip)
      .gte("attempts", 1)
      .is("next_attempt_at", null)
      .select("id");
    if (orphanErr) console.error("[Watchdog] Orphan unstick error:", orphanErr.message);
    if (orphaned?.length > 0) {
      actions.push(`Unstuck ${orphaned.length} items for retry`);
    }
  }

  // ── 5b. Rescue orphaned 'failed' items back to 'pending' ──
  // The claim function only picks up status='pending'. Items set to status='failed'
  // by older code paths (process-import-queue) are permanently orphaned — never retried.
  // Any failed item with remaining attempts should be given another chance.
  try {
    const { data: rescueResult } = await supabase.rpc("execute_recovery_sql", {
      p_sql: `UPDATE import_queue
              SET status = 'pending',
                  next_attempt_at = now() + interval '5 minutes',
                  error_message = NULL,
                  failure_category = NULL
              WHERE status = 'failed'
                AND attempts < ${THRESHOLDS.max_attempts_before_skip}
                AND (failure_category NOT IN ('gone', 'auth_required', 'blocked', 'bad_data', 'non_vehicle', 'filtered')
                     OR failure_category IS NULL)
                AND error_message NOT ILIKE '%410%'
                AND error_message NOT ILIKE '%404%'
                AND error_message NOT ILIKE '%not found%'
                AND error_message NOT ILIKE '%requires login%'
                AND error_message NOT ILIKE '%permanently unavailable%'`,
    });
    const rescueCount = rescueResult?.[0]?.affected ?? 0;
    if (rescueCount > 0) {
      actions.push(`Rescued ${rescueCount} orphaned failed items back to pending for retry`);
    }
  } catch (err) {
    console.error("[Watchdog] Rescue failed items error:", err);
  }

  // ── 6. Per-source circuit breaker ──
  // If a source has high error rate, pause all its pending items instead of
  // letting the processor churn through them and fail repeatedly.
  const trippedSources: string[] = [];
  for (const source of health.by_source) {
    if (
      source.error_rate >= THRESHOLDS.source_error_rate_trip &&
      (source.failed_last_hour + source.completed_last_hour) >= THRESHOLDS.source_min_sample
    ) {
      trippedSources.push(source.source);
      const cooldownUntil = new Date(Date.now() + THRESHOLDS.source_cooldown_hours * 60 * 60 * 1000).toISOString();

      // Pause pending items for this source by pushing next_attempt_at forward
      const { data: paused } = await supabase
        .from("import_queue")
        .update({ next_attempt_at: cooldownUntil })
        .eq("status", "pending")
        .like("listing_url", `%${source.source}%`)
        .lt("attempts", THRESHOLDS.max_attempts_before_skip)
        .or(`next_attempt_at.is.null,next_attempt_at.lt.${new Date().toISOString()}`)
        .select("id")
        .limit(5000);

      if (paused?.length > 0) {
        actions.push(`Circuit-break ${source.source}: paused ${paused.length} items for ${THRESHOLDS.source_cooldown_hours}h (${source.error_rate}% error rate, top: ${source.top_error?.slice(0, 40) || "unknown"})`);
      }
    }
  }

  // ── 7. Reset rate-limited items that have cooled off ──
  const { data: rateLimited } = await supabase
    .from("import_queue")
    .update({ status: "pending", next_attempt_at: null, attempts: 0 })
    .eq("status", "pending")
    .eq("failure_category", "rate_limited")
    .lt("next_attempt_at", new Date().toISOString())
    .select("id")
    .limit(1000);
  if (rateLimited?.length > 0) {
    actions.push(`Reset ${rateLimited.length} rate-limited items (cooled off)`);
  }

  // ── 8. Bulk-skip repeated identical errors ──
  // If 50+ pending items share the exact same error, they're all going to fail the same way.
  for (const err of health.top_errors) {
    if (err.count >= THRESHOLDS.max_same_error_before_bulk_skip) {
      // Only skip if this error is not transient (not rate-limited, not timeout)
      const isTransient = err.pattern.includes("RATE_LIMITED") || err.pattern.includes("429") ||
        err.pattern.includes("timeout") || err.pattern.includes("Timeout");
      if (!isTransient) {
        const { data: bulkSkipped } = await supabase
          .from("import_queue")
          .update({ status: "skipped", error_message: `Bulk-skipped: ${err.pattern.slice(0, 80)}` })
          .eq("status", "failed")
          .like("error_message", `${err.pattern.slice(0, 60)}%`)
          .select("id")
          .limit(2000);
        if (bulkSkipped?.length > 0) {
          actions.push(`Bulk-skipped ${bulkSkipped.length} items with repeated error: "${err.pattern.slice(0, 50)}"`);
        }
      }
    }
  }

  // ── 9. Restart workers aggressively when queue is stalled ──
  if (health.pending > 50 && health.workers_active === 0 && health.processing === 0) {
    // Don't restart if all sources are circuit-broken
    const allTripped = health.by_source.every(s =>
      trippedSources.includes(s.source) || s.pending === 0
    );

    if (!allTripped) {
      let workersStarted = 0;
      // Fire off 3 concurrent processors to get things moving fast
      const workerPromises = Array.from({ length: 3 }, (_, i) =>
        fetch(`${supabaseUrl}/functions/v1/continuous-queue-processor`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            batch_size: 20,
            source: "all",
            continuous: true,
            max_runtime_seconds: 250,
          }),
          signal: AbortSignal.timeout(10_000), // Don't wait for completion
        }).then(() => { workersStarted++; }).catch(() => {})
      );

      // Wait briefly for the requests to fire (not for them to complete)
      await Promise.allSettled(workerPromises);
      if (workersStarted > 0) {
        actions.push(`Launched ${workersStarted} continuous queue processors`);
      }
    } else {
      actions.push("All sources circuit-broken, not starting workers (waiting for cooldown)");
    }
  }

  // ── 10. Log recovery ──
  if (actions.length > 0) {
    try {
      await supabase.from("sentinel_alerts").insert({
        severity: "info",
        type: "watchdog_recovery",
        message: actions.join("; "),
        data: { health: { pending: health.pending, failed: health.failed, error_rate: health.error_rate }, actions, tripped_sources: trippedSources },
      });
    } catch { /* table may not exist */ }
  }

  return actions;
}

function analyzeIssues(health: QueueHealth): string[] {
  const issues: string[] = [];

  if (health.stale_locks > 0) {
    issues.push(`${health.stale_locks} stale locks`);
  }
  if (health.stuck_items > 10) {
    issues.push(`${health.stuck_items} items stuck after ${THRESHOLDS.stuck_attempts}+ attempts`);
  }
  if (health.processing_rate < THRESHOLDS.min_processing_rate && health.pending > 100) {
    issues.push(`Low throughput: ${health.processing_rate}/hr (${health.pending} pending)`);
  }
  if (health.error_rate > THRESHOLDS.max_error_rate) {
    issues.push(`Error rate: ${health.error_rate}%`);
  }
  if (health.workers_active < THRESHOLDS.min_workers && health.pending > 0) {
    issues.push(`No active workers (${health.pending} pending)`);
  }

  // Per-source issues
  for (const source of health.by_source) {
    if (source.error_rate >= THRESHOLDS.source_error_rate_trip &&
        (source.failed_last_hour + source.completed_last_hour) >= THRESHOLDS.source_min_sample) {
      issues.push(`${source.source}: ${source.error_rate}% error rate (${source.top_error?.slice(0, 40) || "various"})`);
    }
  }

  return issues;
}

/**
 * Decide if we should bother the human.
 * Only alert if recovery has been failing for multiple consecutive cycles.
 */
async function shouldAlertHuman(
  supabase: any,
  currentIssues: string[],
  actionsTaken: string[]
): Promise<{ send: boolean; reason: string }> {
  if (currentIssues.length === 0) {
    return { send: false, reason: "no_issues" };
  }

  // If we took recovery actions, give them time to work
  if (actionsTaken.length > 0) {
    return { send: false, reason: "recovery_actions_taken_this_cycle" };
  }

  try {
    // Check recent watchdog runs — have we been stuck with issues for N cycles?
    const { data: recentRuns } = await supabase
      .from("watchdog_runs")
      .select("created_at, issues, actions_taken, alerts_sent")
      .order("created_at", { ascending: false })
      .limit(THRESHOLDS.recovery_fail_cycles_before_alert + 1);

    if (!recentRuns || recentRuns.length < THRESHOLDS.recovery_fail_cycles_before_alert) {
      return { send: false, reason: "not_enough_history" };
    }

    // Check if the last N runs all had unresolved issues with no effective actions
    const stuckCycles = recentRuns.filter((run: any) =>
      run.issues?.length > 0 && (run.actions_taken?.length || 0) === 0
    ).length;

    if (stuckCycles < THRESHOLDS.recovery_fail_cycles_before_alert) {
      return { send: false, reason: `only ${stuckCycles}/${THRESHOLDS.recovery_fail_cycles_before_alert} stuck cycles` };
    }

    // Check cooldown — don't spam even when stuck
    const lastAlerted = recentRuns.find((r: any) => r.alerts_sent);
    if (lastAlerted) {
      const minutesSince = (Date.now() - new Date(lastAlerted.created_at).getTime()) / (1000 * 60);
      if (minutesSince < THRESHOLDS.alert_cooldown_minutes) {
        return { send: false, reason: `cooldown (${Math.round(minutesSince)}m since last alert)` };
      }
    }

    return { send: true, reason: `${stuckCycles} consecutive cycles with unresolved issues, no recovery possible` };
  } catch {
    return { send: false, reason: "history_check_failed" };
  }
}

/**
 * Write notifications like a human would explain the situation to you.
 * No stat dumps. Tell the story: what's wrong, why, what was tried, what needs you.
 */
function describeErrorCause(error: string): string {
  if (!error) return "unknown reason";
  const e = error.toLowerCase();
  if (e.includes("rate_limited") || e.includes("429")) return "the site is rate-limiting us (too many requests)";
  if (e.includes("blocked") || e.includes("403") || e.includes("cloudflare")) return "the site is actively blocking our scraper";
  if (e.includes("timeout")) return "pages are timing out (site may be slow or down)";
  if (e.includes("404") || e.includes("not found")) return "the listings no longer exist";
  if (e.includes("410") || e.includes("gone")) return "the listings have been permanently removed";
  if (e.includes("redirect")) return "the site is redirecting us away from the listings";
  if (e.includes("duplicate key")) return "we already have this data";
  if (e.includes("invalid_page") || e.includes("missing required")) return "the page structure changed and our extractor can't parse it";
  if (e.includes("extraction failed")) return "the extractor couldn't pull data from the page";
  if (e.includes("no longer available")) return "the listings were taken down";
  return `"${error.slice(0, 60)}"`;
}

function formatAlertMessage(health: QueueHealth, issues: string[], actions: string[]): string {
  let msg = `<b>Watchdog needs your help</b>\n\n`;

  // Build a narrative, not a stat dump
  const trippedSources = health.by_source.filter(s =>
    s.error_rate >= THRESHOLDS.source_error_rate_trip &&
    (s.failed_last_hour + s.completed_last_hour) >= THRESHOLDS.source_min_sample
  );

  if (trippedSources.length > 0) {
    msg += `I've been trying to fix this but these sources keep failing:\n\n`;
    for (const s of trippedSources.slice(0, 4)) {
      const cause = describeErrorCause(s.top_error || "");
      msg += `<b>${s.source}</b> — ${cause}. `;
      msg += `${s.failed_last_hour} of the last ${s.failed_last_hour + s.completed_last_hour} attempts failed. `;
      msg += `I paused this source to stop wasting requests.\n\n`;
    }
  }

  if (health.workers_active === 0 && health.pending > 0) {
    msg += `Extraction has stalled — no workers are running. `;
    msg += `I tried restarting them but they keep dying. `;
    const topErr = health.top_errors[0];
    if (topErr) {
      msg += `The most common error is ${describeErrorCause(topErr.pattern)}.\n\n`;
    } else {
      msg += `No recent errors, so they may be crashing on startup.\n\n`;
    }
  }

  if (health.error_rate > THRESHOLDS.max_error_rate && trippedSources.length === 0) {
    msg += `Overall error rate is ${health.error_rate}% in the last hour. `;
    const topErr = health.top_errors[0];
    if (topErr) {
      msg += `Main cause: ${describeErrorCause(topErr.pattern)}.\n\n`;
    }
  }

  // What was tried
  if (actions.length > 0) {
    msg += `<b>What I tried:</b> `;
    const summaries: string[] = [];
    for (const a of actions) {
      if (a.includes("Circuit-break")) summaries.push("paused failing sources");
      else if (a.includes("Launched")) summaries.push("restarted workers");
      else if (a.includes("Skipped") || a.includes("Bulk-skipped")) summaries.push("cleared out hopeless items");
      else if (a.includes("stale locks")) summaries.push("freed stuck workers");
      else if (a.includes("duplicate")) summaries.push("resolved duplicates");
      else if (a.includes("rate-limited")) summaries.push("reset rate-limited items");
      else if (a.includes("Unstuck")) summaries.push("unstuck orphaned items for retry");
    }
    msg += [...new Set(summaries)].join(", ") + ".\n\n";
  }

  // What you should do
  msg += `<b>Might need:</b> `;
  if (trippedSources.some(s => (s.top_error || "").toLowerCase().includes("blocked") || (s.top_error || "").toLowerCase().includes("cloudflare"))) {
    msg += `Check if our IP is blocked or if the site added new bot protection. `;
  }
  if (trippedSources.some(s => (s.top_error || "").toLowerCase().includes("invalid_page") || (s.top_error || "").toLowerCase().includes("missing required"))) {
    msg += `A site may have changed its page layout — the extractor needs updating. `;
  }
  if (health.workers_active === 0 && health.pending > 0) {
    msg += `Check edge function logs for why processors keep dying.`;
  }

  return msg;
}

function formatStatusMessage(health: QueueHealth): string {
  const trippedSources = health.by_source.filter(s =>
    s.error_rate >= THRESHOLDS.source_error_rate_trip &&
    (s.failed_last_hour + s.completed_last_hour) >= THRESHOLDS.source_min_sample
  );

  let msg = "";

  // Lead with the story, not numbers
  if (trippedSources.length === 0 && health.error_rate < THRESHOLDS.max_error_rate &&
      (health.pending === 0 || health.workers_active > 0)) {
    msg += `<b>Extraction running smoothly</b>\n\n`;
    if (health.processing_rate > 0) {
      msg += `Processing about ${health.processing_rate} listings per hour`;
      if (health.pending > 0) {
        const etaHours = Math.round((health.pending / health.processing_rate) * 10) / 10;
        msg += ` with ${health.pending.toLocaleString()} still in the queue (~${etaHours}h remaining)`;
      }
      msg += `.`;
    } else if (health.pending === 0) {
      msg += `Queue is empty — all caught up.`;
    }
  } else {
    msg += `<b>Extraction status</b>\n\n`;

    if (health.workers_active === 0 && health.pending > 0) {
      msg += `Workers are down. ${health.pending.toLocaleString()} listings waiting.\n`;
    } else if (health.processing_rate > 0) {
      msg += `Running at ${health.processing_rate}/hr with ${health.pending.toLocaleString()} in queue.\n`;
    }

    if (health.error_rate > 0) {
      const topErr = health.top_errors[0];
      msg += `\nError rate: ${health.error_rate}%`;
      if (topErr) msg += ` — mostly ${describeErrorCause(topErr.pattern)}`;
      msg += `.\n`;
    }

    if (trippedSources.length > 0) {
      msg += `\nPaused sources:\n`;
      for (const s of trippedSources) {
        msg += `• ${s.source} — ${describeErrorCause(s.top_error || "")}\n`;
      }
    }
  }

  msg += `\n\n${health.complete.toLocaleString()} extracted, ${health.failed.toLocaleString()} failed, ${health.skipped.toLocaleString()} skipped`;

  return msg;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    let action = "check";
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      action = body.action || "check";
    } else if (req.method === "GET") {
      action = "status";
    }

    const health = await getQueueHealth(supabase);
    const issues = analyzeIssues(health);

    let actions_taken: string[] = [];
    let alerts_sent = false;

    if (action === "alert_test") {
      alerts_sent = await sendTelegramAlert(formatStatusMessage(health));
      return new Response(
        JSON.stringify({ success: true, alerts_sent, health }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "status") {
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

    // ── Main recovery loop ──
    // Always run recovery if there are any issues — don't just report them.
    if (issues.length > 0) {
      actions_taken = await runRecoveryActions(supabase, health);
      console.log(`[Watchdog] Issues: ${issues.length}, Actions: ${actions_taken.length}`);

      // Only alert if recovery keeps failing
      const alertDecision = await shouldAlertHuman(supabase, issues, actions_taken);
      if (alertDecision.send) {
        const alertMsg = formatAlertMessage(health, issues, actions_taken);
        alerts_sent = await sendTelegramAlert(alertMsg);
        console.log(`[Watchdog] Alert sent: ${alertDecision.reason}`);
      } else {
        console.log(`[Watchdog] No alert: ${alertDecision.reason}`);
      }
    } else {
      console.log("[Watchdog] All clear");
    }

    const result: WatchdogResult = {
      timestamp: new Date().toISOString(),
      health,
      issues,
      actions_taken,
      alerts_sent,
      next_check: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };

    // Log to watchdog_runs
    try {
      await supabase.from("watchdog_runs").insert({
        health,
        issues,
        actions_taken,
        alerts_sent,
      });
    } catch { /* table may not exist */ }

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
