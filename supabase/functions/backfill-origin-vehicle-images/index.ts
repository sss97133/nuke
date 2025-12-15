import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type ReqBody = {
  batch_size?: number; // vehicles per invocation
  max_images_per_vehicle?: number;
  dry_run?: boolean;
  include_profile_origins?: string[];
};

function normalizeUrl(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s
    .replace(/&#038;/g, "&")
    .replace(/&amp;/g, "&")
    .replace(/&#039;/g, "'")
    .split("#")[0]
    .trim();
}

function isProbablyBadImageUrl(url: string): boolean {
  const u = url.toLowerCase();
  if (!u.startsWith("http")) return true;
  if (u.endsWith(".svg")) return true;
  if (u.includes("thumbnail")) return true;
  if (u.includes("94x63")) return true;
  if (u.includes("thumb/")) return true;
  // Craigslist thumbs
  if (/_50x50c\.(jpg|jpeg|png|webp)(\?|$)/i.test(u)) return true;
  // Share links (BHCC)
  if (u.includes("linkedin.com/sharearticle")) return true;
  if (u.includes("pinterest.com/pin/create")) return true;
  return false;
}

function filterAndDedupeUrls(urls: unknown): string[] {
  const arr = Array.isArray(urls) ? urls : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of arr) {
    const u = normalizeUrl(String(x || ""));
    if (!u) continue;
    if (isProbablyBadImageUrl(u)) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

function filterBatNoise(urls: string[]): string[] {
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const u0 of urls) {
    let u = u0;
    if (!u.includes("bringatrailer.com/wp-content/uploads/")) continue;
    // Strip BaT resize params
    u = u
      .replace(/[?&]w=\d+/g, "")
      .replace(/[?&]resize=[^&]*/g, "")
      .replace(/[?&]fit=[^&]*/g, "")
      .replace(/[?&]$/, "");
    if (u.includes("-scaled.")) u = u.replace("-scaled.", ".");
    if (seen.has(u)) continue;
    seen.add(u);
    cleaned.push(u);
  }

  // listing galleries usually cluster in a single uploads YYYY/MM bucket.
  const bucketCounts = new Map<string, number>();
  const bucketKey = (u: string) => {
    const m = u.match(/\/wp-content\/uploads\/(\d{4})\/(\d{2})\//);
    return m ? `${m[1]}/${m[2]}` : "";
  };
  for (const u of cleaned) {
    const k = bucketKey(u);
    if (!k) continue;
    bucketCounts.set(k, (bucketCounts.get(k) || 0) + 1);
  }
  let bestBucket = "";
  let bestCount = 0;
  for (const [k, c] of bucketCounts.entries()) {
    if (c > bestCount) {
      bestBucket = k;
      bestCount = c;
    }
  }
  if (bestBucket && bestCount >= 8 && bestCount >= Math.floor(cleaned.length * 0.5)) {
    return cleaned.filter((u) => bucketKey(u) === bestBucket);
  }
  return cleaned;
}

function pickSource(profileOrigin: string, hasOrg: boolean): "bat_import" | "organization_import" | "external_import" {
  const po = (profileOrigin || "").toLowerCase();
  if (po === "bat_import") return "bat_import";
  if (hasOrg) return "organization_import";
  return "external_import";
}

async function callBackfillImages(params: {
  supabaseUrl: string;
  internalJwt: string;
  vehicleId: string;
  imageUrls: string[];
  source: "bat_import" | "organization_import" | "external_import";
  maxImages: number;
}) {
  const resp = await fetch(`${params.supabaseUrl}/functions/v1/backfill-images`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.internalJwt}`,
    },
    body: JSON.stringify({
      vehicle_id: params.vehicleId,
      image_urls: params.imageUrls.slice(0, params.maxImages),
      source: params.source,
      run_analysis: false,
      max_images: params.maxImages,
      max_runtime_ms: 25000,
      sleep_ms: 150,
    }),
    signal: AbortSignal.timeout(60000),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`backfill-images failed: HTTP ${resp.status} ${JSON.stringify(data)}`);
  }
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const internalJwt = Deno.env.get("INTERNAL_INVOKE_JWT") ?? "";

  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ success: false, error: "Server not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!internalJwt) {
    return new Response(JSON.stringify({ success: false, error: "Missing INTERNAL_INVOKE_JWT" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body: ReqBody = await req.json().catch(() => ({}));
    const batchSize = Math.max(1, Math.min(50, Number(body.batch_size || 5)));
    const maxImagesPerVehicle = Math.max(1, Math.min(200, Number(body.max_images_per_vehicle || 40)));
    const dryRun = body.dry_run === true;
    const includeOrigins = Array.isArray(body.include_profile_origins) ? body.include_profile_origins.map(String) : null;

    const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // Use DB RPC to efficiently select vehicles missing images + carrying origin image URLs.
    const { data: candidates, error } = await service.rpc("get_vehicles_missing_images_with_origin_urls", {
      p_limit: batchSize,
      p_profile_origins: includeOrigins && includeOrigins.length > 0 ? includeOrigins : null,
      p_force: false,
    });
    if (error) throw new Error(`get_vehicles_missing_images_with_origin_urls failed: ${error.message}`);

    const out: any = {
      success: true,
      dry_run: dryRun,
      batch_size: batchSize,
      max_images_per_vehicle: maxImagesPerVehicle,
      attempted: 0,
      backfilled: 0,
      skipped: 0,
      failed: 0,
      sample: [] as any[],
      note: "Backfills storage-backed vehicle_images for vehicles missing images using origin_metadata.image_urls/external_images.",
    };

    for (const v of (candidates || []) as any[]) {

      const om = v?.origin_metadata && typeof v.origin_metadata === "object" ? v.origin_metadata : {};
      const rawUrls = Array.isArray(om?.image_urls) ? om.image_urls : (Array.isArray(om?.external_images) ? om.external_images : []);
      let urls = filterAndDedupeUrls(rawUrls);

      // BaT needs noise filtering.
      const po = String(v?.profile_origin || "");
      const durl = String(v?.discovery_url || "");
      if (po === "bat_import" || durl.includes("bringatrailer.com/listing/")) {
        urls = filterBatNoise(urls);
      }

      if (urls.length === 0) {
        out.skipped++;
        continue;
      }

      out.attempted++;

      const source = pickSource(po, Boolean(v?.origin_organization_id));
      if (dryRun) {
        out.backfilled++;
        if (out.sample.length < 10) out.sample.push({ vehicle_id: v.id, would_backfill: urls.length, source });
        continue;
      }

      try {
        const data = await callBackfillImages({
          supabaseUrl,
          internalJwt,
          vehicleId: v.id,
          imageUrls: urls,
          source,
          maxImages: maxImagesPerVehicle,
        });

        out.backfilled++;
        if (out.sample.length < 10) out.sample.push({ vehicle_id: v.id, backfilled: true, source, result: data?.results || null });
      } catch (e: any) {
        out.failed++;
        if (out.sample.length < 10) out.sample.push({ vehicle_id: v.id, backfilled: false, error: e?.message || String(e) });
      }
    }

    return new Response(JSON.stringify(out), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});


