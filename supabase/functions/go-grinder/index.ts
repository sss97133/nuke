import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type GrinderRequest = {
  chain_depth?: number; // how many times to self-invoke
  do_seed?: boolean; // whether to run BaT /auctions seeding this iteration
  seed_every?: number; // run seed every N iterations
  iteration?: number;
  bat_import_batch?: number; // how many BaT listing pages to deep-import per iteration
  process_import_queue_batch?: number; // batch_size for process-import-queue
  backfill_images_batch?: number; // how many vehicles to backfill images per iteration
};

function toInt(v: unknown, fallback: number) {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

async function postJson(url: string, headers: Record<string, string>, body: any, timeoutMs: number) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await resp.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore
  }
  return { ok: resp.ok, status: resp.status, text, json };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";

  // Use inbound auth for function-to-function invocations (JWT anon key works).
  // Fallback to service role key (may be non-JWT in some projects, but can still be used for DB client).
  const invokeHeaders = authHeader ? { Authorization: authHeader } : { Authorization: `Bearer ${serviceRole}` };

  const body: GrinderRequest = await req.json().catch(() => ({} as any));
  const chainDepth = Math.max(0, Math.min(toInt(body.chain_depth, 120), 1000));
  const iteration = Math.max(0, toInt(body.iteration, 0));
  const seedEvery = Math.max(1, Math.min(toInt(body.seed_every, 5), 60));

  const batImportBatch = Math.max(0, Math.min(toInt(body.bat_import_batch, 2), 10));
  const processBatch = Math.max(0, Math.min(toInt(body.process_import_queue_batch, 25), 50));
  const backfillBatch = Math.max(0, Math.min(toInt(body.backfill_images_batch, 2), 10));

  const shouldSeed = body.do_seed === true || (iteration % seedEvery === 0);

  const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
  const fnBase = `${supabaseUrl.replace(/\/$/, "")}/functions/v1`;

  const out: any = {
    success: true,
    iteration,
    chain_depth_remaining: chainDepth,
    did_seed: false,
    bat_import_attempted: 0,
    bat_import_ok: 0,
    process_import_queue_ok: false,
    backfill_images_ok: 0,
    elapsed_ms: 0,
    notes: [],
  };

  // 1) Seed BaT live auction index -> import_queue
  if (shouldSeed) {
    const seed = await postJson(
      `${fnBase}/scrape-multi-source`,
      invokeHeaders,
      {
        source_url: "https://bringatrailer.com/auctions/",
        source_type: "auction",
        extract_listings: true,
        use_llm_extraction: false,
        cheap_mode: false, // JS rendered
        max_listings: 1200,
      },
      120_000,
    );
    out.did_seed = seed.ok;
    out.seed_status = seed.status;
    out.seed_result = seed.json || seed.text.slice(0, 300);
    if (!seed.ok) out.notes.push("seed_failed");
  }

  // 2) Deep-import a few BaT listing pages (keeps live auction truth fresh)
  if (batImportBatch > 0) {
    const { data: batRows, error: batErr } = await supabase
      .from("import_queue")
      .select("id, listing_url, status")
      .ilike("listing_url", "%bringatrailer.com/listing/%")
      .in("status", ["pending", "failed"] as any)
      .order("created_at", { ascending: true })
      .limit(batImportBatch);

    if (batErr) {
      out.notes.push(`bat_queue_select_failed:${batErr.message}`);
    } else {
      for (const row of batRows || []) {
        const url = String((row as any).listing_url || "");
        if (!url) continue;
        out.bat_import_attempted++;
        const r = await postJson(`${fnBase}/import-bat-listing`, invokeHeaders, { url }, 120_000);
        if (r.ok && (r.json?.success === true || r.json?.vehicleId || r.json?.vehicle_id)) {
          out.bat_import_ok++;
          const vehicleId = r.json?.vehicleId || r.json?.vehicle_id || null;
          if (vehicleId) {
            await supabase
              .from("import_queue")
              .update({ status: "complete", vehicle_id: vehicleId, processed_at: new Date().toISOString(), error_message: null } as any)
              .eq("id", (row as any).id);
          }
        } else {
          out.notes.push(`bat_import_failed:${r.status}`);
        }
      }
    }
  }

  // 3) Process general import queue (fills DB fields)
  if (processBatch > 0) {
    const proc = await postJson(
      `${fnBase}/process-import-queue`,
      invokeHeaders,
      { batch_size: processBatch, priority_only: false },
      120_000,
    );
    out.process_import_queue_ok = proc.ok;
    out.process_status = proc.status;
    out.process_result = proc.json || proc.text.slice(0, 300);
  }

  // 4) Backfill missing images for a few vehicles
  if (backfillBatch > 0) {
    const { data: candidates, error: candErr } = await supabase.rpc("get_vehicle_image_backfill_candidates", {
      p_limit: backfillBatch,
    } as any);
    if (candErr) {
      out.notes.push(`image_candidates_failed:${candErr.message}`);
    } else {
      for (const c of (candidates || []) as any[]) {
        const vehicleId = c.vehicle_id;
        const imageUrls = Array.isArray(c.image_urls) ? c.image_urls.filter(Boolean) : [];
        if (!vehicleId || imageUrls.length === 0) continue;
        const bf = await postJson(
          `${fnBase}/backfill-images`,
          invokeHeaders,
          { vehicle_id: vehicleId, image_urls: imageUrls, source: "missing_images_backfill", run_analysis: false, max_images: 0, continue: true, sleep_ms: 150, max_runtime_ms: 25000 },
          120_000,
        );
        if (bf.ok && bf.json?.success) out.backfill_images_ok++;
      }
    }
  }

  out.elapsed_ms = Date.now() - startedAt;

  // Self-invoke to keep grinding (bounded)
  if (chainDepth > 0) {
    const nextBody: GrinderRequest = {
      chain_depth: chainDepth - 1,
      iteration: iteration + 1,
      seed_every: seedEvery,
      bat_import_batch: batImportBatch,
      process_import_queue_batch: processBatch,
      backfill_images_batch: backfillBatch,
    };
    // Fire-and-forget; don't block response on it.
    fetch(`${fnBase}/go-grinder`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...invokeHeaders },
      body: JSON.stringify(nextBody),
    }).catch(() => {});
  }

  return new Response(JSON.stringify(out), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});


