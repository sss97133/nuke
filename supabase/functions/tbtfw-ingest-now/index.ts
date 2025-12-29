import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ReqBody = {
  inventory_url?: string;
  max_results?: number;
  import_batches?: number;
  import_batch_size?: number;
  dry_run?: boolean;
};

function toInt(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

async function postJson(url: string, bearer: string, body: any): Promise<{ ok: boolean; status: number; text: string; json: any }> {
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${bearer}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  const text = await resp.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { ok: resp.ok, status: resp.status, text, json };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({
        success: false,
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in function secrets",
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // IMPORTANT: Function-to-function invocation needs a real JWT in many Supabase setups.
    // Prefer INTERNAL_INVOKE_JWT (legacy anon JWT) and fall back to SUPABASE_ANON_KEY.
    const invokeJwt =
      Deno.env.get("INTERNAL_INVOKE_JWT") ||
      Deno.env.get("SUPABASE_ANON_KEY") ||
      "";
    if (!invokeJwt) {
      return new Response(JSON.stringify({
        success: false,
        error: "Missing INTERNAL_INVOKE_JWT (or SUPABASE_ANON_KEY) secret for invoking other Edge Functions",
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body: ReqBody = await req.json().catch(() => ({} as any));
    const inventoryUrl = (body.inventory_url || "https://www.tbtfw.com/inventory").toString();
    const maxResults = Math.max(1, Math.min(toInt(body.max_results, 400), 5000));
    const importBatches = Math.max(0, Math.min(toInt(body.import_batches, 40), 20000));
    const importBatchSize = Math.max(1, Math.min(toInt(body.import_batch_size, 5), 25));
    const dryRun = Boolean(body.dry_run);

    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // 1) Ensure org exists
    const orgWebsite = "https://www.tbtfw.com";
    const { data: existingOrg, error: orgSelErr } = await supabase
      .from("businesses")
      .select("id, business_name, website, metadata")
      .eq("website", orgWebsite)
      .maybeSingle();
    if (orgSelErr) throw new Error(`businesses select failed: ${orgSelErr.message}`);

    let orgId = existingOrg?.id || null;
    if (!orgId) {
      const { data: createdOrg, error: orgInsErr } = await supabase
        .from("businesses")
        .insert({
          business_name: "TBTFW",
          type: "dealer",
          business_type: "dealership",
          website: orgWebsite,
          is_public: true,
          is_verified: false,
          metadata: {
            inventory_url: inventoryUrl,
            source_type: "dealer_website",
            discovered_from: "tbtfw-ingest-now",
            discovered_at: new Date().toISOString(),
          },
        } as any)
        .select("id")
        .single();
      if (orgInsErr) throw new Error(`businesses insert failed: ${orgInsErr.message}`);
      orgId = createdOrg?.id || null;
    }
    if (!orgId) throw new Error("Failed to resolve TBTFW org id");

    const out: any = {
      success: true,
      dry_run: dryRun,
      organization_id: orgId,
      inventory_url: inventoryUrl,
      max_results: maxResults,
      import_batches: importBatches,
      import_batch_size: importBatchSize,
      scrape: null,
      import_runs: [] as any[],
    };

    if (dryRun) {
      return new Response(JSON.stringify(out), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 2) Run scrape-multi-source to queue /am-inventory/* listings
    const scrapeUrl = `${supabaseUrl.replace(/\\/$/, "")}/functions/v1/scrape-multi-source`;
    const scrapeResp = await postJson(scrapeUrl, invokeJwt, {
      source_url: inventoryUrl,
      source_type: "dealer_website",
      organization_id: orgId,
      max_results: maxResults,
      extract_listings: true,
      extract_dealer_info: true,
      use_llm_extraction: true,
      include_sold: false,
      force_listing_status: "in_stock",
      cheap_mode: false,
    });
    out.scrape = {
      ok: scrapeResp.ok,
      status: scrapeResp.status,
      json: scrapeResp.json,
      text_preview: scrapeResp.ok ? null : scrapeResp.text.slice(0, 400),
    };
    if (!scrapeResp.ok) {
      return new Response(JSON.stringify(out), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const scrapeSourceId = scrapeResp.json?.source_id || null;
    if (!scrapeSourceId) {
      return new Response(JSON.stringify({
        success: false,
        error: "scrape-multi-source did not return source_id",
        scrape: out.scrape,
      }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 3) Drain import queue for this scrape source
    const importUrl = `${supabaseUrl.replace(/\\/$/, "")}/functions/v1/process-import-queue`;
    for (let i = 0; i < importBatches; i++) {
      const r = await postJson(importUrl, invokeJwt, {
        batch_size: importBatchSize,
        priority_only: false,
        source_id: scrapeSourceId,
        fast_mode: true,
        skip_image_upload: true,
      });
      const processed = Number(r.json?.processed || 0);
      out.import_runs.push({
        i: i + 1,
        ok: r.ok,
        status: r.status,
        processed,
        succeeded: r.json?.succeeded,
        failed: r.json?.failed,
        duplicates: r.json?.duplicates,
      });
      if (!r.ok) break;
      if (!processed) break;
      // light backoff
      await new Promise((res) => setTimeout(res, 1100));
    }

    return new Response(JSON.stringify(out), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({
      success: false,
      error: err?.message || String(err),
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});


