import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ProcessRequest = {
  batch_size?: number;
  max_attempts?: number;
  reprocess_failed?: boolean;
};

function toInt(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const supabase = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });

    const body: ProcessRequest = await req.json().catch(() => ({} as any));
    const batchSize = Math.max(1, Math.min(toInt(body.batch_size, 10), 50));
    const maxAttempts = Math.max(1, Math.min(toInt(body.max_attempts, 5), 20));
    const reprocessFailed = body.reprocess_failed === true;

    const statuses = reprocessFailed ? ["pending", "failed"] : ["pending"];

    const { data: items, error } = await supabase
      .from("classic_seller_queue")
      .select("id, profile_url, seller_name, seller_type, attempts, status")
      .in("status", statuses as any)
      .lt("attempts", maxAttempts)
      .order("discovered_at", { ascending: true })
      .limit(batchSize);

    if (error) throw new Error(`classic_seller_queue select failed: ${error.message}`);

    const out = {
      success: true,
      batch_size: batchSize,
      processed: 0,
      completed: 0,
      failed: 0,
      inventory_sync_enqueued: 0,
      sample: [] as any[],
    };

    for (const item of items || []) {
      out.processed++;

      // Mark processing
      await supabase
        .from("classic_seller_queue")
        .update({ status: "processing", attempts: (item.attempts || 0) + 1, updated_at: new Date().toISOString() } as any)
        .eq("id", item.id);

      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/index-classic-com-dealer`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({ profile_url: item.profile_url }),
          signal: AbortSignal.timeout(60000),
        });

        const payload = await resp.json().catch(() => ({}));
        if (!resp.ok || !payload?.success || !payload?.organization_id) {
          throw new Error(payload?.error || `index-classic-com-dealer failed (${resp.status})`);
        }

        const organizationId = payload.organization_id as string;

        await supabase
          .from("classic_seller_queue")
          .update({
            status: "completed",
            organization_id: organizationId,
            processed_at: new Date().toISOString(),
            last_error: null,
            updated_at: new Date().toISOString(),
          } as any)
          .eq("id", item.id);

        // Enqueue inventory sync (decoupled; inventory extraction can be heavy).
        const { error: qErr } = await supabase
          .from("organization_inventory_sync_queue")
          .upsert(
            {
              organization_id: organizationId,
              run_mode: "both",
              status: "pending",
              attempts: 0,
              last_error: null,
              next_run_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            } as any,
            { onConflict: "organization_id,run_mode" } as any,
          );
        if (!qErr) out.inventory_sync_enqueued++;

        out.completed++;
        if (out.sample.length < 5) out.sample.push({ profile_url: item.profile_url, organization_id: organizationId });
      } catch (err: any) {
        out.failed++;
        await supabase
          .from("classic_seller_queue")
          .update({
            status: "failed",
            last_error: err?.message || String(err),
            updated_at: new Date().toISOString(),
          } as any)
          .eq("id", item.id);
      }
    }

    return new Response(JSON.stringify(out), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err?.message || String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});


