/**
 * extract-cars-and-bids-core
 *
 * Core extractor for Cars & Bids listings:
 * - Uses Firecrawl to fetch HTML (C&B blocks direct fetch with 403)
 * - C&B is a React SPA - main data comes from meta tags (og:title)
 * - VIN requires full JS rendering which may not always be available
 * - Saves HTML evidence to listing_page_snapshots
 * - Upserts vehicles + vehicle_images + external_listings + auction_events
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeListingUrlKey } from "../_shared/listingUrl.ts";
import { firecrawlScrape } from "../_shared/firecrawl.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.search = "";
    if (!u.pathname.endsWith("/")) u.pathname = `${u.pathname}/`;
    return u.toString();
  } catch {
    const base = String(raw || "").split("#")[0].split("?")[0];
    return base.endsWith("/") ? base : `${base}/`;
  }
}

function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.search = "";
    if (u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch {
    const base = String(raw || "").split("#")[0].split("?")[0];
    return base.endsWith("/") ? base.slice(0, -1) : base;
  }
}

interface CabExtractedData {
  vin: string | null;
  mileage: number | null;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  images: string[];
  engine: string | null;
  transmission: string | null;
  exteriorColor: string | null;
  interiorColor: string | null;
  location: string | null;
  currentBid: number | null;
  endDate: string | null;
  auctionStatus: string | null;
  sellerId: string | null;
  sellerName: string | null;
  description: string | null;
  lotNumber: string | null;
}

/**
 * Extract auction data from C&B HTML
 * C&B is a React SPA - data comes from:
 * 1. Meta tags (og:title contains year/make/model/mileage/transmission/color)
 * 2. Image URLs from the page
 * 3. VIN may be in DOM if JS rendered (requires waitFor)
 */
function extractFromCarsAndBidsHtml(html: string): CabExtractedData {
  const result: CabExtractedData = {
    vin: null,
    mileage: null,
    title: null,
    year: null,
    make: null,
    model: null,
    images: [],
    engine: null,
    transmission: null,
    exteriorColor: null,
    interiorColor: null,
    location: null,
    currentBid: null,
    endDate: null,
    auctionStatus: null,
    sellerId: null,
    sellerName: null,
    description: null,
    lotNumber: null,
  };

  try {
    // 1. Extract from og:title meta tag
    // Format: "2008 Honda S2000 CR - ~22,500 Miles, 6-Speed Manual, Rio Yellow Pearl, Unmodified"
    const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
                        html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
    if (ogTitleMatch) {
      const ogTitle = ogTitleMatch[1];
      console.log('✅ C&B: Found og:title:', ogTitle);

      // Parse year/make/model from beginning
      const ymmMatch = ogTitle.match(/^(\d{4})\s+(\S+)\s+([^-]+)/);
      if (ymmMatch) {
        result.year = parseInt(ymmMatch[1], 10);
        result.make = ymmMatch[2].trim();
        result.model = ymmMatch[3].trim();
        result.title = `${result.year} ${result.make} ${result.model}`;
      }

      // Parse mileage from "~22,500 Miles" or "22,500 Miles"
      const mileageMatch = ogTitle.match(/~?([\d,]+)\s*Miles/i);
      if (mileageMatch) {
        const mileageStr = mileageMatch[1].replace(/,/g, '');
        result.mileage = parseInt(mileageStr, 10);
        if (!Number.isFinite(result.mileage)) result.mileage = null;
        console.log('✅ C&B: Extracted mileage from og:title:', result.mileage);
      }

      // Parse transmission from "6-Speed Manual" or "Automatic"
      const transMatch = ogTitle.match(/(\d+-Speed\s+(?:Manual|Automatic)|Manual|Automatic)/i);
      if (transMatch) {
        result.transmission = transMatch[1];
      }

      // Parse color - usually after transmission, before last comma-separated item
      const colorPatterns = [
        /,\s*([A-Za-z\s]+(?:Pearl|Metallic|White|Black|Blue|Red|Green|Yellow|Silver|Gray|Grey|Orange|Purple|Brown|Beige|Maroon|Gold|Bronze))\s*,/i,
        /,\s*([A-Za-z\s]+(?:Pearl|Metallic))/i,
      ];
      for (const pattern of colorPatterns) {
        const colorMatch = ogTitle.match(pattern);
        if (colorMatch) {
          result.exteriorColor = colorMatch[1].trim();
          break;
        }
      }
    }

    // 2. Extract description from og:description
    const ogDescMatch = html.match(/<meta[^>]*(?:property|name)=["'](?:og:)?description["'][^>]*content=["']([^"']+)["']/i);
    if (ogDescMatch) {
      result.description = ogDescMatch[1];
    }

    // 3. Extract images from media.carsandbids.com URLs
    const imageMatches = html.matchAll(/https:\/\/media\.carsandbids\.com[^"'\s)]+\.(jpg|jpeg|png|webp)[^"'\s)]*/gi);
    const seenImages = new Set<string>();
    for (const match of imageMatches) {
      const imgUrl = match[0].split('?')[0]; // Remove query params for dedup
      if (!seenImages.has(imgUrl) && !imgUrl.includes('width=80')) {
        seenImages.add(imgUrl);
        result.images.push(match[0]); // Keep full URL with CDN params
      }
    }
    console.log(`✅ C&B: Found ${result.images.length} images`);

    // 4. Try to find VIN in rendered HTML (may require waitFor)
    const vinPatterns = [
      /VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i,
      /data-vin=["']([A-HJ-NPR-Z0-9]{17})["']/i,
      /"vin"[:\s]*["']([A-HJ-NPR-Z0-9]{17})["']/i,
    ];
    for (const pattern of vinPatterns) {
      const vinMatch = html.match(pattern);
      if (vinMatch && vinMatch[1].length === 17) {
        result.vin = vinMatch[1].toUpperCase();
        console.log('✅ C&B: Found VIN:', result.vin);
        break;
      }
    }

    // 5. Try to extract auction ID from URL in HTML for lot number
    const lotMatch = html.match(/carsandbids\.com\/auctions\/([A-Za-z0-9]+)/i);
    if (lotMatch) {
      result.lotNumber = lotMatch[1];
    }

    // 6. Try __NEXT_DATA__ as fallback (in case C&B changes to Next.js SSR)
    const nextDataMatch = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (nextDataMatch) {
      try {
        const data = JSON.parse(nextDataMatch[1]);
        const auction = data?.props?.pageProps?.auction;
        if (auction) {
          console.log('✅ C&B: Found __NEXT_DATA__ auction data');
          if (!result.vin && auction.vin) result.vin = auction.vin;
          if (!result.mileage && auction.mileage) {
            const m = parseInt(String(auction.mileage).replace(/[^0-9]/g, ''), 10);
            if (Number.isFinite(m)) result.mileage = m;
          }
          if (!result.year && auction.year) result.year = auction.year;
          if (!result.make && auction.make) result.make = auction.make;
          if (!result.model && auction.model) result.model = auction.model;
          if (!result.transmission && auction.transmission) result.transmission = auction.transmission;
          if (!result.exteriorColor && (auction.exteriorColor || auction.color)) {
            result.exteriorColor = auction.exteriorColor || auction.color;
          }
          if (!result.location && auction.location) result.location = auction.location;
        }
      } catch {
        // Ignore parse errors
      }
    }

  } catch (e) {
    console.error('⚠️ C&B: Error extracting data:', e);
  }

  return result;
}

async function trySaveHtmlSnapshot(args: {
  supabase: any;
  listingUrl: string;
  httpStatus: number | null;
  success: boolean;
  errorMessage: string | null;
  html: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { supabase, listingUrl, httpStatus, success, errorMessage, html, metadata } = args;
  try {
    const htmlText = html ?? null;
    const htmlSha = htmlText ? await sha256Hex(htmlText) : null;
    const contentLength = htmlText ? htmlText.length : 0;

    const payload: any = {
      platform: "carsandbids",
      listing_url: listingUrl,
      fetch_method: "firecrawl",
      http_status: httpStatus,
      success,
      error_message: errorMessage,
      html: htmlText,
      html_sha256: htmlSha,
      content_length: contentLength,
      ...(metadata || {}),
    };

    const { error } = await supabase
      .from("listing_page_snapshots")
      .upsert(payload, { onConflict: "platform,listing_url" });

    if (error) {
      console.warn(`⚠️ C&B: Failed to save snapshot: ${error.message}`);
    }
  } catch (e: any) {
    console.warn(`⚠️ C&B: Snapshot save failed: ${e?.message}`);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").trim();
    const serviceRoleKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
    const firecrawlApiKey = (Deno.env.get("FIRECRAWL_API_KEY") ?? "").trim();

    if (!supabaseUrl) throw new Error("Missing SUPABASE_URL");
    if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
    if (!firecrawlApiKey) throw new Error("Missing FIRECRAWL_API_KEY");

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({}));
    const inputUrl = String(body?.url || body?.listing_url || body?.auction_url || "").trim();
    const providedVehicleId = body?.vehicle_id ? String(body.vehicle_id) : null;

    if (!inputUrl || !inputUrl.includes("carsandbids.com")) {
      return new Response(JSON.stringify({ error: "Invalid Cars & Bids URL" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const listingUrlNorm = normalizeUrl(inputUrl);
    const listingUrlCanonical = canonicalUrl(inputUrl);

    console.log(`extract-cars-and-bids-core: Processing ${listingUrlCanonical}`);

    // Fetch HTML using Firecrawl (C&B blocks direct fetch)
    // Use longer waitFor to allow React app to render
    const firecrawlResult = await firecrawlScrape(
      {
        url: listingUrlNorm,
        formats: ['html'],
        onlyMainContent: false,
        waitFor: 5000, // Wait 5 seconds for React to render
      },
      {
        apiKey: firecrawlApiKey,
        timeoutMs: 60000,
        maxAttempts: 2,
      }
    );

    const html = firecrawlResult.data?.html || '';
    const httpStatus = firecrawlResult.httpStatus;

    if (!html || html.length < 1000) {
      await trySaveHtmlSnapshot({
        supabase,
        listingUrl: listingUrlNorm,
        httpStatus,
        success: false,
        errorMessage: firecrawlResult.error || "Firecrawl returned insufficient HTML",
        html: html || null,
        metadata: { extractor: "extract-cars-and-bids-core" },
      });
      throw new Error(firecrawlResult.error || `Firecrawl returned insufficient HTML (${html?.length || 0} chars)`);
    }

    console.log(`✅ C&B: Firecrawl returned ${html.length} chars of HTML`);

    // Save successful snapshot
    await trySaveHtmlSnapshot({
      supabase,
      listingUrl: listingUrlNorm,
      httpStatus,
      success: true,
      errorMessage: null,
      html,
      metadata: { extractor: "extract-cars-and-bids-core" },
    });

    // Extract data from HTML
    const extracted = extractFromCarsAndBidsHtml(html);

    // Check if we got minimum required data (year/make/model)
    if (!extracted.year || !extracted.make || !extracted.model) {
      console.warn('⚠️ C&B: Could not extract year/make/model');
      // Try to parse from URL as fallback
      const urlMatch = listingUrlCanonical.match(/\/(\d{4})-([^/]+)$/i);
      if (urlMatch) {
        extracted.year = parseInt(urlMatch[1], 10);
        const slugParts = urlMatch[2].split('-');
        if (slugParts.length >= 2) {
          extracted.make = slugParts[0].charAt(0).toUpperCase() + slugParts[0].slice(1);
          extracted.model = slugParts.slice(1).join(' ');
        }
      }
    }

    // Still no year/make? Return error
    if (!extracted.year || !extracted.make) {
      return new Response(JSON.stringify({
        success: false,
        error: "Could not extract vehicle identity (year/make/model)",
        listing_url: listingUrlCanonical,
        html_length: html.length,
      }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`✅ C&B: Extracted - Year: ${extracted.year}, Make: ${extracted.make}, Model: ${extracted.model}, VIN: ${extracted.vin || 'N/A'}, Mileage: ${extracted.mileage || 'N/A'}`);

    // Prepare vehicle data
    const vehicleData: Record<string, any> = {
      year: extracted.year,
      make: extracted.make,
      model: extracted.model,
      vin: extracted.vin,
      mileage: extracted.mileage,
      exterior_color: extracted.exteriorColor,
      interior_color: extracted.interiorColor,
      engine: extracted.engine,
      transmission: extracted.transmission,
      description: extracted.description,
      discovery_url: listingUrlCanonical,
      discovery_source: "carsandbids",
      status: "active",
    };

    // Clean null values
    Object.keys(vehicleData).forEach(key => {
      if (vehicleData[key] === null || vehicleData[key] === undefined) {
        delete vehicleData[key];
      }
    });

    // Check for existing vehicle by URL
    let vehicleId = providedVehicleId;
    const urlKey = normalizeListingUrlKey(listingUrlCanonical);

    const { data: existingByUrl } = await supabase
      .from("vehicles")
      .select("id")
      .or(`discovery_url.eq.${listingUrlCanonical},discovery_url.eq.${listingUrlNorm}`)
      .limit(1)
      .maybeSingle();

    if (existingByUrl?.id) {
      vehicleId = existingByUrl.id;
      console.log(`✅ C&B: Found existing vehicle by URL: ${vehicleId}`);
    }

    // Also check by VIN if we have one
    if (!vehicleId && extracted.vin && extracted.vin.length >= 11) {
      const { data: existingByVin } = await supabase
        .from("vehicles")
        .select("id")
        .eq("vin", extracted.vin)
        .limit(1)
        .maybeSingle();

      if (existingByVin?.id) {
        vehicleId = existingByVin.id;
        console.log(`✅ C&B: Found existing vehicle by VIN: ${vehicleId}`);
      }
    }

    // Upsert vehicle
    let created = false;
    if (vehicleId) {
      // Update existing
      const { error: updateError } = await supabase
        .from("vehicles")
        .update({
          ...vehicleData,
          updated_at: new Date().toISOString(),
        })
        .eq("id", vehicleId);

      if (updateError) {
        console.error(`⚠️ C&B: Vehicle update failed: ${updateError.message}`);
      }
    } else {
      // Insert new
      const { data: insertedVehicle, error: insertError } = await supabase
        .from("vehicles")
        .insert(vehicleData)
        .select("id")
        .single();

      if (insertError) {
        throw new Error(`Vehicle insert failed: ${insertError.message}`);
      }
      vehicleId = insertedVehicle.id;
      created = true;
      console.log(`✅ C&B: Created new vehicle: ${vehicleId}`);
    }

    // Upsert images
    let imagesInserted = 0;
    if (vehicleId && extracted.images.length > 0) {
      const imageRows = extracted.images.slice(0, 50).map((url, idx) => ({
        vehicle_id: vehicleId,
        image_url: url,
        display_order: idx,
        source: "carsandbids",
      }));

      // Delete existing images first to avoid duplicates
      await supabase
        .from("vehicle_images")
        .delete()
        .eq("vehicle_id", vehicleId)
        .eq("source", "carsandbids");

      const { error: imgError } = await supabase
        .from("vehicle_images")
        .insert(imageRows);

      if (imgError) {
        console.warn(`⚠️ C&B: Image insert failed: ${imgError.message}`);
      } else {
        imagesInserted = imageRows.length;
      }
    }

    // Upsert external_listing
    const externalListingData: Record<string, any> = {
      platform: "carsandbids",
      listing_url: listingUrlCanonical,
      vehicle_id: vehicleId,
      title: extracted.title,
      current_bid: extracted.currentBid,
      listing_status: extracted.auctionStatus || "active",
      seller_id: extracted.sellerId,
      seller_name: extracted.sellerName,
      location: extracted.location,
      end_date: extracted.endDate,
    };

    Object.keys(externalListingData).forEach(key => {
      if (externalListingData[key] === null || externalListingData[key] === undefined) {
        delete externalListingData[key];
      }
    });

    const { error: listingError } = await supabase
      .from("external_listings")
      .upsert(externalListingData, { onConflict: "platform,listing_url" });

    if (listingError) {
      console.warn(`⚠️ C&B: External listing upsert failed: ${listingError.message}`);
    }

    // Upsert auction_event
    if (vehicleId && extracted.lotNumber) {
      const auctionEventData: Record<string, any> = {
        vehicle_id: vehicleId,
        platform: "carsandbids",
        lot_number: extracted.lotNumber,
        auction_url: listingUrlCanonical,
        high_bid: extracted.currentBid,
        end_date: extracted.endDate,
        status: extracted.auctionStatus || "active",
        location: extracted.location,
      };

      Object.keys(auctionEventData).forEach(key => {
        if (auctionEventData[key] === null || auctionEventData[key] === undefined) {
          delete auctionEventData[key];
        }
      });

      const { error: auctionError } = await supabase
        .from("auction_events")
        .upsert(auctionEventData, { onConflict: "vehicle_id,platform,lot_number" });

      if (auctionError) {
        console.warn(`⚠️ C&B: Auction event upsert failed: ${auctionError.message}`);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      source: "Cars & Bids",
      site_type: "carsandbids",
      listing_url: listingUrlCanonical,
      vehicle_id: vehicleId,
      created,
      extracted: {
        year: extracted.year,
        make: extracted.make,
        model: extracted.model,
        vin: extracted.vin,
        mileage: extracted.mileage,
        exterior_color: extracted.exteriorColor,
        transmission: extracted.transmission,
        images_count: extracted.images.length,
      },
      images_inserted: imagesInserted,
      timestamp: new Date().toISOString(),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("extract-cars-and-bids-core error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message || String(error),
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
