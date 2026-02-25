/**
 * extract-cars-and-bids-core
 *
 * Precision extractor for Cars & Bids listings.
 *
 * Strategy:
 * 1. Check listing_page_snapshots cache first — zero API cost for previously fetched pages
 * 2. On cache miss, fetch via Firecrawl (C&B is a React SPA, requires JS rendering)
 * 3. Parse rendered HTML directly against known DOM structure — no LLM, no markdown parsing
 *
 * DOM map (live inspection 2026-02):
 * - ld+json Product schema: year, make, model, VIN, price, hero image (server-rendered for SEO)
 * - og:title / page <title>: mileage, transmission, VIN fallback
 * - dl > dt/dd pairs: Make, Model, Mileage, VIN, Engine, Transmission, Body Style,
 *                     Exterior Color, Interior Color, Location, Seller, Seller Type
 * - #auction-stats-meta / .bid-stats: bid count, end date, views
 * - .detail-* sections: Doug's Take (.dougs-take), Highlights, Equipment, etc.
 * - media.carsandbids.com CDN URLs: gallery images (width=2080 = full size)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeListingUrlKey } from "../_shared/listingUrl.ts";
import { firecrawlScrape } from "../_shared/firecrawl.ts";
import { normalizeVehicleFields } from "../_shared/normalizeVehicle.ts";

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
  bodyStyle: string | null;
  commentCount: number | null;
  bidCount: number | null;
}

/**
 * Parse C&B listing HTML directly against known DOM structure.
 * No LLM, no markdown — reads server-rendered HTML using known selectors.
 *
 * Priority order per field:
 *   1. ld+json Product schema (most reliable — server-rendered for SEO)
 *   2. og:title (mileage) / page <title> (VIN fallback)
 *   3. dt/dd pairs (all vehicle facts)
 *   4. Auction stat elements (.bid-value, .bid-icon, .num-comments)
 *   5. Detail sections (.dougs-take, .detail-highlights, .detail-equipment)
 *   6. CDN image URLs (media.carsandbids.com)
 */
function parseCabHtml(html: string, sourceUrl?: string): CabExtractedData {
  const result: CabExtractedData = {
    vin: null, mileage: null, title: null, year: null, make: null, model: null,
    images: [], engine: null, transmission: null, exteriorColor: null, interiorColor: null,
    location: null, currentBid: null, endDate: null, auctionStatus: null, sellerId: null,
    sellerName: null, description: null, lotNumber: null, bodyStyle: null,
    dougsTake: null, highlights: null, equipment: null, commentCount: null, bidCount: null,
  };

  try {
    // 1. ld+json Product schema (server-rendered for SEO — most reliable)
    for (const match of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        const schema = JSON.parse(match[1]);
        const items: any[] = Array.isArray(schema['@graph']) ? schema['@graph'] : [schema];
        for (const item of items) {
          const type = item['@type'];
          if (type === 'Product' || type === 'Car' || type === 'Vehicle') {
            if (!result.year && item.vehicleModelDate) result.year = parseInt(item.vehicleModelDate, 10);
            if (!result.make && item.brand?.name) result.make = item.brand.name;
            if (!result.model && item.name) {
              // Strip "2016 Porsche " prefix from Product name if present
              const m = item.name.match(/^\d{4}\s+\S+\s+(.+)$/);
              result.model = m ? m[1] : item.name;
            }
            if (!result.vin && item.vehicleIdentificationNumber) {
              result.vin = item.vehicleIdentificationNumber.toUpperCase();
            }
            if (!result.currentBid && item.offers?.price) {
              const p = parseInt(String(item.offers.price).replace(/[^0-9]/g, ''), 10);
              if (p > 0) result.currentBid = p;
            }
            // Hero image from schema
            const img = Array.isArray(item.image) ? item.image[0] : item.image;
            if (typeof img === 'string' && img.includes('carsandbids')) result.images.push(img);
          }
        }
      } catch { /* skip malformed ld+json */ }
    }
    if (result.year) console.log(`✅ C&B [ld+json]: ${result.year} ${result.make} ${result.model}, VIN=${result.vin}`);

    // 2. og:title — extract mileage (and year/make/model as fallback)
    // Format: "2016 Porsche Boxster Spyder - ~21,000 Miles, 6-Speed Manual, Silver"
    const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
                         html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
    if (ogTitleMatch) {
      const ogTitle = ogTitleMatch[1];
      if (!result.year || !result.make) {
        const ymm = ogTitle.match(/^(\d{4})\s+(\S+)\s+([^-]+)/);
        if (ymm) {
          result.year = parseInt(ymm[1], 10);
          result.make = ymm[2].trim();
          result.model = ymm[3].trim();
        }
      }
      if (!result.mileage) {
        const mi = ogTitle.match(/~?([\d,]+)\s*Miles/i);
        if (mi) result.mileage = parseInt(mi[1].replace(/,/g, ''), 10) || null;
      }
    }

    // Build title
    if (result.year && result.make && result.model) {
      result.title = `${result.year} ${result.make} ${result.model}`;
    }

    // 3. <title> tag — VIN fallback ("VIN: XXXXXXXXXXXXXXXXX")
    if (!result.vin) {
      const titleEl = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleEl) {
        const v = titleEl[1].match(/VIN[:\s]+([A-HJ-NPR-Z0-9]{17})/i);
        if (v) result.vin = v[1].toUpperCase();
      }
    }

    // 4. dt/dd pairs — all vehicle facts
    // <dt>Mileage</dt><dd>21,000</dd> — may have whitespace/tags between
    for (const match of html.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi)) {
      const label = match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
      const value = match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (!value || !label) continue;
      switch (label) {
        case 'make': if (!result.make) result.make = value; break;
        case 'model': if (!result.model) result.model = value; break;
        case 'mileage': {
          if (!result.mileage) {
            const m = parseInt(value.replace(/[^0-9]/g, ''), 10);
            if (m > 0) result.mileage = m;
          }
          break;
        }
        case 'vin': if (!result.vin && value.length >= 11) result.vin = value.toUpperCase(); break;
        case 'engine': if (!result.engine) result.engine = value; break;
        case 'transmission': if (!result.transmission) result.transmission = value; break;
        case 'body style': if (!result.bodyStyle) result.bodyStyle = value; break;
        case 'exterior color': if (!result.exteriorColor) result.exteriorColor = value; break;
        case 'interior color': if (!result.interiorColor) result.interiorColor = value; break;
        case 'location': if (!result.location) result.location = value; break;
        case 'seller': if (!result.sellerName) result.sellerName = value; break;
        case 'seller type': {
          if (!result.sellerId) {
            const lv = value.toLowerCase();
            if (lv.includes('dealer')) result.sellerId = 'dealer';
            else if (lv.includes('private')) result.sellerId = 'private';
          }
          break;
        }
      }
    }
    console.log(`✅ C&B [dt/dd]: mileage=${result.mileage}, vin=${result.vin}, engine=${result.engine}, trans=${result.transmission}`);

    // 5. Auction stats
    // Bid value: class="bid-value">$52,000
    if (!result.currentBid) {
      const bidValMatch = html.match(/class=["'][^"']*bid-value[^"']*["'][^>]*>\s*\$?([\d,]+)/i);
      if (bidValMatch) {
        const b = parseInt(bidValMatch[1].replace(/,/g, ''), 10);
        if (b > 0) result.currentBid = b;
      }
    }

    // Auction status
    if (!result.auctionStatus) {
      if (/sold\s+for\s+\$/i.test(html) || /class=["'][^"']*\bsold\b[^"']*["']/i.test(html)) {
        result.auctionStatus = 'sold';
      } else if (/auction\s+ended/i.test(html) || /reserve\s+not\s+met/i.test(html)) {
        result.auctionStatus = 'ended';
      } else {
        result.auctionStatus = 'active';
      }
    }

    // Bid count
    const bidCountMatch = html.match(/class=["'][^"']*bid-icon[^"']*["'][\s\S]{0,200}?(\d+)\s*(?:Bid|bid)/i);
    if (bidCountMatch) result.bidCount = parseInt(bidCountMatch[1], 10) || null;

    // Comment count
    const commentCountMatch = html.match(/num-comments[\s\S]{0,200}?class=["'][^"']*value[^"']*["'][^>]*>\s*(\d+)/i);
    if (commentCountMatch) result.commentCount = parseInt(commentCountMatch[1], 10) || null;

    // End date
    const endDateMatch = html.match(/data-(?:countdown-date|end-date)=["']([^"']+)["']/i) ||
                         html.match(/"endDate"\s*:\s*"([^"]+)"/i);
    if (endDateMatch) {
      try {
        const d = new Date(endDateMatch[1]);
        if (!isNaN(d.getTime())) result.endDate = d.toISOString();
      } catch { /* ignore */ }
    }

    // 6. Detail sections — Doug's Take, Highlights, Equipment
    const sectionDefs: Array<[keyof CabExtractedData, string]> = [
      ['dougsTake', 'dougs-take'],
      ['highlights', 'detail-highlights'],
      ['equipment', 'detail-equipment'],
    ];
    for (const [field, cls] of sectionDefs) {
      const clsRe = new RegExp(
        `class=["'][^"']*${cls}[^"']*["'][\\s\\S]{0,2000}?class=["'][^"']*detail-body[^"']*["'][^>]*>([\\s\\S]*?)<\\/div>`,
        'i'
      );
      const m = html.match(clsRe);
      if (m) {
        (result as any)[field] = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 8000);
      }
    }

    // 7. Gallery images — CDN URLs (skip small thumbnails)
    const seenImages = new Set<string>(result.images.map(u => u.split('?')[0]));
    for (const m of html.matchAll(/https:\/\/media\.carsandbids\.com\/[^"'\s)>]+/gi)) {
      const url = m[0];
      const cleanUrl = url.split('?')[0];
      // Skip thumbnails: width=80, 160, 320 in CDN transform path
      if (/\/cdn-cgi\/image\/[^/]*width=(?:80|160|320)[,/]/.test(url)) continue;
      if (!seenImages.has(cleanUrl)) {
        seenImages.add(cleanUrl);
        result.images.push(url);
      }
    }
    console.log(`✅ C&B [images]: ${result.images.length} found`);

    // 8. Lot number from URL path (/auctions/XXXXXX/)
    const lotSource = sourceUrl || '';
    const lotMatch = lotSource.match(/\/auctions\/([A-Za-z0-9]+)/i) ||
                     html.match(/carsandbids\.com\/auctions\/([A-Za-z0-9]+)/i);
    if (lotMatch) result.lotNumber = lotMatch[1];

    // 9. VIN from plain text patterns (final fallback)
    if (!result.vin) {
      const vinPatterns = [
        /VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i,
        /"vehicleIdentificationNumber"\s*:\s*"([A-HJ-NPR-Z0-9]{17})"/i,
        /data-vin=["']([A-HJ-NPR-Z0-9]{17})["']/i,
      ];
      for (const p of vinPatterns) {
        const v = html.match(p);
        if (v) { result.vin = v[1].toUpperCase(); break; }
      }
    }

    // 10. og:description as description fallback
    const ogDescMatch = html.match(/<meta[^>]*(?:property|name)=["'](?:og:)?description["'][^>]*content=["']([^"']+)["']/i);
    if (ogDescMatch && !result.description) result.description = ogDescMatch[1];

  } catch (e) {
    console.error('⚠️ C&B: Error parsing HTML:', e);
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

    // Cache-first: check listing_page_snapshots before calling Firecrawl
    // A snapshot saved from any prior extraction is reusable indefinitely for re-extraction
    const cacheMaxAgeMs = 7 * 24 * 60 * 60 * 1000; // 7 days
    const { data: cachedSnapshot } = await supabase
      .from('listing_page_snapshots')
      .select('html, fetched_at')
      .eq('listing_url', listingUrlNorm)
      .eq('success', true)
      .gte('fetched_at', new Date(Date.now() - cacheMaxAgeMs).toISOString())
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let html: string;
    let httpStatus: number | null;
    let responseTimeMs: number;
    let fromCache = false;

    if (cachedSnapshot?.html) {
      html = cachedSnapshot.html;
      httpStatus = 200;
      responseTimeMs = 0;
      fromCache = true;
      console.log(`✅ C&B: Cache hit — using snapshot from ${cachedSnapshot.fetched_at} (${html.length} chars)`);
    } else {
      // Cache miss — fetch via Firecrawl (C&B is a React SPA, blocks direct fetch)
      const scrapeStart = Date.now();
      const firecrawlResult = await firecrawlScrape(
        {
          url: listingUrlNorm,
          formats: ['html'],  // HTML only — we parse directly, no markdown needed
          onlyMainContent: false,
          waitFor: 3000,
          actions: [
            { type: 'scroll', direction: 'down', pixels: 2000 },
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
          timeoutMs: 30000,
          maxAttempts: 1,
        }
      );

      html = firecrawlResult.data?.html || '';
      httpStatus = firecrawlResult.httpStatus;
      responseTimeMs = Date.now() - scrapeStart;

      if (!html || html.length < 1000) {
        await trySaveHtmlSnapshot({
          supabase,
          listingUrl: listingUrlNorm,
          httpStatus,
          success: false,
          errorMessage: firecrawlResult.error || "Firecrawl returned insufficient HTML",
          html: html || null,
        });
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

      console.log(`✅ C&B: Firecrawl returned ${html.length} chars of HTML — saving to cache`);

      // Save to cache for zero-cost future extractions
      await trySaveHtmlSnapshot({
        supabase,
        listingUrl: listingUrlNorm,
        httpStatus,
        success: true,
        errorMessage: null,
        html,
      });
    }

    // Parse HTML directly — no LLM, no markdown, no API cost
    const extracted = parseCabHtml(html, listingUrlCanonical);
    console.log(`✅ C&B: Parsed from ${fromCache ? 'cache' : 'live fetch'}`);

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

    // Normalize make/model/transmission before insert
    const norm = normalizeVehicleFields(extracted);
    if (norm.make) extracted.make = norm.make;
    if (norm.model) extracted.model = norm.model;
    if (norm.transmission) extracted.transmission = norm.transmission;

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
      body_style: extracted.bodyStyle,
      // Create rich description from Doug's Take + Highlights
      description: [
        extracted.dougsTake ? `**Doug's Take:**\n${extracted.dougsTake}` : null,
        extracted.highlights ? `**Highlights:**\n${extracted.highlights}` : null,
        extracted.description,
      ].filter(Boolean).join('\n\n') || null,
      location: extracted.location,
      // Only set sale_price if auction actually sold, otherwise set high_bid
      sale_price: extracted.auctionStatus === 'sold' ? extracted.currentBid : null,
      high_bid: extracted.auctionStatus !== 'sold' ? extracted.currentBid : null,
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
        .maybeSingle();

      if (insertError) {
        // Handle duplicate key — vehicle exists but URL lookup missed it
        if (insertError.message?.includes('duplicate key') || insertError.message?.includes('unique constraint')) {
          console.log(`⚠️ C&B: Insert hit duplicate key, trying update by discovery_url`);
          // Try both original and lowercased URLs
          const urlVariants = [listingUrlCanonical, listingUrlCanonical.toLowerCase()];
          let dupVehicle: { id: string } | null = null;
          for (const variant of urlVariants) {
            const { data } = await supabase
              .from("vehicles")
              .select("id")
              .eq("discovery_url", variant)
              .limit(1)
              .maybeSingle();
            if (data?.id) { dupVehicle = data; break; }
          }
          if (dupVehicle?.id) {
            vehicleId = dupVehicle.id;
            await supabase
              .from("vehicles")
              .update({ ...vehicleData, updated_at: new Date().toISOString() })
              .eq("id", vehicleId);
            console.log(`✅ C&B: Updated existing vehicle via fallback: ${vehicleId}`);
          } else {
            throw new Error(`Vehicle insert failed: ${insertError.message}`);
          }
        } else {
          throw new Error(`Vehicle insert failed: ${insertError.message}`);
        }
      } else {
        vehicleId = insertedVehicle!.id;
        created = true;
        console.log(`✅ C&B: Created new vehicle: ${vehicleId}`);
      }
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
      const { error: deleteError } = await supabase
        .from("vehicle_images")
        .delete()
        .eq("vehicle_id", vehicleId)
        .eq("source", "external_import");
      if (deleteError) console.error('Failed to delete from vehicle_images:', deleteError.message);

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
