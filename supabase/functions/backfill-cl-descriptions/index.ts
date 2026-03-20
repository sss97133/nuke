/**
 * backfill-cl-descriptions
 *
 * Backfills descriptions for Craigslist vehicles missing them.
 * No archived snapshots exist for CL — uses live HTTP fetch.
 * Many listings will be expired (410 Gone / 404) — these are skipped.
 *
 * Strategy:
 *  1. Query vehicles WHERE discovery_source = 'craigslist' AND description IS NULL
 *  2. Try live-fetch of each CL listing URL
 *  3. Parse description from <section id="postingbody">
 *  4. Also picks up: mileage, color, transmission, body_style if missing
 *  5. Update vehicles table for any that succeed
 *
 * Input:  { batch_size?: number (default 20), dry_run?: boolean }
 * Output: { success, stats }
 *
 * Deploy: supabase functions deploy backfill-cl-descriptions --no-verify-jwt
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { archiveFetch } from "../_shared/archiveFetch.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ─── CL HTML parsers ──────────────────────────────────────────────────────────

function extractDescription(html: string): string | null {
  // Primary: postingbody section
  const descMatch = html.match(
    /<section id="postingbody"[^>]*>([\s\S]*?)<\/section>/,
  );
  if (descMatch) {
    const desc = descMatch[1]
      .replace(/<div class="print-information[^>]*>[\s\S]*?<\/div>/g, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (desc.length > 20) return desc.slice(0, 5000);
  }

  // Fallback: JSON-LD description
  const jsonLd = extractJsonLd(html);
  if (jsonLd?.description) {
    const desc = String(jsonLd.description)
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (desc.length > 20) return desc.slice(0, 5000);
  }

  return null;
}

function extractJsonLd(html: string): any | null {
  const match = html.match(
    /<script type="application\/ld\+json" id="ld_posting_data"\s*>([\s\S]*?)<\/script>/,
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function extractAttrValue(html: string, attrClass: string): string | null {
  const pattern = new RegExp(
    `<div class="attr ${attrClass}"[^>]*>[\\s\\S]*?<span class="valu"[^>]*>(?:[\\s]*<a[^>]*>([^<]+)<\\/a>|([^<]+))`,
    "i",
  );
  const match = html.match(pattern);
  const result = (match?.[1] || match?.[2])?.replace(/\s+/g, " ").trim();
  return result || null;
}

function extractSpanValue(html: string, spanClass: string): string | null {
  const pattern = new RegExp(
    `<span class="valu ${spanClass}"[^>]*>(?:[\\s]*<a[^>]*>([^<]+)<\\/a>|([^<]+))`,
    "i",
  );
  const match = html.match(pattern);
  const result = (match?.[1] || match?.[2])?.replace(/\s+/g, " ").trim();
  return result || null;
}

interface ParsedCL {
  description: string | null;
  mileage: number | null;
  color: string | null;
  transmission: string | null;
  body_style: string | null;
  price: number | null;
}

function parseCLHtml(html: string): ParsedCL {
  const description = extractDescription(html);

  const mileageStr = extractAttrValue(html, "auto_miles");
  const mileage = mileageStr
    ? parseInt(mileageStr.replace(/,/g, ""), 10) || null
    : null;

  const color = extractAttrValue(html, "auto_paint");
  const transmission = extractAttrValue(html, "auto_transmission");
  const body_style = extractAttrValue(html, "auto_bodytype");

  // Price from JSON-LD
  const jsonLd = extractJsonLd(html);
  const price = jsonLd?.offers?.price
    ? Math.round(parseFloat(jsonLd.offers.price)) || null
    : null;

  return { description, mileage, color, transmission, body_style, price };
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
      `[CL-DESC-BACKFILL] Starting. batch_size=${batch_size}, dry_run=${dry_run}`,
    );

    // ── Fetch CL vehicles missing descriptions ────────────────────────────
    let vehiclesRes: any;
    if (vehicle_id) {
      vehiclesRes = await supabase
        .from("vehicles")
        .select("id, listing_url, year, make, model, description, mileage, color, transmission, body_style, sale_price")
        .eq("id", vehicle_id);
    } else {
      vehiclesRes = await supabase
        .from("vehicles")
        .select("id, listing_url, year, make, model, description, mileage, color, transmission, body_style, sale_price")
        .eq("discovery_source", "craigslist")
        .is("description", null)
        .not("listing_url", "is", null)
        .ilike("listing_url", "%craigslist.org%")
        .order("updated_at", { ascending: true })
        .limit(batch_size);
    }

    if (vehiclesRes.error) {
      return okJson({ success: false, error: vehiclesRes.error.message }, 500);
    }

    const vehicles = vehiclesRes.data || [];
    if (!vehicles.length) {
      return okJson({
        success: true,
        message: "No CL vehicles need description backfill",
        stats: { attempted: 0, updated: 0, expired: 0, failed: 0 },
      });
    }

    console.log(`[CL-DESC-BACKFILL] Found ${vehicles.length} vehicles to process`);

    const stats = {
      attempted: vehicles.length,
      updated: 0,
      expired: 0,         // 404/410 gone listings
      no_desc: 0,         // fetched but no description found
      failed: 0,
      fields_added: 0,
    };
    const errors: string[] = [];
    const previews: any[] = [];

    for (const vehicle of vehicles) {
      const { id, listing_url, year, make, model } = vehicle;
      const label = `${year} ${make} ${model} (${id?.slice(0, 8)})`;

      if (!listing_url?.includes("craigslist.org")) {
        stats.failed++;
        continue;
      }

      try {
        // archiveFetch checks cache first, then fetches live
        // For CL, no cache will exist so this is always a live fetch
        const fetchResult = await archiveFetch(listing_url, {
          platform: "craigslist",
          maxAgeSec: 7 * 86400, // Cache for a week
          useFirecrawl: false,   // CL doesn't need JS
          includeMarkdown: false,
          callerName: "backfill-cl-descriptions",
          metadata: { vehicle_id: id },
        });

        // Check for expired listing
        const statusCode = (fetchResult as any).statusCode ?? (fetchResult as any).httpStatus;
        if (statusCode === 404 || statusCode === 410) {
          console.log(`[CL-DESC-BACKFILL] Expired listing (${statusCode}): ${label}`);
          stats.expired++;
          continue;
        }

        if (!fetchResult.html || fetchResult.html.length < 200) {
          console.log(`[CL-DESC-BACKFILL] No HTML for ${label}: status=${statusCode}, error=${fetchResult.error || 'empty'}`);
          // If status looks like expiry, count as expired
          if (statusCode && statusCode >= 400) {
            stats.expired++;
          } else {
            stats.failed++;
          }
          continue;
        }

        const parsed = parseCLHtml(fetchResult.html);

        if (!parsed.description) {
          console.log(`[CL-DESC-BACKFILL] No description found for ${label}`);
          stats.no_desc++;
          continue;
        }

        // Build update payload — only fill NULL fields
        const updatePayload: Record<string, any> = {
          description: parsed.description,
          updated_at: new Date().toISOString(),
        };
        let fieldsAdded = 1;

        if (parsed.mileage && !vehicle.mileage) {
          updatePayload.mileage = parsed.mileage;
          fieldsAdded++;
        }
        if (parsed.color && !vehicle.color) {
          updatePayload.color = parsed.color;
          fieldsAdded++;
        }
        if (parsed.transmission && !vehicle.transmission) {
          updatePayload.transmission = parsed.transmission;
          fieldsAdded++;
        }
        if (parsed.body_style && !vehicle.body_style) {
          updatePayload.body_style = parsed.body_style;
          fieldsAdded++;
        }
        if (parsed.price && !vehicle.sale_price) {
          updatePayload.sale_price = parsed.price;
          fieldsAdded++;
        }

        if (dry_run) {
          previews.push({
            vehicle_id: id,
            label,
            url: listing_url,
            description_length: parsed.description.length,
            description_preview: parsed.description.slice(0, 200),
            cached: fetchResult.cached,
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
          console.error(`[CL-DESC-BACKFILL] Update failed for ${label}:`, updateErr.message);
          stats.failed++;
          errors.push(`${label}: ${updateErr.message}`);
        } else {
          console.log(`[CL-DESC-BACKFILL] Updated ${label}: +${fieldsAdded} fields`);
          stats.updated++;
          stats.fields_added += fieldsAdded;
        }

        // Small delay to avoid rate limiting
        await new Promise((r) => setTimeout(r, 500));
      } catch (err: any) {
        const msg = err.message || String(err);
        console.error(`[CL-DESC-BACKFILL] Error for ${label}:`, msg);
        // Treat network errors as likely expired listings
        if (msg.includes("404") || msg.includes("410") || msg.includes("ECONNREFUSED")) {
          stats.expired++;
        } else {
          stats.failed++;
          if (errors.length < 10) errors.push(`${label}: ${msg}`);
        }
      }
    }

    const response: any = { success: true, dry_run, stats };
    if (errors.length > 0) response.errors = errors;
    if (dry_run && previews.length > 0) response.previews = previews;

    console.log(`[CL-DESC-BACKFILL] Done:`, stats);
    return okJson(response);
  } catch (error: any) {
    console.error("[CL-DESC-BACKFILL] Fatal error:", error);
    return okJson({ success: false, error: error.message }, 500);
  }
});
