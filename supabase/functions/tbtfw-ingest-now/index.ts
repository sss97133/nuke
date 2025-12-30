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

async function fetchHtml(url: string): Promise<string> {
  // Try direct fetch first (cheap). Some Cloudflare setups may hang/deny Edge IPs.
  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(20000),
    });
    if (resp.ok) return await resp.text();
  } catch {
    // fall through to Firecrawl
  }

  // Firecrawl fallback (more reliable for JS/anti-bot pages)
  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY") || "";
  if (!firecrawlKey) throw new Error("Direct fetch failed and FIRECRAWL_API_KEY is not set");

  const fcResp = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${firecrawlKey}`,
    },
    body: JSON.stringify({
      url,
      formats: ["html"],
      onlyMainContent: false,
      // Give Webflow time to hydrate listing links if needed.
      waitFor: 6500,
    }),
    signal: AbortSignal.timeout(60000),
  });
  const txt = await fcResp.text();
  if (!fcResp.ok) throw new Error(`Firecrawl HTTP ${fcResp.status}: ${txt.slice(0, 200)}`);
  let data: any = null;
  try {
    data = JSON.parse(txt);
  } catch {
    throw new Error(`Firecrawl response was not JSON: ${txt.slice(0, 200)}`);
  }
  const html = data?.data?.html || null;
  if (!html || typeof html !== "string") throw new Error("Firecrawl returned no html");
  return html;
}

function titleFromSlug(slug: string): string {
  const s = String(slug || "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s;
}

function parseFromAmInventoryUrl(u: string): { year: number | null; vin: string | null; title: string | null; make: string | null; model: string | null } {
  try {
    const url = new URL(u);
    const m = url.pathname.match(/\/am-inventory\/([^/]+)/i);
    const slug = (m?.[1] || "").trim();
    if (!slug) return { year: null, vin: null, title: null, make: null, model: null };

    const vinMatch = slug.match(/\b([A-HJ-NPR-Z0-9]{17})\b/i);
    const vin = vinMatch?.[1]?.toUpperCase() || null;

    const yearMatch = slug.match(/\b(19|20)\d{2}\b/);
    const year = yearMatch ? parseInt(yearMatch[0], 10) : null;

    // Rough make/model inference from slug (best-effort).
    // Slugs are typically: Make-Model-...-YEAR-VIN
    const parts = slug.split("-").filter(Boolean);
    const yearIdx = year ? parts.findIndex((p) => p === String(year)) : -1;
    const usable = yearIdx > 0 ? parts.slice(0, yearIdx) : parts;
    const make = usable[0] ? usable[0].replace(/\s+/g, " ").trim() : null;
    const model = usable.length > 1 ? usable.slice(1).join(" ").trim() : null;

    const title = titleFromSlug(usable.join(" "));
    return { year, vin, title: title || null, make, model };
  } catch {
    return { year: null, vin: null, title: null, make: null, model: null };
  }
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
      scrape_source_id: null,
      discovery: null,
      import_runs: [] as any[],
    };

    if (dryRun) {
      return new Response(JSON.stringify(out), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 2) Deterministic discovery for TBTFW: inventory HTML contains /am-inventory/* links.
    const html = await fetchHtml(inventoryUrl);
    const base = new URL(inventoryUrl);
    const linkMatches = Array.from(html.matchAll(/href="(\/am-inventory\/[^"]+)"/gi)).map((m) => (m[1] || "").trim());
    const absLinks = linkMatches
      .map((p) => new URL(p, base.origin).toString())
      .filter((u) => u.includes("/am-inventory/"));
    const dedupedLinks = Array.from(new Set(absLinks)).slice(0, maxResults);

    // Grab one hero image per listing (best-effort). TBTFW embeds AutoManager blob URLs.
    const imgMatches = Array.from(html.matchAll(/https:\/\/automanager\.blob\.core\.windows\.net\/wmphotos\/043135\/[^"'\\s<>]+?_1280\.(?:jpg|jpeg|png|webp)/gi))
      .map((m) => (m[0] || "").trim())
      .filter(Boolean);
    const dedupedImgs = Array.from(new Set(imgMatches));

    // Ensure scrape_source exists (so we can filter import processing by source_id)
    const { data: existingSource, error: ssErr } = await supabase
      .from("scrape_sources")
      .select("id")
      .eq("url", inventoryUrl)
      .maybeSingle();
    if (ssErr) throw new Error(`scrape_sources select failed: ${ssErr.message}`);

    let scrapeSourceId: string | null = existingSource?.id || null;
    if (!scrapeSourceId) {
      const { data: createdSource, error: ssInsErr } = await supabase
        .from("scrape_sources")
        .insert({
          name: "TBTFW Inventory",
          url: inventoryUrl,
          source_type: "dealer",
          inventory_url: inventoryUrl,
          last_scraped_at: new Date().toISOString(),
          last_successful_scrape: new Date().toISOString(),
          total_listings_found: dedupedLinks.length,
        } as any)
        .select("id")
        .single();
      if (ssInsErr) throw new Error(`scrape_sources insert failed: ${ssInsErr.message}`);
      scrapeSourceId = createdSource?.id || null;
    }
    if (!scrapeSourceId) throw new Error("Failed to resolve scrape_source_id");

    out.scrape_source_id = scrapeSourceId;
    out.discovery = {
      links_found: absLinks.length,
      links_deduped: dedupedLinks.length,
      images_found: imgMatches.length,
      images_deduped: dedupedImgs.length,
      sample_links: dedupedLinks.slice(0, 5),
    };

    // Upsert import_queue rows (idempotent by listing_url)
    // Filter out junk /am-inventory/<VIN> URLs (no year => process-import-queue will reject).
    const pairs = dedupedLinks.map((u, idx) => ({ u, idx, parsed: parseFromAmInventoryUrl(u) }));
    const validPairs = pairs.filter((p) => typeof p.parsed.year === 'number' && Number.isFinite(p.parsed.year));
    const rows = validPairs.map((p) => {
      const thumb = dedupedImgs[p.idx] || null;
      return {
        source_id: scrapeSourceId,
        listing_url: p.u,
        listing_title: p.parsed.title,
        listing_year: p.parsed.year,
        listing_make: p.parsed.make,
        listing_model: p.parsed.model,
        thumbnail_url: thumb,
        raw_data: {
          organization_id: orgId,
          inventory_extraction: true,
          listing_status: "in_stock",
          vin: p.parsed.vin,
          image_urls: thumb ? [thumb] : [],
          extracted_via: "tbtfw-ingest-now",
          source_url: inventoryUrl,
        },
        priority: 0,
      };
    });

    let queued = 0;
    const chunkSize = 100;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error: upErr } = await supabase
        .from("import_queue")
        .upsert(chunk, { onConflict: "listing_url" } as any);
      if (upErr) throw new Error(`import_queue upsert failed: ${upErr.message}`);
      queued += chunk.length;
    }
    out.discovery.queued = queued;

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


