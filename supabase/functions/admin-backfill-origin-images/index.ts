import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type ReqBody = {
  batch_size?: number;
  max_images_per_vehicle?: number;
  dry_run?: boolean;
  force?: boolean;
  include_profile_origins?: string[];
  include_partials?: boolean;
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

  // Heuristic to remove BaT "recommended auctions" noise:
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
  // Only apply if it looks meaningful.
  if (bestBucket && bestCount >= 8 && bestCount >= Math.floor(cleaned.length * 0.5)) {
    return cleaned.filter((u) => bucketKey(u) === bestBucket);
  }
  return cleaned;
}

async function requireAdmin(req: Request, service: any) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const authHeader = req.headers.get("Authorization") || "";

  if (!anonKey) {
    throw new Error("SUPABASE_ANON_KEY not configured");
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data, error } = await authClient.auth.getUser();
  if (error || !data?.user?.id) {
    return { ok: false as const, status: 401, message: "Unauthorized" };
  }

  const userId = data.user.id;
  const { data: adminRow, error: adminErr } = await service
    .from("admin_users")
    .select("id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (adminErr || !adminRow?.id) {
    return { ok: false as const, status: 403, message: "Forbidden" };
  }

  return { ok: true as const, userId };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ success: false, error: "Server not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const admin = await requireAdmin(req, service);
    if (!admin.ok) {
      return new Response(JSON.stringify({ success: false, error: admin.message }), {
        status: admin.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: ReqBody = await req.json().catch(() => ({}));
    const batchSize = Math.max(1, Math.min(200, Number(body.batch_size || 50)));
    // max_images_per_vehicle <= 0 means "no cap"
    const maxImagesPerVehicleRaw = Number(body.max_images_per_vehicle ?? 0);
    const maxImagesPerVehicle =
      Number.isFinite(maxImagesPerVehicleRaw) && maxImagesPerVehicleRaw <= 0
        ? 0
        : Math.max(1, Math.min(5000, Math.floor(Number(body.max_images_per_vehicle || 200))));
    const dryRun = body.dry_run === true;
    const force = body.force === true;
    const includeOrigins = Array.isArray(body.include_profile_origins) ? body.include_profile_origins.map(String) : null;
    const includePartials = body.include_partials === true;

    // Select candidates via SQL RPC to avoid any PostgREST relationship assumptions.
    const rpcName = includePartials ? "get_vehicles_partial_images_with_origin_urls" : "get_vehicles_missing_images_with_origin_urls";
    const { data: vehicles, error: vehErr } = await service.rpc(rpcName, {
      p_limit: batchSize,
      p_profile_origins: includeOrigins && includeOrigins.length > 0 ? includeOrigins : null,
      p_force: force,
    });
    if (vehErr) throw vehErr;

    const results: any = {
      success: true,
      dry_run: dryRun,
      attempted: 0,
      backfilled: 0,
      skipped: 0,
      failed: 0,
      details: [] as any[],
      note: "Processes a window of 1000 newest vehicles; call repeatedly for full coverage.",
    };

    const candidates = (vehicles || []).filter((v: any) => {
      const om = v?.origin_metadata;
      const urls = (om && typeof om === "object") ? (om as any).image_urls : null;
      const list = filterAndDedupeUrls(urls);
      return list.length > 0;
    });

    for (const v of candidates) {
      results.attempted += 1;

      // Skip logic:
      // - Missing-mode: skip if any images already exist
      // - Partial-mode: proceed even if images exist (we're filling gaps)
      if (!includePartials) {
        const { count: existingCount } = await service
          .from("vehicle_images")
          .select("id", { count: "exact", head: true })
          .eq("vehicle_id", v.id)
          // Legacy rows may have is_document = NULL; treat that as "not a document"
          .not("is_document", "is", true);

        if (existingCount && existingCount > 0) {
          results.skipped += 1;
          continue;
        }
      }

      const om = v?.origin_metadata;
      const rawUrls = (om && typeof om === "object") ? (om as any).image_urls : [];
      let urls = filterAndDedupeUrls(rawUrls);
      if (String(v?.profile_origin || "") === "bat_import" || String(v?.discovery_url || "").includes("bringatrailer.com/listing/")) {
        urls = filterBatNoise(urls);
      }
      if (maxImagesPerVehicle > 0) {
        urls = urls.slice(0, maxImagesPerVehicle);
      }

      if (urls.length === 0) {
        results.skipped += 1;
        continue;
      }

      if (dryRun) {
        results.backfilled += 1;
        results.details.push({ vehicle_id: v.id, method: "dry_run", count: urls.length });
        continue;
      }

      // Prefer storage-backed import via backfill-images.
      let method: "storage" | "external_link" = "storage";
      let inserted = 0;
      let backfillErrText: string | null = null;

      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/backfill-images`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            vehicle_id: v.id,
            image_urls: urls,
            source: String(v?.profile_origin || "origin_metadata"),
            run_analysis: false,
            max_images: 0,
            continue: true,
          }),
        });
        const txt = await resp.text();
        if (!resp.ok) {
          backfillErrText = `${resp.status} ${txt}`;
          throw new Error("backfill-images failed");
        }
        // backfill-images returns {uploaded, skipped, failed} (best-effort)
        try {
          const j = JSON.parse(txt);
          inserted = Number(j?.uploaded || 0) + Number(j?.skipped || 0);
        } catch {
          inserted = urls.length;
        }
      } catch {
        // Fallback: create DB rows that point to the external URL directly.
        method = "external_link";
        const nowIso = new Date().toISOString();
        const safeUrls = (urls || [])
          .map((u: string) => String(u || "").trim())
          .filter((u: string) => u.startsWith("http"))
          // Defensive BaT hygiene: don't allow promo/editorial assets into vehicle galleries.
          .filter((u: string) => {
            const s = u.toLowerCase();
            if (!s.includes("bringatrailer.com/wp-content/uploads/")) return true;
            if (s.includes("qotw") || s.includes("winner-template")) return false;
            if (s.includes("weekly-weird") || s.includes("mile-marker")) return false;
            if (s.includes("podcast") || s.includes("merch")) return false;
            if (s.includes("thumbnail-template") || s.includes("site-post-")) return false;
            if (s.includes("screenshot-")) return false;
            if (s.includes("countries/") || s.includes("themes/") || s.includes("assets/img/")) return false;
            if (/\/web-\d{3,}-/i.test(s)) return false;
            return true;
          });

        const rows = safeUrls.map((u: string, idx: number) => ({
          vehicle_id: v.id,
          image_url: u,
          thumbnail_url: u,
          medium_url: u,
          large_url: u,
          variants: { full: u, large: u, medium: u, thumbnail: u },
          is_primary: idx === 0,
          is_document: false,
          is_external: true,
          approval_status: "auto_approved",
          is_approved: true,
          redaction_level: "none",
          is_duplicate: false,
          duplicate_of: null,
          stale: false,
          position: idx,
          display_order: idx,
          source: String(v?.profile_origin || "origin_metadata"),
          source_url: String(v?.discovery_url || "") || null,
          caption: String(v?.profile_origin || "Imported"),
          created_at: nowIso,
          updated_at: nowIso,
        }));

        const { error: insErr } = await service.from("vehicle_images").insert(rows);
        if (insErr) {
          results.failed += 1;
          results.details.push({ vehicle_id: v.id, method, error: insErr.message, backfill_error: backfillErrText });
          continue;
        }
        inserted = rows.length;
      }

      // Bookkeeping on vehicles.origin_metadata
      try {
        const existingOm = (om && typeof om === "object") ? om : {};
        const nextOm = {
          ...existingOm,
          images_backfilled_at: new Date().toISOString(),
          images_backfilled_count: inserted,
          images_backfilled_method: method,
          images_backfilled_source: "origin_metadata",
          ...(backfillErrText ? { images_backfilled_backfill_error: backfillErrText } : {}),
        };
        await service
          .from("vehicles")
          .update({ origin_metadata: nextOm, updated_at: new Date().toISOString() } as any)
          .eq("id", v.id);
      } catch {
        // non-fatal
      }

      results.backfilled += 1;
      results.details.push({ vehicle_id: v.id, method, count: inserted });
    }

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});


