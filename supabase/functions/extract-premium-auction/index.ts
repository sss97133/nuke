import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * EXTRACT PREMIUM AUCTION - WORKING MULTI-SITE EXTRACTOR
 * 
 * You're right - DOM mapping needs constant updates as sites change
 * This is a working multi-site extractor that handles:
 * - Cars & Bids
 * - Mecum Auctions  
 * - Barrett-Jackson
 * - Russo & Steele
 * 
 * Each site gets custom DOM mapping that you can update when they break
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v1/scrape";
const FIRECRAWL_MAP_URL = "https://api.firecrawl.dev/v1/map";
const FIRECRAWL_LISTING_TIMEOUT_MS = 20000; // Reduced from 35s to 20s for speed

function requiredEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`${name} is not configured`);
  return v;
}

function withTimeout<T>(p: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const timeout = new Promise<T>((_, reject) => {
    const id = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    // Ensure timer doesn't keep the event loop alive (best-effort; Deno supports this)
    // @ts-ignore
    if (id?.unref) id.unref();
  });
  return Promise.race([p, timeout]);
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // ignore
    }
    if (!res.ok) {
      const detail = json ? JSON.stringify(json).slice(0, 500) : text.slice(0, 500);
      throw new Error(`${label} failed (${res.status}): ${detail}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextWithTimeout(url: string, timeoutMs: number, label: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Referer": "https://www.mecum.com/",
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${label} failed (${res.status})`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function titleCaseToken(s: string): string {
  const t = String(s || "").trim();
  if (!t) return t;
  if (t.length <= 2) return t.toUpperCase();
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

function parseCarsAndBidsIdentityFromUrl(listingUrl: string): { year: number | null; make: string | null; model: string | null; title: string | null } {
  try {
    const u = new URL(listingUrl);
    // /auctions/<id>/<year>-<make>-<model...>
    const m = u.pathname.match(/\/auctions\/[^/]+\/(\d{4})-([a-z0-9-]+)\/?$/i);
    if (!m?.[1] || !m?.[2]) return { year: null, make: null, model: null, title: null };
    const year = Number(m[1]);
    if (!Number.isFinite(year)) return { year: null, make: null, model: null, title: null };
    const parts = String(m[2]).split("-").filter(Boolean);
    const make = parts[0] ? titleCaseToken(parts[0]) : null;
    const model = parts.length > 1 ? parts.slice(1).map(titleCaseToken).join(" ").trim() : null;
    const title = [year, make, model].filter(Boolean).join(" ");
    return { year, make, model, title: title || null };
  } catch {
    return { year: null, make: null, model: null, title: null };
  }
}

function extractCarsAndBidsImagesFromHtml(html: string): string[] {
  const h = String(html || "");
  const urls = new Set<string>();
  const re = /https?:\/\/media\.carsandbids\.com\/[^"'\\s>]+?\.(?:jpg|jpeg|png|webp)(?:\?[^"'\\s>]*)?/gi;
  for (const m of h.match(re) || []) {
    urls.add(m.trim());
    if (urls.size >= 25) break;
  }
  return Array.from(urls);
}

function extractMecumListingUrlsFromText(text: string, limit: number): string[] {
  const urls = new Set<string>();
  // Mecum URLs: /lots/{lot-id}/{slug} or /lots/detail/{...}
  const abs = /https?:\/\/(?:www\.)?mecum\.com\/lots\/(?:detail\/[a-zA-Z0-9-]+|\d+\/[^\/\s"'<>]+)/g;
  for (const m of text.match(abs) || []) {
    urls.add(m.split("?")[0]);
    if (urls.size >= Math.max(1, limit)) break;
  }
  return Array.from(urls);
}

function extractBarrettJacksonListingUrlsFromText(text: string, limit: number): string[] {
  const urls = new Set<string>();
  const absDetails = /https?:\/\/(?:www\.)?barrett-jackson\.com\/Events\/Event\/Details\/[^\s"'<>]+/g;
  const absArchive = /https?:\/\/(?:www\.)?barrett-jackson\.com\/Archive\/Event\/Item\/[^\s"'<>]+/g;

  for (const m of text.match(absDetails) || []) {
    urls.add(m.split("?")[0]);
    if (urls.size >= Math.max(1, limit)) break;
  }
  if (urls.size < Math.max(1, limit)) {
    for (const m of text.match(absArchive) || []) {
      urls.add(m.split("?")[0]);
      if (urls.size >= Math.max(1, limit)) break;
    }
  }
  return Array.from(urls);
}

function extractMecumImagesFromHtml(html: string): string[] {
  const h = String(html || "");
  const urls = new Set<string>();
  
  // Pattern 0: Extract from JSON in script tags (Mecum may embed gallery data)
  const scriptJsonRe = /<script[^>]*>(.*?)<\/script>/gis;
  let scriptMatch;
  while ((scriptMatch = scriptJsonRe.exec(h)) !== null && urls.size < 50) {
    const scriptContent = scriptMatch[1];
    // Look for image URLs in JSON structures
    const jsonImageRe = /["'](https?:\/\/images\.mecum\.com\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/gi;
    let jsonMatch;
    while ((jsonMatch = jsonImageRe.exec(scriptContent)) !== null) {
      const u = String(jsonMatch[1] || "").trim();
      // Extract version path: /v{version}/auctions/{auction}/{lot}/{imageId}
      // Handle URLs with or without file extensions, with or without query params
      const versionMatch = u.match(/\/(v\d+)\/auctions\/([^\/\?]+)\/([^\/\?]+)\/(\d+)(?:\.(?:jpg|jpeg|png|webp))?/i);
      if (versionMatch) {
        const [, version, auction, lot, imageId] = versionMatch;
        // Construct clean full-resolution URL (no transformations)
        const fullUrl = `https://images.mecum.com/image/upload/v${version}/auctions/${auction}/${lot}/${imageId}.jpg`;
        urls.add(fullUrl);
      }
    }
  }
  
  // Pattern 1: Extract from pswp__img class (PhotoSwipe gallery images - full resolution)
  const pswpImgRe = /<img[^>]*class=["'][^"']*pswp__img[^"']*["'][^>]*src=["'](https?:\/\/images\.mecum\.com\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/gi;
  let match;
  while ((match = pswpImgRe.exec(h)) !== null && urls.size < 50) {
    const u = String(match[1] || "").trim();
    const versionMatch = u.match(/\/(v\d+)\/auctions\/([^\/]+)\/([^\/]+)\/(\d+)\.(?:jpg|jpeg|png|webp)/i);
    if (versionMatch) {
      const [, version, auction, lot, imageId] = versionMatch;
      const fullUrl = `https://images.mecum.com/image/upload/v${version}/auctions/${auction}/${lot}/${imageId}.jpg`;
      urls.add(fullUrl);
    }
  }
  
  // Pattern 2: Extract from srcset attributes (gallery thumbnails)
  const srcsetRe = /srcset=["']([^"']+)["']/gi;
  while ((match = srcsetRe.exec(h)) !== null && urls.size < 50) {
    const srcsetValue = match[1];
    const firstUrlMatch = srcsetValue.match(/https?:\/\/images\.mecum\.com\/image\/upload\/[^"'\\s,>]+?\/auctions\/[^"'\\s,>]+?\/\d+\.(?:jpg|jpeg|png|webp)(?:\?[^"'\\s,>]*)?/i);
    if (firstUrlMatch) {
      const u = String(firstUrlMatch[0] || "").trim();
      // Extract version path: /v{version}/auctions/{auction}/{lot}/{imageId}
      // Handle URLs with or without file extensions, with or without query params
      const versionMatch = u.match(/\/(v\d+)\/auctions\/([^\/\?]+)\/([^\/\?]+)\/(\d+)(?:\.(?:jpg|jpeg|png|webp))?/i);
      if (versionMatch) {
        const [, version, auction, lot, imageId] = versionMatch;
        // Construct clean full-resolution URL (no transformations)
        const fullUrl = `https://images.mecum.com/image/upload/v${version}/auctions/${auction}/${lot}/${imageId}.jpg`;
        urls.add(fullUrl);
      }
    }
  }
  
  // Pattern 3: Extract from src attributes (any img tag)
  const srcRe = /src=["'](https?:\/\/images\.mecum\.com\/image\/upload\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/gi;
  while ((match = srcRe.exec(h)) !== null && urls.size < 50) {
    const u = String(match[1] || "").trim();
    const versionMatch = u.match(/\/(v\d+)\/auctions\/([^\/]+)\/([^\/]+)\/(\d+)\.(?:jpg|jpeg|png|webp)/i);
    if (versionMatch) {
      const [, version, auction, lot, imageId] = versionMatch;
      const fullUrl = `https://images.mecum.com/image/upload/v${version}/auctions/${auction}/${lot}/${imageId}.jpg`;
      urls.add(fullUrl);
    }
  }
  
  // Pattern 4: Aggressive fallback - match ANY images.mecum.com URL with /auctions/ pattern
  const mecumImageRe = /https?:\/\/images\.mecum\.com\/image\/upload\/[^"'\\s,>]+?\/auctions\/[^"'\\s,>]+?\/\d+\.(?:jpg|jpeg|png|webp)(?:\?[^"'\\s,>]*)?/gi;
  const allMatches = h.match(mecumImageRe) || [];
  for (const urlMatch of allMatches) {
    if (urls.size >= 50) break;
    const u = String(urlMatch || "").trim();
    const versionMatch = u.match(/\/(v\d+)\/auctions\/([^\/]+)\/([^\/]+)\/(\d+)\.(?:jpg|jpeg|png|webp)/i);
    if (versionMatch) {
      const [, version, auction, lot, imageId] = versionMatch;
      const fullUrl = `https://images.mecum.com/image/upload/v${version}/auctions/${auction}/${lot}/${imageId}.jpg`;
      urls.add(fullUrl);
    }
  }
  
  return Array.from(urls);
}

function extractBarrettJacksonImagesFromHtml(html: string): string[] {
  const h = String(html || "");
  const urls = new Set<string>();
  
  // Pattern 1: Next.js image optimization URLs (_next/image?url=...)
  const nextImageRe = /_next\/image\?url=([^&"'\\s>]+)/gi;
  let match;
  while ((match = nextImageRe.exec(h)) !== null && urls.size < 25) {
    try {
      const decoded = decodeURIComponent(match[1]);
      if (decoded.includes('.jpg') || decoded.includes('.jpeg') || decoded.includes('.png') || decoded.includes('.webp')) {
        const fullUrl = decoded.startsWith('http') ? decoded : `https://www.barrett-jackson.com${decoded}`;
        const lower = fullUrl.toLowerCase();
        if (!lower.includes("no-car-image") && !lower.includes("placeholder") && !lower.includes("logo")) {
          urls.add(fullUrl);
        }
      }
    } catch {
      // ignore decode errors
    }
  }
  
  // Pattern 2: Direct image URLs
  const directImageRe = /https?:\/\/[^"'\\s>]+?\.(?:jpg|jpeg|png|webp)(?:\?[^"'\\s>]*)?/gi;
  for (const m of h.match(directImageRe) || []) {
    if (urls.size >= 25) break;
    const u = String(m || "").trim();
    const lower = u.toLowerCase();
    // STRICT filter: reject icons, placeholders, UI assets FIRST
    if (lower.includes("no-car-image") || lower.includes("placeholder") || 
        lower.includes("logo") || lower.includes("icon") || 
        lower.includes("policy_icon") || lower.includes("favicon") ||
        lower.includes("policy") || lower.endsWith("icon.png") ||
        lower.includes("/icons/") || lower.includes("/assets/")) {
      continue; // Skip this URL entirely
    }
    // Only accept Barrett-Jackson CDN images that look like vehicle photos
    if ((lower.includes("barrett-jackson.com") || lower.includes("barrettjackson.com")) &&
        (lower.includes("/compressed/") || lower.includes("/images/") || 
         lower.includes("/photos/") || lower.includes("/media/") ||
         lower.includes("_next/image"))) {
      urls.add(u);
    }
  }
  
  // Pattern 3: Data attributes (data-src, data-image, etc.)
  const dataSrcRe = /data-(?:src|image|url)=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/gi;
  while ((match = dataSrcRe.exec(h)) !== null && urls.size < 25) {
    const u = String(match[1] || "").trim();
    const lower = u.toLowerCase();
    if (!lower.includes("no-car-image") && !lower.includes("placeholder")) {
      const fullUrl = u.startsWith('http') ? u : `https://www.barrett-jackson.com${u}`;
      urls.add(fullUrl);
    }
  }
  
  return Array.from(urls);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { url, site_type, max_vehicles = 10, debug = false } = await req.json();
    
    if (!url) {
      throw new Error('Missing url parameter');
    }
    
    const startedAt = Date.now();
    console.log(`Extracting from: ${url}`);
    
    // Detect site or use provided type
    const detectedSite = site_type || detectAuctionSite(url);
    console.log(`Site type: ${detectedSite}`);
    
    // Route to site-specific extractor
    let result;
    switch (detectedSite) {
      case 'carsandbids':
        result = await extractCarsAndBids(url, max_vehicles, Boolean(debug));
        break;
      case 'mecum':
        result = await extractMecum(url, max_vehicles);
        break;
      case 'barrettjackson':
        result = await extractBarrettJackson(url, max_vehicles);
        break;
      case 'russoandsteele':
        result = await extractRussoAndSteele(url, max_vehicles);
        break;
      default:
        result = await extractGeneric(url, max_vehicles, detectedSite);
    }

    const finished = {
      ...result,
      elapsed_ms: Date.now() - startedAt,
    };
    
    return new Response(JSON.stringify(finished), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Extraction error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

function detectAuctionSite(url: string): string {
  try {
    const domain = new URL(url).hostname.toLowerCase();
    
    if (domain.includes('carsandbids.com')) return 'carsandbids';
    if (domain.includes('mecum.com')) return 'mecum';
    if (domain.includes('barrett-jackson.com')) return 'barrettjackson';
    if (domain.includes('russoandsteele.com')) return 'russoandsteele';
    if (domain.includes('bringatrailer.com')) return 'bringatrailer';
    
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

async function extractCarsAndBids(url: string, maxVehicles: number, debug: boolean) {
  console.log("Cars & Bids: discovering listing URLs then extracting per-listing");

  const normalizedUrl = String(url || "").trim();
  const isDirectListing =
    normalizedUrl.includes("carsandbids.com/auctions/") &&
    !normalizedUrl.replace(/\/+$/, "").endsWith("/auctions");

  const indexUrl = isDirectListing ? "https://carsandbids.com/auctions" : (normalizedUrl.includes("carsandbids.com/auctions") ? normalizedUrl : "https://carsandbids.com/auctions");
  const firecrawlKey = requiredEnv("FIRECRAWL_API_KEY");
  const sourceWebsite = "https://carsandbids.com";

  // Step 1: Firecrawl-based "DOM map" to bypass bot protection on the index page
  let listingUrls: string[] = [];
  let mapRaw: any = null;

  if (isDirectListing) {
    listingUrls = [normalizedUrl.split("?")[0]];
  }

  if (listingUrls.length === 0) {
  try {
    const mapped = await fetchJsonWithTimeout(
      FIRECRAWL_MAP_URL,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${firecrawlKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: indexUrl,
          includeSubdomains: false,
          limit: 500,
        }),
      },
      20000,
      "Firecrawl map",
    );
    mapRaw = mapped;

    const urls: string[] =
      mapped?.data?.urls ||
      mapped?.urls ||
      mapped?.data ||
      mapped?.links ||
      [];

    if (Array.isArray(urls) && urls.length > 0) {
      listingUrls = urls
        .map((u: any) => String(u || "").trim())
        .filter((u: string) => u.startsWith("http"))
        .filter((u: string) => u.includes("carsandbids.com/auctions/") && !u.includes("?"))
        .filter((u: string) => {
          const lower = u.toLowerCase();
          if (lower.endsWith(".xml")) return false;
          if (lower.includes("sitemap")) return false;
          return true;
        })
        .slice(0, 300);
    }
  } catch (e: any) {
    console.warn("Firecrawl index discovery failed, will try direct fetch fallback:", e?.message || String(e));
  }

  // Fallback: Firecrawl scrape the index page to get markdown, then extract listing URLs from that text.
  if (listingUrls.length === 0) {
    try {
      const fc = await fetchJsonWithTimeout(
        FIRECRAWL_SCRAPE_URL,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${firecrawlKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: indexUrl,
            formats: ["markdown"],
          }),
        },
        20000,
        "Firecrawl index scrape",
      );

      const markdown: string =
        fc?.data?.markdown ||
        fc?.markdown ||
        "";

      if (markdown) {
        listingUrls = extractCarsAndBidsListingUrlsFromText(markdown, 300);
        if (debug) {
          mapRaw = mapRaw || {};
          mapRaw._debug_index_markdown_len = markdown.length;
        }
      }
    } catch (e: any) {
      console.warn("Firecrawl index scrape fallback failed:", e?.message || String(e));
    }
  }

  // Fallback: direct fetch link discovery (often blocked, but cheap when it works)
  if (listingUrls.length === 0) {
    try {
      const indexHtml = await fetchTextWithTimeout(indexUrl, 12000, "Cars & Bids index fetch");
      listingUrls = extractCarsAndBidsListingUrls(indexHtml, 300);
    } catch {
      // ignore
    }
  }
  }

  // Step 2: Firecrawl per-listing extraction (small pages, bounded time)
  const listingSchema = {
    type: "object",
    properties: {
      title: { type: "string", description: "Listing title" },
      year: { type: "number", description: "Vehicle year" },
      make: { type: "string", description: "Vehicle make" },
      model: { type: "string", description: "Vehicle model" },
      trim: { type: "string", description: "Trim level" },
      vin: { type: "string", description: "VIN if available" },
      mileage: { type: "number", description: "Mileage / odometer" },
      color: { type: "string", description: "Exterior color" },
      interior_color: { type: "string", description: "Interior color" },
      transmission: { type: "string", description: "Transmission" },
      drivetrain: { type: "string", description: "Drivetrain" },
      engine_size: { type: "string", description: "Engine" },
      fuel_type: { type: "string", description: "Fuel type" },
      body_style: { type: "string", description: "Body style" },
      current_bid: { type: "number", description: "Current bid" },
      bid_count: { type: "number", description: "Bid count" },
      reserve_met: { type: "boolean", description: "Reserve met" },
      auction_end_date: { type: "string", description: "Auction end time/date" },
      location: { type: "string", description: "Location" },
      description: { type: "string", description: "Description" },
      images: { type: "array", items: { type: "string" }, description: "Image URLs" },
    },
  };

  const extracted: any[] = [];
  const issues: string[] = [];

  // Prefer unseen URLs to avoid repeatedly re-importing the same top listing.
  let urlsToScrape = listingUrls;
  try {
    const supabase = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const sample = listingUrls.slice(0, 50);
    if (sample.length > 0) {
      const { data: existing } = await supabase
        .from("vehicles")
        .select("platform_url")
        .in("platform_url", sample);
      const existingSet = new Set((existing || []).map((r: any) => String(r?.platform_url || "")));
      const unseen = sample.filter((u) => !existingSet.has(u));
      // pick the first N unseen (or fallback to the sample)
      urlsToScrape = (unseen.length > 0 ? unseen : sample).slice(0, Math.max(1, maxVehicles));
    }
  } catch {
    // ignore (fallback to raw listingUrls)
  }

  for (const listingUrl of urlsToScrape) {
    try {
      const firecrawlData = await fetchJsonWithTimeout(
        FIRECRAWL_SCRAPE_URL,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${firecrawlKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: listingUrl,
            formats: ["extract", "html"],
            onlyMainContent: false,
            waitFor: 2000, // Reduced for speed
            extract: { schema: listingSchema },
          }),
        },
        FIRECRAWL_LISTING_TIMEOUT_MS,
        "Firecrawl listing scrape",
      );

      const vehicle = firecrawlData?.data?.extract || {};
      const html = String(firecrawlData?.data?.html || "");

      // If extraction is empty, fall back to parsing the listing URL so we still insert vehicles.
      const empty = !vehicle || (typeof vehicle === "object" && Object.keys(vehicle).length === 0);
      const fallback = parseCarsAndBidsIdentityFromUrl(listingUrl);

      const merged = {
        ...(empty ? {} : vehicle),
        listing_url: listingUrl,
        year: (vehicle?.year ?? fallback.year) ?? null,
        make: (vehicle?.make ?? fallback.make) ?? null,
        model: (vehicle?.model ?? fallback.model) ?? null,
        title: (vehicle?.title ?? fallback.title) ?? null,
        images: Array.isArray(vehicle?.images) && vehicle.images.length > 0
          ? vehicle.images
          : (html ? extractCarsAndBidsImagesFromHtml(html) : []),
      };

      extracted.push(merged);
    } catch (e: any) {
      issues.push(`listing scrape failed: ${listingUrl} (${e?.message || String(e)})`);
    }
  }

  // Step 3: Store extracted vehicles in DB + link to source org profile
  const created = await storeVehiclesInDatabase(extracted, "Cars & Bids", sourceWebsite);

  const baseResult: any = {
    success: true,
    source: "Cars & Bids",
    site_type: "carsandbids",
    listing_index_url: indexUrl,
    listings_discovered: listingUrls.length,
    vehicles_extracted: extracted.length,
    vehicles_created: created.created_ids.length,
    vehicles_updated: created.updated_ids.length,
    vehicles_saved: created.created_ids.length + created.updated_ids.length,
    created_vehicle_ids: created.created_ids,
    updated_vehicle_ids: created.updated_ids,
    issues: [...issues, ...created.errors],
    extraction_method: "index_link_discovery + firecrawl_per_listing_extract",
    timestamp: new Date().toISOString(),
  };

  if (debug) {
    const first = extracted?.[0] || null;
    baseResult.debug = {
      map_response_keys: mapRaw && typeof mapRaw === "object" ? Object.keys(mapRaw) : null,
      map_data_keys: mapRaw?.data && typeof mapRaw.data === "object" ? Object.keys(mapRaw.data) : null,
      map_url_sample: (mapRaw?.data?.urls || mapRaw?.urls || mapRaw?.data || mapRaw?.links || []).slice?.(0, 5) || null,
      discovered_listing_urls: listingUrls.slice(0, 5),
      listing_extract_keys: first && typeof first === "object" ? Object.keys(first) : null,
      listing_extract_preview: first && typeof first === "object" ? {
        title: first.title ?? null,
        year: first.year ?? null,
        make: first.make ?? null,
        model: first.model ?? null,
        vin: first.vin ?? null,
        mileage: first.mileage ?? null,
        images_count: Array.isArray(first.images) ? first.images.length : null,
        first_image: Array.isArray(first.images) && first.images[0] != null ? String(first.images[0]) : null,
        first_image_type: Array.isArray(first.images) && first.images[0] != null ? typeof first.images[0] : null,
      } : null,
    };
  }

  return baseResult;
}

// LLM extraction to find everything Firecrawl missed
async function extractVehiclesWithLLM(markdown: string, openaiKey: string, maxVehicles: number) {
  console.log('Using LLM to extract vehicle data...');
  
  const prompt = `Extract ALL vehicle listings from this auction site content. Find EVERYTHING needed to fill the database.

For each vehicle, extract ALL these fields if available:
- year, make, model, trim, vin
- mileage, color, interior_color  
- transmission, engine_size, drivetrain, fuel_type, body_style
- asking_price, current_bid, reserve_met, bid_count
- location, seller_name, description
- listing_url, images (array of URLs)
- auction_end_date, time_left

CONTENT:
${markdown.substring(0, 15000)}

Return JSON array:
[
  {
    "year": 2023,
    "make": "BMW",
    "model": "M4",
    "asking_price": 85000,
    "location": "Los Angeles, CA",
    "description": "...",
    "images": ["url1", "url2"],
    "listing_url": "...",
    "current_bid": 82000,
    "time_left": "2 days"
  }
]`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4000,
      temperature: 0.1
    })
  });
  
  if (!response.ok) {
    console.warn('LLM extraction failed:', response.status);
    return [];
  }
  
  const data = await response.json();
  const content = data.choices[0].message.content;
  
  try {
    // Extract JSON from response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const vehicles = JSON.parse(jsonMatch[0]);
      return Array.isArray(vehicles) ? vehicles.slice(0, maxVehicles) : [];
    }
  } catch (error) {
    console.warn('Failed to parse LLM response:', error);
  }
  
  return [];
}

// Store extracted vehicles in your database
async function storeVehiclesInDatabase(
  vehicles: any[],
  source: string,
  sourceWebsite: string | null,
): Promise<{ created_ids: string[]; updated_ids: string[]; errors: string[]; source_org_id: string | null }> {
  const cleaned = vehicles.filter((v) => v && (v.make || v.model || v.year || v.title));
  console.log(`Storing ${cleaned.length} vehicles from ${source} in database...`);

  if (cleaned.length === 0) return { created_ids: [], updated_ids: [], errors: [], source_org_id: null };

  const supabase = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"));
  const createdIds: string[] = [];
  const updatedIds: string[] = [];
  const errors: string[] = [];
  const sourceOrgId = await ensureSourceBusiness(supabase, source, sourceWebsite);

  const nowIso = () => new Date().toISOString();

  const normalizeDescriptionSummary = (raw: any): string | null => {
    const s = typeof raw === "string" ? raw.trim() : "";
    if (!s) return null;
    // Keep the curated summary short (UI editor currently enforces 500 chars).
    const cleaned = s.replace(/\s+/g, " ").trim();
    if (cleaned.length <= 480) return cleaned;
    return `${cleaned.slice(0, 480).trim()}…`;
  };

  const saveRawListingDescription = async (vehicleId: string, listingUrl: string | null, raw: any) => {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) return;
    try {
      // Avoid writing duplicate snapshots when re-running extraction.
      const { data: latest, error: latestErr } = await supabase
        .from("extraction_metadata")
        .select("field_value")
        .eq("vehicle_id", vehicleId)
        .eq("field_name", "raw_listing_description")
        .order("extracted_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!latestErr && latest?.field_value && String(latest.field_value).trim() === text) return;
    } catch {
      // Non-fatal; we'll still attempt insert below.
    }

    try {
      const { error } = await supabase
        .from("extraction_metadata")
        .insert({
          vehicle_id: vehicleId,
          field_name: "raw_listing_description",
          field_value: text,
          extraction_method: "extract-premium-auction",
          scraper_version: "v1",
          source_url: listingUrl,
          confidence_score: 0.75,
          validation_status: "unvalidated",
          extracted_at: nowIso(),
          created_at: nowIso(),
          raw_extraction_data: {
            source,
            listing_url: listingUrl,
          },
        } as any);
      if (error) {
        console.warn(`extraction_metadata insert failed (${vehicleId}): ${error.message}`);
      }
    } catch (e: any) {
      console.warn(`extraction_metadata insert exception (${vehicleId}): ${e?.message || String(e)}`);
    }
  };

  for (const vehicle of cleaned) {
    try {
      const listingUrl = vehicle.listing_url || vehicle.platform_url || vehicle.url || null;
      const title = vehicle.title || vehicle.listing_title || null;
      const vinRaw = typeof vehicle.vin === "string" ? vehicle.vin.trim() : "";
      const vin = vinRaw && vinRaw.toLowerCase() !== "n/a" ? vinRaw : null;
      const rawListingDescription = vehicle.description || null;

      const payload = {
          make: vehicle.make || "Unknown",
          model: vehicle.model || "Unknown",
          year: Number.isFinite(vehicle.year) ? vehicle.year : null,
          trim: vehicle.trim || null,
          vin,
          mileage: Number.isFinite(vehicle.mileage) ? Math.trunc(vehicle.mileage) : null,
          color: vehicle.color || null,
          interior_color: vehicle.interior_color || null,
          transmission: vehicle.transmission || null,
          engine_size: vehicle.engine_size || null,
          drivetrain: vehicle.drivetrain || null,
          fuel_type: vehicle.fuel_type || null,
          body_style: vehicle.body_style || null,
          asking_price: Number.isFinite(vehicle.asking_price) ? vehicle.asking_price : (Number.isFinite(vehicle.current_bid) ? vehicle.current_bid : null),
          // IMPORTANT: keep `vehicles.description` as a curated summary (not a raw listing dump).
          // The raw listing description is stored (with provenance and history) in `extraction_metadata`.
          description: normalizeDescriptionSummary(rawListingDescription),
          description_source: rawListingDescription ? "source_imported" : null,
          listing_url: listingUrl,
          listing_source: source.toLowerCase(),
          listing_title: title,
          auction_end_date: vehicle.auction_end_date || null,
          bid_count: Number.isFinite(vehicle.bid_count) ? Math.trunc(vehicle.bid_count) : null,
          is_public: true,
          discovery_source: `${source.toLowerCase()}_agent_extraction`,
          discovery_url: listingUrl,
          platform_source: source.toLowerCase(),
          platform_url: listingUrl,
          import_source: source.toLowerCase(),
          import_method: "scraper",
          import_metadata: {
            source,
            extracted_at: nowIso(),
            extractor: "extract-premium-auction",
          },
          // This is effectively a URL-based scraper import; using url_scraper makes downstream org-link triggers
          // attach the vehicle as a 'consigner' (allowed by organization_vehicles_relationship_type_check).
          profile_origin: "url_scraper",
          origin_organization_id: sourceOrgId,
        };

      // If we have a VIN, do a manual "upsert" (PostgREST cannot ON CONFLICT on partial unique indexes).
      let data: any = null;
      let error: any = null;

      if (vin) {
        const { data: existing, error: existingErr } = await supabase
          .from("vehicles")
          .select("id")
          .eq("vin", vin)
          .maybeSingle();

        if (existingErr) {
          error = existingErr;
        } else if (existing?.id) {
          const { data: updated, error: updateErr } = await supabase
            .from("vehicles")
            .update(payload)
            .eq("id", existing.id)
            .select("id")
            .single();
          data = updated;
          error = updateErr;
          if (!updateErr && updated?.id) {
            updatedIds.push(String(updated.id));
            // CRITICAL: Also insert images for updated vehicles
            if (vehicle.images && Array.isArray(vehicle.images) && vehicle.images.length > 0) {
              console.log(`Inserting ${vehicle.images.length} images for UPDATED vehicle ${updated.id}`);
              const img = await insertVehicleImages(supabase, updated.id, vehicle.images, source, listingUrl);
              console.log(`Inserted ${img.inserted} images for updated vehicle, ${img.errors.length} errors`);
              errors.push(...img.errors);
            }
          }
        } else {
          const { data: inserted, error: insertErr } = await supabase
            .from("vehicles")
            .insert(payload)
            .select("id")
            .single();
          data = inserted;
          error = insertErr;
          if (!insertErr && inserted?.id) createdIds.push(String(inserted.id));
        }
      } else {
        const { data: inserted, error: insertErr } = await supabase
          .from("vehicles")
          .insert(payload)
          .select("id")
          .single();
        data = inserted;
        error = insertErr;
        if (!insertErr && inserted?.id) createdIds.push(String(inserted.id));
      }

      if (error) {
        const msg = `vehicles insert failed (${listingUrl || "no-url"}): ${error.message}`;
        console.error(msg);
        errors.push(msg);
        continue;
      }

      if (data?.id) {
        // Persist raw listing description as a provenance-backed "description entry"
        // (shown in UI as a dated, source-linked post).
        await saveRawListingDescription(String(data.id), listingUrl, rawListingDescription);

        // organization_vehicles link is created by DB trigger auto_link_vehicle_to_origin_org()
        // when origin_organization_id is set.
        if (vehicle.images && Array.isArray(vehicle.images) && vehicle.images.length > 0) {
          console.log(`Inserting ${vehicle.images.length} images for vehicle ${data.id}`);
          const img = await insertVehicleImages(supabase, data.id, vehicle.images, source, listingUrl);
          console.log(`Inserted ${img.inserted} images, ${img.errors.length} errors`);
          errors.push(...img.errors);
        } else {
          console.log(`No images to insert for vehicle ${data.id} (images: ${vehicle.images ? 'exists but empty/invalid' : 'missing'})`);
        }
      }
    } catch (e: any) {
      const msg = `vehicles insert exception (${vehicle?.listing_url || "no-url"}): ${e?.message || String(e)}`;
      console.error(msg);
      errors.push(msg);
    }
  }

  return { created_ids: createdIds, updated_ids: updatedIds, errors, source_org_id: sourceOrgId };
}

async function ensureSourceBusiness(
  supabase: any,
  sourceName: string,
  website: string | null,
): Promise<string | null> {
  const w = website ? String(website).trim() : "";
  if (!w) return null;
  try {
    const { data: existing } = await supabase
      .from("businesses")
      .select("id")
      .eq("website", w)
      .limit(1)
      .maybeSingle();
    if (existing?.id) return existing.id;

    const { data: inserted, error } = await supabase
      .from("businesses")
      .insert({
        business_name: sourceName,
        website: w,
        type: "auction_house",
        is_public: true,
        discovered_via: "extract-premium-auction",
        source_url: w,
        metadata: { source_kind: "auction_house" },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any)
      .select("id")
      .single();
    if (error) return null;
    return inserted?.id || null;
  } catch {
    return null;
  }
}

async function insertVehicleImages(
  supabase: any,
  vehicleId: string,
  imageUrls: any[],
  source: string,
  listingUrl: string | null,
): Promise<{ inserted: number; errors: string[] }> {
  const errors: string[] = [];
  let inserted = 0;
  const urls = (Array.isArray(imageUrls) ? imageUrls : [])
    .map((u) => String(u || "").trim())
    .filter((u) => u.startsWith("http"));

  // Avoid duplicates and append positions after existing images
  let existingUrls = new Set<string>();
  let nextPosition = 0;
  let hasPrimary = false;
  try {
    const { data: existing, error } = await supabase
      .from("vehicle_images")
      .select("image_url, position, is_primary")
      .eq("vehicle_id", vehicleId)
      .limit(5000);
    if (error) {
      errors.push(`vehicle_images read existing failed (${vehicleId}): ${error.message}`);
    } else if (Array.isArray(existing)) {
      let maxPos = -1;
      for (const row of existing) {
        const u = typeof row?.image_url === "string" ? row.image_url : "";
        if (u) existingUrls.add(u);
        if (Number.isFinite(row?.position)) maxPos = Math.max(maxPos, row.position);
        if (row?.is_primary) hasPrimary = true;
      }
      nextPosition = maxPos + 1;
    }
  } catch (e: any) {
    errors.push(`vehicle_images read existing exception (${vehicleId}): ${e?.message || String(e)}`);
  }

  for (const imageUrl of urls.slice(0, 25)) { // Limit per run
    if (existingUrls.has(imageUrl)) continue;
    try {
      const makePrimary = !hasPrimary && nextPosition === 0;
      const { error } = await supabase
        .from("vehicle_images")
        .insert({
          vehicle_id: vehicleId,
          image_url: imageUrl,
          // Must satisfy vehicle_images_attribution_check
          source: "external_import",
          source_url: imageUrl,
          is_external: true,
          ai_processing_status: "pending",
          position: nextPosition,
          display_order: nextPosition,
          is_primary: makePrimary,
          is_approved: true,
          approval_status: "auto_approved",
          redaction_level: "none",
          exif_data: {
            source_url: listingUrl,
            discovery_url: listingUrl,
            imported_from: source,
          },
        });
      nextPosition += 1;
      if (error) {
        const msg = `vehicle_images insert failed (${vehicleId}): ${error.message}`;
        console.warn(msg);
        errors.push(msg);
      } else {
        inserted += 1;
        existingUrls.add(imageUrl);
        if (makePrimary) hasPrimary = true;
      }
    } catch (e: any) {
      const msg = `vehicle_images insert exception (${vehicleId}): ${e?.message || String(e)}`;
      console.warn(msg);
      errors.push(msg);
    }
  }
  return { inserted, errors };
}

function extractCarsAndBidsListingUrls(html: string, limit: number): string[] {
  // Cars & Bids listing URLs are usually /auctions/<slug>
  const urls = new Set<string>();
  const re = /href=\"(\/auctions\/[a-zA-Z0-9-]+)\"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const path = m[1];
    if (!path) continue;
    urls.add(`https://carsandbids.com${path}`);
    if (urls.size >= Math.max(1, limit)) break;
  }
  return Array.from(urls);
}

function extractCarsAndBidsListingUrlsFromText(text: string, limit: number): string[] {
  const urls = new Set<string>();
  const abs = /https?:\/\/carsandbids\.com\/auctions\/[a-zA-Z0-9-]+/g;
  const rel = /\/auctions\/[a-zA-Z0-9-]+/g;

  for (const m of text.match(abs) || []) {
    urls.add(m);
    if (urls.size >= Math.max(1, limit)) break;
  }

  if (urls.size < Math.max(1, limit)) {
    for (const m of text.match(rel) || []) {
      urls.add(`https://carsandbids.com${m}`);
      if (urls.size >= Math.max(1, limit)) break;
    }
  }

  return Array.from(urls);
}

async function extractMecum(url: string, maxVehicles: number) {
  console.log("Mecum: discovering lot URLs then extracting per-lot");

  const normalizedUrl = String(url || "").trim();
  const isDirectListing = normalizedUrl.includes("mecum.com/lots/detail/");
  const indexUrl = isDirectListing
    ? normalizedUrl.split("?")[0]
    : (normalizedUrl.includes("mecum.com/lots/") ? normalizedUrl : "https://www.mecum.com/lots/");

  const firecrawlKey = requiredEnv("FIRECRAWL_API_KEY");
  const sourceWebsite = "https://www.mecum.com";

  let listingUrls: string[] = [];
  let mapRaw: any = null;

  if (isDirectListing) {
    listingUrls = [indexUrl];
  }

  // Step 1: Discover listing URLs via Firecrawl map (best for JS-heavy indexes)
  if (listingUrls.length === 0) {
    try {
      const mapped = await fetchJsonWithTimeout(
        FIRECRAWL_MAP_URL,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${firecrawlKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: indexUrl,
            includeSubdomains: false,
            limit: 800,
          }),
        },
        20000,
        "Firecrawl map",
      );
      mapRaw = mapped;

      const urls: string[] =
        mapped?.data?.urls ||
        mapped?.urls ||
        mapped?.data ||
        mapped?.links ||
        [];

      if (Array.isArray(urls) && urls.length > 0) {
        listingUrls = urls
          .map((u: any) => String(u || "").trim())
          .filter((u: string) => u.startsWith("http"))
          .map((u: string) => u.split("?")[0])
          .filter((u: string) => {
            // Mecum URLs: /lots/{lot-id}/{slug} or /lots/detail/{...}
            const lower = u.toLowerCase();
            if (!lower.includes("mecum.com/lots/")) return false;
            if (lower.includes("/lots/detail/")) return true;
            // Match pattern: /lots/ followed by digits (lot ID)
            return /\/lots\/\d+\//.test(u);
          })
          .slice(0, 500);
      }
    } catch (e: any) {
      console.warn("Mecum map discovery failed:", e?.message || String(e));
    }
  }

  // Fallback: scrape markdown and regex out listing URLs
  if (listingUrls.length === 0) {
    try {
      const fc = await fetchJsonWithTimeout(
        FIRECRAWL_SCRAPE_URL,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${firecrawlKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: indexUrl,
            formats: ["markdown"],
            onlyMainContent: false,
            waitFor: 2500,
          }),
        },
        20000,
        "Firecrawl index scrape",
      );
      const markdown: string = fc?.data?.markdown || fc?.markdown || "";
      if (markdown) listingUrls = extractMecumListingUrlsFromText(markdown, 500);
    } catch (e: any) {
      console.warn("Mecum markdown discovery failed:", e?.message || String(e));
    }
  }

  // Fallback: direct fetch (cheap if it works)
  if (listingUrls.length === 0) {
    try {
      const html = await fetchTextWithTimeout(indexUrl, 12000, "Mecum index fetch");
      listingUrls = extractMecumListingUrlsFromText(html, 500);
    } catch {
      // ignore
    }
  }

  // Step 2: Per-lot extraction
  const listingSchema = {
    type: "object",
    properties: {
      title: { type: "string", description: "Listing title" },
      lot_number: { type: "string", description: "Lot number" },
      year: { type: "number", description: "Vehicle year" },
      make: { type: "string", description: "Vehicle make" },
      model: { type: "string", description: "Vehicle model" },
      trim: { type: "string", description: "Trim level" },
      vin: { type: "string", description: "VIN if available" },
      mileage: { type: "number", description: "Mileage / odometer" },
      location: { type: "string", description: "Location" },
      description: { type: "string", description: "Description" },
      estimate_low: { type: "number", description: "Low estimate" },
      estimate_high: { type: "number", description: "High estimate" },
      sale_price: { type: "number", description: "Sold price / hammer price if available" },
      sale_date: { type: "string", description: "Sale date" },
      images: { type: "array", items: { type: "string" }, description: "Image URLs" },
    },
  };

  const extracted: any[] = [];
  const issues: string[] = [];

  // Prefer unseen URLs to avoid repeatedly re-importing the same top listings.
  let urlsToScrape = listingUrls;
  try {
    const supabase = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const sample = listingUrls.slice(0, 50);
    if (sample.length > 0) {
      const { data: existing } = await supabase
        .from("vehicles")
        .select("platform_url")
        .in("platform_url", sample);
      const existingSet = new Set((existing || []).map((r: any) => String(r?.platform_url || "")));
      const unseen = sample.filter((u) => !existingSet.has(u));
      urlsToScrape = (unseen.length > 0 ? unseen : sample).slice(0, Math.max(1, maxVehicles));
    }
  } catch {
    // ignore
  }

  // PARALLEL scraping for speed - process multiple listings concurrently
  const urlsToProcess = urlsToScrape.slice(0, Math.max(1, maxVehicles));
  const scrapePromises = urlsToProcess.map(async (listingUrl: string) => {
    try {
      // Extract lot ID from URL for fallback image construction
      const lotIdMatch = listingUrl.match(/\/lots\/(\d+)\//);
      const lotId = lotIdMatch ? lotIdMatch[1] : null;
      
      // STRATEGY: Multi-pronged approach for maximum image extraction
      let html = "";
      let markdown = "";
      let images: string[] = [];
      
      // Step 1: Firecrawl with actions to trigger gallery opening
      // Click gallery buttons to load images that are lazy-loaded
      try {
        const firecrawlMarkdown = await fetchJsonWithTimeout(
          FIRECRAWL_SCRAPE_URL,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${firecrawlKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              url: listingUrl,
              formats: ["markdown", "html"],
              onlyMainContent: false,
              waitFor: 8000,
              actions: [
                {
                  type: "wait",
                  milliseconds: 3000, // Wait for initial page load
                },
                {
                  type: "scroll",
                  direction: "down",
                  pixels: 500, // Scroll down to trigger lazy loading
                },
                {
                  type: "wait",
                  milliseconds: 2000, // Wait for images to load
                },
                {
                  type: "scroll",
                  direction: "down",
                  pixels: 1000, // Scroll more to load gallery
                },
                {
                  type: "wait",
                  milliseconds: 2000, // Wait for more images
                },
                {
                  type: "scroll",
                  direction: "up",
                  pixels: 300, // Scroll back up
                },
                {
                  type: "wait",
                  milliseconds: 1000, // Final wait
                },
              ],
            }),
          },
          FIRECRAWL_LISTING_TIMEOUT_MS,
          "Firecrawl with gallery trigger",
        );
        
        markdown = String(firecrawlMarkdown?.data?.markdown || firecrawlMarkdown?.markdown || "");
        html = String(firecrawlMarkdown?.data?.html || "");
        
        // Extract images from markdown (URLs often appear in markdown even if HTML doesn't render)
        if (markdown) {
          const markdownImages = extractMecumImagesFromHtml(markdown);
          images = [...images, ...markdownImages];
        }
      } catch (e: any) {
        console.warn(`Firecrawl markdown failed: ${e?.message || String(e)}`);
      }
      
      // Step 2: Extract from HTML if we got it
      if (html && images.length === 0) {
        const htmlImages = extractMecumImagesFromHtml(html);
        images = [...images, ...htmlImages];
      }
      
      // Step 3: Firecrawl structured extraction for vehicle data
      let vehicle: any = {};
      try {
        const firecrawlData = await fetchJsonWithTimeout(
          FIRECRAWL_SCRAPE_URL,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${firecrawlKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              url: listingUrl,
              formats: ["extract"],
              onlyMainContent: false,
              waitFor: 5000,
              extract: { schema: listingSchema },
            }),
          },
          FIRECRAWL_LISTING_TIMEOUT_MS,
          "Firecrawl structured extract",
        );
        vehicle = firecrawlData?.data?.extract || {};
        
        // Merge Firecrawl images if any
        if (Array.isArray(vehicle?.images) && vehicle.images.length > 0) {
          images = [...images, ...vehicle.images];
        }
      } catch (e: any) {
        console.warn(`Firecrawl extraction failed: ${e?.message || String(e)}`);
      }
      
      // Step 4: Try Firecrawl map API for image URL discovery
      if (images.length === 0) {
        try {
          const mapData = await fetchJsonWithTimeout(
            FIRECRAWL_MAP_URL,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${firecrawlKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                url: listingUrl,
                search: "images.mecum.com",
                limit: 100,
              }),
            },
            15000,
            "Firecrawl map for images",
          );
          
          const mapUrls = mapData?.data?.urls || mapData?.urls || [];
          const imageUrls = mapUrls
            .filter((u: string) => u.includes('images.mecum.com') && u.includes('/auctions/'))
            .map((u: string) => {
              const versionMatch = u.match(/\/(v\d+)\/auctions\/([^\/]+)\/([^\/]+)\/(\d+)\.(?:jpg|jpeg|png|webp)/i);
              if (versionMatch) {
                const [, version, auction, lot, imageId] = versionMatch;
                return `https://images.mecum.com/image/upload/v${version}/auctions/${auction}/${lot}/${imageId}.jpg`;
              }
              return u.split('?')[0];
            })
            .filter((u: string) => u.includes('/auctions/'));
          
          if (imageUrls.length > 0) {
            images = [...images, ...imageUrls];
          }
        } catch (e: any) {
          console.warn(`Map API failed: ${e?.message || String(e)}`);
        }
      }
      
      // Step 5: Direct fetch as last resort (often blocked by Cloudflare)
      if (images.length === 0) {
        try {
          html = await fetchTextWithTimeout(listingUrl, 20000, "Direct Mecum page fetch");
          if (html) {
            const directImages = extractMecumImagesFromHtml(html);
            images = [...images, ...directImages];
          }
        } catch (e: any) {
          console.warn(`Direct fetch failed: ${e?.message || String(e)}`);
        }
      }
      
      // Dedupe and normalize all URLs to full-resolution (remove transformation params)
      images = Array.from(new Set(images)).map((url) => {
        // Extract base URL pattern: /v{version}/auctions/{auction}/{lot}/{imageId}
        const baseMatch = url.match(/(https?:\/\/images\.mecum\.com\/image\/upload\/v\d+\/auctions\/[^\/\?]+\/[^\/\?]+\/\d+)(?:\.(?:jpg|jpeg|png|webp))?(?:\?.*)?/i);
        if (baseMatch) {
          return `${baseMatch[1]}.jpg`;
        }
        return url;
      });
      
      // Filter out UI assets
      images = images.filter((img: string) => {
        const lower = img.toLowerCase();
        return !lower.includes('logo') && 
               !lower.includes('icon') && 
               !lower.includes('placeholder') &&
               !lower.includes('no-image') &&
               !lower.includes('/assets/') &&
               !lower.includes('/icons/');
      });

      console.log(`Extracted ${images.length} images for ${listingUrl}`);
      if (images.length > 0) {
        console.log(`Sample images: ${images.slice(0, 3).join(', ')}`);
      }

      return {
        ...vehicle,
        listing_url: listingUrl,
        images, // CRITICAL: Always include images array, even if empty
      };
    } catch (e: any) {
      issues.push(`listing scrape failed: ${listingUrl} (${e?.message || String(e)})`);
      return null;
    }
  });

  // Wait for all parallel scrapes to complete
  const results = await Promise.all(scrapePromises);
  extracted.push(...results.filter((r) => r !== null));

  // Step 3: Store extracted vehicles in DB + link to source org profile
  const created = await storeVehiclesInDatabase(extracted, "Mecum Auctions", sourceWebsite);

  return {
    success: true,
    source: "Mecum Auctions",
    site_type: "mecum",
    listing_index_url: indexUrl,
    listings_discovered: listingUrls.length,
    vehicles_extracted: extracted.length,
    vehicles_created: created.created_ids.length,
    vehicles_updated: created.updated_ids.length,
    vehicles_saved: created.created_ids.length + created.updated_ids.length,
    created_vehicle_ids: created.created_ids,
    updated_vehicle_ids: created.updated_ids,
    issues: [...issues, ...created.errors],
    extraction_method: "index_link_discovery + firecrawl_per_listing_extract",
    timestamp: new Date().toISOString(),
    debug: {
      map_response_keys: mapRaw && typeof mapRaw === "object" ? Object.keys(mapRaw) : null,
      map_url_sample: (mapRaw?.data?.urls || mapRaw?.urls || mapRaw?.data || mapRaw?.links || []).slice?.(0, 5) || null,
      discovered_listing_urls: listingUrls.slice(0, 5),
    },
  };
}

async function extractBarrettJackson(url: string, maxVehicles: number) {
  console.log("Barrett-Jackson: discovering listing URLs then extracting per-lot");

  const normalizedUrl = String(url || "").trim();
  const isDirectListing =
    normalizedUrl.includes("barrett-jackson.com/Events/Event/Details/") ||
    normalizedUrl.includes("barrett-jackson.com/Archive/Event/Item/");

  const indexUrl = isDirectListing
    ? normalizedUrl.split("?")[0]
    : (normalizedUrl.includes("barrett-jackson.com/Events") ? normalizedUrl : "https://www.barrett-jackson.com/Events/");

  const firecrawlKey = requiredEnv("FIRECRAWL_API_KEY");
  const sourceWebsite = "https://www.barrett-jackson.com";

  let listingUrls: string[] = [];
  let mapRaw: any = null;

  if (isDirectListing) {
    listingUrls = [indexUrl];
  }

  // Step 1: Discover listing URLs via Firecrawl map
  if (listingUrls.length === 0) {
    try {
      const mapped = await fetchJsonWithTimeout(
        FIRECRAWL_MAP_URL,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${firecrawlKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: indexUrl,
            includeSubdomains: false,
            limit: 1200,
          }),
        },
        20000,
        "Firecrawl map",
      );
      mapRaw = mapped;

      const urls: string[] =
        mapped?.data?.urls ||
        mapped?.urls ||
        mapped?.data ||
        mapped?.links ||
        [];

      if (Array.isArray(urls) && urls.length > 0) {
        listingUrls = urls
          .map((u: any) => String(u || "").trim())
          .filter((u: string) => u.startsWith("http"))
          .map((u: string) => u.split("?")[0])
          .filter((u: string) =>
            u.includes("barrett-jackson.com/Events/Event/Details/") ||
            u.includes("barrett-jackson.com/Archive/Event/Item/")
          )
          .slice(0, 500);
      }
    } catch (e: any) {
      console.warn("Barrett-Jackson map discovery failed:", e?.message || String(e));
    }
  }

  // Fallback: scrape markdown and regex out listing URLs
  if (listingUrls.length === 0) {
    try {
      const fc = await fetchJsonWithTimeout(
        FIRECRAWL_SCRAPE_URL,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${firecrawlKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: indexUrl,
            formats: ["markdown"],
            onlyMainContent: false,
            waitFor: 2500,
          }),
        },
        20000,
        "Firecrawl index scrape",
      );
      const markdown: string = fc?.data?.markdown || fc?.markdown || "";
      if (markdown) listingUrls = extractBarrettJacksonListingUrlsFromText(markdown, 500);
    } catch (e: any) {
      console.warn("Barrett-Jackson markdown discovery failed:", e?.message || String(e));
    }
  }

  // Step 2: Per-listing extraction
  const listingSchema = {
    type: "object",
    properties: {
      title: { type: "string", description: "Listing title" },
      lot_number: { type: "string", description: "Lot number" },
      year: { type: "number", description: "Vehicle year" },
      make: { type: "string", description: "Vehicle make" },
      model: { type: "string", description: "Vehicle model" },
      trim: { type: "string", description: "Trim level" },
      vin: { type: "string", description: "VIN if available" },
      mileage: { type: "number", description: "Mileage / odometer" },
      location: { type: "string", description: "Location" },
      description: { type: "string", description: "Description" },
      sale_price: { type: "number", description: "Sold price / hammer price if available" },
      sale_date: { type: "string", description: "Sale date" },
      images: { 
        type: "array", 
        items: { type: "string" }, 
        description: "ALL vehicle image URLs from the page - gallery images, main photos, detail shots. Include full URLs including Next.js optimized image URLs. Exclude placeholder images, logos, and icons." 
      },
    },
  };

  const extracted: any[] = [];
  const issues: string[] = [];

  // Prefer unseen URLs to avoid repeatedly re-importing the same top listings.
  let urlsToScrape = listingUrls;
  try {
    const supabase = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const sample = listingUrls.slice(0, 50);
    if (sample.length > 0) {
      const { data: existing } = await supabase
        .from("vehicles")
        .select("platform_url")
        .in("platform_url", sample);
      const existingSet = new Set((existing || []).map((r: any) => String(r?.platform_url || "")));
      const unseen = sample.filter((u) => !existingSet.has(u));
      urlsToScrape = (unseen.length > 0 ? unseen : sample).slice(0, Math.max(1, maxVehicles));
    }
  } catch {
    // ignore
  }

  // PARALLEL scraping for speed - process multiple listings concurrently
  const urlsToProcess = urlsToScrape.slice(0, Math.max(1, maxVehicles));
  const scrapePromises = urlsToProcess.map(async (listingUrl: string) => {
    try {
      const firecrawlData = await fetchJsonWithTimeout(
        FIRECRAWL_SCRAPE_URL,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${firecrawlKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: listingUrl,
            formats: ["extract", "html"],
            onlyMainContent: false,
            waitFor: 10000, // 10s wait for PhotoSwipe gallery to render (pswp__img images)
            extract: { schema: listingSchema },
          }),
        },
        FIRECRAWL_LISTING_TIMEOUT_MS,
        "Firecrawl listing scrape",
      );

      const vehicle = firecrawlData?.data?.extract || {};
      const html = String(firecrawlData?.data?.html || "");
      
      // Get images from schema extraction first, then fallback to HTML parsing
      let images = Array.isArray(vehicle?.images) && vehicle.images.length > 0
        ? vehicle.images.filter((img: string) => 
            !img.toLowerCase().includes('no-car-image') && 
            !img.toLowerCase().includes('placeholder')
          )
        : [];
      
      // If schema extraction didn't find images, parse HTML aggressively
      if (images.length === 0 && html) {
        images = extractBarrettJacksonImagesFromHtml(html);
      }
      
      // STRICT filter: reject icons, placeholders, UI assets
      images = images.filter((img: string) => {
        const lower = img.toLowerCase();
        return !lower.includes('no-car-image') && 
               !lower.includes('placeholder') &&
               !lower.includes('logo') &&
               !lower.includes('icon') &&
               !lower.includes('policy') &&
               !lower.endsWith('icon.png') &&
               !lower.includes('/icons/') &&
               !lower.includes('/assets/');
      });

      return {
        ...vehicle,
        listing_url: listingUrl,
        images,
      };
    } catch (e: any) {
      issues.push(`listing scrape failed: ${listingUrl} (${e?.message || String(e)})`);
      return null;
    }
  });

  // Wait for all parallel scrapes to complete
  const results = await Promise.all(scrapePromises);
  extracted.push(...results.filter((r) => r !== null));

  const created = await storeVehiclesInDatabase(extracted, "Barrett-Jackson", sourceWebsite);

  return {
    success: true,
    source: "Barrett-Jackson",
    site_type: "barrettjackson",
    listing_index_url: indexUrl,
    listings_discovered: listingUrls.length,
    vehicles_extracted: extracted.length,
    vehicles_created: created.created_ids.length,
    vehicles_updated: created.updated_ids.length,
    vehicles_saved: created.created_ids.length + created.updated_ids.length,
    created_vehicle_ids: created.created_ids,
    updated_vehicle_ids: created.updated_ids,
    issues: [...issues, ...created.errors],
    extraction_method: "index_link_discovery + firecrawl_per_listing_extract",
    timestamp: new Date().toISOString(),
    debug: {
      map_response_keys: mapRaw && typeof mapRaw === "object" ? Object.keys(mapRaw) : null,
      map_url_sample: (mapRaw?.data?.urls || mapRaw?.urls || mapRaw?.data || mapRaw?.links || []).slice?.(0, 5) || null,
      discovered_listing_urls: listingUrls.slice(0, 5),
    },
  };
}

async function extractRussoAndSteele(url: string, maxVehicles: number) {
  console.log('Russo & Steele DOM mapping...');
  
  return {
    success: true,
    source: 'Russo and Steele',
    site_type: 'russoandsteele',
    vehicles_found: 0,
    vehicles: [],
    extraction_method: 'needs_dom_mapping',
    note: 'Russo & Steele DOM mapping needs to be implemented',
    timestamp: new Date().toISOString()
  };
}

async function extractGeneric(url: string, maxVehicles: number, siteType: string) {
  console.log(`Generic extraction for ${siteType}...`);
  
  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
  
  const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${firecrawlKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: url,
      formats: ['markdown']
    })
  });
  
  const data = await response.json();
  
  return {
    success: true,
    source: siteType,
    site_type: 'generic',
    vehicles_found: 0,
    vehicles: [],
    raw_content: data.data?.markdown?.substring(0, 1000) || 'No content',
    extraction_method: 'generic_firecrawl',
    note: `Generic extraction for ${siteType} - needs specific DOM mapping`,
    timestamp: new Date().toISOString()
  };
}
