import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type ProcessRequest = {
  batch_size?: number;
  source_id?: string;
  // If true, only create vehicles + external vehicle_images (do not download/upload to storage)
  // This keeps edge runtimes fast and avoids 504s.
  external_images_only?: boolean;
  max_external_images?: number;
  // Optional override for attribution on vehicle_images.user_id (must be an auth.users id)
  import_user_id?: string;
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

async function getDefaultImportUserId(supabase: any): Promise<string | null> {
  try {
    // Note: `auth.users` is not reliably exposed via PostgREST. Use `profiles` (public) as the
    // canonical place to find a stable user id for attribution when running automated imports.
    // `profiles.id` is the auth user id in this project.
    const { data, error } = await supabase
      .from("profiles")
      .select("id,created_at")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) return null;
    return data?.id ?? null;
  } catch {
    return null;
  }
}

function promoteBhccImageUrl(raw: string): string {
  let s = (raw || "").trim();
  if (!s) return s;
  s = s.replace(/_(s|m)\.(jpg|jpeg|png)$/i, "_l.$2");
  return s;
}

function normalizeBhccImageUrl(candidate: string, listingUrl: string): string | null {
  let s = (candidate || "").trim();
  if (!s) return null;

  // Prefer https, tolerate protocol-relative URLs.
  if (s.startsWith("//")) s = "https:" + s;

  // Convert relative paths to absolute.
  if (s.startsWith("/")) {
    try {
      const base = new URL(listingUrl);
      s = `${base.origin}${s}`;
    } catch {
      s = `https://www.beverlyhillscarclub.com${s}`;
    }
  }

  // If it’s still not absolute, skip (we only store absolute external links).
  if (!/^https?:\/\//i.test(s)) return null;

  // Normalize host + prefer https.
  if (s.startsWith("http://")) s = "https://" + s.slice("http://".length);

  // Only keep BHCC galleria images.
  if (!s.toLowerCase().includes("/galleria_images/")) return null;

  return promoteBhccImageUrl(s);
}

function parseBhccFromHtml(html: string, listingUrl: string): {
  year: number | null;
  make: string | null;
  model: string | null;
  asking_price: number | null;
  images: string[];
  bhcc_stockno: number | null;
} {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const h1 = (doc?.querySelector("h1")?.textContent || "").replace(/\s+/g, " ").trim();
  const metaDesc =
    (doc?.querySelector('meta[name="description"]')?.getAttribute("content") || "")
      .replace(/\s+/g, " ")
      .trim();

  const bhccStockMatch = metaDesc.match(/Stock\s*#\s*(\d{1,10})/i) || html.match(/Stock\s*#\s*(\d{1,10})/i);
  const bhcc_stockno = bhccStockMatch?.[1] ? parseInt(bhccStockMatch[1], 10) : null;

  // Price (best-effort)
  const priceText =
    (doc?.querySelector(".price")?.textContent || doc?.querySelector('[class*="price"]')?.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
  const priceDigits = (priceText || "").replace(/[^\d]/g, "");
  const asking_price = priceDigits ? parseInt(priceDigits, 10) : null;

  // Y/M/M from meta description: "Used 1955 Mercedes-Benz 190SL Stock # 1068 ..."
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
    // Minimal multiword make handling
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

  // Images: prefer BHCC galleria_images; keep hi-res _l when possible.
  const found = new Set<string>();

  // 1) DOM-driven extraction (most reliable; catches relative URLs)
  const domCandidates: string[] = [];
  const nodes = Array.from(doc?.querySelectorAll('a[href*="galleria_images"], img[src*="galleria_images"], img[data-src*="galleria_images"], img[data-lazy*="galleria_images"]') || []);
  for (const n of nodes as any[]) {
    const href = (n.getAttribute?.("href") || "").trim();
    const src = (n.getAttribute?.("src") || "").trim();
    const dataSrc = (n.getAttribute?.("data-src") || "").trim();
    const dataLazy = (n.getAttribute?.("data-lazy") || "").trim();
    if (href) domCandidates.push(href);
    if (src) domCandidates.push(src);
    if (dataSrc) domCandidates.push(dataSrc);
    if (dataLazy) domCandidates.push(dataLazy);
  }
  for (const c of domCandidates) {
    const u = normalizeBhccImageUrl(c, listingUrl);
    if (u) found.add(u);
  }

  // 2) Regex fallback for absolute + non-www + relative URLs embedded in scripts
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
    bhcc_stockno: (typeof bhcc_stockno === "number" && Number.isFinite(bhcc_stockno)) ? bhcc_stockno : null,
  };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

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

    const body = (await req.json().catch(() => ({}))) as ProcessRequest;
    const batchSize = clampInt(body.batch_size, 1, 50, 10);
    const sourceId = safeString(body.source_id);
    const externalOnly = body.external_images_only !== false; // default true
    const maxExternalImages = clampInt(body.max_external_images, 1, 60, 24);
    const importUserId =
      safeString(body.import_user_id) ||
      (await getDefaultImportUserId(supabase));

    let q = supabase
      .from("import_queue")
      .select("*")
      .eq("status", "pending")
      .lt("attempts", 3)
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(batchSize);

    if (sourceId) q = q.eq("source_id", sourceId);

    const { data: items, error: qErr } = await q;
    if (qErr) throw new Error(`import_queue query failed: ${qErr.message}`);

    if (!items?.length) {
      return new Response(JSON.stringify({ success: true, processed: 0, message: "No pending items" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const out = {
      success: true,
      processed: 0,
      created: 0,
      updated: 0,
      images_created: 0,
      org_links_upserted: 0,
      dealer_inventory_upserted: 0,
      errors: 0,
      sample: [] as any[],
      external_images_only: externalOnly,
      max_external_images: maxExternalImages,
    };

    for (const item of items as any[]) {
      const listingUrl = safeString(item.listing_url);
      if (!listingUrl) continue;

      // mark processing
      await supabase
        .from("import_queue")
        .update({ status: "processing", attempts: (item.attempts ?? 0) + 1 } as any)
        .eq("id", item.id);

      try {
        // Fast-path parse for BHCC directly from HTML (avoids calling other Edge Functions + JWT issues).
        const html = await fetch(listingUrl, {
          headers: {
            "User-Agent": "NukeFastImporter/1.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
          signal: AbortSignal.timeout(15000),
        }).then((r) => r.ok ? r.text() : "").catch(() => "");
        if (!html) throw new Error("Failed to fetch listing HTML");

        const parsed = parseBhccFromHtml(html, listingUrl);
        const year = parsed.year;
        const make = safeString(parsed.make);
        const model = safeString(parsed.model);
        const askingPrice = parsed.asking_price;

        if (!make || !model) {
          throw new Error(`Missing make/model after scrape (make=${make}, model=${model})`);
        }

        const orgId = safeString(item.raw_data?.organization_id) || safeString(item.organization_id) || null;
        const listingStatusRaw = safeString(item.raw_data?.listing_status) || safeString(item.raw_data?.status) || null;
        const isSold = listingStatusRaw === "sold" || listingStatusRaw === "sold_out" || listingStatusRaw === "sold_vehicle";

        // Upsert vehicle by discovery_url (canonical for listing-origin profiles)
        const { data: existingVehicle, error: findErr } = await supabase
          .from("vehicles")
          .select("id, origin_metadata, year, make, model, status, is_public, is_for_sale, primary_image_url, image_url")
          .eq("discovery_url", listingUrl)
          .maybeSingle();
        if (findErr) throw new Error(`vehicles lookup failed: ${findErr.message}`);

        let vehicleId: string;
        if (!existingVehicle?.id) {
          const primaryImage = safeString(parsed.images?.[0] || null);
          const shouldPublish = Boolean(orgId);
          const originMetadata = {
            source_id: item.source_id,
            queue_id: item.id,
            imported_at: new Date().toISOString(),
            external_images: parsed.images,
            image_count: parsed.images.length,
            bhcc: (typeof parsed.bhcc_stockno === "number" && Number.isFinite(parsed.bhcc_stockno))
              ? { stockno: parsed.bhcc_stockno }
              : undefined,
          };
          const { data: inserted, error: insErr } = await supabase
            .from("vehicles")
            .insert({
              year,
              make,
              model,
              asking_price: askingPrice,
              // Dealer inventory imports should be visible in the feed immediately.
              // If we don't have an org link, keep it private/pending.
              status: shouldPublish ? "active" : "pending",
              is_public: shouldPublish,
              is_for_sale: shouldPublish ? !isSold : null,
              primary_image_url: shouldPublish ? primaryImage : null,
              image_url: shouldPublish ? primaryImage : null,
              discovery_url: listingUrl,
              profile_origin: "url_scraper",
              origin_organization_id: orgId,
              origin_metadata: originMetadata,
              import_queue_id: item.id,
            } as any)
            .select("id")
            .single();

          if (insErr) {
            // Race-safe: if another worker inserted the same discovery_url, re-fetch and continue.
            const msg = (insErr as any)?.message || "";
            const code = (insErr as any)?.code || "";
            if (code === "23505" || msg.includes("vehicles_discovery_url_unique") || msg.toLowerCase().includes("duplicate key")) {
              const { data: v2, error: v2Err } = await supabase
                .from("vehicles")
                .select("id")
                .eq("discovery_url", listingUrl)
                .maybeSingle();
              if (v2Err || !v2?.id) throw new Error(`vehicles insert conflicted but lookup failed: ${(v2Err as any)?.message || "no row"}`);
              vehicleId = v2.id;
            } else {
              throw new Error(`vehicles insert failed: ${msg}`);
            }
          } else {
            vehicleId = inserted.id;
            out.created++;
          }
        } else {
          vehicleId = existingVehicle.id;
          const om = (existingVehicle.origin_metadata && typeof existingVehicle.origin_metadata === "object") ? existingVehicle.origin_metadata : {};
          const nextOm = {
            ...om,
            bhcc: (typeof parsed.bhcc_stockno === "number" && Number.isFinite(parsed.bhcc_stockno))
              ? { ...(om as any).bhcc, stockno: parsed.bhcc_stockno }
              : (om as any).bhcc,
            external_images: parsed.images.length ? parsed.images : (om as any).external_images,
            image_count: parsed.images.length ? parsed.images.length : (om as any).image_count,
            last_rescraped_at: new Date().toISOString(),
          };

          // Repair-pass: if existing make/model are clearly junk (or missing), overwrite.
          const needsRepair =
            !existingVehicle.make ||
            !existingVehicle.model ||
            existingVehicle.make.toLowerCase() === "beverly" ||
            existingVehicle.model.toLowerCase().includes("car club");

          const updates: any = {
            updated_at: new Date().toISOString(),
            origin_organization_id: orgId || null,
            origin_metadata: nextOm,
          };
          if (needsRepair) {
            updates.year = year;
            updates.make = make;
            updates.model = model;
          }
          if (!existingVehicle.year && year) updates.year = year;
          if (askingPrice) updates.asking_price = askingPrice;

          // If this item is tied to a dealer org, ensure the vehicle is visible in the public feed.
          // (Homepage feed filters on is_public=true and hides status='pending'.)
          if (orgId) {
            const primaryImage = safeString(parsed.images?.[0] || null);
            if (!existingVehicle.is_public) updates.is_public = true;
            if (safeString(existingVehicle.status) === "pending") updates.status = "active";
            if (existingVehicle.is_for_sale === null || typeof existingVehicle.is_for_sale === "undefined") updates.is_for_sale = !isSold;
            if (!safeString((existingVehicle as any).primary_image_url) && primaryImage) updates.primary_image_url = primaryImage;
            if (!safeString((existingVehicle as any).image_url) && primaryImage) updates.image_url = primaryImage;
          }

          const { error: updErr } = await supabase
            .from("vehicles")
            .update(updates)
            .eq("id", vehicleId);
          if (updErr) throw new Error(`vehicles update failed: ${updErr.message}`);
          out.updated++;
        }

        // External images (fast): insert vehicle_images rows pointing to external URLs.
        if (externalOnly) {
          if (!importUserId) throw new Error("Missing import_user_id (vehicle_images.user_id is required)");
          const images: string[] = Array.isArray(parsed.images) ? parsed.images.filter((u: any) => typeof u === "string" && u.startsWith("http")) : [];
          const toInsert = images.slice(0, maxExternalImages);
          for (let i = 0; i < toInsert.length; i++) {
            const img = toInsert[i];
            const { error: imgErr } = await supabase
              .from("vehicle_images")
              .insert({
                vehicle_id: vehicleId,
                user_id: importUserId,
                image_url: img,
                source: "dealer_scrape",
                source_url: listingUrl,
                is_external: true,
                position: i,
                is_primary: i === 0,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              } as any);
            // ignore dup errors best-effort
            if (!imgErr) out.images_created++;
          }
        }

        // Link to org + inventory (best-effort; schema varies across migrations)
        if (orgId) {
          // organization_vehicles relationship_type must satisfy enum; use 'seller' or 'collaborator'.
          await supabase
            .from("organization_vehicles")
            .upsert({
              organization_id: orgId,
              vehicle_id: vehicleId,
              relationship_type: isSold ? "seller" : "seller",
              status: "active",
              auto_tagged: true,
              notes: `Auto-imported from ${new URL(listingUrl).hostname}`,
              updated_at: new Date().toISOString(),
            } as any, { onConflict: "organization_id,vehicle_id,relationship_type" } as any);
          out.org_links_upserted++;

          await supabase
            .from("dealer_inventory")
            .upsert({
              dealer_id: orgId,
              vehicle_id: vehicleId,
              status: isSold ? "sold" : "in_stock",
              asking_price: askingPrice,
              sale_date: isSold ? new Date().toISOString().slice(0, 10) : null,
              updated_at: new Date().toISOString(),
            } as any, { onConflict: "dealer_id,vehicle_id" } as any);
          out.dealer_inventory_upserted++;
        }

        await supabase
          .from("import_queue")
          .update({ status: "complete", vehicle_id: vehicleId, processed_at: new Date().toISOString(), error_message: null } as any)
          .eq("id", item.id);

        out.processed++;
        if (out.sample.length < 5) {
          out.sample.push({ queue_id: item.id, vehicle_id: vehicleId, listing_url: listingUrl, make, model, year, org_id: orgId, is_sold: isSold });
        }
      } catch (err: any) {
        out.errors++;
        await supabase
          .from("import_queue")
          .update({ status: "failed", error_message: err?.message || String(err), processed_at: new Date().toISOString() } as any)
          .eq("id", item.id);
      }
    }

    return new Response(JSON.stringify(out), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err?.message || String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});


