/**
 * backfill-mecum-descriptions
 *
 * Re-extracts description (and other fields) for Mecum vehicles missing descriptions
 * by parsing archived HTML from listing_page_snapshots.
 *
 * Strategy:
 *  1. Query vehicles WHERE listing_url ILIKE '%mecum%' AND description IS NULL
 *  2. For each, find the best archived snapshot in listing_page_snapshots
 *  3. Parse __NEXT_DATA__ JSON from snapshot HTML → extract blocks → get HIGHLIGHTS/EQUIPMENT
 *  4. Also captures: engine, mileage, vin, transmission, lot_number from the same parse
 *  5. Update vehicles table (only overwrite fields that are currently NULL)
 *
 * This is archive-only — no live fetches, zero cost.
 *
 * Input:  { batch_size?: number (default 20), dry_run?: boolean }
 * Output: { success, stats }
 *
 * Deploy: supabase functions deploy backfill-mecum-descriptions --no-verify-jwt
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ─── Block parser (mirrors extract-mecum logic) ───────────────────────────────

function stripHtml(s: string): string {
  return String(s)
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseBlocksDescription(
  blocks: any[],
): { description: string | null; engine: string | null } {
  const sections: { heading: string; items: string[] }[] = [];
  let specEngine: string | null = null;

  function walk(bs: any[], currentSection: string[] | null): void {
    for (const block of bs) {
      if (!block || typeof block !== "object") continue;
      const name = block.name || "";
      const attrs = block.attributes || {};
      const content = stripHtml(attrs.content || attrs.text || "");

      if (name === "core/heading") {
        if (content) {
          const heading = content.toUpperCase();
          sections.push({ heading, items: [] });
          currentSection = sections[sections.length - 1].items;
        }
      } else if (name === "core/list-item") {
        if (content && currentSection) {
          currentSection.push(content);
        }
      }

      if (Array.isArray(block.innerBlocks) && block.innerBlocks.length > 0) {
        walk(block.innerBlocks, currentSection);
      }
    }
  }

  walk(blocks, null);

  // Extract engine from SPECIFICATIONS label/value pairs
  function extractSpecValue(bs: any[], label: string): string | null {
    const flat: string[] = [];
    function walkFlat(bss: any[]) {
      for (const b of bss) {
        if (!b || typeof b !== "object") continue;
        if (b.name === "core/paragraph") {
          const t = stripHtml(b.attributes?.content || "");
          if (t) flat.push(t);
        }
        if (Array.isArray(b.innerBlocks)) walkFlat(b.innerBlocks);
      }
    }
    walkFlat(bs);
    for (let i = 0; i < flat.length - 1; i++) {
      if (flat[i].toUpperCase() === label.toUpperCase()) {
        return flat[i + 1] || null;
      }
    }
    return null;
  }

  specEngine = extractSpecValue(blocks, "ENGINE");

  const parts: string[] = [];
  const highlights = sections.find((s) => s.heading === "HIGHLIGHTS");
  const equipment = sections.find((s) => s.heading === "EQUIPMENT");

  if (highlights?.items.length) {
    parts.push(highlights.items.map((i) => `• ${i}`).join("\n"));
  }
  if (equipment?.items.length) {
    parts.push("Equipment:\n" + equipment.items.map((i) => `• ${i}`).join("\n"));
  }

  const combined = parts.join("\n\n").trim();
  return {
    description: combined.length > 30 ? combined.slice(0, 5000) : null,
    engine: specEngine,
  };
}

// ─── Parse __NEXT_DATA__ from archived HTML ────────────────────────────────────

interface ParsedMecumData {
  description: string | null;
  engine: string | null;  // will map to engine_size column
  mileage: number | null;
  vin: string | null;
  transmission: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  lot_number: string | null;
  auction_name: string | null;
  sale_price: number | null;
}

function parseFromArchivedHtml(html: string): ParsedMecumData | null {
  const nextDataMatch = html.match(
    /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!nextDataMatch?.[1]) return null;

  let parsed: any;
  try {
    parsed = JSON.parse(nextDataMatch[1]);
  } catch {
    return null;
  }

  const post = parsed?.props?.pageProps?.post;
  if (!post) return null;

  const result: ParsedMecumData = {
    description: null,
    engine: post.lotSeries || null,
    mileage: null,
    vin: post.vinSerial || null,
    transmission: post.transmission || null,
    exterior_color: post.color || null,
    interior_color: post.interior || null,
    lot_number: post.lotNumber || null,
    auction_name: null,
    sale_price: null,
  };

  // Description from blocks
  if (Array.isArray(post.blocks) && post.blocks.length > 0) {
    const { description, engine } = parseBlocksDescription(post.blocks);
    if (description) result.description = description;
    if (engine && (!result.engine || result.engine.length > 60)) {
      result.engine = engine;
    }
  }

  // Fallback: post.content
  if (!result.description && post.content) {
    const stripped = String(post.content)
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (stripped.length > 30) {
      result.description = stripped.slice(0, 5000);
    }
  }

  // Mileage from odometer field
  if (post.odometer) {
    const miles = parseInt(String(post.odometer).replace(/[, ]/g, ""), 10);
    if (miles > 0 && miles < 10_000_000) result.mileage = miles;
  }

  // Auction name from taxonomy
  const auctionEdges = post?.auctionsTax?.edges;
  if (Array.isArray(auctionEdges) && auctionEdges.length > 0) {
    result.auction_name = auctionEdges[0]?.node?.name || null;
  }

  // Hammer price
  if (post.hammerPrice) {
    const price = parseInt(String(post.hammerPrice).replace(/[,$ ]/g, ""), 10);
    if (price > 0) result.sale_price = price;
  }

  return result;
}

// ─── HTTP Handler ─────────────────────────────────────────────────────────────

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const {
      batch_size = 20,
      dry_run = false,
      vehicle_id = null,
    } = body;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    console.log(
      `[MECUM-DESC-BACKFILL] Starting. batch_size=${batch_size}, dry_run=${dry_run}`,
    );

    // ── Fetch vehicles missing descriptions ───────────────────────────────
    // Strategy: use listing_page_snapshots as driver (indexed on platform+listing_url)
    // then JOIN to vehicles. This is faster than scanning 50K Mecum vehicles.

    let vehicles: any[] = [];

    if (vehicle_id) {
      // Single vehicle mode — look up directly
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, listing_url, year, make, model, description, mileage, vin, engine_size, transmission")
        .eq("id", vehicle_id);
      if (error) return okJson({ success: false, error: error.message }, 500);
      vehicles = data || [];
    } else {
      // Two-step approach:
      // Step 1: get a batch of Mecum snapshot URLs (fast — index on platform+fetched_at)
      // Keep scanBatch small to avoid URL-too-long errors in the IN clause
      const scanBatch = Math.min(batch_size * 3, 75);
      const { data: snapRows, error: snapErr } = await supabase
        .from("listing_page_snapshots")
        .select("listing_url")
        .eq("platform", "mecum")
        .eq("success", true)
        .not("html", "is", null)
        .order("fetched_at", { ascending: false })
        .limit(scanBatch);

      if (snapErr) return okJson({ success: false, error: snapErr.message }, 500);
      if (!snapRows?.length) {
        return okJson({ success: true, message: "No Mecum snapshots found", stats: {} });
      }

      // Step 2: find vehicles for those URLs that are missing descriptions (IN query)
      // Cap at 40 to keep URL under PostgREST limit
      const urls = [...new Set((snapRows as any[]).map((r) => r.listing_url))].slice(0, 40);
      const { data: vRows, error: vErr } = await supabase
        .from("vehicles")
        .select("id, listing_url, year, make, model, description, mileage, vin, engine_size, transmission")
        .in("listing_url", urls)
        .is("description", null)
        .limit(batch_size);

      if (vErr) return okJson({ success: false, error: vErr.message }, 500);
      vehicles = vRows || [];
    }

    if (!vehicles.length) {
      return okJson({
        success: true,
        message: "No Mecum vehicles need description backfill",
        stats: { attempted: 0, updated: 0, skipped: 0, no_snapshot: 0, no_desc_found: 0 },
      });
    }

    console.log(`[MECUM-DESC-BACKFILL] Found ${vehicles.length} vehicles to process`);

    const stats = {
      attempted: vehicles.length,
      updated: 0,
      skipped: 0,
      no_snapshot: 0,
      no_desc_found: 0,
      failed: 0,
      fields_added: 0,
    };
    const errors: string[] = [];
    const previews: any[] = [];

    for (const vehicle of vehicles) {
      const { id, listing_url, year, make, model } = vehicle;
      const label = `${year} ${make} ${model} (${id?.slice(0, 8)})`;

      if (!listing_url || !listing_url.includes("mecum.com")) {
        stats.skipped++;
        continue;
      }

      try {
        // Look up best archived snapshot for this URL
        const { data: snapshots, error: snapErr } = await supabase
          .from("listing_page_snapshots")
          .select("html, fetched_at")
          .eq("listing_url", listing_url)
          .eq("platform", "mecum")
          .eq("success", true)
          .not("html", "is", null)
          .gt("content_length", 10000)
          .order("fetched_at", { ascending: false })
          .limit(1);

        if (snapErr) {
          console.warn(`[MECUM-DESC-BACKFILL] Snapshot query error for ${label}:`, snapErr.message);
          stats.failed++;
          continue;
        }

        if (!snapshots?.length || !snapshots[0].html) {
          console.log(`[MECUM-DESC-BACKFILL] No snapshot for ${label}`);
          stats.no_snapshot++;
          continue;
        }

        const { html } = snapshots[0];
        const parsed = parseFromArchivedHtml(html);

        if (!parsed || !parsed.description) {
          console.log(`[MECUM-DESC-BACKFILL] No description found in snapshot for ${label}`);
          stats.no_desc_found++;
          continue;
        }

        // Build update payload — only set fields currently NULL on the vehicle.
        // NOTE: VIN skipped here — handled by dedicated backfill-vin-from-snapshots task
        // to avoid unique constraint conflicts across duplicate vehicles.
        const updatePayload: Record<string, any> = {
          updated_at: new Date().toISOString(),
          description: parsed.description,
        };

        let fieldsAdded = 1; // description

        if (parsed.mileage && !vehicle.mileage) {
          updatePayload.mileage = parsed.mileage;
          fieldsAdded++;
        }
        if (parsed.engine && !vehicle.engine_size) {
          updatePayload.engine_size = parsed.engine;
          fieldsAdded++;
        }
        if (parsed.transmission && !vehicle.transmission) {
          updatePayload.transmission = parsed.transmission;
          fieldsAdded++;
        }

        if (dry_run) {
          previews.push({
            vehicle_id: id,
            label,
            url: listing_url,
            description_length: parsed.description.length,
            description_preview: parsed.description.slice(0, 200),
            mileage: parsed.mileage,
            engine: parsed.engine,
          });
          stats.updated++;
          stats.fields_added += fieldsAdded;
          continue;
        }

        const { error: updateErr } = await supabase
          .from("vehicles")
          .update(updatePayload)
          .eq("id", id);

        if (updateErr) {
          console.error(`[MECUM-DESC-BACKFILL] Update failed for ${label}:`, updateErr.message);
          stats.failed++;
          errors.push(`${label}: ${updateErr.message}`);
        } else {
          console.log(
            `[MECUM-DESC-BACKFILL] Updated ${label}: desc=${parsed.description.length}c +${fieldsAdded} fields`,
          );
          stats.updated++;
          stats.fields_added += fieldsAdded;
        }
      } catch (err: any) {
        console.error(`[MECUM-DESC-BACKFILL] Error for ${label}:`, err.message);
        stats.failed++;
        if (errors.length < 10) errors.push(`${label}: ${err.message}`);
      }
    }

    const response: any = { success: true, dry_run, stats };
    if (errors.length > 0) response.errors = errors;
    if (dry_run && previews.length > 0) response.previews = previews;

    console.log(`[MECUM-DESC-BACKFILL] Done:`, stats);
    return okJson(response);
  } catch (error: any) {
    console.error("[MECUM-DESC-BACKFILL] Fatal error:", error);
    return okJson({ success: false, error: error.message }, 500);
  }
});
