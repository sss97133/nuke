import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

/**
 * BaT Gallery Hygiene Runner (batch-safe).
 *
 * Canonical source of truth: vehicles.origin_metadata.image_urls (BaT #bat_listing_page_photo_gallery[data-gallery-items]).
 *
 * This function:
 * - If canonical URLs are missing/small, fetches the BaT listing HTML and refreshes origin_metadata.image_urls (NO backfill).
 * - Calls public.repair_bat_vehicle_gallery_images(vehicle_id) to:
 *   - set vehicle_images.position to match canonical ordering
 *   - mark non-canonical BaT-domain images as is_duplicate (never delete)
 *   - reset primary image to canonical position 0
 */

type ReqBody = {
  vehicle_id?: string; // If provided, only process this vehicle
  dry_run?: boolean;
  limit?: number; // Max vehicles to scan (default 1000)
  batch_size?: number; // Max vehicles to repair in one run (default 25)
  min_vehicle_age_hours?: number; // optional rate limiter
};

function isBatListingUrl(raw: string | null | undefined): boolean {
  const s = String(raw || "").toLowerCase();
  return s.includes("bringatrailer.com/listing/");
}

function coalesceUrl(v: any): string | null {
  const url = (v?.bat_auction_url || v?.listing_url || v?.discovery_url || null) as string | null;
  return url ? String(url) : null;
}

async function isAuthorized(req: Request): Promise<{ ok: boolean; mode: "service_role" | "admin_user" | "none"; error?: string }> {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  if (!authHeader) return { ok: false, mode: "none", error: "Missing Authorization header" };

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  if (serviceKey && authHeader.trim() === `Bearer ${serviceKey}`) return { ok: true, mode: "service_role" };

  // Allow logged-in admins to trigger from the UI.
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("ANON_KEY") ?? "";
  if (!supabaseUrl || !anonKey) return { ok: false, mode: "none", error: "Server not configured" };

  try {
    const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await authClient.auth.getUser();
    if (userErr || !userData?.user) return { ok: false, mode: "none", error: "Unauthorized" };

    // IMPORTANT: is_admin_or_moderator() depends on auth.uid(), so it must run under the user's JWT context.
    const { data: isAdmin, error: adminErr } = await authClient.rpc("is_admin_or_moderator");
    if (adminErr) return { ok: false, mode: "none", error: adminErr.message };
    if (isAdmin === true) return { ok: true, mode: "admin_user" };
    return { ok: false, mode: "none", error: "Forbidden" };
  } catch (e: any) {
    return { ok: false, mode: "none", error: e?.message || String(e) };
  }
}

function cleanCanonical(urls: any[]): string[] {
  const arr = Array.isArray(urls) ? urls : [];
  const out: string[] = [];
  for (const u of arr) {
    if (typeof u !== "string") continue;
    const s = u.trim();
    if (!s) continue;
    const low = s.toLowerCase();
    if (!low.includes("bringatrailer.com/wp-content/uploads/")) continue;
    if (low.includes("/countries/") || low.includes("/themes/") || low.endsWith(".svg")) continue;
    out.push(s.split("#")[0].split("?")[0].replace(/-scaled\./g, "."));
  }
  // De-dupe preserving order
  return [...new Set(out)];
}

function safeDecodeHtmlAttr(s: string): string {
  return String(s || "")
    .replace(/&quot;/g, "\"")
    .replace(/&#038;/g, "&")
    .replace(/&amp;/g, "&");
}

function extractCanonicalGalleryUrlsFromHtml(html: string): string[] {
  const h = String(html || "");

  const normalize = (u: string) =>
    u
      .split("#")[0]
      .split("?")[0]
      .replace(/&#038;/g, "&")
      .replace(/&amp;/g, "&")
      .replace(/-scaled\./g, ".")
      .trim();

  const isOk = (u: string) => {
    const s = u.toLowerCase();
    return u.startsWith("http") && s.includes("bringatrailer.com/wp-content/uploads/") && !s.endsWith(".svg") && !s.endsWith(".pdf");
  };

  const isNoise = (u: string): boolean => {
    const f = u.toLowerCase();
    return (
      f.includes("qotw") ||
      f.includes("winner-template") ||
      f.includes("weekly-weird") ||
      f.includes("mile-marker") ||
      f.includes("podcast") ||
      f.includes("merch") ||
      f.includes("thumbnail-template") ||
      f.includes("site-post-") ||
      f.includes("screenshot-") ||
      f.includes("countries/") ||
      f.includes("themes/") ||
      f.includes("assets/img/") ||
      /\/web-\d{3,}-/i.test(f)
    );
  };

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(h, "text/html");
    const galleryDiv = doc?.getElementById("bat_listing_page_photo_gallery");
    if (!galleryDiv) return [];
    const attr = galleryDiv.getAttribute("data-gallery-items");
    if (!attr) return [];
    const jsonText = safeDecodeHtmlAttr(attr);
    const items = JSON.parse(jsonText);
    if (!Array.isArray(items)) return [];
    const urls: string[] = [];
    for (const it of items) {
      const u = it?.large?.url || it?.small?.url;
      if (typeof u !== "string" || !u.trim()) continue;
      const nu = normalize(u);
      if (!isOk(nu)) continue;
      if (isNoise(nu)) continue;
      urls.push(nu);
    }
    return [...new Set(urls)];
  } catch {
    return [];
  }
}

async function fetchHtml(url: string): Promise<{ html: string; method: string; status: number }> {
  const firecrawlApiKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (firecrawlApiKey) {
    try {
      const r = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${firecrawlApiKey}`,
        },
        body: JSON.stringify({
          url,
          formats: ["html"],
          onlyMainContent: false,
          waitFor: 3500,
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (r.ok) {
        const j = await r.json().catch(() => ({}));
        const html = String(j?.data?.html || "");
        if (html) return { html, method: "firecrawl", status: 200 };
      }
    } catch {
      // fall through
    }
  }

  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; NukeBot/1.0)",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
    },
    signal: AbortSignal.timeout(20000),
  });
  const html = await r.text();
  return { html, method: "direct", status: r.status };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await isAuthorized(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ success: false, error: auth.error || "Unauthorized" }), {
      status: auth.error === "Forbidden" ? 403 : 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ success: false, error: "Server not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body: ReqBody = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const limit = Math.max(1, Math.min(5000, Number(body.limit || 1000))); // Safety limit
    const batchSize = Math.max(1, Math.min(100, Number(body.batch_size || 25))); // Repairs per run
    const minAgeHours = Math.max(0, Math.min(24 * 90, Number(body.min_vehicle_age_hours || 0)));

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // Get vehicles to process
    let vehicles: any[] = [];
    if (body.vehicle_id) {
      // Single vehicle mode (for testing)
      const { data, error } = await admin
        .from("vehicles")
        .select("id, year, make, model, profile_origin, discovery_url, listing_url, bat_auction_url, origin_metadata")
        .eq("id", body.vehicle_id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (data) vehicles = [data];
    } else {
      // Batch mode: Find ALL BaT vehicles that have BaT images
      // First, get BaT vehicles (we'll filter to candidates during processing loop)
      const cutoffIso = minAgeHours > 0 ? new Date(Date.now() - minAgeHours * 60 * 60 * 1000).toISOString() : null;
      const { data, error } = await admin
        .from("vehicles")
        .select("id, year, make, model, profile_origin, discovery_url, listing_url, bat_auction_url, origin_metadata, discovery_source")
        .or("profile_origin.eq.bat_import,discovery_source.eq.bat_import,listing_url.ilike.%bringatrailer.com/listing/%,discovery_url.ilike.%bringatrailer.com/listing/%,bat_auction_url.ilike.%bringatrailer.com/listing/%")
        .order("updated_at", { ascending: true })
        .limit(limit);
      if (error) throw new Error(error.message);
      vehicles = data || [];
      if (cutoffIso) {
        vehicles = vehicles.filter((v) => !v?.updated_at || String(v.updated_at) <= cutoffIso);
      }
    }

    const results: any = {
      success: true,
      dry_run: dryRun,
      auth_mode: auth.mode,
      scanned: vehicles.length,
      candidates: 0,
      repaired: 0,
      refreshed_canonical: 0,
      skipped: 0,
      failed: 0,
      vehicles: [] as any[],
    };

    for (const vehicle of vehicles) {
      const vehicleResult: any = {
        vehicle_id: vehicle.id,
        vehicle_name: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
        canonical_images: 0,
        repaired: false,
        refreshed_canonical: false,
        rpc: null as any,
        errors: [] as string[],
      };

      try {
        const url = coalesceUrl(vehicle);
        if (!url || !isBatListingUrl(url)) {
          vehicleResult.skipped_reason = "no_bat_listing_url";
          results.skipped++;
          results.vehicles.push(vehicleResult);
          continue;
        }

        // Canonical set from origin_metadata.image_urls
        const om = (vehicle.origin_metadata && typeof vehicle.origin_metadata === "object") ? vehicle.origin_metadata : {};
        let canonical = cleanCanonical((om as any)?.image_urls);
        vehicleResult.canonical_images = canonical.length;

        // If canonical is missing/small, refresh it from HTML using batDomMap (no backfill)
        if (canonical.length < 20) {
          results.candidates++;
          if (!dryRun) {
            const fetched = await fetchHtml(url);
            const fresh = extractCanonicalGalleryUrlsFromHtml(fetched.html);
            if (fresh.length >= 20) {
              const nextOm = { ...(om as any), image_urls: fresh, image_count: fresh.length, bat_hygiene: { ...(om as any)?.bat_hygiene, refreshed_at: new Date().toISOString(), refresh_method: fetched.method } };
              await admin.from("vehicles").update({ origin_metadata: nextOm, updated_at: new Date().toISOString() }).eq("id", vehicle.id);
              canonical = fresh;
              vehicleResult.canonical_images = canonical.length;
              vehicleResult.refreshed_canonical = true;
              results.refreshed_canonical++;
            }
          } else {
            vehicleResult.refreshed_canonical = true;
          }
        }

        // If we now have canonical, run the strict repair RPC
        if (vehicleResult.canonical_images >= 20) {
          results.candidates++;
          const { data: rpcData, error: rpcErr } = await admin.rpc("repair_bat_vehicle_gallery_images", {
            p_vehicle_id: vehicle.id,
            p_dry_run: dryRun,
          });
          if (rpcErr) throw new Error(rpcErr.message);
          vehicleResult.rpc = rpcData;
          vehicleResult.repaired = rpcData?.skipped !== true;
          if (vehicleResult.repaired) results.repaired++;
        } else {
          vehicleResult.skipped_reason = "canonical_missing";
          results.skipped++;
        }
      } catch (e: any) {
        vehicleResult.errors.push(e?.message || String(e));
        results.failed++;
      }

      results.vehicles.push(vehicleResult);

      // Soft limit repairs per run (keeps runtime predictable)
      if (!body.vehicle_id) {
        const done = results.repaired + results.failed + results.skipped;
        if (done >= batchSize) break;
      }

      // small delay to avoid hammering
      await new Promise((r) => setTimeout(r, 75));
    }

    return new Response(JSON.stringify(results, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

