import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type RunMode = "current" | "sold" | "both";

type RequestBody = {
  run_mode?: RunMode;
  limit?: number;
  only_with_website?: boolean;
  requeue_failed?: boolean;
  dry_run?: boolean;
};

function toInt(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function safeString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function isRunMode(v: unknown): v is RunMode {
  return v === "current" || v === "sold" || v === "both";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl) throw new Error("Missing SUPABASE_URL in function env");
    if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY in function env");

    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    const body: RequestBody = await req.json().catch(() => ({} as any));
    const runMode: RunMode = isRunMode(body.run_mode) ? body.run_mode : "current";
    const limit = Math.max(1, Math.min(toInt(body.limit, 5000), 5000));
    const onlyWithWebsite = body.only_with_website !== false; // default true
    const requeueFailed = body.requeue_failed !== false; // default true
    const dryRun = body.dry_run === true || body.dry_run === (true as any) || body.dry_run === ("true" as any) || body.dry_run === undefined ? body.dry_run === true : false;

    // 1) Load BaT local partners org IDs
    // Prefer discovered_via, fallback to metadata presence.
    const { data: orgs, error: orgErr } = await supabase
      .from("businesses")
      .select("id, website, discovered_via, metadata")
      .or("discovered_via.eq.bat_local_partners,metadata->bat_local_partners.not.is.null")
      .order("created_at", { ascending: true })
      .limit(limit);

    if (orgErr) throw new Error(`businesses select failed: ${orgErr.message}`);

    const all = Array.isArray(orgs) ? orgs : [];
    const candidates = all.filter((o: any) => {
      if (!o?.id) return false;
      if (!onlyWithWebsite) return true;
      return !!safeString(o.website);
    });

    const candidateIds = candidates.map((o: any) => String(o.id));

    // 2) Determine which are already queued for this run_mode
    const alreadyQueued = new Set<string>();
    const failedQueued = new Set<string>();
    const chunkSize = 500;
    for (let i = 0; i < candidateIds.length; i += chunkSize) {
      const chunk = candidateIds.slice(i, i + chunkSize);
      const { data, error } = await supabase
        .from("organization_inventory_sync_queue")
        .select("organization_id, status")
        .eq("run_mode", runMode)
        .in("organization_id", chunk);
      if (error || !Array.isArray(data)) continue;
      for (const row of data) {
        const id = row?.organization_id ? String(row.organization_id) : null;
        if (!id) continue;
        alreadyQueued.add(id);
        if (String(row?.status || "") === "failed" || String(row?.status || "") === "skipped") {
          failedQueued.add(id);
        }
      }
    }

    const toInsert = candidateIds.filter((id) => !alreadyQueued.has(id));

    // 3) Insert missing queue rows
    const now = new Date().toISOString();
    const rows = toInsert.map((organizationId) => ({
      organization_id: organizationId,
      run_mode: runMode,
      status: "pending",
      attempts: 0,
      last_error: null,
      last_run_at: null,
      next_run_at: null,
      updated_at: now,
    }));

    let inserted = 0;
    if (!dryRun && rows.length) {
      const { error: upErr } = await supabase
        .from("organization_inventory_sync_queue")
        .upsert(rows, { onConflict: "organization_id,run_mode" } as any);
      if (upErr) throw new Error(`organization_inventory_sync_queue upsert failed: ${upErr.message}`);
      inserted = rows.length;
    }

    // 4) Requeue failed/skipped rows (optional)
    let requeued = 0;
    if (requeueFailed && failedQueued.size > 0) {
      const ids = Array.from(failedQueued);
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        if (!dryRun) {
          const { error: updErr } = await supabase
            .from("organization_inventory_sync_queue")
            .update({ status: "pending", next_run_at: null, updated_at: now } as any)
            .eq("run_mode", runMode)
            .in("organization_id", chunk);
          if (updErr) throw new Error(`organization_inventory_sync_queue requeue failed: ${updErr.message}`);
        }
        requeued += chunk.length;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        dry_run: dryRun,
        run_mode: runMode,
        found_orgs: all.length,
        candidates: candidates.length,
        already_queued: alreadyQueued.size,
        inserted,
        requeued_failed_or_skipped: requeued,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err?.message || String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});


