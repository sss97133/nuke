import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.search = "";
    if (!u.pathname.endsWith("/")) u.pathname = `${u.pathname}/`;
    return u.toString();
  } catch {
    return String(raw).split("#")[0].split("?")[0];
  }
}

function safeDecodeHtmlAttr(s: string): string {
  return String(s || "")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#038;/g, "&");
}

function upgradeBatImageUrl(u: string): string {
  return String(u || "")
    .replace(/-scaled\.(jpg|jpeg|png|webp)$/i, ".$1")
    .replace(/-\d+x\d+\.(jpg|jpeg|png|webp)$/i, ".$1")
    .replace(/[?&]resize=[^&]*/g, "")
    .replace(/[?&]strip=[^&]*/g, "")
    .replace(/[?&]quality=[^&]*/g, "")
    .replace(/[?&]+$/, "")
    .trim();
}

function isNoise(u: string): boolean {
  const f = String(u || "").toLowerCase();
  return (
    f.includes("qotw") ||
    f.includes("winner-template") ||
    f.includes("weekly-weird") ||
    f.includes("mile-marker") ||
    f.includes("podcast") ||
    f.includes("merch") ||
    f.includes("podcast-graphic") ||
    f.includes("thumbnail-template") ||
    f.includes("site-post-") ||
    /\/web-\d{3,}-/i.test(f)
  );
}

function extractGalleryUrls(html: string): { urls: string[]; method: string } {
  const h = String(html || "");

  // Prefer the canonical BaT gallery JSON embedded in `data-gallery-items`.
  const m = h.match(/data-gallery-items\s*=\s*["']([^"']+)["']/i);
  if (!m?.[1]) return { urls: [], method: "not_found:data-gallery-items" };

  const decoded = safeDecodeHtmlAttr(m[1]);
  try {
    const items = JSON.parse(decoded);
    if (!Array.isArray(items)) return { urls: [], method: "bad_json:not_array" };

    const urls: string[] = [];
    for (const it of items) {
      const candidate = it?.full?.url || it?.original?.url || it?.large?.url || it?.small?.url;
      if (typeof candidate !== "string" || !candidate.trim()) continue;

      const upgraded = upgradeBatImageUrl(candidate);
      const normalized = upgraded.split("#")[0].split("?")[0].replace(/-scaled\./g, ".").trim();
      const lower = normalized.toLowerCase();

      if (!normalized.startsWith("http")) continue;
      if (!lower.includes("bringatrailer.com/wp-content/uploads/")) continue;
      if (lower.endsWith(".svg") || lower.endsWith(".pdf")) continue;
      if (isNoise(normalized)) continue;

      urls.push(normalized);
    }

    return { urls: [...new Set(urls)], method: "attr:data-gallery-items" };
  } catch {
    return { urls: [], method: "bad_json:parse_error" };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_KEY") ??
    "";

  if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { success: false, error: "Server not configured" });

  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY") ?? "";
  if (!firecrawlKey) return json(500, { success: false, error: "FIRECRAWL_API_KEY is required" });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, detectSessionInUrl: false },
  });

  try {
    const body = await req.json().catch(() => ({}));
    const urlRaw = String(body?.url || body?.batUrl || "").trim();
    const vehicleId = String(body?.vehicle_id || body?.vehicleId || "").trim();

    if (!urlRaw) return json(400, { success: false, error: "url required" });
    if (!vehicleId) return json(400, { success: false, error: "vehicle_id required" });

    const url = normalizeUrl(urlRaw);

    // Firecrawl rendered HTML (required for BaT).
    const fc = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${firecrawlKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ["html"],
        onlyMainContent: false,
        waitFor: 12000,
      }),
      signal: AbortSignal.timeout(90000),
    });

    if (!fc.ok) {
      const t = await fc.text().catch(() => "");
      return json(502, { success: false, error: `Firecrawl error ${fc.status}`, details: t.slice(0, 300) });
    }

    const fcJson = await fc.json().catch(() => ({}));
    const html = String(fcJson?.data?.html || "");
    if (!html) return json(502, { success: false, error: "Firecrawl returned no HTML" });

    const gallery = extractGalleryUrls(html);
    const urls = gallery.urls;
    if (urls.length === 0) {
      return json(200, { success: true, vehicleId, url, images: { found: 0, uploaded: 0, skipped: 0, failed: 0, method: gallery.method } });
    }

    const { data: backfillData, error: backfillError } = await supabase.functions.invoke("backfill-images", {
      body: {
        vehicle_id: vehicleId,
        image_urls: urls,
        source: "bat_import",
        run_analysis: false,
        max_images: 0,
        continue: true,
        sleep_ms: 150,
        max_runtime_ms: 60000,
      },
    });

    if (backfillError) {
      return json(500, { success: false, error: backfillError.message, images: { found: urls.length, uploaded: 0, skipped: 0, failed: urls.length, method: gallery.method } });
    }

    const uploaded = Number(backfillData?.uploaded || backfillData?.data?.uploaded || 0);
    const skipped = Number(backfillData?.skipped || backfillData?.data?.skipped || 0);
    const failed = Number(backfillData?.failed || backfillData?.data?.failed || 0);

    // Record provenance + set primary image if missing
    try {
      const { data: vrow } = await supabase
        .from("vehicles")
        .select("origin_metadata,primary_image_url,image_url")
        .eq("id", vehicleId)
        .maybeSingle();
      const om = (vrow?.origin_metadata && typeof vrow.origin_metadata === "object") ? vrow.origin_metadata : {};
      const nextOm = { ...om, bat_image_urls: urls, bat_image_count: urls.length };
      const primary = urls[0] || null;
      const updates: any = { origin_metadata: nextOm, updated_at: new Date().toISOString() };
      if (!vrow?.primary_image_url && primary) updates.primary_image_url = primary;
      if (!vrow?.image_url && primary) updates.image_url = primary;
      await supabase.from("vehicles").update(updates).eq("id", vehicleId);
    } catch {
      // non-blocking
    }

    return json(200, {
      success: true,
      vehicleId,
      url,
      images: { found: urls.length, uploaded, skipped, failed, method: gallery.method },
    });
  } catch (e: any) {
    return json(500, { success: false, error: e?.message || String(e) });
  }
});


