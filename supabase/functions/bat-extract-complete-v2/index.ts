// ⚠️ SEARCH ALERT: If you searched for "BaT extraction" or "bringatrailer extraction"
// and found this file, STOP. Read docs/BAT_EXTRACTION_SUCCESS_WORKFLOW.md first.
//
// ⚠️ DEPRECATED: This function is deprecated and incomplete (missing VIN/specs).
// 
// ✅ USE THIS INSTEAD (Approved Two-Step Workflow):
// 1. extract-premium-auction (core data: VIN, specs, images, auction_events)
// 2. extract-auction-comments (comments, bids)
//
// Documentation: docs/BAT_EXTRACTION_SUCCESS_WORKFLOW.md

// BaT Complete Extractor v2 (DEPRECATED - DO NOT USE)
// Combines best of: batDomMap.ts + extract-premium-auction VIN/specs logic
// ALL data mandatory - uses battle-tested code only

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { extractBatDomMap } from "../_shared/batDomMap.ts";
import { fetchBatPage } from "../_shared/batFetcher.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// VIN extraction from extract-premium-auction (proven to work)
function extractVin(html: string): string | null {
  const vinPatterns = [
    /VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i,
    /VIN[:\s]*<[^>]*>([A-HJ-NPR-Z0-9]{17})/i,
    /<td[^>]*>VIN[:\s]*<\/td>\s*<td[^>]*>([A-HJ-NPR-Z0-9]{17})/i,
    /<dt[^>]*>VIN[:\s]*<\/dt>\s*<dd[^>]*>([A-HJ-NPR-Z0-9]{17})/i,
  ];

  for (const pattern of vinPatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      const vin = match[1].trim().toUpperCase();
      if (vin.length === 17 && /^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
        return vin;
      }
    }
  }
  return null;
}

// Extract mileage/specs from description
function extractSpecs(html: string): {
  mileage: number | null;
  color: string | null;
  transmission: string | null;
  engine: string | null;
} {
  const text = html.replace(/<[^>]+>/g, ' ');
  
  // Mileage
  const mileageMatch = text.match(/(\d{1,3}(?:,\d{3})*)\s*miles/i) || text.match(/odometer shows\s+(\d{1,3}[,k\s]*\d*)\s*miles/i);
  let mileage = null;
  if (mileageMatch) {
    const raw = mileageMatch[1].replace(/,/g, '').replace(/k/i, '000');
    mileage = parseInt(raw) || null;
  }

  // Color
  const colorMatch = text.match(/(?:painted?|finished?|color)\s+(?:in\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/i);
  const color = colorMatch ? colorMatch[1].trim() : null;

  // Transmission
  const transMatch = text.match(/(\d-speed)\s+(automatic|manual|transmission)/i) ||
                     text.match(/(Turbo Hydramatic|Powerglide|Muncie|T[45]0|TH\d{3})/i);
  const transmission = transMatch ? transMatch[0].trim() : null;

  // Engine
  const engineMatch = text.match(/(\d{3}ci|[\d.]+L)\s+V?\d+/i) ||
                      text.match(/(350ci|454ci|327|396|427)\s+V8/i);
  const engine = engineMatch ? engineMatch[0].trim() : null;

  return { mileage, color, transmission, engine };
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const startTime = performance.now();

  try {
    const { url, vehicle_id, apply = false } = await req.json();
    
    if (!url) {
      return new Response(JSON.stringify({ success: false, error: "url required" }), { status: 400 });
    }

    console.log(`[bat-extract-complete-v2] Extracting: ${url}`);

    // Fetch HTML
    const fetchResult = await fetchBatPage(url, { forceFirecrawl: true });
    
    if (!fetchResult.html) {
      return new Response(JSON.stringify({
        success: false,
        error: "Failed to fetch HTML",
        details: fetchResult.error,
      }), { status: 502 });
    }

    const html = fetchResult.html;

    // Extract using battle-tested batDomMap
    const { extracted, health } = extractBatDomMap(html, url);

    // Extract VIN and specs (from extract-premium-auction)
    const vin = extractVin(html);
    const specs = extractSpecs(html);

    // Merge all data
    const complete = {
      ...extracted,
      vin,
      ...specs,
    };

    // Define MANDATORY fields
    const MANDATORY_FIELDS = ['title', 'identity', 'lot_number', 'images', 'sale', 'description'];
    
    // Check failures
    const failed_fields = Object.entries(health.fields)
      .filter(([name, field]) => MANDATORY_FIELDS.includes(name) && !field.ok)
      .map(([name, field]) => ({ field: name, method: field.method }));

    if (failed_fields.length > 0) {
      console.log(`[bat-extract-complete-v2] Incomplete:`, failed_fields);
      
      if (vehicle_id) {
        await supabase.rpc("record_extraction_attempt", {
          p_vehicle_id: vehicle_id,
          p_source_url: url,
          p_source_type: "bat",
          p_extractor_name: "bat-extract-complete",
          p_extractor_version: "v2",
          p_status: "partial",
          p_failure_code: "INCOMPLETE_EXTRACTION",
          p_failure_reason: `Failed: ${failed_fields.map(f => f.field).join(", ")}`,
          p_metrics: {
            health_score: health.overall_score,
            timing: { total_ms: performance.now() - startTime },
          },
        });
      }

      return new Response(JSON.stringify({
        success: false,
        status: "incomplete",
        health_score: health.overall_score,
        failed_fields,
      }), { status: 500 });
    }

    // ALL mandatory fields succeeded - apply if requested
    if (apply && vehicle_id) {
      const updates: any = {
        title: complete.title,
        year: complete.year,
        make: complete.make,
        model: complete.model,
        vin: complete.vin,
        mileage: complete.mileage,
        color: complete.color,
        transmission: complete.transmission,
        engine_size: complete.engine,
        sale_price: complete.sale_price || complete.current_bid,
        bat_sold_price: complete.sale_price,
        bat_sale_date: complete.sale_date,
        bat_bids: complete.bid_count,
        bat_comments: complete.comment_count,
        bat_lot_number: complete.lot_number,
        bat_seller: complete.seller_username,
        bat_buyer: complete.buyer_username,
        bat_location: complete.location_clean || complete.location_raw,
        description: complete.description_text,
        primary_image_url: complete.image_urls[0],
        origin_metadata: {
          bat_image_urls: complete.image_urls,
          bat_image_count: complete.image_urls.length,
          extracted_at: new Date().toISOString(),
          health_score: health.overall_score,
          extractor_version: "v2",
        },
        updated_at: new Date().toISOString(),
      };

      await supabase.from("vehicles").update(updates).eq("id", vehicle_id);

      // Insert images to vehicle_images
      if (complete.image_urls.length > 0) {
        // Build image rows
        const imageRows = complete.image_urls.slice(0, 200).map((url: string, idx: number) => ({
          vehicle_id,
          image_url: url,
          source: "bat_import",
          image_type: "gallery",
          is_primary: idx === 0,
          position: idx + 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }));

        // Delete old bat_import images first, then insert new
        await supabase.from("vehicle_images").delete().match({ vehicle_id, source: "bat_import" });
        const { error: imgErr } = await supabase.from("vehicle_images").insert(imageRows);
        if (imgErr) console.error("Image insert error:", imgErr);
      }

      // Create/update bat_listings
      await supabase.from("bat_listings").upsert({
        vehicle_id,
        bat_listing_url: url,
        bat_lot_number: complete.lot_number,
        bat_listing_title: complete.title,
        sale_date: complete.sale_date,
        final_bid: complete.sale_price,
        bid_count: complete.bid_count,
        comment_count: complete.comment_count,
        seller_username: complete.seller_username,
        buyer_username: complete.buyer_username,
        listing_status: complete.sale_price ? "sold" : "active",
        scraped_at: new Date().toISOString(),
        last_updated_at: new Date().toISOString(),
      }, { onConflict: "bat_listing_url" });

      // Record successful attempt
      await supabase.rpc("record_extraction_attempt", {
        p_vehicle_id: vehicle_id,
        p_source_url: url,
        p_source_type: "bat",
        p_extractor_name: "bat-extract-complete",
        p_extractor_version: "v2",
        p_status: "success",
        p_metrics: {
          health_score: health.overall_score,
          images: complete.image_urls.length,
          timing: { total_ms: performance.now() - startTime },
        },
        p_extracted_data: complete,
      });
    }

    return new Response(JSON.stringify({
      success: true,
      status: "complete",
      vehicle_id,
      url,
      health_score: health.overall_score,
      data: complete,
      timing_ms: Math.round(performance.now() - startTime),
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (e: any) {
    console.error("[bat-extract-complete-v2] Error:", e);
    return new Response(JSON.stringify({
      success: false,
      error: e.message,
    }), { status: 500 });
  }
});

