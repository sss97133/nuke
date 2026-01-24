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
    // Don't lowercase - C&B auction IDs are case-sensitive!
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
    // Don't lowercase - C&B auction IDs are case-sensitive!
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
  // C&B specific fields
  dougsTake: string | null;
  highlights: string | null;
  equipment: string | null;
  commentCount: number | null;
  bidCount: number | null;
}

/**
 * Extract auction data from C&B HTML
 * C&B is a React SPA - data comes from:
 * 1. Meta tags (og:title contains year/make/model/mileage/transmission/color)
 * 2. Image URLs from the page
 * 3. VIN may be in DOM if JS rendered (requires waitFor)
 */
function extractFromCarsAndBidsHtml(html: string, markdown?: string): CabExtractedData {
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
    // C&B specific
    dougsTake: null,
    highlights: null,
    equipment: null,
    commentCount: null,
    bidCount: null,
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

    // 2a. Extract structured data from markdown (C&B renders these as key-value pairs)
    // Format: "Mileage21,800" or "VIN1G1YB2D42N5117572" etc.
    if (markdown) {
      console.log('✅ C&B: Parsing structured data from markdown');

      // VIN - 17 characters for post-1980, 11-14 for older vehicles
      // C&B format is "VIN1G1YB2D42N5117572Title" - VIN followed immediately by "Title"
      const mdVinMatch = markdown.match(/VIN([A-HJ-NPR-Z0-9]{17})(?:Title|[^A-Za-z0-9]|$)/i) ||
                         markdown.match(/VIN([A-HJ-NPR-Z0-9]{11,17})(?:Title|[^A-Za-z0-9]|$)/i);
      if (mdVinMatch && !result.vin) {
        result.vin = mdVinMatch[1].toUpperCase();
        console.log('✅ C&B: Found VIN in markdown:', result.vin);
      }

      // Mileage - "Mileage21,800" or "Mileage~21,800"
      const mdMileageMatch = markdown.match(/Mileage~?([\d,]+)/i);
      if (mdMileageMatch && !result.mileage) {
        const m = parseInt(mdMileageMatch[1].replace(/,/g, ''), 10);
        if (Number.isFinite(m)) {
          result.mileage = m;
          console.log('✅ C&B: Found mileage in markdown:', result.mileage);
        }
      }

      // Exterior Color - "Exterior ColorCeramic Matrix Gray"
      const mdExtColorMatch = markdown.match(/Exterior\s*Color([A-Za-z0-9\s]+?)(?:Interior|Seller|Engine|Drivetrain|Transmission|Body|Location|\n|$)/i);
      if (mdExtColorMatch && !result.exteriorColor) {
        result.exteriorColor = mdExtColorMatch[1].trim();
        console.log('✅ C&B: Found exterior color in markdown:', result.exteriorColor);
      }

      // Interior Color - "Interior ColorAdrenaline Red"
      const mdIntColorMatch = markdown.match(/Interior\s*Color([A-Za-z0-9\s]+?)(?:Seller|Engine|Drivetrain|Transmission|Body|Location|\n|$)/i);
      if (mdIntColorMatch && !result.interiorColor) {
        result.interiorColor = mdIntColorMatch[1].trim();
        console.log('✅ C&B: Found interior color in markdown:', result.interiorColor);
      }

      // Transmission - "TransmissionAutomatic (8-Speed)" or "TransmissionManual (6-Speed)"
      const mdTransMatch = markdown.match(/Transmission((?:Automatic|Manual)(?:\s*\([^)]+\))?)/i);
      if (mdTransMatch && !result.transmission) {
        result.transmission = mdTransMatch[1].trim();
        console.log('✅ C&B: Found transmission in markdown:', result.transmission);
      }

      // Engine - "Engine6.2L Turbocharged V8"
      const mdEngineMatch = markdown.match(/Engine([^\n]+?)(?:Drivetrain|Transmission|Body|Exterior|Interior|Seller|$)/i);
      if (mdEngineMatch && !result.engine) {
        result.engine = mdEngineMatch[1].trim();
        console.log('✅ C&B: Found engine in markdown:', result.engine);
      }

      // Bid/Sale price - "Bid to $61,000" or "Sold for $XX,XXX"
      const mdBidMatch = markdown.match(/(?:Bid to|Sold for|High Bid|Final Bid)\s*\$?([\d,]+)/i);
      if (mdBidMatch && !result.currentBid) {
        const bid = parseInt(mdBidMatch[1].replace(/,/g, ''), 10);
        if (Number.isFinite(bid) && bid > 0) {
          result.currentBid = bid;
          console.log('✅ C&B: Found bid/price in markdown:', result.currentBid);
        }
      }

      // Location - "Location[Canyon, TX 79015]" or "LocationCanyon, TX"
      const mdLocationMatch = markdown.match(/Location\[?([A-Za-z0-9,\s]+?)(?:\]|\n|Seller|$)/i);
      if (mdLocationMatch && !result.location) {
        result.location = mdLocationMatch[1].trim();
        console.log('✅ C&B: Found location in markdown:', result.location);
      }

      // Auction status - check for ended/sold indicators
      if (markdown.includes('Auction Ended') || markdown.includes('This auction has ended')) {
        result.auctionStatus = 'ended';
      } else if (markdown.includes('Reserve Not Met')) {
        result.auctionStatus = 'reserve_not_met';
      } else if (markdown.includes('Sold for')) {
        result.auctionStatus = 'sold';
      }

      // C&B Specific: Doug's Take
      const dougsTakeMatch = markdown.match(/Doug['']s Take\s*([\s\S]*?)(?:####\s*Highlights|####\s*Equipment|$)/i);
      if (dougsTakeMatch && dougsTakeMatch[1]) {
        result.dougsTake = dougsTakeMatch[1].trim().slice(0, 5000);
        console.log('✅ C&B: Found Doug\'s Take:', result.dougsTake.slice(0, 100) + '...');
      }

      // C&B Specific: Highlights
      const highlightsMatch = markdown.match(/####\s*Highlights\s*([\s\S]*?)(?:####\s*Equipment|####\s*Modifications|$)/i);
      if (highlightsMatch && highlightsMatch[1]) {
        result.highlights = highlightsMatch[1].trim().slice(0, 8000);
        console.log('✅ C&B: Found Highlights section');
      }

      // C&B Specific: Equipment
      const equipmentMatch = markdown.match(/####\s*Equipment\s*([\s\S]*?)(?:####\s*Modifications|####\s*Known Flaws|####\s*Recent Service|$)/i);
      if (equipmentMatch && equipmentMatch[1]) {
        result.equipment = equipmentMatch[1].trim().slice(0, 5000);
        console.log('✅ C&B: Found Equipment section');
      }

      // C&B Specific: Comment count - "Comments37" or "37 comments"
      const commentCountMatch = markdown.match(/Comments?(\d+)/i) || markdown.match(/(\d+)\s*comments?/i);
      if (commentCountMatch) {
        const count = parseInt(commentCountMatch[1], 10);
        if (Number.isFinite(count)) {
          result.commentCount = count;
          console.log('✅ C&B: Found comment count:', result.commentCount);
        }
      }

      // C&B Specific: Bid count - "Bids22" or "22 bids"
      const bidCountMatch = markdown.match(/Bids?(\d+)/i) || markdown.match(/(\d+)\s*bids?/i);
      if (bidCountMatch) {
        const count = parseInt(bidCountMatch[1], 10);
        if (Number.isFinite(count)) {
          result.bidCount = count;
          console.log('✅ C&B: Found bid count:', result.bidCount);
        }
      }
    }

    // 2b. Extract og:image as potential primary image
    const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
                         html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
    if (ogImageMatch) {
      console.log('✅ C&B: Found og:image meta tag:', ogImageMatch[1]);
      if (ogImageMatch[1].includes('carsandbids') || ogImageMatch[1].includes('.jpg') || ogImageMatch[1].includes('.png') || ogImageMatch[1].includes('.webp')) {
        result.images.push(ogImageMatch[1]);
        console.log('✅ C&B: Added og:image to images array');
      }
    } else {
      console.log('⚠️ C&B: No og:image meta tag found in HTML');
    }

    // 3. Extract images from media.carsandbids.com URLs
    const seenImages = new Set<string>();

    // Try multiple patterns for finding C&B images
    const imagePatterns = [
      /https:\/\/media\.carsandbids\.com[^"'\s)]+\.(jpg|jpeg|png|webp)[^"'\s)]*/gi,
      /"(https:\/\/media\.carsandbids\.com[^"]+)"/gi,
      /src=["'](https:\/\/media\.carsandbids\.com[^"']+)["']/gi,
    ];

    for (const pattern of imagePatterns) {
      const imageMatches = html.matchAll(pattern);
      for (const match of imageMatches) {
        const imgUrl = (match[1] || match[0]).split('?')[0]; // Remove query params for dedup
        if (!seenImages.has(imgUrl) && !imgUrl.includes('width=80') && !imgUrl.includes('_thumb')) {
          seenImages.add(imgUrl);
          result.images.push(match[1] || match[0]); // Keep full URL with CDN params
        }
      }
    }

    // Also try to find images in JSON data embedded in page
    const jsonImageMatch = html.match(/"images"\s*:\s*\[([\s\S]*?)\]/i);
    if (jsonImageMatch) {
      try {
        const imgArray = JSON.parse(`[${jsonImageMatch[1]}]`);
        for (const img of imgArray) {
          const imgUrl = typeof img === 'string' ? img : img?.url || img?.src;
          if (imgUrl && imgUrl.includes('media.carsandbids.com')) {
            const cleanUrl = imgUrl.split('?')[0];
            if (!seenImages.has(cleanUrl) && !cleanUrl.includes('width=80')) {
              seenImages.add(cleanUrl);
              result.images.push(imgUrl);
            }
          }
        }
      } catch {
        // Ignore JSON parse errors
      }
    }

    // Also extract images from markdown if provided (markdown often captures images better)
    if (markdown) {
      const mdImageMatches = markdown.matchAll(/!\[[^\]]*\]\((https:\/\/media\.carsandbids\.com[^)]+)\)/gi);
      for (const match of mdImageMatches) {
        const imgUrl = match[1].split('?')[0];
        if (!seenImages.has(imgUrl) && !imgUrl.includes('width=80') && !imgUrl.includes('_thumb')) {
          seenImages.add(imgUrl);
          result.images.push(match[1]);
        }
      }
      // Also try plain URLs in markdown
      const mdUrlMatches = markdown.matchAll(/https:\/\/media\.carsandbids\.com[^\s\)]+\.(jpg|jpeg|png|webp)/gi);
      for (const match of mdUrlMatches) {
        const imgUrl = match[0].split('?')[0];
        if (!seenImages.has(imgUrl) && !imgUrl.includes('width=80') && !imgUrl.includes('_thumb')) {
          seenImages.add(imgUrl);
          result.images.push(match[0]);
        }
      }
    }

    console.log(`✅ C&B: Found ${result.images.length} images from HTML${markdown ? ' and markdown' : ''}`);
    if (result.images.length === 0) {
      // Debug: log a sample of the HTML to see what's there
      console.log('⚠️ C&B: No images found. HTML sample (first 500 chars):', html.slice(0, 500));
      console.log('⚠️ C&B: HTML contains media.carsandbids.com:', html.includes('media.carsandbids.com'));
      console.log('⚠️ C&B: HTML length:', html.length);
    }

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

          // Extract auction data (bid, end date, status)
          if (!result.currentBid && auction.currentBid) {
            const bid = parseInt(String(auction.currentBid).replace(/[^0-9]/g, ''), 10);
            if (Number.isFinite(bid) && bid > 0) result.currentBid = bid;
          }
          if (!result.endDate && (auction.endDate || auction.endTime || auction.endsAt)) {
            const endDateStr = auction.endDate || auction.endTime || auction.endsAt;
            try {
              const parsed = new Date(endDateStr);
              if (!isNaN(parsed.getTime())) result.endDate = parsed.toISOString();
            } catch { /* ignore */ }
          }
          if (!result.auctionStatus && auction.status) {
            result.auctionStatus = String(auction.status).toLowerCase();
          }
        }
      } catch {
        // Ignore parse errors
      }
    }

    // 7. Extract auction data from countdown/bid elements in HTML
    // Pattern for countdown: data-countdown-date="2026-01-23T23:35:00Z"
    const countdownMatch = html.match(/data-countdown-date\s*=\s*["']([^"']+)["']/i) ||
                           html.match(/data-end-date\s*=\s*["']([^"']+)["']/i) ||
                           html.match(/"endDate"\s*:\s*"([^"]+)"/i);
    if (countdownMatch && !result.endDate) {
      try {
        const parsed = new Date(countdownMatch[1]);
        if (!isNaN(parsed.getTime())) result.endDate = parsed.toISOString();
        console.log('✅ C&B: Extracted endDate from countdown:', result.endDate);
      } catch { /* ignore */ }
    }

    // Pattern for current bid: "$12,500" or "USD $12,500"
    const bidPatterns = [
      /Current\s+Bid[^>]*>.*?USD\s*\$?([\d,]+)/i,
      /Current\s+Bid[^>]*>.*?\$([\d,]+)/i,
      /"currentBid"\s*:\s*(\d+)/i,
      /data-current-bid[^>]*>.*?\$([\d,]+)/i,
    ];
    for (const pattern of bidPatterns) {
      if (result.currentBid) break;
      const bidMatch = html.match(pattern);
      if (bidMatch) {
        const bid = parseInt(bidMatch[1].replace(/,/g, ''), 10);
        if (Number.isFinite(bid) && bid > 0) {
          result.currentBid = bid;
          console.log('✅ C&B: Extracted currentBid from HTML:', result.currentBid);
        }
      }
    }

    // Check auction status from HTML
    if (!result.auctionStatus) {
      if (/Auction\s+Ended/i.test(html) || /Reserve\s+Not\s+Met/i.test(html)) {
        result.auctionStatus = 'ended';
      } else if (/Sold\s+for/i.test(html)) {
        result.auctionStatus = 'sold';
      }
    }

  } catch (e) {
    console.error('⚠️ C&B: Error extracting data:', e);
  }

  return result;
}

/**
 * Log extraction attempt to scraping_health for self-healing feedback loop
 */
async function logScrapingHealth(args: {
  supabase: any;
  url: string;
  success: boolean;
  statusCode?: number | null;
  errorMessage?: string | null;
  errorType?: string | null;
  responseTimeMs?: number;
  dataExtracted?: Record<string, any>;
  imagesFound?: number;
  hasPrice?: boolean;
}): Promise<void> {
  try {
    const { supabase, url, success, statusCode, errorMessage, errorType, responseTimeMs, dataExtracted, imagesFound, hasPrice } = args;

    await supabase.from('scraping_health').insert({
      source: 'carsandbids',
      url,
      success,
      status_code: statusCode || null,
      error_message: errorMessage || null,
      error_type: errorType || null,
      response_time_ms: responseTimeMs || null,
      data_extracted: dataExtracted || null,
      images_found: imagesFound || 0,
      has_price: hasPrice || false,
      function_name: 'extract-cars-and-bids-core',
    });
    console.log(`✅ C&B: Logged health status (success=${success})`);
  } catch (e: any) {
    console.warn(`⚠️ C&B: Failed to log scraping health: ${e?.message}`);
  }
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

    // Use insert (not upsert) - constraint name differs from expected
    const { error } = await supabase
      .from("listing_page_snapshots")
      .insert(payload);

    if (error) {
      // Ignore duplicate key errors (just means we already have a snapshot)
      if (!error.message?.includes('duplicate key')) {
        console.warn(`⚠️ C&B: Failed to save snapshot: ${error.message}`);
      }
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
    // COST OPTIMIZED: No LLM extract (we parse HTML ourselves), minimal scroll
    // This reduces cost from ~50 credits to ~1-2 credits per page
    const firecrawlResult = await firecrawlScrape(
      {
        url: listingUrlNorm,
        formats: ['html', 'markdown'],  // NO 'extract' - we parse ourselves (huge cost savings)
        onlyMainContent: false,
        waitFor: 3000, // Reduced from 8000 - React renders fast
        actions: [
          { type: 'scroll', direction: 'down', pixels: 2000 },  // Single scroll to trigger lazy load
          { type: 'wait', milliseconds: 1500 },
        ],
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      },
      {
        apiKey: firecrawlApiKey,
        timeoutMs: 30000,  // Reduced from 120000
        maxAttempts: 1,    // Reduced from 2 - don't double-spend on failures
      }
    );

    // No LLM extract - we parse HTML/markdown ourselves
    const llmExtract = null;

    const scrapeStartTime = Date.now();
    const html = firecrawlResult.data?.html || '';
    const markdown = firecrawlResult.data?.markdown || '';
    const httpStatus = firecrawlResult.httpStatus;
    const scrapeEndTime = Date.now();
    const responseTimeMs = scrapeEndTime - scrapeStartTime;

    // Log LLM extraction results
    if (llmExtract) {
      console.log(`✅ C&B: LLM extracted - images: ${llmExtract.images?.length || 0}, vin: ${llmExtract.vin || 'none'}, mileage: ${llmExtract.mileage || 'none'}`);
    }

    if (!html || html.length < 1000) {
      await trySaveHtmlSnapshot({
        supabase,
        listingUrl: listingUrlNorm,
        httpStatus,
        success: false,
        errorMessage: firecrawlResult.error || "Firecrawl returned insufficient HTML",
        html: html || null,
        metadata: { extractor: "extract-cars-and-bids-core", llmExtract },
      });
      // Log failure to scraping_health
      await logScrapingHealth({
        supabase,
        url: listingUrlCanonical,
        success: false,
        statusCode: httpStatus,
        errorMessage: firecrawlResult.error || `Insufficient HTML (${html?.length || 0} chars)`,
        errorType: 'parse_error',
        responseTimeMs,
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
      metadata: { extractor: "extract-cars-and-bids-core", llmExtract },
    });

    // Extract data from HTML
    const extracted = extractFromCarsAndBidsHtml(html, markdown);

    // Merge LLM extraction results (these are often more reliable for lazy-loaded content)
    if (llmExtract) {
      // Use LLM images if we didn't find any in HTML
      if ((!extracted.images || extracted.images.length === 0) && Array.isArray(llmExtract.images) && llmExtract.images.length > 0) {
        extracted.images = llmExtract.images.filter((url: string) =>
          typeof url === 'string' && (url.includes('media.carsandbids.com') || url.includes('carsandbids'))
        );
        console.log(`✅ C&B: Using ${extracted.images.length} images from LLM extraction`);
      }
      // Use LLM VIN if we didn't find one
      if (!extracted.vin && llmExtract.vin && typeof llmExtract.vin === 'string' && llmExtract.vin.length === 17) {
        extracted.vin = llmExtract.vin.toUpperCase();
        console.log(`✅ C&B: Using VIN from LLM extraction: ${extracted.vin}`);
      }
      // Use LLM mileage if we didn't find one
      if (!extracted.mileage && llmExtract.mileage && typeof llmExtract.mileage === 'number') {
        extracted.mileage = llmExtract.mileage;
        console.log(`✅ C&B: Using mileage from LLM extraction: ${extracted.mileage}`);
      }
      // Use LLM colors if available
      if (!extracted.exteriorColor && llmExtract.exterior_color) {
        extracted.exteriorColor = String(llmExtract.exterior_color);
      }
      if (!extracted.interiorColor && llmExtract.interior_color) {
        extracted.interiorColor = String(llmExtract.interior_color);
      }
      // Use LLM transmission if available
      if (!extracted.transmission && llmExtract.transmission) {
        extracted.transmission = String(llmExtract.transmission);
      }
    }

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
      // Log failure to scraping_health
      await logScrapingHealth({
        supabase,
        url: listingUrlCanonical,
        success: false,
        statusCode: httpStatus,
        errorMessage: 'Could not extract vehicle identity (year/make/model)',
        errorType: 'parse_error',
        responseTimeMs,
      });
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

    // Canonical organization ID for Cars & Bids (from organizations table)
    const CARS_AND_BIDS_ORG_ID = "4dac1878-b3fc-424c-9e92-3cf552f1e053";

    // Prepare vehicle data (use actual column names from vehicles table)
    const vehicleData: Record<string, any> = {
      year: extracted.year,
      make: extracted.make,
      model: extracted.model,
      vin: extracted.vin,
      mileage: extracted.mileage,
      color: extracted.exteriorColor,  // vehicles table uses 'color' not 'exterior_color'
      interior_color: extracted.interiorColor,
      engine_type: extracted.engine,   // vehicles table uses 'engine_type' not 'engine'
      transmission: extracted.transmission,
      // Create rich description from Doug's Take + Highlights
      description: [
        extracted.dougsTake ? `**Doug's Take:**\n${extracted.dougsTake}` : null,
        extracted.highlights ? `**Highlights:**\n${extracted.highlights}` : null,
        extracted.description,
      ].filter(Boolean).join('\n\n') || null,
      location: extracted.location,
      sale_price: extracted.currentBid, // Store as sale_price for ended auctions
      bid_count: extracted.bidCount,
      discovery_url: listingUrlCanonical,
      discovery_source: "carsandbids",
      listing_source: "extract-cars-and-bids-core",
      status: "active",
      // Store C&B-specific data in import_metadata
      import_metadata: {
        platform: "carsandbids",
        dougs_take: extracted.dougsTake,
        highlights: extracted.highlights,
        equipment: extracted.equipment,
        comment_count: extracted.commentCount,
        bid_count: extracted.bidCount,
        auction_status: extracted.auctionStatus,
        extracted_at: new Date().toISOString(),
      },
    };

    // Clean null values
    Object.keys(vehicleData).forEach(key => {
      if (vehicleData[key] === null || vehicleData[key] === undefined) {
        delete vehicleData[key];
      }
    });

    // Check for existing vehicle by URL (use ilike for case-insensitive matching)
    let vehicleId = providedVehicleId;

    // Extract just the path part for matching (handles different URL formats)
    const urlPath = listingUrlCanonical.replace(/^https?:\/\/[^/]+/, '');
    const { data: existingByUrl } = await supabase
      .from("vehicles")
      .select("id")
      .ilike("discovery_url", `%${urlPath}%`)
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

    // Upsert images - use same attribution pattern as BaT extractor to satisfy vehicle_images_attribution_check
    let imagesInserted = 0;
    let imageInsertError: string | null = null;
    if (vehicleId && extracted.images.length > 0) {
      const nowIso = new Date().toISOString();
      // NOTE: Do NOT include user_id field - omitting it allows the constraint to pass
      // The attribution check requires either user_id OR (source='*_import' with specific fields)
      const imageRows = extracted.images.slice(0, 50).map((url, idx) => ({
        vehicle_id: vehicleId,
        image_url: url,
        source: "external_import", // Use external_import source to satisfy attribution check (cab_import not whitelisted)
        source_url: url,
        is_external: true,
        approval_status: "auto_approved",
        is_approved: true,
        redaction_level: "none",
        position: idx,
        display_order: idx,
        is_primary: idx === 0,
        exif_data: {
          source_url: listingUrlCanonical,
          discovery_url: listingUrlCanonical,
          imported_from: "cars_and_bids",
        },
      }));

      // Delete existing cab_import images first to avoid duplicates
      await supabase
        .from("vehicle_images")
        .delete()
        .eq("vehicle_id", vehicleId)
        .eq("source", "external_import");

      console.log(`✅ C&B: Attempting to insert ${imageRows.length} images for vehicle ${vehicleId}`);
      console.log(`✅ C&B: First image row: ${JSON.stringify(imageRows[0])}`);

      const { data: insertedImages, error: imgError } = await supabase
        .from("vehicle_images")
        .insert(imageRows)
        .select("id");

      if (imgError) {
        console.error(`⚠️ C&B: Image insert failed: ${imgError.message}`);
        console.error(`⚠️ C&B: Image insert error code: ${imgError.code}`);
        console.error(`⚠️ C&B: Image insert error details: ${imgError.details}`);
        console.error(`⚠️ C&B: Image insert error hint: ${imgError.hint}`);
        imageInsertError = `${imgError.code || 'ERROR'}: ${imgError.message}`;
        // Don't fail the entire operation - log error in response
      } else {
        imagesInserted = insertedImages?.length || imageRows.length;
        console.log(`✅ C&B: Successfully inserted ${imagesInserted} images`);
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

    // Link to Cars & Bids organization
    if (vehicleId) {
      const relationshipType = extracted.auctionStatus === 'sold' ? 'sold_by' : 'consigner';
      const { error: orgLinkError } = await supabase
        .from('organization_vehicles')
        .upsert({
          organization_id: CARS_AND_BIDS_ORG_ID,
          vehicle_id: vehicleId,
          relationship_type: relationshipType,
          status: 'active',
          auto_tagged: true,
          notes: `Imported from Cars & Bids: ${listingUrlCanonical}`
        }, {
          onConflict: 'organization_id,vehicle_id,relationship_type'
        });

      if (orgLinkError) {
        console.warn(`⚠️ C&B: Org link failed: ${orgLinkError.message}`);
      } else {
        console.log(`✅ C&B: Linked vehicle to Cars & Bids org`);
      }
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

    // Log success to scraping_health
    await logScrapingHealth({
      supabase,
      url: listingUrlCanonical,
      success: true,
      statusCode: httpStatus,
      responseTimeMs,
      dataExtracted: {
        year: extracted.year,
        make: extracted.make,
        model: extracted.model,
        has_vin: !!extracted.vin,
        has_mileage: !!extracted.mileage,
        images_count: extracted.images.length,
      },
      imagesFound: extracted.images.length,
      hasPrice: !!extracted.currentBid,
    });

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
        interior_color: extracted.interiorColor,
        transmission: extracted.transmission,
        engine: extracted.engine,
        location: extracted.location,
        current_bid: extracted.currentBid,
        images_count: extracted.images.length,
      },
      images_inserted: imagesInserted,
      image_insert_error: imageInsertError,
      timestamp: new Date().toISOString(),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("extract-cars-and-bids-core error:", error);
    // Try to log error to scraping_health
    try {
      const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").trim();
      const serviceRoleKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
      if (supabaseUrl && serviceRoleKey) {
        const supabase = createClient(supabaseUrl, serviceRoleKey);
        const body = await req.clone().json().catch(() => ({}));
        const inputUrl = String(body?.url || body?.listing_url || body?.auction_url || "").trim();
        if (inputUrl) {
          await logScrapingHealth({
            supabase,
            url: inputUrl,
            success: false,
            errorMessage: error.message || String(error),
            errorType: error.message?.includes('timeout') ? 'timeout' : 'network',
          });
        }
      }
    } catch (healthError) {
      console.warn('Failed to log error to scraping_health:', healthError);
    }
    return new Response(JSON.stringify({
      success: false,
      error: error.message || String(error),
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
