import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Bulk Enqueue Inventory Extraction
 * 
 * Finds organizations with missing or low inventory and queues them for extraction.
 * This is the easy way to backfill all missing vehicle inventories.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type RequestBody = {
  run_mode?: "current" | "sold" | "both";
  limit?: number;
  only_with_website?: boolean;
  min_inventory_threshold?: number; // Only queue orgs with inventory count below this
  business_type?: string; // Filter by business_type (e.g., 'dealer', 'auction_house')
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl) throw new Error("Missing SUPABASE_URL in function env");
    if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY in function env");

    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    const body: RequestBody = await req.json().catch(() => ({} as any));
    const runMode: "current" | "sold" | "both" = body.run_mode || "both";
    const limit = Math.max(1, Math.min(toInt(body.limit, 1000), 5000));
    const onlyWithWebsite = body.only_with_website !== false; // default true
    const minInventoryThreshold = toInt(body.min_inventory_threshold, 5); // default: queue if < 5 vehicles
    const requeueFailed = body.requeue_failed !== false; // default true
    const dryRun = body.dry_run === true;

    console.log(`🔍 Finding organizations with missing inventory...`);
    console.log(`   - Run mode: ${runMode}`);
    console.log(`   - Limit: ${limit}`);
    console.log(`   - Only with website: ${onlyWithWebsite}`);
    console.log(`   - Min inventory threshold: ${minInventoryThreshold}`);
    console.log(`   - Business type filter: ${body.business_type || "all"}`);

    // 1) Find organizations with low/no inventory
    let query = supabase
      .from("businesses")
      .select(`
        id,
        business_name,
        website,
        business_type,
        total_vehicles,
        (
          SELECT COUNT(*)
          FROM organization_vehicles
          WHERE organization_id = businesses.id
          AND status = 'active'
        ) as active_vehicle_count
      `)
      .eq("is_public", true)
      .order("created_at", { ascending: true })
      .limit(limit);

    // Filter by business type if specified
    if (body.business_type) {
      query = query.eq("business_type", body.business_type);
    }

    // Filter by website if required
    if (onlyWithWebsite) {
      query = query.not("website", "is", null);
    }

    const { data: orgs, error: orgErr } = await query;

    if (orgErr) throw new Error(`businesses select failed: ${orgErr.message}`);

    const all = Array.isArray(orgs) ? orgs : [];
    
    // Filter to organizations with low inventory
    const candidates = all.filter((o: any) => {
      if (!o?.id) return false;
      if (onlyWithWebsite && !safeString(o.website)) return false;
      
      // Check if inventory is below threshold
      const vehicleCount = o.active_vehicle_count || o.total_vehicles || 0;
      return vehicleCount < minInventoryThreshold;
    });

    console.log(`   Found ${candidates.length} organizations with low inventory (out of ${all.length} total)`);

    const candidateIds = candidates.map((o: any) => String(o.id));

    // 2) Check which are already queued
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

    console.log(`   - Already queued: ${alreadyQueued.size}`);
    console.log(`   - Failed/skipped: ${failedQueued.size}`);
    console.log(`   - New to queue: ${toInsert.length}`);

    // 3) Insert missing queue rows
    const now = new Date().toISOString();
    const rows = toInsert.map((organizationId) => ({
      organization_id: organizationId,
      run_mode: runMode,
      status: "pending" as const,
      attempts: 0,
      last_error: null,
      last_run_at: null,
      next_run_at: null,
      updated_at: now,
    }));

    let inserted = 0;
    if (!dryRun && rows.length > 0) {
      const { error: upErr } = await supabase
        .from("organization_inventory_sync_queue")
        .upsert(rows, { onConflict: "organization_id,run_mode" } as any);
      
      if (upErr) throw new Error(`organization_inventory_sync_queue upsert failed: ${upErr.message}`);
      inserted = rows.length;
      console.log(`✅ Queued ${inserted} organizations for inventory extraction`);
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
            .update({ 
              status: "pending", 
              next_run_at: null, 
              updated_at: now,
              attempts: 0 // Reset attempts for retry
            } as any)
            .eq("run_mode", runMode)
            .in("organization_id", chunk);
          
          if (updErr) throw new Error(`organization_inventory_sync_queue requeue failed: ${updErr.message}`);
        }
        requeued += chunk.length;
      }
      console.log(`✅ Requeued ${requeued} previously failed organizations`);
    }

    // 5) Sample of organizations queued
    const sample = candidates
      .filter((o: any) => toInsert.includes(String(o.id)))
      .slice(0, 10)
      .map((o: any) => ({
        id: o.id,
        name: o.business_name,
        website: o.website,
        current_inventory: o.active_vehicle_count || o.total_vehicles || 0,
      }));

    return new Response(
      JSON.stringify({
        success: true,
        dry_run: dryRun,
        run_mode: runMode,
        stats: {
          total_orgs_checked: all.length,
          candidates_with_low_inventory: candidates.length,
          already_queued: alreadyQueued.size,
          newly_queued: inserted,
          requeued_failed: requeued,
        },
        sample_queued: sample,
        next_steps: [
          "Run `process-inventory-sync-queue` to start extracting inventory",
          "Or wait for the cron job to process the queue automatically",
        ],
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("Error:", err);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: err?.message || String(err),
        stack: err?.stack 
      }), 
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

