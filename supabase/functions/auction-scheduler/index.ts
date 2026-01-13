import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

type SchedulerRequest = {
  start_batch_size?: number;
  end_batch_size?: number;
  dry_run?: boolean;
};

type SchedulerResult = {
  started: number;
  start_failed: number;
  ended: number;
  end_failed: number;
  start_ids: string[];
  end_ids: string[];
  errors: string[];
};

const jsonHeaders = { "Content-Type": "application/json" };

const safeIso = () => new Date().toISOString();

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    let payload = parts[1];
    payload = payload.replace(/-/g, "+").replace(/_/g, "/");
    // Pad base64 string
    while (payload.length % 4 !== 0) payload += "=";
    return JSON.parse(atob(payload)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  const startedAt = Date.now();
  const result: SchedulerResult = {
    started: 0,
    start_failed: 0,
    ended: 0,
    end_failed: 0,
    start_ids: [],
    end_ids: [],
    errors: [],
  };

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ success: false, error: "Method not allowed" }), {
        status: 405,
        headers: jsonHeaders,
      });
    }

    const body = (await req.json().catch(() => ({}))) as SchedulerRequest;
    const startBatchSize = Math.max(1, Math.min(200, Number(body.start_batch_size || 50)));
    const endBatchSize = Math.max(1, Math.min(200, Number(body.end_batch_size || 50)));
    const dryRun = body.dry_run === true;

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!supabaseUrl || !supabaseAnonKey) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing SUPABASE_URL or SUPABASE_ANON_KEY" }),
        { status: 500, headers: jsonHeaders }
      );
    }

    // This endpoint must only be callable by the scheduler/cron using the service role JWT.
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
    const payload = token ? decodeJwtPayload(token) : null;
    if (!payload || payload.role !== "service_role") {
      return new Response(JSON.stringify({ success: false, error: "Not authorized" }), {
        status: 403,
        headers: jsonHeaders,
      });
    }

    // Use the incoming Authorization header (service role) for server-only RPCs.
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });
    const nowIso = safeIso();

    // -------------------------
    // 1) Start due draft auctions
    // -------------------------
    let dueStarts: Array<{ listing_id: string }> = [];
    try {
      const rpc = await supabase.rpc("get_due_auction_starts", { p_limit: startBatchSize });
      if (rpc.error) throw rpc.error;
      dueStarts = (rpc.data as any[])?.map((r) => ({ listing_id: String((r as any).listing_id) })) || [];
    } catch {
      // Fallback: conservative query if RPC doesn't exist yet.
      const q = await supabase
        .from("vehicle_listings")
        .select("id")
        .eq("status", "draft")
        .in("sale_type", ["auction", "live_auction"])
        .lte("auction_start_time", nowIso)
        .limit(startBatchSize);
      dueStarts = (q.data || []).map((r: any) => ({ listing_id: String(r.id) }));
    }

    for (const row of dueStarts) {
      const listingId = row.listing_id;
      if (!listingId) continue;
      if (dryRun) {
        result.started += 1;
        result.start_ids.push(listingId);
        continue;
      }

      try {
        const rpc = await supabase.rpc("activate_auction_listing", {
          p_listing_id: listingId,
          p_use_scheduled_time: true,
        });
        if (rpc.error) throw rpc.error;
        const ok = (rpc.data as any)?.success === true;
        if (!ok) {
          result.start_failed += 1;
          result.errors.push(`Start ${listingId}: ${(rpc.data as any)?.error || "unknown error"}`);
          continue;
        }
        result.started += 1;
        result.start_ids.push(listingId);
      } catch (e: any) {
        result.start_failed += 1;
        result.errors.push(`Start ${listingId}: ${e?.message || String(e)}`);
      }
    }

    // -------------------------
    // 2) End auctions whose timers have elapsed
    // -------------------------
    let dueEnds: Array<{ listing_id: string }> = [];
    try {
      const rpc = await supabase.rpc("get_due_auction_ends", { p_limit: endBatchSize });
      if (rpc.error) throw rpc.error;
      dueEnds = (rpc.data as any[])?.map((r) => ({ listing_id: String((r as any).listing_id) })) || [];
    } catch {
      const q = await supabase
        .from("vehicle_listings")
        .select("id")
        .eq("status", "active")
        .in("sale_type", ["auction", "live_auction"])
        .lte("auction_end_time", nowIso)
        .limit(endBatchSize);
      dueEnds = (q.data || []).map((r: any) => ({ listing_id: String(r.id) }));
    }

    for (const row of dueEnds) {
      const listingId = row.listing_id;
      if (!listingId) continue;
      if (dryRun) {
        result.ended += 1;
        result.end_ids.push(listingId);
        continue;
      }

      try {
        const rpc = await supabase.rpc("process_auction_end", { p_listing_id: listingId });
        if (rpc.error) throw rpc.error;
        const ok = (rpc.data as any)?.success === true;
        if (!ok) {
          result.end_failed += 1;
          result.errors.push(`End ${listingId}: ${(rpc.data as any)?.error || "unknown error"}`);
          continue;
        }
        result.ended += 1;
        result.end_ids.push(listingId);
      } catch (e: any) {
        result.end_failed += 1;
        result.errors.push(`End ${listingId}: ${e?.message || String(e)}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        now: nowIso,
        duration_ms: Date.now() - startedAt,
        ...result,
      }),
      { headers: jsonHeaders }
    );
  } catch (e: any) {
    result.errors.push(e?.message || String(e));
    return new Response(
      JSON.stringify({
        success: false,
        now: safeIso(),
        duration_ms: Date.now() - startedAt,
        ...result,
      }),
      { status: 500, headers: jsonHeaders }
    );
  }
});

