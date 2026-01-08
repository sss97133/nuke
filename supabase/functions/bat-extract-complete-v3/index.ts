// ⚠️ SEARCH ALERT: If you searched for "BaT extraction" or "bringatrailer extraction"
// and found this file, STOP. Read docs/BAT_EXTRACTION_SUCCESS_WORKFLOW.md first.
//
// ⚠️ DEPRECATED: This function is deprecated and untested.
// 
// ✅ USE THIS INSTEAD (Approved Two-Step Workflow):
// 1. extract-premium-auction (core data: VIN, specs, images, auction_events)
// 2. extract-auction-comments (comments, bids)
//
// Documentation: docs/BAT_EXTRACTION_SUCCESS_WORKFLOW.md

// BaT Complete Extractor v3 - CONSOLIDATED (DEPRECATED - DO NOT USE)
// Uses: batDomMap.ts (metadata) + extract-premium-auction (VIN/specs)
// Calls extract-premium-auction as a service to get proven VIN/spec extraction

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { extractBatDomMap } from "../_shared/batDomMap.ts";
import { fetchBatPage } from "../_shared/batFetcher.ts";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Extract from BaT Essentials section (the ACTUAL source of truth)
function extractEssentials(html: string) {
  const essentials: any = {};
  
  // Find essentials div
  const essentialsMatch = html.match(/<div[^>]*class="essentials"[^>]*>([\s\S]{0,5000})<\/div>/i);
  if (!essentialsMatch) return essentials;
  
  const essentialsHtml = essentialsMatch[1];
  
  // VIN from Chassis: Look for 17-char VIN anywhere in essentials (most flexible)
  const vinMatch = essentialsHtml.match(/([A-HJ-NPR-Z0-9]{17})/);
  if (vinMatch && essentialsHtml.match(/Chassis/i)) {
    essentials.vin = vinMatch[1].toUpperCase();
  }
  
  // Mileage: "82k Miles Shown" or "82,000 Miles"
  const mileageMatch = essentialsHtml.match(/(\d{1,3}(?:,\d{3})*)\s*(?:k\s*)?Miles/i);
  if (mileageMatch) {
    let miles = mileageMatch[1].replace(/,/g, "");
    if (essentialsHtml.match(/\d+k\s*Miles/i)) {
      miles = miles + "000";
    }
    essentials.mileage = parseInt(miles);
  }
  
  // Transmission: "Three-Speed Turbo Hydramatic Automatic Transmission."
  const transMatch = essentialsHtml.match(/<li>([^<]*(?:Transmission|transmission)[^<]*)<\/li>/i);
  if (transMatch) {
    essentials.transmission = transMatch[1].replace(/\.$/, "").trim();
  }
  
  // Color: "Weathered Light Blue Paint w/Clear Coat"
  const colorMatch = essentialsHtml.match(/([A-Za-z\s]+(?:Blue|Red|Black|White|Green|Yellow|Silver|Gray|Grey|Orange|Purple|Brown|Tan|Beige|Gold|Bronze)[^<]*Paint[^<]*)/i);
  if (colorMatch) {
    essentials.color = colorMatch[1].replace(/\s*Paint.*/, "").trim();
  }
  
  // Engine: "350ci V8"
  const engineMatch = essentialsHtml.match(/(\d+(?:cc|ci|L)\s+[A-Z0-9]+)/i);
  if (engineMatch) {
    essentials.engine_size = engineMatch[1].trim();
  }
  
  // Seller: "Seller: <a>Jgb2</a>"
  const sellerMatch = essentialsHtml.match(/<strong>Seller<\/strong>:\s*<a[^>]*>([^<]+)<\/a>/i);
  if (sellerMatch) {
    essentials.seller_username = sellerMatch[1].trim();
  }
  
  // Location: "Location: <a>Odessa, Texas 79765</a>"
  const locationMatch = essentialsHtml.match(/<strong>Location<\/strong>:\s*<a[^>]*>([^<]+)<\/a>/i);
  if (locationMatch) {
    essentials.location = locationMatch[1].trim();
  }
  
  return essentials;
}

// Extract comments from #comments-javascript-enabled (BaT's actual structure)
function extractComments(html: string): { comments: any[]; comment_count: number; bid_count: number } {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (!doc) return { comments: [], comment_count: 0, bid_count: 0 };

    // Find comments container
    const commentsContainer = doc.querySelector('#comments-javascript-enabled');
    if (!commentsContainer) {
      // Fallback: try .comment elements
      const commentEls = doc.querySelectorAll('.comment');
      const count = commentEls.length;
      return { comments: [], comment_count: count, bid_count: 0 };
    }

    // Extract individual comments from data-cursor-element-id elements
    const commentElements = commentsContainer.querySelectorAll('[data-cursor-element-id]');
    const comments: any[] = [];
    let bidCount = 0;

    for (const el of commentElements) {
      const text = el.textContent || '';
      
      // Skip UI chrome
      if (text.includes('Keep me in this conversation') || 
          text.includes('This author\'s likes:') ||
          text.length < 10) continue;

      // Extract author (pattern: "Jan 7 at 3:08 PM JHBBII")
      const authorMatch = text.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+\s+at\s+\d+:\d+\s+[AP]M\s+([A-Za-z0-9_]+)/i);
      const author = authorMatch ? authorMatch[1] : null;

      // Extract timestamp
      const dateMatch = text.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+\s+at\s+\d+:\d+\s+[AP]M)/i);
      const timestamp = dateMatch ? dateMatch[1] : null;

      // Extract comment text (everything after timestamp/author)
      let commentText = text;
      if (dateMatch) {
        commentText = text.substring(text.indexOf(dateMatch[1]) + dateMatch[1].length).trim();
      }
      if (author) {
        commentText = commentText.replace(new RegExp(`^${author}\\s*`), '').trim();
      }
      commentText = commentText.replace(/This author's likes:[\s\S]*$/, '').trim();

      // Check if it's a bid comment
      const isBid = /bid|congrats|sold for|winning bid/i.test(commentText);
      if (isBid) bidCount++;

      if (commentText.length > 5) {
        comments.push({
          author: author || 'Unknown',
          text: commentText,
          timestamp,
          is_bid: isBid,
        });
      }
    }

    // Fallback: extract counts from text if no individual comments found
    if (comments.length === 0) {
      const bodyText = doc.body?.textContent || '';
      const commentMatch = bodyText.match(/\b([\d,]+)\s+comments?\b/i);
      const bidMatch = bodyText.match(/\b([\d,]+)\s+bids?\b/i);
      return {
        comments: [],
        comment_count: commentMatch ? parseInt(commentMatch[1].replace(/,/g, '')) : 0,
        bid_count: bidMatch ? parseInt(bidMatch[1].replace(/,/g, '')) : 0,
      };
    }

    return {
      comments,
      comment_count: comments.length,
      bid_count: bidCount,
    };
  } catch (e: any) {
    console.warn(`[bat-extract-complete-v3] Comment extraction failed: ${e.message}`);
    return { comments: [], comment_count: 0, bid_count: 0 };
  }
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

    console.log(`[bat-extract-complete-v3] Extracting: ${url}`);

    // Get HTML first
    const fetchResult = await fetchBatPage(url, { forceFirecrawl: true });
    if (!fetchResult.html) throw new Error("Fetch failed");

    // Run batDomMap for metadata/images
    const domMapResult = extractBatDomMap(fetchResult.html, url);
    const { extracted, health } = domMapResult;
    
    // Extract from Essentials section (THE ACTUAL SOURCE)
    const essentials = extractEssentials(fetchResult.html);
    
    // Extract comments from #comments-javascript-enabled
    const commentsData = extractComments(fetchResult.html);
    
    // Merge: batDomMap + essentials + comments
    const complete = {
      ...extracted,
      vin: essentials.vin || null,
      mileage: essentials.mileage || null,
      color: essentials.color || null,
      transmission: essentials.transmission || null,
      engine_size: essentials.engine_size || null,
      seller_username: essentials.seller_username || extracted.seller_username || null,
      location_clean: essentials.location || extracted.location_clean || null,
      comment_count: commentsData.comment_count || extracted.comment_count || 0,
      bid_count: commentsData.bid_count || extracted.bid_count || 0,
      comments: commentsData.comments || [],
    };

    // Check mandatory fields
    const MANDATORY = ['title', 'identity', 'images', 'sale', 'description'];
    const failed = Object.entries(health.fields)
      .filter(([name, field]) => MANDATORY.includes(name) && !field.ok)
      .map(([name]) => name);

    if (failed.length > 0) {
      if (vehicle_id) {
        await supabase.rpc("record_extraction_attempt", {
          p_vehicle_id: vehicle_id,
          p_source_url: url,
          p_source_type: "bat",
          p_extractor_name: "bat-extract-complete",
          p_extractor_version: "v3",
          p_status: "partial",
          p_failure_code: "INCOMPLETE",
          p_failure_reason: `Missing: ${failed.join(", ")}`,
          p_metrics: { health_score: health.overall_score, timing: { total_ms: performance.now() - startTime } },
        });
      }

      return new Response(JSON.stringify({
        success: false,
        status: "incomplete",
        failed_fields: failed,
        health_score: health.overall_score,
      }), { status: 500 });
    }

    // Apply to database
    if (apply && vehicle_id) {
      await supabase.from("vehicles").update({
        title: complete.title,
        year: complete.year,
        make: complete.make,
        model: complete.model,
        vin: complete.vin || null,
        mileage: complete.mileage || null,
        color: complete.color || null,
        transmission: complete.transmission || null,
        engine_size: complete.engine_size || null,
        sale_price: complete.sale_price || complete.current_bid,
        bat_sold_price: complete.sale_price,
        bat_sale_date: complete.sale_date,
        bat_bids: complete.bid_count,
        bat_comments: complete.comment_count,
        bat_lot_number: complete.lot_number,
        bat_seller: complete.seller_username || null,
        bat_buyer: complete.buyer_username || null,
        bat_location: complete.location_clean || complete.location_raw || null,
        location: complete.location_clean || complete.location_raw || null,
        description: complete.description_text,
        primary_image_url: complete.image_urls[0],
        origin_metadata: {
          bat_image_urls: complete.image_urls,
          extracted_at: new Date().toISOString(),
          health_score: health.overall_score,
          essentials: essentials,
        },
        updated_at: new Date().toISOString(),
      }).eq("id", vehicle_id);

      // Insert images
      if (complete.image_urls.length > 0) {
        await supabase.from("vehicle_images").delete().match({ vehicle_id, source: "bat_import" });
        await supabase.from("vehicle_images").insert(
          complete.image_urls.slice(0, 200).map((url: string, i: number) => ({
            vehicle_id,
            image_url: url,
            source: "bat_import",
            image_type: "gallery",
            is_primary: i === 0,
            position: i + 1,
          }))
        );
      }

      // bat_listings record
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
      }, { onConflict: "bat_listing_url" });

      // Record attempt
      await supabase.rpc("record_extraction_attempt", {
        p_vehicle_id: vehicle_id,
        p_source_url: url,
        p_source_type: "bat",
        p_extractor_name: "bat-extract-complete",
        p_extractor_version: "v3",
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
      health_score: health.overall_score,
      data: complete,
      timing_ms: Math.round(performance.now() - startTime),
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (e: any) {
    console.error("[bat-extract-complete-v3]", e);
    return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500 });
  }
});

