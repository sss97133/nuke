/**
 * extract-cars-and-bids-core
 *
 * Core extractor for Cars & Bids listings:
 * - Uses Firecrawl to fetch HTML (C&B blocks direct fetch with 403)
 * - Parses __NEXT_DATA__ JSON for VIN, mileage, and vehicle data
 * - Saves HTML evidence to listing_page_snapshots
 * - Upserts vehicles + vehicle_images + external_listings + auction_events
 *
 * Comments/bids are handled separately by extract-cars-and-bids-comments.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeListingUrlKey } from "../_shared/listingUrl.ts";

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

function titleCaseToken(s: string): string {
  const t = String(s || "").trim();
  if (!t) return t;
  if (t.length <= 2) return t.toUpperCase();
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

/**
 * Extract auction data from __NEXT_DATA__ JSON embedded in C&B HTML
 */
function extractFromNextData(html: string): {
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
} | null {
  try {
    const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!match) {
      console.log('⚠️ C&B: No __NEXT_DATA__ found in HTML');
      return null;
    }
    const data = JSON.parse(match[1]);

    // Try multiple paths to find auction data
    const auction = data?.props?.pageProps?.auction ||
                   data?.props?.pageProps?.data?.auction ||
                   data?.props?.auction ||
                   data?.auction;

    if (!auction) {
      console.log('⚠️ C&B: No auction data in __NEXT_DATA__');
      console.log('  Available pageProps keys:', Object.keys(data?.props?.pageProps || {}));
      return null;
    }

    console.log('✅ C&B: Found auction data, keys:', Object.keys(auction).slice(0, 20));

    // Extract images from photos array
    const images: string[] = [];
    if (auction.photos && Array.isArray(auction.photos)) {
      for (const photo of auction.photos) {
        if (photo.large) images.push(photo.large);
        else if (photo.medium) images.push(photo.medium);
        else if (photo.small) images.push(photo.small);
        else if (photo.url) images.push(photo.url);
      }
    }

    // Parse mileage - handle both number and string formats
    let mileage: number | null = null;
    const rawMileage = auction.mileage || auction.odometer || auction.miles;
    if (rawMileage) {
      const mileageStr = String(rawMileage).replace(/[^0-9]/g, '');
      mileage = mileageStr ? parseInt(mileageStr, 10) : null;
      if (mileage && !Number.isFinite(mileage)) mileage = null;
    }

    // Parse year
    let year: number | null = auction.year || null;
    if (year && typeof year === 'string') {
      year = parseInt(year, 10);
      if (!Number.isFinite(year)) year = null;
    }

    // Parse current bid
    let currentBid: number | null = null;
    const rawBid = auction.currentBid || auction.current_bid || auction.highBid || auction.high_bid;
    if (rawBid) {
      if (typeof rawBid === 'number') {
        currentBid = rawBid;
      } else {
        const bidStr = String(rawBid).replace(/[^0-9]/g, '');
        currentBid = bidStr ? parseInt(bidStr, 10) : null;
      }
    }

    // Seller info
    const seller = auction.seller || auction.user || {};

    return {
      vin: auction.vin || null,
      mileage,
      title: auction.title || null,
      year,
      make: auction.make || null,
      model: auction.model || null,
      images,
      engine: auction.engine || auction.engineDescription || null,
      transmission: auction.transmission || null,
      exteriorColor: auction.exteriorColor || auction.exterior_color || auction.color || null,
      interiorColor: auction.interiorColor || auction.interior_color || null,
      location: auction.location || auction.sellerLocation || null,
      currentBid,
      endDate: auction.endDate || auction.end_date || auction.endTime || null,
      auctionStatus: auction.status || auction.auctionStatus || null,
      sellerId: seller.id ? String(seller.id) : null,
      sellerName: seller.username || seller.name || null,
      description: auction.description || auction.summary || null,
      lotNumber: auction.id ? String(auction.id) : null,
    };
  } catch (e) {
    console.error('⚠️ C&B: Error parsing __NEXT_DATA__:', e);
    return null;
  }
}

/**
 * Parse year/make/model from title if not provided in auction data
 */
function parseYearMakeModelFromTitle(title: string): { year: number | null; make: string | null; model: string | null } {
  if (!title) return { year: null, make: null, model: null };

  // Pattern: "YEAR MAKE MODEL..."
  const match = title.match(/^(\d{4})\s+(\S+)\s+(.+)$/i);
  if (!match) return { year: null, make: null, model: null };

  const year = parseInt(match[1], 10);
  if (!Number.isFinite(year) || year < 1885 || year > new Date().getFullYear() + 2) {
    return { year: null, make: null, model: null };
  }

  return {
    year,
    make: titleCaseToken(match[2]),
    model: match[3].trim(),
  };
}

async function fetchWithFirecrawl(url: string, apiKey: string): Promise<{ html: string; status: number }> {
  console.log(`🔥 C&B: Fetching ${url} with Firecrawl...`);

  const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url,
      formats: ['html'],
      waitFor: 2000, // Wait for JS to render
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Firecrawl error: ${response.status} - ${errorText.substring(0, 200)}`);
  }

  const data = await response.json();
  if (!data.success || !data.data?.html) {
    throw new Error(`Firecrawl returned no HTML: ${JSON.stringify(data).substring(0, 200)}`);
  }

  console.log(`✅ C&B: Firecrawl returned ${data.data.html.length} chars of HTML`);
  return { html: data.data.html, status: 200 };
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
    let html = "";
    let httpStatus: number = 200;

    try {
      const fetched = await fetchWithFirecrawl(listingUrlNorm, firecrawlApiKey);
      html = fetched.html;
      httpStatus = fetched.status;
    } catch (e: any) {
      await trySaveHtmlSnapshot({
        supabase,
        listingUrl: listingUrlNorm,
        httpStatus: null,
        success: false,
        errorMessage: e?.message || "Firecrawl fetch failed",
        html: null,
        metadata: { extractor: "extract-cars-and-bids-core" },
      });
      throw e;
    }

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

    // Extract data from __NEXT_DATA__
    const extracted = extractFromNextData(html);
    if (!extracted) {
      return new Response(JSON.stringify({
        success: false,
        error: "Could not extract data from __NEXT_DATA__",
        listing_url: listingUrlCanonical,
      }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fill in year/make/model from title if not present
    let { year, make, model } = extracted;
    if ((!year || !make || !model) && extracted.title) {
      const parsed = parseYearMakeModelFromTitle(extracted.title);
      year = year || parsed.year;
      make = make || parsed.make;
      model = model || parsed.model;
    }

    console.log(`✅ C&B: Extracted - Year: ${year}, Make: ${make}, Model: ${model}, VIN: ${extracted.vin || 'N/A'}, Mileage: ${extracted.mileage || 'N/A'}`);

    // Prepare vehicle data
    const vehicleData: Record<string, any> = {
      year,
      make,
      model,
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
      const imageRows = extracted.images.map((url, idx) => ({
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
        year,
        make,
        model,
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
