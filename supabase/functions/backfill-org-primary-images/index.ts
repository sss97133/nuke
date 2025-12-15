import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractBrandAssetsFromHtml } from "../_shared/extractBrandAssets.ts";
import { extractAndCacheFavicon } from "../_shared/extractFavicon.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type RequestBody = {
  batch_size?: number;
  max_sites?: number;
  dry_run?: boolean;
};

function toInt(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function safeString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function normalizeOrigin(url: string): string | null {
  try {
    const u = new URL(url);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    return u.origin.replace(/\/$/, "");
  } catch {
    return null;
  }
}

function pickFirstString(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (Array.isArray(v)) {
    for (const item of v) {
      const s = safeString(item);
      if (s) return s;
    }
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const body: RequestBody = await req.json().catch(() => ({} as any));
    const batchSize = Math.max(1, Math.min(toInt(body.batch_size, 25), 200));
    const maxSites = Math.max(1, Math.min(toInt(body.max_sites, batchSize), batchSize));
    const dryRun = body.dry_run === true;

    // Fetch orgs missing a banner image (primary image).
    // Filter at the DB-level so we don't miss later rows due to paging by updated_at.
    // Includes NULL and empty-string banners.
    const { data: orgs, error } = await supabase
      .from("businesses")
      // Some deployments may not have `favicon_url`/`cover_image_url` columns yet.
      // Keep this query schema-compatible.
      .select("id, business_name, website, logo_url, banner_url, metadata")
      .or("banner_url.is.null,banner_url.eq.")
      .order("updated_at", { ascending: true })
      .limit(batchSize);

    if (error) throw new Error(`businesses select failed: ${error.message}`);

    const candidates = orgs || [];

    const out = {
      success: true,
      dry_run: dryRun,
      batch_size: batchSize,
      candidates: candidates.length,
      processed: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      sample: [] as any[],
    };

    for (const org of candidates.slice(0, maxSites)) {
      out.processed++;
      try {
        const website = safeString(org.website);
        const origin = website ? normalizeOrigin(website) : null;
        let faviconUrl: string | null = safeString((org.metadata as any)?.brand_assets?.favicon_url) || null;

        let bannerUrl: string | null =
          safeString(org.banner_url) ||
          safeString(org.logo_url) ||
          null;

        // Not all schemas have cover_image_url; keep this best-effort only.
        let coverUrl: string | null = null;
        let metaUpdate: any = null;

        if (!bannerUrl && origin) {
          // Fetch HTML and extract brand assets.
          const resp = await fetch(origin, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "Accept-Language": "en-US,en;q=0.9",
            },
            signal: AbortSignal.timeout(15000),
          });

          if (resp.ok) {
            const html = await resp.text();
            const assets = extractBrandAssetsFromHtml(html, origin);
            bannerUrl = safeString(assets.banner_url) || pickFirstString(assets.primary_image_urls) || null;
            coverUrl = coverUrl || safeString(assets.banner_url) || null;

            const existingMeta = (org.metadata && typeof org.metadata === "object") ? org.metadata : {};
            metaUpdate = {
              ...existingMeta,
              brand_assets: {
                ...(existingMeta as any)?.brand_assets,
                banner_url: safeString(assets.banner_url) || null,
                logo_url: safeString(assets.logo_url) || null,
                logo_svg_url: safeString(assets.logo_svg_url) || null,
                primary_image_urls: Array.isArray(assets.primary_image_urls) ? assets.primary_image_urls.slice(0, 8) : [],
                extracted_at: new Date().toISOString(),
                source_url: origin,
              },
            };
          }
        }

        // If still blank, fall back to favicon (at least something for UI).
        if (!bannerUrl && origin) {
          try {
            if (!faviconUrl) {
              faviconUrl = await extractAndCacheFavicon(supabase, origin, "dealer", safeString(org.business_name));
            }
            bannerUrl = safeString(faviconUrl) || null;
          } catch {
            // ignore
          }
        }

        if (!bannerUrl) {
          out.skipped++;
          if (out.sample.length < 5) out.sample.push({ id: org.id, action: "skipped_no_fallback" });
          continue;
        }

        if (!dryRun) {
          const updates: any = {};
          if (!safeString(org.banner_url)) updates.banner_url = bannerUrl;
          // Persist favicon in metadata for schema compatibility.
          if (safeString(faviconUrl)) {
            const existingMeta = (org.metadata && typeof org.metadata === "object") ? org.metadata : {};
            updates.metadata = {
              ...existingMeta,
              brand_assets: {
                ...((existingMeta as any)?.brand_assets || {}),
                favicon_url: faviconUrl,
                extracted_at: new Date().toISOString(),
                source_url: origin,
              }
            };
          } else if (metaUpdate) {
            updates.metadata = metaUpdate;
          }

          if (Object.keys(updates).length > 0) {
            const { error: upErr } = await supabase.from("businesses").update(updates).eq("id", org.id);
            if (upErr) throw new Error(`businesses update failed: ${upErr.message}`);
          }
        }

        out.updated++;
        if (out.sample.length < 5) out.sample.push({ id: org.id, action: dryRun ? "would_update" : "updated", banner_url: bannerUrl });
      } catch (e: any) {
        out.failed++;
        if (out.sample.length < 5) out.sample.push({ id: org.id, action: "failed", error: e?.message || String(e) });
      }
    }

    return new Response(JSON.stringify(out), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err?.message || String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});


