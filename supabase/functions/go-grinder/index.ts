import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type GrinderRequest = {
  chain_depth?: number; // how many times to self-invoke
  do_seed?: boolean; // whether to run BaT /auctions fetch this iteration
  seed_every?: number; // run seed every N iterations (default)
  iteration?: number;
  bat_import_batch?: number; // how many BaT listing pages to deep-import per iteration (from discovered URLs)
  max_listings?: number; // how many listing URLs to request from the BaT index
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
  const HARD_BUDGET_MS = 55_000; // keep well under Edge timeout; this function self-invokes to continue grinding
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

  const batImportBatch = Math.max(0, Math.min(toInt(body.bat_import_batch, 1), 5));
  const maxListings = Math.max(50, Math.min(toInt(body.max_listings, 250), 1200));

  const shouldSeed = body.do_seed === true || (iteration % seedEvery === 0);

  const fnBase = `${supabaseUrl.replace(/\/$/, "")}/functions/v1`;

  const remainingMs = () => Math.max(0, HARD_BUDGET_MS - (Date.now() - startedAt));
  const canRun = (minMs: number) => remainingMs() > minMs;

  const out: any = {
    success: true,
    iteration,
    chain_depth_remaining: chainDepth,
    did_seed: false,
    max_listings: maxListings,
    bat_import_attempted: 0,
    bat_import_ok: 0,
    discovered_listing_urls: 0,
    elapsed_ms: 0,
    notes: [],
  };

  // 1) Fetch BaT live auctions index (JS rendered) via scrape-multi-source
  let listingUrls: string[] = [];
  if (shouldSeed && canRun(18_000)) {
    try {
      const seed = await postJson(
        `${fnBase}/scrape-multi-source`,
        invokeHeaders,
        {
          source_url: "https://bringatrailer.com/auctions/",
          source_type: "auction",
          extract_listings: true,
          use_llm_extraction: false,
          cheap_mode: false, // JS rendered
          max_listings: maxListings,
        },
        Math.min(52_000, Math.max(12_000, remainingMs() - 2_000)),
      );
      out.did_seed = seed.ok;
      out.seed_status = seed.status;
      out.seed_result = seed.json || seed.text.slice(0, 220);
      if (!seed.ok) out.notes.push("seed_failed");
      const sample = Array.isArray(seed.json?.sample_listings) ? seed.json.sample_listings : [];
      listingUrls = sample.map((x: any) => String(x?.url || "")).filter((u: string) => u.includes("bringatrailer.com/listing/"));
      // de-dupe
      listingUrls = Array.from(new Set(listingUrls)).slice(0, maxListings);
      out.discovered_listing_urls = listingUrls.length;
    } catch (e: any) {
      out.notes.push(`seed_error:${e?.message || String(e)}`);
    }
  } else if (shouldSeed) {
    out.notes.push("seed_skipped_budget");
  }

  // 2) Deep-import a few discovered BaT listings using approved two-step workflow
  // ✅ APPROVED WORKFLOW: extract-premium-auction + extract-auction-comments
  // ⚠️ Do NOT use import-bat-listing (deprecated)
  // See: docs/BAT_EXTRACTION_SUCCESS_WORKFLOW.md
  if (batImportBatch > 0 && listingUrls.length > 0) {
    const take = Math.min(batImportBatch, listingUrls.length, 2); // keep tiny per invocation
    for (let i = 0; i < take; i++) {
      if (!canRun(18_000)) { // Increased budget for two-step workflow
        out.notes.push("bat_import_skipped_budget");
        break;
      }
      const url = listingUrls[i];
      if (!url) continue;
      out.bat_import_attempted++;
      
      try {
        // Step 1: Extract core vehicle data (VIN, specs, images, auction_events)
        const step1 = await postJson(
          `${fnBase}/extract-premium-auction`,
          invokeHeaders,
          { url, max_vehicles: 1 },
          Math.min(50_000, Math.max(15_000, remainingMs() - 5_000)),
        );
        
        if (!step1.ok || !step1.json?.success) {
          out.notes.push(`bat_import_step1_failed:${step1.status}`);
          continue;
        }
        
        const vehicleId = step1.json?.created_vehicle_ids?.[0] || step1.json?.updated_vehicle_ids?.[0];
        if (!vehicleId) {
          out.notes.push("bat_import_no_vehicle_id");
          continue;
        }
        
        // Step 2: Extract comments and bids (non-critical, don't fail if this fails)
        if (canRun(10_000)) {
          const step2 = await postJson(
            `${fnBase}/extract-auction-comments`,
            invokeHeaders,
            { auction_url: url, vehicle_id: vehicleId },
            Math.min(30_000, Math.max(8_000, remainingMs() - 2_000)),
          );
          
          if (step2.ok) {
            out.bat_import_ok++;
          } else {
            // Step 1 succeeded, step 2 failed - still count as OK since core data extracted
            out.bat_import_ok++;
            out.notes.push(`bat_import_step2_failed_non_critical:${step2.status}`);
          }
        } else {
          // Step 1 succeeded but no budget for step 2 - still count as OK
          out.bat_import_ok++;
          out.notes.push("bat_import_step2_skipped_budget");
        }
      } catch (e: any) {
        out.notes.push(`bat_import_error:${e?.message || String(e)}`);
      }
    }
  } else if (batImportBatch > 0 && listingUrls.length === 0) {
    out.notes.push("no_bat_urls_discovered");
  }

  out.elapsed_ms = Date.now() - startedAt;

  // Self-invoke to keep grinding (bounded)
  if (chainDepth > 0) {
    const nextBody: GrinderRequest = {
      chain_depth: chainDepth - 1,
      iteration: iteration + 1,
      seed_every: seedEvery,
      bat_import_batch: batImportBatch,
      max_listings: maxListings,
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


