import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ReqBody = {
  source_id?: string; // import_queue.source_id (scrape_sources.id)
  organization_id?: string; // businesses.id (dealer)
  batch_size?: number;
  max_images?: number;
  max_age_minutes?: number; // treat "processing" older than this as stale/unlocked
};

function toInt(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

async function firecrawlHtml(url: string): Promise<string> {
  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY") || "";
  if (!firecrawlKey) throw new Error("Missing FIRECRAWL_API_KEY");

  const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${firecrawlKey}`,
    },
    body: JSON.stringify({
      url,
      formats: ["html"],
      onlyMainContent: false,
      waitFor: 6500,
    }),
    signal: AbortSignal.timeout(60000),
  });

  const txt = await resp.text();
  if (!resp.ok) throw new Error(`Firecrawl HTTP ${resp.status}: ${txt.slice(0, 200)}`);
  let data: any = null;
  try {
    data = JSON.parse(txt);
  } catch {
    throw new Error(`Firecrawl response was not JSON: ${txt.slice(0, 200)}`);
  }
  const html = data?.data?.html;
  if (!html || typeof html !== "string") throw new Error("Firecrawl returned no html");
  return html;
}

function parseVin(html: string): string | null {
  // TBTFW specific: <div class="vin pad-right">VIN </div><div class="vin">SLATV4C0XPU216899</div>
  const tbtfwMatch = html.match(/<div[^>]*class="[^"]*\bvin\b[^"]*pad-right[^"]*"[^>]*>VIN\s*<\/div>\s*<div[^>]*class="[^"]*\bvin\b[^"]*"[^>]*>\s*([A-HJ-NPR-Z0-9]{17})\s*<\/div>/i);
  if (tbtfwMatch?.[1]) {
    const vin = tbtfwMatch[1].toUpperCase().trim();
    if (vin.length === 17 && !/[IOQ]/.test(vin)) return vin;
  }
  
  // Fallback: generic patterns
  const bodyText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const m =
    bodyText.match(/\bVIN\b[\s:]*([A-HJ-NPR-Z0-9]{17})\b/i) ||
    html.match(/VIN\s*<\/div>\s*<div[^>]*class="[^"]*\bvin\b[^"]*"[^>]*>\s*([A-HJ-NPR-Z0-9]{17})\s*<\/div>/i);
  const vin = (m?.[1] || "").toUpperCase().trim();
  if (!vin || vin.length !== 17 || /[IOQ]/.test(vin)) return null;
  return vin;
}

function parseVinFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const slug = u.pathname.split('/').filter(Boolean).pop() || '';
    const m = slug.match(/\b([A-HJ-NPR-Z0-9]{17})\b/i);
    const vin = (m?.[1] || '').toUpperCase().trim();
    if (!vin || vin.length !== 17 || /[IOQ]/.test(vin)) return null;
    return vin;
  } catch {
    return null;
  }
}

function parseStock(html: string): string | null {
  // TBTFW specific: <div class="vin pad-right">Stock # </div><div class="vin">216899</div>
  const tbtfwMatch = html.match(/<div[^>]*class="[^"]*\bvin\b[^"]*pad-right[^"]*"[^>]*>Stock\s*#\s*<\/div>\s*<div[^>]*class="[^"]*\bvin\b[^"]*"[^>]*>\s*([A-Za-z0-9-]{2,20})\s*<\/div>/i);
  if (tbtfwMatch?.[1]) {
    return tbtfwMatch[1].trim();
  }
  
  // Fallback: generic patterns
  const bodyText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const m =
    html.match(/Stock\s*#\s*<\/div>\s*<div[^>]*class="[^"]*\bvin\b[^"]*"[^>]*>\s*([A-Za-z0-9-]{2,20})\s*<\/div>/i) ||
    bodyText.match(/\bStock\s*#\b[\s:]*([A-Za-z0-9-]{2,20})/i);
  const s = (m?.[1] || "").trim();
  return s || null;
}

function parseMileage(html: string): number | null {
  // TBTFW specific: <div class="vehicle-sub-info lrg">256</div><div class="vehicle-sub-info lrg pad-left">Miles</div>
  const tbtfwMatch = html.match(/<div[^>]*class="[^"]*vehicle-sub-info[^"]*lrg[^"]*"[^>]*>(\d{1,3}(?:,\d{3})*|\d{1,7})<\/div>\s*<div[^>]*class="[^"]*vehicle-sub-info[^"]*lrg[^"]*pad-left[^"]*"[^>]*>Miles<\/div>/i);
  if (tbtfwMatch?.[1]) {
    const miles = parseInt(tbtfwMatch[1].replace(/,/g, ""), 10);
    if (Number.isFinite(miles) && miles > 0 && miles <= 10000000) return miles;
  }
  
  // Fallback: generic pattern
  const bodyText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const m = bodyText.match(/(\d{1,3}(?:,\d{3})+|\d{2,7})\s*Miles?\b/i);
  if (!m?.[1]) return null;
  const miles = parseInt(m[1].replace(/,/g, ""), 10);
  if (!Number.isFinite(miles) || miles <= 0 || miles > 10000000) return null;
  return miles;
}

function parsePrice(html: string): number | null {
  // Check for "Call for Price" first - must not have w-condition-invisible (which means it's hidden)
  const callForPriceVisible = html.match(/<div[^>]*class="[^"]*price-call[^"]*"[^>]*(?!w-condition-invisible)[^>]*>Call\s+(?:for\s+)?Price/i);
  if (callForPriceVisible || /\bCall\s+for\s+Price\b/i.test(html.replace(/w-condition-invisible[^>]*>/g, ''))) {
    // Only return null if "Call for Price" is actually visible (not hidden by w-condition-invisible)
    const callForPriceHidden = html.match(/<div[^>]*class="[^"]*price-call[^"]*w-condition-invisible[^"]*"[^>]*>/i);
    if (!callForPriceHidden) {
      return null;
    }
  }
  
  // TBTFW specific: <div class="price lrg">379995</div> (no dollar sign in same element)
  // Match price div that has both "price" and "lrg" classes, and doesn't have "price-call"
  const tbtfwMatch = html.match(/<div[^>]*class="[^"]*\bprice\b(?![^"]*\bprice-call\b)[^"]*\blrg\b[^"]*"[^>]*>\s*(\d{4,})\s*<\/div>/i);
  if (tbtfwMatch?.[1]) {
    const n = parseInt(tbtfwMatch[1].replace(/,/g, ""), 10);
    if (Number.isFinite(n) && n >= 1000 && n <= 100000000) return n;
  }
  
  // Alternative: just look for price class without price-call
  const altMatch = html.match(/<div[^>]*class="[^"]*\bprice\b(?![^"]*\bprice-call\b)[^"]*"[^>]*>\s*(\d{4,})\s*<\/div>/i);
  if (altMatch?.[1]) {
    const n = parseInt(altMatch[1].replace(/,/g, ""), 10);
    if (Number.isFinite(n) && n >= 1000 && n <= 100000000) return n;
  }
  
  // Fallback: generic pattern with dollar sign
  const bodyText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const m = bodyText.match(/\$\s*([\d,]{4,})/);
  if (!m?.[1]) return null;
  const n = parseInt(m[1].replace(/,/g, ""), 10);
  if (!Number.isFinite(n) || n < 1000 || n > 100000000) return null;
  return n;
}

function parseImages(html: string, maxImages: number): string[] {
  const urls = Array.from(html.matchAll(/https:\/\/automanager\.blob\.core\.windows\.net\/wmphotos\/043135\/[^"'\s<>]+?\.(?:jpg|jpeg|png|webp)/gi))
    .map((m) => (m[0] || "").trim())
    .filter(Boolean)
    .map((u) => u.replace(/_(?:320|640|800|1024)\.(jpg|jpeg|png|webp)$/i, "_1280.$1"));
  return uniq(urls).slice(0, maxImages);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceKey) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const body: ReqBody = await req.json().catch(() => ({} as any));
    const batchSize = Math.max(1, Math.min(toInt(body.batch_size, 3), 10));
    const maxImages = Math.max(1, Math.min(toInt(body.max_images, 50), 80));
    const maxAgeMin = Math.max(1, Math.min(toInt(body.max_age_minutes, 20), 240));
    const sourceId = (body.source_id || "").toString().trim();
    const orgId = (body.organization_id || "").toString().trim() || null;
    if (!sourceId) throw new Error("Missing source_id");

    const cutoff = new Date(Date.now() - maxAgeMin * 60 * 1000).toISOString();

    // Pick candidates: pending/failed, plus stale processing
    const { data: items, error } = await supabase
      .from("import_queue")
      .select("id, listing_url, listing_year, listing_make, listing_model, listing_title, thumbnail_url, status, attempts, locked_at, locked_by, raw_data")
      .eq("source_id", sourceId)
      // PostgREST logic: use and(...) inside or(...)
      .or(`status.eq.pending,status.eq.failed,and(status.eq.processing,locked_at.lt.${cutoff})`)
      .order("updated_at", { ascending: true })
      .limit(batchSize);
    if (error) throw new Error(`import_queue select failed: ${error.message}`);

    const out: any = {
      success: true,
      source_id: sourceId,
      organization_id: orgId,
      batch_size: batchSize,
      picked: (items || []).length,
      processed: 0,
      completed: 0,
      failed: 0,
      results: [] as any[],
    };

    for (const it of items || []) {
      out.processed++;
      const url = String(it.listing_url || "").trim();
      const worker = `tbtfw-process-queue:${crypto.randomUUID?.() || String(Date.now())}`;

      // claim lock (best-effort)
      await supabase
        .from("import_queue")
        .update({
          status: "processing",
          locked_at: new Date().toISOString(),
          locked_by: worker,
          last_attempt_at: new Date().toISOString(),
          attempts: (it.attempts || 0) + 1,
          updated_at: new Date().toISOString(),
          error_message: null,
        } as any)
        .eq("id", it.id);

      try {
        if (!url.includes("/am-inventory/")) throw new Error("Not a TBTFW /am-inventory URL");

        const html = await firecrawlHtml(url);
        const vin = parseVin(html) || parseVinFromUrl(url);
        const stock = parseStock(html);
        const mileage = parseMileage(html);
        const askingPrice = parsePrice(html);
        const images = parseImages(html, maxImages);

        // Upsert vehicle by discovery_url
        const { data: existingVehicle } = await supabase
          .from("vehicles")
          .select("id, vin, is_public, origin_metadata")
          .eq("discovery_url", url)
          .maybeSingle();

        const baseVehiclePatch: any = {
          listing_url: url,
          listing_source: "tbtfw.com",
          listing_title: it.listing_title || it.listing_title === "" ? it.listing_title : null,
          title: it.listing_title || null,
          year: it.listing_year || null,
          make: it.listing_make || null,
          model: it.listing_model || null,
          mileage: mileage ?? null,
          asking_price: askingPrice ?? null,
          vin: vin ?? null,
          vin_source: vin ? "tbtfw_listing" : null,
          vin_confidence: vin ? 85 : null,
          primary_image_url: images[0] || (it.thumbnail_url || null),
          image_url: images[0] || (it.thumbnail_url || null),
          platform_source: "TBTFW",
          platform_url: "https://www.tbtfw.com",
          origin_organization_id: orgId,
          updated_at: new Date().toISOString(),
        };

        let vehicleId: string;
        if (existingVehicle?.id) {
          vehicleId = existingVehicle.id;
          await supabase.from("vehicles").update(baseVehiclePatch).eq("id", vehicleId);
        } else {
          const { data: created, error: vErr } = await supabase
            .from("vehicles")
            .insert({
              ...baseVehiclePatch,
              status: "pending",
              is_public: false,
              discovery_url: url,
              profile_origin: "url_scraper",
              origin_metadata: {
                source_id: sourceId,
                queue_id: it.id,
                imported_at: new Date().toISOString(),
                image_urls: images,
                image_count: images.length,
                ...(stock ? { stock_number: stock } : {}),
              },
              import_queue_id: it.id,
            } as any)
            .select("id")
            .single();
          if (vErr) throw new Error(`vehicles insert failed: ${vErr.message}`);
          vehicleId = created.id;
        }

        // External image rows (best-effort; skip duplicates by source_url)
        if (images.length > 0) {
          const { data: existingImgs } = await supabase
            .from("vehicle_images")
            .select("source_url")
            .eq("vehicle_id", vehicleId)
            .limit(200);
          const seen = new Set((existingImgs || []).map((r: any) => String(r.source_url || "")));
          const toInsert = images.filter((u) => !seen.has(u)).slice(0, maxImages);
          if (toInsert.length > 0) {
            const imageRecords = toInsert.map((u, idx) => ({
              vehicle_id: vehicleId,
              image_url: u,
              thumbnail_url: u,
              medium_url: u,
              large_url: u,
              is_external: true,
              source: orgId ? "organization_import" : "external_import",
              source_url: url,
              is_primary: idx === 0,
              position: idx,
              display_order: idx,
              approval_status: "auto_approved",
              is_approved: true,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }));
            await supabase.from("vehicle_images").insert(imageRecords as any);
          }
        }

        // Mark queue complete
        await supabase
          .from("import_queue")
          .update({
            status: "complete",
            vehicle_id: vehicleId,
            processed_at: new Date().toISOString(),
            error_message: null,
            locked_at: null,
            locked_by: null,
            next_attempt_at: null,
            updated_at: new Date().toISOString(),
            raw_data: {
              ...(it.raw_data || {}),
              tbtfw: {
                vin,
                stock,
                mileage,
                asking_price: askingPrice,
                image_count: images.length,
                processed_at: new Date().toISOString(),
              },
            },
          } as any)
          .eq("id", it.id);

        out.completed++;
        out.results.push({ id: it.id, url, ok: true, vehicle_id: vehicleId, vin, mileage, asking_price: askingPrice, images: images.length });
      } catch (e: any) {
        const msg = e?.message || String(e);
        await supabase
          .from("import_queue")
          .update({
            status: "failed",
            error_message: msg,
            locked_at: null,
            locked_by: null,
            next_attempt_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          } as any)
          .eq("id", it.id);
        out.failed++;
        out.results.push({ id: it.id, url, ok: false, error: msg.slice(0, 200) });
      }
    }

    return new Response(JSON.stringify(out), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});


