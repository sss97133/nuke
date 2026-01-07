// Fixes image contamination for a single vehicle and can rehydrate from canonical source gallery.
// Dry-run by default; apply changes when `apply=true` in the JSON body.
// Request: POST { vehicle_id: string, apply?: boolean, rehydrate?: boolean }

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_KEY") ??
  "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or service role key in env.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const HOST_BLOCKLIST = [
  "facebook.com",
  "px.ads.linkedin.com",
  "addtoany.com",
  "barrett-jackson.com", // placeholder
];

const isBadHost = (url?: string | null) => {
  if (!url) return false;
  try {
    const u = new URL(url);
    // Allow BaT uploads but block other BaT assets
    if (u.hostname.includes("bringatrailer.com")) {
      return !u.pathname.includes("/wp-content/uploads/");
    }
    return HOST_BLOCKLIST.some((h) => u.hostname.includes(h));
  } catch {
    return false;
  }
};

const isLikelyImage = (url: string) => {
  if (!url) return false;
  const lower = url.toLowerCase();
  // exclude svg/icons and tracking pixels
  if (lower.endsWith(".svg")) return false;
  if (lower.includes("pixel")) return false;
  // accept common raster extensions
  if (/\.(jpg|jpeg|png|webp|avif)(\?|$)/i.test(lower)) return true;
  return false;
};

const isAllowedUpload = (url: string) => {
  try {
    const u = new URL(url);
    // Allow BaT uploads but not theme assets
    if (u.hostname.includes("bringatrailer.com")) {
      return u.pathname.includes("/wp-content/uploads/");
    }
    return true;
  } catch {
    return false;
  }
};

const unique = <T>(arr: T[]) => Array.from(new Set(arr));

const normalizeCanonicalList = (om: any): string[] => {
  if (!om || typeof om !== "object") return [];
  const imgs = Array.isArray(om.images)
    ? om.images
    : Array.isArray(om.image_urls)
    ? om.image_urls
    : [];
  const thumb = om.thumbnail_url || om.thumbnail || null;
  return unique(
    [
      ...(thumb ? [thumb] : []),
      ...imgs,
    ]
      .filter((u) => typeof u === "string" && u.startsWith("http"))
      .filter((u) => !isBadHost(u))
      .filter((u) => isLikelyImage(u))
      .filter((u) => isAllowedUpload(u)),
  );
};

async function fetchBatUploads(discoveryUrl: string): Promise<string[]> {
  try {
    const res = await fetch(discoveryUrl, { redirect: "follow" });
    const html = await res.text();
    const matches = Array.from(
      html.matchAll(
        /https?:\/\/[^"'>\\s]*wp-content\/uploads\/[^"'>\\s]+\.(?:jpg|jpeg|png|webp|avif)/gi,
      ),
    ).map((m) => m[0]);
    return normalizeCanonicalList({ images: matches });
  } catch (_err) {
    return [];
  }
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const vehicleId = body?.vehicle_id;
  const apply = Boolean(body?.apply);
  const rehydrate = Boolean(body?.rehydrate);
  let scraped = 0;

  if (!vehicleId) {
    return new Response("vehicle_id is required", { status: 400 });
  }

  try {
    const { data: vehicle, error: vErr } = await supabase
      .from("vehicles")
      .select(
        `
          id, primary_image_url, image_url, profile_origin, discovery_url,
          origin_metadata, sale_status, auction_outcome, asking_price,
          sale_price, bat_sold_price, bat_sale_date
        `,
      )
      .eq("id", vehicleId)
      .maybeSingle();
    if (vErr) throw vErr;
    if (!vehicle) {
      return new Response("Vehicle not found", { status: 404 });
    }

    const { data: images, error: imgErr } = await supabase
      .from("vehicle_images")
      .select(
        `
          id, vehicle_id, image_url, storage_path, file_hash,
          thumbnail_url, medium_url, large_url, variants, source
        `,
      )
      .eq("vehicle_id", vehicleId);
    if (imgErr) throw imgErr;

    const hashes = unique(
      (images ?? []).map((i) => i.file_hash).filter((h) => !!h) as string[],
    );

    let hashUsage: Record<string, number> = {};
    if (hashes.length) {
      const { data: usageRows, error: usageErr } = await supabase
        .from("vehicle_images")
        .select("file_hash, vehicle_id")
        .in("file_hash", hashes);
      if (usageErr) throw usageErr;
      const usageMap: Record<string, Set<string>> = {};
      for (const row of usageRows ?? []) {
        const set = usageMap[row.file_hash] ?? new Set<string>();
        set.add(row.vehicle_id);
        usageMap[row.file_hash] = set;
      }
      hashUsage = Object.fromEntries(
        Object.entries(usageMap).map(([h, set]) => [h, set.size]),
      );
    }

    const contaminated: any[] = [];
    const clean: any[] = [];

    for (const img of images ?? []) {
      const url = img.image_url || img.large_url || img.medium_url ||
        img.thumbnail_url || img.storage_path;
      const hashCount = img.file_hash ? (hashUsage[img.file_hash] ?? 0) : 0;
      const shared = hashCount > 1;
      const badHost = isBadHost(url);
      if (shared || badHost) {
        contaminated.push({
          ...img,
          reason: shared
            ? `hash shared by ${hashCount} vehicles`
            : "bad host",
        });
      } else {
        clean.push(img);
      }
    }

    let canonical = normalizeCanonicalList(vehicle.origin_metadata);

    // If BaT source and no canonical images, attempt scrape
    const discoveryUrl = String(vehicle.discovery_url || "").trim();
    if (!canonical.length && discoveryUrl.includes("bringatrailer.com")) {
      const scrapedList = await fetchBatUploads(discoveryUrl);
      scraped = scrapedList.length;
      if (apply && scrapedList.length) {
        // Merge into origin_metadata if missing
        const om = vehicle.origin_metadata && typeof vehicle.origin_metadata === "object"
          ? { ...vehicle.origin_metadata }
          : {};
        if (!om.images && !om.image_urls) {
          om.images = scrapedList;
          om.image_urls = scrapedList;
          om.bat_scraped_at = new Date().toISOString();
          await supabase.from("vehicles").update({ origin_metadata: om }).eq("id", vehicleId);
          // Refresh canonical after write
          canonical = scrapedList;
        }
      } else if (scrapedList.length) {
        canonical = scrapedList;
      }
    }

    const preferredPrimary = (() => {
      if (canonical.length) return canonical[0];
      const cleanUrls = clean
        .map((c) =>
          c.image_url || c.large_url || c.medium_url || c.thumbnail_url
        )
        .filter((u) => !!u && !isBadHost(u) && isLikelyImage(u) && isAllowedUpload(u));
      if (cleanUrls.length) return cleanUrls[0];
      return null;
    })();

    if (apply) {
      if (contaminated.length) {
        const ids = contaminated.map((c) => c.id);
        const { error: delErr } = await supabase.from("vehicle_images")
          .delete()
          .in("id", ids);
        if (delErr) throw delErr;
      }

      // Rehydrate missing canonical images if requested
      if (rehydrate && canonical.length) {
        // Existing URLs in images to avoid dup inserts
        const existingUrls = new Set(
          (images ?? [])
            .map((i) => i.image_url)
            .filter((u) => !!u) as string[],
        );
        const toInsert = canonical.filter((u) => !existingUrls.has(u));
        if (toInsert.length) {
          const rows = toInsert.map((url) => ({
            vehicle_id: vehicleId,
            image_url: url,
            source: "rehydrate",
          }));
          const { error: insErr } = await supabase.from("vehicle_images")
            .insert(rows);
          if (insErr) throw insErr;
        }
      }

      if (preferredPrimary && preferredPrimary !== vehicle.primary_image_url) {
        const { error: updErr } = await supabase
          .from("vehicles")
          .update({
            primary_image_url: preferredPrimary,
            image_url: vehicle.image_url || preferredPrimary,
            updated_at: new Date().toISOString(),
          })
          .eq("id", vehicleId);
        if (updErr) throw updErr;
      }
    }

    return new Response(
      JSON.stringify({
        vehicle_id: vehicleId,
        apply,
        images_total: images?.length ?? 0,
        contaminated_count: contaminated.length,
        clean_count: clean.length,
        scraped_count: scraped,
        contaminated_examples: contaminated.slice(0, 5).map((c) => ({
          id: c.id,
          reason: c.reason,
          image_url: c.image_url,
          storage_path: c.storage_path,
          file_hash: c.file_hash,
        })),
        canonical_examples: canonical.slice(0, 5),
        preferred_primary: preferredPrimary,
        rehydrate,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

