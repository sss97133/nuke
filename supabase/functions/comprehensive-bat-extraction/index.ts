import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { extractBatListingWithFirecrawl, extractBasicBatDataFromHtml } from "../_shared/batFirecrawlMapper.ts";

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

function isNoiseBatImageUrl(u: string): boolean {
  const f = String(u || "").toLowerCase();
  return (
    // Original BaT-specific noise patterns
    f.includes("qotw") ||
    f.includes("winner-template") ||
    f.includes("weekly-weird") ||
    f.includes("mile-marker") ||
    f.includes("podcast") ||
    f.includes("merch") ||
    f.includes("podcast-graphic") ||
    f.includes("thumbnail-template") ||
    f.includes("site-post-") ||
    /\/web-\d{3,}-/i.test(f) ||

    // Enhanced pollution filtering
    f.includes("logo") || f.includes("header") || f.includes("footer") ||
    f.includes("menu") || f.includes("nav") || f.includes("sidebar") ||
    f.includes("advertisement") || f.includes("/ads/") || f.includes("advert") ||
    f.includes("social") || f.includes("share") || f.includes("facebook") ||
    f.includes("twitter") || f.includes("instagram") || f.includes("youtube") ||

    // BaT-specific user/profile images
    f.includes("default-avatar") || f.includes("profile-") ||
    f.includes("comment-") || f.includes("user-") || f.includes("avatar") ||
    f.includes("member-") || f.includes("seller-") ||

    // UI elements and icons
    /\/(icons?|sprites?|ui|layout|assets)\//i.test(f) ||
    f.includes("icon-") || f.includes("sprite-") ||
    f.includes("badge") || f.includes("button") ||
    f.includes("arrow") || f.includes("chevron") ||

    // Related listings/recommendations pollution
    f.includes("related-") || f.includes("similar-") ||
    f.includes("recommended-") || f.includes("also-") ||
    f.includes("other-listings") || f.includes("more-from") ||

    // BaT promotional content
    f.includes("bat-logo") || f.includes("bringatrailer-") ||
    f.includes("merchandise") || f.includes("apparel") ||
    f.includes("newsletter") || f.includes("subscribe") ||

    // Watermarks and overlays
    f.includes("watermark") || f.includes("overlay") ||
    f.includes("stamp") || f.includes("signature") ||

    // Very small images (likely icons/UI elements)
    /-\d{1,2}x\d{1,2}\./i.test(f) ||

    // Empty or placeholder images
    f.includes("placeholder") || f.includes("blank") ||
    f.includes("empty") || f.includes("default.") ||
    f.includes("no-image") || f.includes("not-found")
  );
}

function extractBatGalleryUrlsFromHtml(html: string): { urls: string[]; method: string } {
  const h = String(html || "");
  const match = h.match(/data-gallery-items\s*=\s*["']([^"']+)["']/i);
  if (!match?.[1]) return { urls: [], method: "not_found:data-gallery-items" };

  const decoded = safeDecodeHtmlAttr(match[1]);
  try {
    const items = JSON.parse(decoded);
    if (!Array.isArray(items)) return { urls: [], method: "bad_json:not_array" };

    const urls: string[] = [];
    for (const it of items) {
      const candidate = it?.full?.url || it?.original?.url || it?.large?.url || it?.small?.url;
      if (typeof candidate !== "string" || !candidate.trim()) continue;
      const upgraded = upgradeBatImageUrl(candidate);
      const normalized = upgraded.split("#")[0].split("?")[0].replace(/-scaled\./g, ".").trim();
      if (!normalized.startsWith("http")) continue;
      const lower = normalized.toLowerCase();
      if (!lower.includes("bringatrailer.com/wp-content/uploads/")) continue;
      if (lower.endsWith(".svg") || lower.endsWith(".pdf")) continue;
      if (isNoiseBatImageUrl(normalized)) continue;
      urls.push(normalized);
    }
    return { urls: [...new Set(urls)], method: "attr:data-gallery-items:regex" };
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
    const batUrlRaw = String(body?.batUrl || body?.url || "").trim();
    const vehicleId = String(body?.vehicleId || body?.vehicle_id || "").trim() || null;
    const skipImages = body?.skip_images === true;

    if (!batUrlRaw) return json(400, { success: false, error: "batUrl required" });
    const batUrl = normalizeUrl(batUrlRaw);

    const fc = await extractBatListingWithFirecrawl(batUrl, firecrawlKey);
    const html = fc.html || "";
    const data = fc.data || extractBasicBatDataFromHtml(html, batUrl);

    // Gallery images from canonical BaT gallery only
    const gallery = extractBatGalleryUrlsFromHtml(html);
    const galleryUrls = gallery.urls;

    let images = { found: galleryUrls.length, uploaded: 0, skipped: 0, failed: 0, method: gallery.method };
    if (!skipImages && vehicleId && galleryUrls.length > 0) {
      const { data: backfillData, error: backfillError } = await supabase.functions.invoke("backfill-images", {
        body: {
          vehicle_id: vehicleId,
          image_urls: galleryUrls,
          source: "bat_import",
          run_analysis: false,
          max_images: 0,
          continue: true,
          sleep_ms: 150,
          max_runtime_ms: 60000,
        },
      });
      if (backfillError) {
        images.failed = galleryUrls.length;
        console.error("[comprehensive-bat-extraction] backfill-images error:", backfillError.message);
      } else {
        images.uploaded = Number(backfillData?.uploaded || backfillData?.data?.uploaded || 0);
        images.skipped = Number(backfillData?.skipped || backfillData?.data?.skipped || 0);
        images.failed = Number(backfillData?.failed || backfillData?.data?.failed || 0);
      }
    }

    return json(200, {
      success: true,
      url: batUrl,
      vehicleId,
      data,
      images,
      firecrawl: {
        success: !!fc.data || !!fc.html,
        has_html: !!fc.html,
        has_extract: !!fc.data,
        error: fc.error || null,
      },
    });
  } catch (e: any) {
    console.error("[comprehensive-bat-extraction] error:", e);
    return json(500, { success: false, error: e?.message || String(e) });
  }
});


