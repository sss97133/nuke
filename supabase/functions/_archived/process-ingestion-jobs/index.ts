import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ProcessIngestionJobsRequest {
  batch_size?: number;
  dry_run?: boolean;
}

async function callEdgeFunctionWithFallbackAuth(
  functionName: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: any; errorText?: string }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const internalJwt = Deno.env.get("INTERNAL_INVOKE_JWT") ?? "";

  const url = `${supabaseUrl}/functions/v1/${functionName}`;

  const attempt = async (bearer: string) => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${bearer}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return { res, text, parsed };
  };

  // First try service key (works when verify_jwt=false)
  if (serviceKey) {
    const r1 = await attempt(serviceKey);
    if (r1.res.ok) return { ok: true, status: r1.res.status, data: r1.parsed };

    // Retry with INTERNAL_INVOKE_JWT if present (works when verify_jwt=true)
    if (internalJwt && internalJwt !== serviceKey) {
      const r2 = await attempt(internalJwt);
      if (r2.res.ok) return { ok: true, status: r2.res.status, data: r2.parsed };
      return { ok: false, status: r2.res.status, data: r2.parsed, errorText: r2.text };
    }

    return { ok: false, status: r1.res.status, data: r1.parsed, errorText: r1.text };
  }

  if (internalJwt) {
    const r = await attempt(internalJwt);
    if (r.res.ok) return { ok: true, status: r.res.status, data: r.parsed };
    return { ok: false, status: r.res.status, data: r.parsed, errorText: r.text };
  }

  return { ok: false, status: 500, data: null, errorText: "Missing SUPABASE_SERVICE_ROLE_KEY/INTERNAL_INVOKE_JWT" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();

  try {
    const body: ProcessIngestionJobsRequest = await req.json().catch(() => ({}));
    const batchSize = Math.max(1, Math.min(Number(body.batch_size ?? 1) || 1, 5));
    const dryRun = body.dry_run === true;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Fetch queued jobs
    const { data: jobs, error: fetchError } = await supabase
      .from("ingestion_jobs")
      .select("*")
      .eq("status", "queued")
      .order("priority", { ascending: true })
      .order("scheduled_for", { ascending: true })
      .limit(batchSize);

    if (fetchError) throw fetchError;

    if (!jobs || jobs.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          processed: 0,
          message: "No queued ingestion jobs",
          duration_ms: Date.now() - startedAt,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results: any[] = [];
    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    for (const job of jobs) {
      processed++;

      // Claim job (best-effort) to avoid double-processing
      const nowIso = new Date().toISOString();
      const claimUpdate: any = {
        status: "running",
        started_at: nowIso,
        updated_at: nowIso,
        attempt: (job.attempt || 0) + 1,
      };

      const { data: claimed, error: claimError } = await supabase
        .from("ingestion_jobs")
        .update(claimUpdate)
        .eq("id", job.id)
        .eq("status", "queued")
        .select("*")
        .maybeSingle();

      if (claimError || !claimed) {
        results.push({
          id: job.id,
          status: "skipped",
          reason: "Already claimed",
        });
        continue;
      }

      const payload = claimed.payload || {};
      const tasks: string[] = Array.isArray(payload.tasks) ? payload.tasks : [];
      const websiteUrl = String(claimed.site_url || payload.website_url || "").trim() || null;

      const jobResult: any = {
        id: claimed.id,
        job_type: claimed.job_type,
        organization_id: claimed.organization_id,
        site_url: claimed.site_url,
        tasks,
        actions: [],
        dry_run: dryRun,
      };

      try {
        if (!claimed.organization_id) {
          throw new Error("Job missing organization_id");
        }

        if (dryRun) {
          jobResult.actions.push({ action: "dry_run_skip_execution" });
        } else {
          // Task: LLM synopsis / due diligence
          if (tasks.includes("org_due_diligence")) {
            const dd = await callEdgeFunctionWithFallbackAuth("generate-org-due-diligence", {
              organizationId: claimed.organization_id,
              websiteUrl: websiteUrl,
              forceRegenerate: false,
            });

            if (!dd.ok) {
              throw new Error(
                `generate-org-due-diligence failed (HTTP ${dd.status}): ${dd.errorText || JSON.stringify(dd.data)}`
              );
            }

            jobResult.actions.push({ action: "generate-org-due-diligence", ok: true });
          }

          // Task: site mapping (placeholder; currently just stores a note)
          if (tasks.includes("site_mapping")) {
            jobResult.actions.push({
              action: "site_mapping",
              ok: true,
              note:
                "Queued as a placeholder; if you want full site mapping, wire this task to discover-organization-full or a site mapper function.",
            });
          }
        }

        // Mark succeeded
        const completedAt = new Date().toISOString();
        await supabase
          .from("ingestion_jobs")
          .update({
            status: "succeeded",
            completed_at: completedAt,
            updated_at: completedAt,
            result: jobResult,
            error_message: null,
          })
          .eq("id", claimed.id);

        succeeded++;
        results.push({ ...jobResult, status: "succeeded" });
      } catch (e: any) {
        const completedAt = new Date().toISOString();
        const errMsg = e?.message || String(e);

        await supabase
          .from("ingestion_jobs")
          .update({
            status: "failed",
            completed_at: completedAt,
            updated_at: completedAt,
            error_message: errMsg,
            result: jobResult,
          })
          .eq("id", claimed.id);

        failed++;
        results.push({ ...jobResult, status: "failed", error: errMsg });
      }
    }

    return new Response(
      JSON.stringify(
        {
          success: true,
          processed,
          succeeded,
          failed,
          duration_ms: Date.now() - startedAt,
          results,
        },
        null,
        2
      ),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("process-ingestion-jobs error:", error);
    return new Response(JSON.stringify({ success: false, error: error?.message || String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

