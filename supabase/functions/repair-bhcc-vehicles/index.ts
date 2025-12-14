import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type ReqBody = {
  organization_id?: string;
  limit?: number;
  dry_run?: boolean;
  import_user_id?: string;
  // If true, only repair obviously broken rows (make/model junk, missing year/stockno/images)
  only_if_bad?: boolean;
};

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : fallback;
  return Math.max(min, Math.min(max, v));
}

function safeString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}

function promoteBhccImageUrl(raw: string): string {
  let s = (raw || "").trim();
  if (!s) return s;
  s = s.replace(/_(s|m)\.(jpg|jpeg|png)$/i, "_l.$2");
  if (s.startsWith("http://")) s = "https://" + s.slice("http://".length);
  return s;
}

function normalizeBhccImageUrl(candidate: string, listingUrl: string): string | null {
  let s = (candidate || "").trim();
  if (!s) return null;
  if (s.startsWith("//")) s = "https:" + s;
  if (s.startsWith("/")) {
    try {
      const base = new URL(listingUrl);
      s = `${base.origin}${s}`;
    } catch {
      s = `https://www.beverlyhillscarclub.com${s}`;
    }
  }
  if (!/^https?:\/\//i.test(s)) return null;
  if (s.startsWith("http://")) s = "https://" + s.slice("http://".length);
  if (!s.toLowerCase().includes("/galleria_images/")) return null;
  return promoteBhccImageUrl(s);
}

function parseBhccFromHtml(html: string, listingUrl: string): {
  year: number | null;
  make: string | null;
  model: string | null;
  asking_price: number | null;
  images: string[];
  stockno: number | null;
} {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const metaDesc =
    (doc?.querySelector('meta[name="description"]')?.getAttribute("content") || "")
      .replace(/\s+/g, " ")
      .trim();
  const h1 = (doc?.querySelector("h1")?.textContent || "").replace(/\s+/g, " ").trim();

  const stockMatch = metaDesc.match(/Stock\s*#\s*(\d{1,10})/i) || html.match(/Stock\s*#\s*(\d{1,10})/i);
  const stockno = stockMatch?.[1] ? parseInt(stockMatch[1], 10) : null;

  const priceText =
    (doc?.querySelector(".price")?.textContent || doc?.querySelector('[class*="price"]')?.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
  const priceDigits = (priceText || "").replace(/[^\d]/g, "");
  const asking_price = priceDigits ? parseInt(priceDigits, 10) : null;

  let year: number | null = null;
  let make: string | null = null;
  let model: string | null = null;

  const md = metaDesc.match(/Used\s+(\d{4})\s+(.+?)\s+Stock\s*#\s*\d+/i);
  const titleLike = md?.[1] && md?.[2] ? `${md[1]} ${md[2]}` : h1;
  const ymm = (titleLike || "").replace(/\s+/g, " ").trim();
  const m = ymm.match(/^(\d{4})\s+(.+)$/);
  if (m) {
    year = parseInt(m[1], 10);
    const rest = (m[2] || "").trim();
    const multi = ["Mercedes-Benz", "Alfa Romeo", "Aston Martin", "Rolls-Royce", "Land Rover", "Austin Healey", "De Tomaso"];
    const lowerRest = rest.toLowerCase();
    let matched = false;
    for (const cand of multi) {
      const lc = cand.toLowerCase();
      if (lowerRest.startsWith(lc + " ")) {
        make = cand;
        model = rest.slice(cand.length).trim() || null;
        matched = true;
        break;
      }
    }
    if (!matched) {
      const parts = rest.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        make = parts[0] || null;
        model = parts.slice(1).join(" ") || null;
      }
    }
  }

  // Images: grab BHCC galleria_images URLs (absolute OR relative) from DOM + scripts.
  const found = new Set<string>();
  const nodes = Array.from(doc?.querySelectorAll('a[href*="galleria_images"], img[src*="galleria_images"], img[data-src*="galleria_images"], img[data-lazy*="galleria_images"]') || []);
  for (const n of nodes as any[]) {
    const href = (n.getAttribute?.("href") || "").trim();
    const src = (n.getAttribute?.("src") || "").trim();
    const dataSrc = (n.getAttribute?.("data-src") || "").trim();
    const dataLazy = (n.getAttribute?.("data-lazy") || "").trim();
    for (const c of [href, src, dataSrc, dataLazy]) {
      if (!c) continue;
      const u = normalizeBhccImageUrl(c, listingUrl);
      if (u) found.add(u);
    }
  }

  const reAbs = /https?:\/\/(?:www\.)?beverlyhillscarclub\.com\/galleria_images\/[^\s"'<>]+?\.(jpg|jpeg|png)/gi;
  let mmAbs: RegExpExecArray | null;
  while ((mmAbs = reAbs.exec(html)) !== null) {
    const u = normalizeBhccImageUrl(mmAbs[0], listingUrl);
    if (u) found.add(u);
  }

  const reRel = /\/galleria_images\/[^\s"'<>]+?\.(jpg|jpeg|png)/gi;
  let mmRel: RegExpExecArray | null;
  while ((mmRel = reRel.exec(html)) !== null) {
    const u = normalizeBhccImageUrl(mmRel[0], listingUrl);
    if (u) found.add(u);
  }

  const images = Array.from(found);

  return {
    year: Number.isFinite(year as any) ? year : null,
    make,
    model,
    asking_price: asking_price && Number.isFinite(asking_price) ? asking_price : null,
    images,
    stockno: (typeof stockno === "number" && Number.isFinite(stockno)) ? stockno : null,
  };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: "Missing Supabase env" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = (await req.json().catch(() => ({}))) as ReqBody;

    const orgId = safeString(body.organization_id);
    const limit = clampInt(body.limit, 1, 250, 50);
    const dryRun = body.dry_run === true;
    const onlyIfBad = body.only_if_bad !== false; // default true
    const importUserId = safeString(body.import_user_id);

    // Pull candidate vehicles for BHCC (by org_id or by domain in discovery_url).
    let q = supabase
      .from("vehicles")
      .select("id,discovery_url,year,make,model,asking_price,origin_metadata,origin_organization_id,created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (orgId) {
      q = q.eq("origin_organization_id", orgId);
    } else {
      q = q.ilike("discovery_url", "%beverlyhillscarclub.com/%");
    }

    const { data: vehicles, error: vErr } = await q;
    if (vErr) throw new Error(`vehicles query failed: ${vErr.message}`);

    const list = Array.isArray(vehicles) ? vehicles : [];

    const result = {
      ok: true,
      scanned: list.length,
      repaired: 0,
      skipped: 0,
      images_inserted: 0,
      dry_run: dryRun,
      sample: [] as any[],
    };

    for (const v of list as any[]) {
      const url = safeString(v.discovery_url);
      if (!url || !url.includes("beverlyhillscarclub.com/")) {
        result.skipped++;
        continue;
      }

      const make = safeString(v.make) || "";
      const model = safeString(v.model) || "";
      const stockno = (v.origin_metadata && typeof v.origin_metadata === "object") ? (v.origin_metadata?.bhcc?.stockno ?? null) : null;

      // Determine if images are missing (avoid duplicates: only insert if zero).
      let existingImageCount: number | null = null;
      try {
        const { count, error: imgCountErr } = await supabase
          .from("vehicle_images")
          .select("id", { count: "exact", head: true })
          .eq("vehicle_id", v.id);
        if (!imgCountErr && typeof count === "number") existingImageCount = count;
      } catch {
        // ignore
      }
      const missingImages = existingImageCount === 0;

      const looksBad =
        !v.year ||
        !make ||
        !model ||
        make.toLowerCase() === "beverly" ||
        model.toLowerCase().includes("car club") ||
        !stockno ||
        missingImages;

      if (onlyIfBad && !looksBad) {
        result.skipped++;
        continue;
      }

      const html = await fetch(url, {
        headers: {
          "User-Agent": "NukeBhccRepair/1.0",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(15000),
      }).then((r) => r.ok ? r.text() : "").catch(() => "");

      if (!html) {
        result.skipped++;
        continue;
      }

      const parsed = parseBhccFromHtml(html, url);
      if (!parsed.make || !parsed.model) {
        result.skipped++;
        continue;
      }

      // Update vehicle identity + origin_metadata.bhcc.stockno
      const om = (v.origin_metadata && typeof v.origin_metadata === "object") ? v.origin_metadata : {};
      const nextOm = {
        ...om,
        bhcc: {
          ...(om as any)?.bhcc,
          stockno: parsed.stockno ?? (om as any)?.bhcc?.stockno ?? null,
          last_repaired_at: new Date().toISOString(),
        }
      };

      if (!dryRun) {
        await supabase
          .from("vehicles")
          .update({
            year: parsed.year ?? v.year,
            make: parsed.make,
            model: parsed.model,
            asking_price: parsed.asking_price ?? v.asking_price,
            origin_metadata: nextOm,
            updated_at: new Date().toISOString(),
          } as any)
          .eq("id", v.id);
      }

      // If vehicle has zero images, add external image rows (requires import_user_id).
      if (importUserId && parsed.images.length && missingImages) {
        if (!dryRun) {
          const maxImgs = Math.min(parsed.images.length, 24);
          for (let i = 0; i < maxImgs; i++) {
            const img = parsed.images[i];
            const { error: imgErr } = await supabase
              .from("vehicle_images")
              .insert({
                vehicle_id: v.id,
                user_id: importUserId,
                image_url: img,
                source: "dealer_scrape",
                source_url: url,
                is_external: true,
                position: i,
                is_primary: i === 0,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              } as any);
            if (!imgErr) result.images_inserted++;
          }
        }
      }

      result.repaired++;
      if (result.sample.length < 8) {
        result.sample.push({
          vehicle_id: v.id,
          url,
          year: parsed.year ?? v.year,
          make: parsed.make,
          model: parsed.model,
          stockno: parsed.stockno,
          images_found: parsed.images.length,
        });
      }
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: err?.message || String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});


