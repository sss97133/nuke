/**
 * agent-monitor — Reactive issue detection and routing
 *
 * Detects system issues and immediately creates agent_tasks routed
 * to the correct VP. Called by crons and by the COO on demand.
 *
 * POST /agent-monitor
 * Body: { action: "scan" | "brief" }
 *
 * "scan" → detect issues, create agent_tasks, return what was created
 * "brief" → return current task queue without creating new tasks
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

interface DetectedIssue {
  title: string;
  description: string;
  agent_type: string;
  priority: number;
  metadata: Record<string, unknown>;
}

async function detectIssues(): Promise<DetectedIssue[]> {
  const issues: DetectedIssue[] = [];

  // ── 1. Stale locks ───────────────────────────────────────────────
  try {
    const { data: locks } = await supabase.rpc("release_stale_locks", { dry_run: true });
    if (locks && locks.length > 0) {
      issues.push({
        title: `${locks.length} stale locks detected`,
        description: `Records locked >30min: ${JSON.stringify(locks.map((l: any) => l.table_name))}`,
        agent_type: "vp-platform",
        priority: 70,
        metadata: { locks, auto_fix: "SELECT release_stale_locks();" },
      });
    }
  } catch (_) { /* non-fatal */ }

  // ── 2. Import queue backlog ──────────────────────────────────────
  try {
    const { data: queueStats } = await supabase
      .from("import_queue")
      .select("status", { count: "exact" })
      .eq("status", "pending");

    const pendingCount = queueStats?.length ?? 0;
    if (pendingCount > 500) {
      issues.push({
        title: `Import queue backlog: ${pendingCount} pending`,
        description: "Queue depth exceeds 500 — extraction may be stalled or demand spiked",
        agent_type: "vp-extraction",
        priority: 80,
        metadata: { pending_count: pendingCount },
      });
    }
  } catch (_) { /* non-fatal */ }

  // ── 3. BaT extraction queue stuck ───────────────────────────────
  try {
    const { data: batStuck } = await supabase
      .from("bat_extraction_queue")
      .select("id", { count: "exact" })
      .eq("status", "processing")
      .lt("locked_at", new Date(Date.now() - 45 * 60 * 1000).toISOString());

    if ((batStuck?.length ?? 0) > 0) {
      issues.push({
        title: `${batStuck!.length} BaT tasks stuck in processing >45min`,
        description: "BaT extraction workers may have crashed mid-run",
        agent_type: "vp-extraction",
        priority: 75,
        metadata: { stuck_count: batStuck!.length },
      });
    }
  } catch (_) { /* non-fatal */ }

  // ── 4. Vehicle image quality backfill progress ───────────────────
  try {
    const { data: unscored } = await supabase
      .from("vehicles")
      .select("id", { count: "exact" })
      .is("data_quality_score", null)
      .eq("status", "active");

    if ((unscored?.length ?? 0) > 100) {
      issues.push({
        title: `${unscored!.length} active vehicles missing quality score`,
        description: "Quality backfill may be falling behind or stalled",
        agent_type: "vp-platform",
        priority: 45,
        metadata: { unscored_count: unscored!.length },
      });
    }
  } catch (_) { /* non-fatal */ }

  // ── 5. Vehicles missing YMM ─────────────────────────────────────
  try {
    const { data: noYMM } = await supabase
      .from("vehicles")
      .select("id", { count: "exact" })
      .is("year", null)
      .eq("status", "active");

    if ((noYMM?.length ?? 0) > 50) {
      issues.push({
        title: `${noYMM!.length} active vehicles missing year/make/model`,
        description: "YMM propagation backfill needed — affects valuation and search quality",
        agent_type: "vp-vehicle-intel",
        priority: 60,
        metadata: { count: noYMM!.length, fix: "batch-ymm-propagate" },
      });
    }
  } catch (_) { /* non-fatal */ }

  // ── 6. YONO sidecar down ─────────────────────────────────────────
  // (checked via env — if YONO_SIDECAR_URL is set but unreachable)
  const sidecarUrl = Deno.env.get("YONO_SIDECAR_URL") || "http://127.0.0.1:8472";
  try {
    const res = await fetch(`${sidecarUrl}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) throw new Error("unhealthy");
  } catch {
    issues.push({
      title: "YONO sidecar unreachable",
      description: `Cannot reach ${sidecarUrl}/health — image classification falling back to cloud AI (cost impact)`,
      agent_type: "vp-ai",
      priority: 85,
      metadata: { sidecar_url: sidecarUrl, blocks: "sdk-v1.3.0" },
    });
  }

  return issues;
}

async function createTasksForIssues(issues: DetectedIssue[]) {
  const created = [];

  for (const issue of issues) {
    // Check if identical title already has a pending/in-progress task
    const { data: existing } = await supabase
      .from("agent_tasks")
      .select("id")
      .eq("title", issue.title)
      .in("status", ["pending", "claimed", "in_progress"])
      .limit(1);

    if (existing && existing.length > 0) {
      continue; // already being handled
    }

    const { data: task, error } = await supabase
      .from("agent_tasks")
      .insert({
        title: issue.title,
        description: issue.description,
        agent_type: issue.agent_type,
        priority: issue.priority,
        metadata: issue.metadata,
        status: "pending",
      })
      .select()
      .single();

    if (!error && task) {
      created.push(task);
    }
  }

  return created;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action = "scan" } = await req.json().catch(() => ({ action: "scan" }));

    if (action === "brief") {
      // Return pending tasks without creating new ones
      const { data: tasks } = await supabase
        .from("agent_tasks")
        .select("*")
        .in("status", ["pending", "claimed", "in_progress"])
        .order("priority", { ascending: false });

      return new Response(JSON.stringify({
        pending_tasks: tasks?.length ?? 0,
        tasks: tasks ?? [],
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Full scan
    const issues = await detectIssues();
    const created = await createTasksForIssues(issues);

    return new Response(JSON.stringify({
      scanned_at: new Date().toISOString(),
      issues_detected: issues.length,
      tasks_created: created.length,
      tasks: created,
      issues_skipped: issues.length - created.length,
      note: issues.length - created.length > 0
        ? "Some issues already have active tasks — not duplicated"
        : undefined,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
