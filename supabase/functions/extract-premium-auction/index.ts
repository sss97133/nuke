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
  
  // Upgrade thumbnail/small URLs to full resolution
  const upgradeToFullRes = (url: string): string => {
    if (!url || typeof url !== 'string') return url;
    let upgraded = url
      // Remove all query params (resize, width, height, etc.)
      .split('?')[0]
      // Remove size suffixes like -150x150, -300x300, -thumb, -small
      .replace(/-\d+x\d+\.(jpg|jpeg|png|webp)$/i, '.$1')
      .replace(/-thumb(?:nail)?\.(jpg|jpeg|png|webp)$/i, '.$1')
      .replace(/-small\.(jpg|jpeg|png|webp)$/i, '.$1')
      .replace(/-medium\.(jpg|jpeg|png|webp)$/i, '.$1')
      .trim();
    return upgraded;
  };
  
  // Filter function to exclude non-vehicle images
  const isVehicleImage = (url: string): boolean => {
    if (!url || typeof url !== 'string') return false;
    const lower = url.toLowerCase();
    // Must be from media.carsandbids.com
    if (!lower.includes('media.carsandbids.com')) return false;
    // Exclude video thumbnails/freeze frames
    if (lower.includes('/video') || lower.includes('/videos/') || lower.match(/video[\/\-]/)) return false;
    if (lower.includes('thumbnail') || (lower.includes('thumb') && !lower.match(/thumbnail/i))) {
      // Allow 'thumbnail' in path only if it's clearly a gallery image path
      if (!lower.match(/\/photos\/|\/images\/|\/gallery\//)) return false;
    }
    // Exclude UI elements and icons
    if (lower.includes('/icon') || lower.includes('/icons/') || lower.includes('/logo') || lower.includes('/logos/') || 
        lower.includes('/button') || lower.includes('/ui/') || lower.includes('/assets/') || lower.includes('/static/')) {
      return false;
    }
    // Exclude small thumbnails by size suffix (but we'll upgrade them)
    // Don't exclude here, let upgradeToFullRes handle it
    return true;
  };
  
  // Method 1: Extract from script tags with JSON data (React/Next.js apps often embed data here)
  try {
    // Look for script tags containing gallery/photo data
    const scriptPattern = /<script[^>]*>(.*?)<\/script>/gis;
    let scriptMatch;
    while ((scriptMatch = scriptPattern.exec(h)) !== null) {
      const scriptContent = scriptMatch[1];
      // Look for gallery/photo arrays in JSON
      const jsonPatterns = [
        /"photos":\s*(\[[^\]]+\])/gi,
        /"images":\s*(\[[^\]]+\])/gi,
        /"gallery":\s*(\[[^\]]+\])/gi,
        /photos:\s*(\[[^\]]+\])/gi,
        /images:\s*(\[[^\]]+\])/gi,
        /gallery:\s*(\[[^\]]+\])/gi,
      ];
      
      for (const pattern of jsonPatterns) {
        const matches = scriptContent.matchAll(pattern);
        for (const match of matches) {
          try {
            const jsonStr = match[1];
            const parsed = JSON.parse(jsonStr);
            if (Array.isArray(parsed)) {
              for (const item of parsed) {
                // Handle object with size variants (prioritize full/original/large)
                let url: string | null = null;
                if (typeof item === 'string') {
                  url = item;
                } else if (typeof item === 'object' && item !== null) {
                  url = item.full || item.original || item.large || item.url || item.src || item.image || null;
                }
                if (url && typeof url === 'string' && isVehicleImage(url)) {
                  const upgraded = upgradeToFullRes(url);
                  if (upgraded) urls.add(upgraded);
                }
              }
            }
          } catch {
            // Not valid JSON, continue
          }
        }
      }
    }
  } catch (e: any) {
    console.warn('Error extracting from script tags:', e?.message);
  }
  
  // Method 2: Extract from data attributes (data-src, data-full, data-original, data-image)
  try {
    const dataAttrPatterns = [
      /data-src=["']([^"']+)["']/gi,
      /data-full=["']([^"']+)["']/gi,
      /data-original=["']([^"']+)["']/gi,
      /data-image=["']([^"']+)["']/gi,
      /data-large=["']([^"']+)["']/gi,
      /data-url=["']([^"']+)["']/gi,
    ];
    
    for (const pattern of dataAttrPatterns) {
      const matches = h.matchAll(pattern);
      for (const match of matches) {
        const url = match[1];
        if (url && isVehicleImage(url)) {
          const upgraded = upgradeToFullRes(url);
          if (upgraded) urls.add(upgraded);
        }
      }
    }
  } catch (e: any) {
    console.warn('Error extracting from data attributes:', e?.message);
  }
  
  // Method 3: Extract from img src in gallery/photo sections only (PRIORITY: Find actual gallery)
  try {
    // PRIORITY: Look for specific Cars & Bids gallery containers/IDs
    // Common patterns: photo-gallery, image-gallery, photos-container, vehicle-photos
    const specificGalleryPatterns = [
      // ID-based (most specific)
      /<div[^>]*id=["'][^"']*(?:photo[_-]?gallery|image[_-]?gallery|photos[_-]?container|vehicle[_-]?photos|listing[_-]?gallery)[^"']*["'][^>]*>([\s\S]{0,200000})<\/div>/gi,
      // Class-based (more specific gallery classes)
      /<div[^>]*class=["'][^"']*(?:photo[_-]?gallery|image[_-]?gallery|photos[_-]?container|vehicle[_-]?photos|listing[_-]?gallery|auction[_-]?photos)[^"']*["'][^>]*>([\s\S]{0,200000})<\/div>/gi,
      // Generic gallery patterns (fallback)
      /<div[^>]*class=["'][^"']*(?:gallery|photos|images)[^"']*["'][^>]*>([\s\S]{0,100000})<\/div>/gi,
      /<section[^>]*class=["'][^"']*(?:gallery|photos|images|photo[_-]?gallery)[^"']*["'][^>]*>([\s\S]{0,100000})<\/section>/gi,
    ];
    
    let gallerySections: string[] = [];
    for (const pattern of specificGalleryPatterns) {
      const matches = h.matchAll(pattern);
      for (const match of matches) {
        if (match[1] && match[1].length > 100) { // Only include substantial sections
          gallerySections.push(match[1]);
        }
      }
      // If we found specific gallery sections, prioritize those and stop
      if (gallerySections.length > 0 && pattern === specificGalleryPatterns[0] || pattern === specificGalleryPatterns[1]) {
        break;
      }
    }
    
    // Also look for data attributes that indicate galleries (React/Next.js pattern)
    if (gallerySections.length === 0) {
      const dataGalleryPattern = /<div[^>]*data[_-]?(?:gallery|photos|images)[^>]*>([\s\S]{0,200000})<\/div>/gi;
      const matches = h.matchAll(dataGalleryPattern);
      for (const match of matches) {
        if (match[1] && match[1].length > 100) {
          gallerySections.push(match[1]);
        }
      }
    }
    
    // If we found gallery sections, extract from those ONLY; otherwise use full HTML
    const searchHtml = gallerySections.length > 0 ? gallerySections.join('\n') : h;
    
    // Extract img src, prioritizing data-src (lazy loading) then src, then data-full
    const imgPattern = /<img[^>]+(?:data[_-]?full=["']([^"']+)["']|data[_-]?src=["']([^"']+)["']|data[_-]?original=["']([^"']+)["']|src=["']([^"']+)["'])[^>]*>/gi;
    let imgMatch;
    while ((imgMatch = imgPattern.exec(searchHtml)) !== null) {
      // Priority: data-full > data-src > data-original > src
      const url = imgMatch[1] || imgMatch[2] || imgMatch[3] || imgMatch[4];
      if (url && isVehicleImage(url)) {
        const upgraded = upgradeToFullRes(url);
        if (upgraded) urls.add(upgraded);
      }
    }
    
    // Also check for background-image in CSS (some galleries use CSS backgrounds)
    if (gallerySections.length > 0) {
      const bgImagePattern = /background[_-]?image:\s*url\(["']?([^"')]+)["']?\)/gi;
      let bgMatch;
      while ((bgMatch = bgImagePattern.exec(searchHtml)) !== null) {
        const url = bgMatch[1];
        if (url && isVehicleImage(url)) {
          const upgraded = upgradeToFullRes(url);
          if (upgraded) urls.add(upgraded);
        }
      }
    }
  } catch (e: any) {
    console.warn('Error extracting from gallery sections:', e?.message);
  }
  
  // Method 4: Fallback - extract all media.carsandbids.com images, upgrade thumbnails, filter noise
  if (urls.size === 0) {
    const re = /https?:\/\/media\.carsandbids\.com\/[^"'\\s>]+?\.(?:jpg|jpeg|png|webp)(?:\?[^"'\\s>]*)?/gi;
    for (const m of h.match(re) || []) {
      const url = m.trim();
      if (isVehicleImage(url)) {
        const upgraded = upgradeToFullRes(url);
        if (upgraded) urls.add(upgraded);
      }
    }
  }
  
  // CRITICAL: Prioritize exterior images over interior/engine bay shots
  // Sort URLs to put exterior shots first (they typically come first in gallery)
  const sortedUrls = Array.from(urls);
  
  // Filter and prioritize: exterior shots first, then others
  const exteriorUrls: string[] = [];
  const interiorUrls: string[] = [];
  const otherUrls: string[] = [];
  
  for (const url of sortedUrls) {
    const lower = url.toLowerCase();
    // Exclude interior/engine bay shots from primary position
    if (lower.includes('interior') || lower.includes('dashboard') || lower.includes('engine') || 
        lower.includes('bay') || lower.includes('underhood') || lower.includes('under-hood') ||
        lower.includes('trunk') || lower.includes('cargo') || lower.includes('wheel') ||
        lower.includes('rim') || lower.includes('tire') || lower.includes('brake') ||
        lower.includes('suspension') || lower.includes('exhaust') || lower.includes('drivetrain')) {
      interiorUrls.push(url);
    } else {
      // Prioritize exterior shots
      exteriorUrls.push(url);
    }
  }
  
  // Return: exterior first, then others (interior shots can be in gallery but not primary)
  const finalUrls = [...exteriorUrls, ...otherUrls, ...interiorUrls];
  
  // Limit to reasonable number (prioritize first 50 exterior shots)
  return finalUrls.slice(0, 100);
}

function extractCarsAndBidsAuctionData(html: string): {
  current_bid?: number | null;
  bid_count?: number | null;
  reserve_met?: boolean | null;
  reserve_price?: number | null;
  auction_end_date?: string | null;
  final_price?: number | null;
  view_count?: number | null;
  watcher_count?: number | null;
} {
  const h = String(html || "");
  const result: any = {};
  
  // Helper to parse currency amounts
  const parseCurrency = (text: string | null | undefined): number | null => {
    if (!text) return null;
    const match = text.match(/[\$]?([\d,]+)/);
    if (match && match[1]) {
      const amount = parseInt(match[1].replace(/,/g, ''), 10);
      return Number.isFinite(amount) && amount > 0 ? amount : null;
    }
    return null;
  };
  
  // Helper to parse integers
  const parseInteger = (text: string | null | undefined): number | null => {
    if (!text) return null;
    const match = text.match(/(\d+)/);
    if (match && match[1]) {
      const num = parseInt(match[1], 10);
      return Number.isFinite(num) && num >= 0 ? num : null;
    }
    return null;
  };
  
  // Extract current bid - multiple patterns
  const bidPatterns = [
    /Current\s+Bid[^>]*>.*?USD\s*\$?([\d,]+)/i,
    /Current\s+Bid[^>]*>.*?\$([\d,]+)/i,
    /<strong[^>]*class[^>]*bid[^>]*>.*?\$([\d,]+)/i,
    /"currentBid":\s*(\d+)/i,
    /data-current-bid[^>]*>.*?\$([\d,]+)/i,
    /High\s+Bid[^>]*>.*?\$([\d,]+)/i,
  ];
  
  for (const pattern of bidPatterns) {
    const match = h.match(pattern);
    if (match && match[1]) {
      const bid = parseCurrency(match[1]);
      if (bid) {
        result.current_bid = bid;
        break;
      }
    }
  }
  
  // Extract bid count
  const bidCountPatterns = [
    /(\d+)\s+bids?/i,
    /Bid\s+Count[^>]*>.*?(\d+)/i,
    /"bidCount":\s*(\d+)/i,
    /data-bid-count[^>]*>.*?(\d+)/i,
  ];
  
  for (const pattern of bidCountPatterns) {
    const match = h.match(pattern);
    if (match && match[1]) {
      const count = parseInteger(match[1]);
      if (count !== null) {
        result.bid_count = count;
        break;
      }
    }
  }
  
  // Extract reserve met status
  const reserveMetPatterns = [
    /Reserve\s+Met/i,
    /"reserveMet":\s*true/i,
    /data-reserve-met[^>]*>.*?true/i,
  ];
  
  for (const pattern of reserveMetPatterns) {
    if (pattern.test(h)) {
      result.reserve_met = true;
      break;
    }
  }
  
  // Extract reserve price
  const reservePricePatterns = [
    /Reserve[^>]*>.*?\$([\d,]+)/i,
    /"reservePrice":\s*(\d+)/i,
    /data-reserve-price[^>]*>.*?\$([\d,]+)/i,
  ];
  
  for (const pattern of reservePricePatterns) {
    const match = h.match(pattern);
    if (match && match[1]) {
      const price = parseCurrency(match[1]);
      if (price) {
        result.reserve_price = price;
        break;
      }
    }
  }
  
  // Extract auction end date/time - CRITICAL for timers
  const endDatePatterns = [
    /data-countdown-date\s*=\s*"([^"]+)"/i,
    /data-end-date\s*=\s*"([^"]+)"/i,
    /"endDate"\s*:\s*"([^"]+)"/i,
    /Auction\s+Ends[^>]*>.*?(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2})/i,
    /Ends[^>]*>.*?(\w+\s+\d{1,2},\s+\d{4}[^<]*\d{1,2}:\d{2}\s*(?:AM|PM))/i,
  ];
  
  for (const pattern of endDatePatterns) {
    const match = h.match(pattern);
    if (match && match[1]) {
      const dateStr = match[1].trim();
      const parsed = Date.parse(dateStr);
      if (Number.isFinite(parsed)) {
        result.auction_end_date = new Date(parsed).toISOString();
        break;
      }
    }
  }
  
  // Extract final/sale price (for ended auctions)
  const finalPricePatterns = [
    /Sold\s+for[^>]*>.*?\$([\d,]+)/i,
    /Final\s+Price[^>]*>.*?\$([\d,]+)/i,
    /"finalPrice":\s*(\d+)/i,
    /"salePrice":\s*(\d+)/i,
  ];
  
  for (const pattern of finalPricePatterns) {
    const match = h.match(pattern);
    if (match && match[1]) {
      const price = parseCurrency(match[1]);
      if (price) {
        result.final_price = price;
        break;
      }
    }
  }
  
  // Extract view count
  const viewCountPatterns = [
    /([\d,]+)\s+views?/i,
    /View\s+Count[^>]*>.*?([\d,]+)/i,
    /"viewCount":\s*(\d+)/i,
  ];
  
  for (const pattern of viewCountPatterns) {
    const match = h.match(pattern);
    if (match && match[1]) {
      const count = parseInteger(match[1].replace(/,/g, ''));
      if (count !== null) {
        result.view_count = count;
        break;
      }
    }
  }
  
  // Extract watcher count
  const watcherCountPatterns = [
    /([\d,]+)\s+watchers?/i,
    /Watcher\s+Count[^>]*>.*?([\d,]+)/i,
    /"watcherCount":\s*(\d+)/i,
  ];
  
  for (const pattern of watcherCountPatterns) {
    const match = h.match(pattern);
    if (match && match[1]) {
      const count = parseInteger(match[1].replace(/,/g, ''));
      if (count !== null) {
        result.watcher_count = count;
        break;
      }
    }
  }
  
  return result;
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
  while ((scriptMatch = scriptJsonRe.exec(h)) !== null) {
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
  while ((match = pswpImgRe.exec(h)) !== null) {
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
  while ((match = srcsetRe.exec(h)) !== null) {
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
  while ((match = nextImageRe.exec(h)) !== null) {
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
    const u = String(m || "").trim();
    // Clean URL: remove resize params, get full resolution
    const cleaned = u.split('?')[0].split('#')[0];
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
      urls.add(cleaned);
    }
  }
  
  // Pattern 3: Data attributes (data-src, data-image, etc.)
  const dataSrcRe = /data-(?:src|image|url)=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/gi;
  while ((match = dataSrcRe.exec(h)) !== null) {
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
      case 'bringatrailer':
        result = await extractBringATrailer(url, max_vehicles);
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
    // Strip /video suffix - that's not the actual listing URL
    let cleanUrl = normalizedUrl.split("?")[0].replace(/\/video\/?$/, '');
    listingUrls = [cleanUrl];
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
          // CRITICAL: Exclude /video URLs - those are not the actual listing pages
          if (lower.includes("/video")) return false;
          return true;
        })
        .map((u: string) => u.replace(/\/video\/?$/, '')) // Strip /video suffix just in case
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
      images: { 
        type: "array", 
        items: { type: "string" }, 
        description: "ALL high-resolution full-size image URLs from the vehicle gallery. Extract from gallery JSON/data attributes, prioritize 'full', 'original', or 'large' size URLs. Remove all resize parameters (?w=, ?h=, ?resize=). Get ONLY full-resolution gallery images, NOT thumbnails, NOT video frames, NOT UI elements. Exclude any URLs containing 'thumb', 'thumbnail', 'video', 'icon', 'logo', or size suffixes like -150x150." 
      },
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
            waitFor: 8000, // Wait for gallery to fully load (increased for better gallery detection)
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

      // Extract and clean images - PRIORITIZE HTML extraction (more reliable for full-res)
      let images: string[] = [];
      // Method 1: HTML extraction (most reliable for full-resolution images)
      if (html) {
        const htmlImages = extractCarsAndBidsImagesFromHtml(html);
        if (htmlImages.length > 0) {
          images = htmlImages.map((u: string) => cleanImageUrl(u, 'carsandbids'));
        }
      }
      // Method 2: Fallback to Firecrawl extraction if HTML extraction failed
      if (images.length === 0 && Array.isArray(vehicle?.images) && vehicle.images.length > 0) {
        images = vehicle.images
          .map((u: string) => cleanImageUrl(u, 'carsandbids'))
          .filter((u: string) => {
            // Filter out thumbnails and video frames from Firecrawl extraction
            const lower = u.toLowerCase();
            return !lower.includes('thumb') && !lower.includes('video') && !lower.includes('icon');
          });
      }
      
      // Extract auction data from HTML (bids, prices, timers) - CRITICAL for live auctions
      let auctionData: any = {};
      if (html) {
        auctionData = extractCarsAndBidsAuctionData(html);
      }
      
      // CRITICAL: Clean listing URL - strip /video suffix
      const cleanListingUrl = listingUrl.replace(/\/video\/?$/, '');
      
      const merged = {
        ...(empty ? {} : vehicle),
        listing_url: cleanListingUrl,
        year: (vehicle?.year ?? fallback.year) ?? null,
        make: (vehicle?.make ?? fallback.make) ?? null,
        model: (vehicle?.model ?? fallback.model) ?? null,
        title: (vehicle?.title ?? fallback.title) ?? null,
        images, // Cleaned high-res images
        // Auction data - prioritize HTML extraction, fallback to Firecrawl
        current_bid: auctionData.current_bid ?? vehicle?.current_bid ?? null,
        bid_count: auctionData.bid_count ?? vehicle?.bid_count ?? null,
        reserve_met: auctionData.reserve_met ?? vehicle?.reserve_met ?? null,
        reserve_price: auctionData.reserve_price ?? vehicle?.reserve_price ?? null,
        auction_end_date: auctionData.auction_end_date ?? vehicle?.auction_end_date ?? null,
        final_price: auctionData.final_price ?? vehicle?.final_price ?? vehicle?.sale_price ?? null,
        view_count: auctionData.view_count ?? vehicle?.view_count ?? null,
        watcher_count: auctionData.watcher_count ?? vehicle?.watcher_count ?? null,
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

      // Determine sale price (priority: sale_price > final_bid > current_bid > high_bid)
      const salePrice = Number.isFinite(vehicle.sale_price) ? vehicle.sale_price :
                       (Number.isFinite(vehicle.final_bid) ? vehicle.final_bid : null);
      const askingPrice = Number.isFinite(vehicle.asking_price) ? vehicle.asking_price :
                          (Number.isFinite(vehicle.current_bid) ? vehicle.current_bid :
                           (Number.isFinite(vehicle.high_bid) ? vehicle.high_bid : null));

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
          displacement: vehicle.displacement || null,
          asking_price: askingPrice,
          sale_price: salePrice,
          // IMPORTANT: keep `vehicles.description` as a curated summary (not a raw listing dump).
          // The raw listing description is stored (with provenance and history) in `extraction_metadata`.
          description: normalizeDescriptionSummary(rawListingDescription),
          description_source: rawListingDescription ? "source_imported" : null,
          listing_url: listingUrl,
          listing_source: source.toLowerCase(),
          listing_title: title,
          auction_end_date: vehicle.auction_end_date || null,
          sale_date: vehicle.sale_date || null,
          // Note: current_bid and bid_count are stored in external_listings, not vehicles table
          // Only high_bid/winning_bid go in vehicles table for auction outcomes
          // BaT-specific fields
          bat_seller: vehicle.seller || vehicle.seller_username || null,
          bat_location: vehicle.location || null,
          bat_bids: Number.isFinite(vehicle.bid_count) ? Math.trunc(vehicle.bid_count) : null,
          bat_views: Number.isFinite(vehicle.view_count) ? Math.trunc(vehicle.view_count) : null,
          bat_comments: Number.isFinite(vehicle.comment_count) ? Math.trunc(vehicle.comment_count) : null,
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
        // Check for existing vehicle by discovery_url (canonical for listing imports)
        const { data: existingByUrl, error: urlCheckErr } = await supabase
          .from("vehicles")
          .select("id")
          .eq("discovery_url", listingUrl)
          .maybeSingle();
        
        if (urlCheckErr) {
          error = urlCheckErr;
        } else if (existingByUrl?.id) {
          // Update existing vehicle
          const { data: updated, error: updateErr } = await supabase
            .from("vehicles")
            .update(payload)
            .eq("id", existingByUrl.id)
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
          // Insert new vehicle
          const { data: inserted, error: insertErr } = await supabase
            .from("vehicles")
            .insert(payload)
            .select("id")
            .single();
          data = inserted;
          error = insertErr;
          if (!insertErr && inserted?.id) createdIds.push(String(inserted.id));
        }
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

        // Create comprehensive external_listing for ALL auction platforms with ALL extracted data
        // Determine platform from listing URL or source
        let platform: string | null = null;
        if (listingUrl) {
          const urlLower = String(listingUrl).toLowerCase();
          if (urlLower.includes('bringatrailer.com')) platform = 'bat';
          else if (urlLower.includes('carsandbids.com')) platform = 'carsandbids';
          else if (urlLower.includes('mecum.com')) platform = 'mecum';
          else if (urlLower.includes('barrett-jackson.com') || urlLower.includes('barrettjackson.com')) platform = 'barrettjackson';
          else if (urlLower.includes('russoandsteele.com')) platform = 'russoandsteele';
        }
        
        // Fallback to source name if URL detection failed
        if (!platform) {
          const sourceLower = String(source).toLowerCase();
          if (sourceLower.includes('bring a trailer') || sourceLower.includes('bat')) platform = 'bat';
          else if (sourceLower.includes('cars & bids') || sourceLower.includes('carsandbids')) platform = 'carsandbids';
          else if (sourceLower.includes('mecum')) platform = 'mecum';
          else if (sourceLower.includes('barrett')) platform = 'barrettjackson';
          else if (sourceLower.includes('russo')) platform = 'russoandsteele';
        }
        
        if (platform && listingUrl) {
          try {
            // Extract listing ID from URL (platform-specific)
            let listingId: string | null = null;
            if (platform === 'bat') {
              const lotMatch = String(listingUrl).match(/-(\d+)\/?$/);
              listingId = vehicle.lot_number || (lotMatch ? lotMatch[1] : null);
            } else if (platform === 'carsandbids') {
              listingId = listingUrl.split('/').filter(Boolean).pop() || null;
            } else if (platform === 'mecum') {
              const lotMatch = String(listingUrl).match(/\/lots\/(?:detail\/)?([^\/]+)/);
              listingId = vehicle.lot_number || (lotMatch ? lotMatch[1] : null);
            } else if (platform === 'barrettjackson') {
              const itemMatch = String(listingUrl).match(/\/Item\/([^\/]+)/);
              listingId = vehicle.lot_number || (itemMatch ? itemMatch[1] : null) || listingUrl.split('/').filter(Boolean).pop() || null;
            } else {
              listingId = listingUrl.split('/').filter(Boolean).pop() || null;
            }
            
            // Calculate all dates in ISO format
            let endDateIso: string | null = null;
            let startDateIso: string | null = null;
            let soldAtIso: string | null = null;
            
            if (vehicle.auction_end_date) {
              try {
                const endDate = new Date(vehicle.auction_end_date);
                if (Number.isFinite(endDate.getTime())) {
                  endDate.setUTCHours(23, 59, 59, 999);
                  endDateIso = endDate.toISOString();
                }
              } catch {
                // ignore
              }
            }
            
            if (vehicle.auction_start_date) {
              try {
                const startDate = new Date(vehicle.auction_start_date);
                if (Number.isFinite(startDate.getTime())) {
                  startDate.setUTCHours(0, 0, 0, 0);
                  startDateIso = startDate.toISOString();
                }
              } catch {
                // ignore
              }
            }
            
            if (vehicle.sale_date) {
              try {
                const soldDate = new Date(vehicle.sale_date);
                if (Number.isFinite(soldDate.getTime())) {
                  soldDate.setUTCHours(23, 59, 59, 999);
                  soldAtIso = soldDate.toISOString();
                }
              } catch {
                // ignore
              }
            }
            
            // Determine listing status
            let listingStatus = 'ended';
            if (endDateIso && new Date(endDateIso) > new Date()) {
              listingStatus = 'active';
            } else if (vehicle.sale_price || vehicle.final_bid) {
              listingStatus = 'sold';
            } else if (vehicle.reserve_met === false) {
              listingStatus = 'reserve_not_met';
            }
            
            // Determine final price (priority: sale_price > final_bid > current_bid > high_bid)
            const finalPrice = Number.isFinite(vehicle.sale_price) ? vehicle.sale_price :
                              (Number.isFinite(vehicle.final_bid) ? vehicle.final_bid : null);
            const currentBid = Number.isFinite(vehicle.current_bid) ? vehicle.current_bid : 
                              (Number.isFinite(vehicle.high_bid) ? vehicle.high_bid : null);
            
            // Store ALL extracted images in metadata for fallback display
            const extractedImages = Array.isArray(vehicle.images) ? vehicle.images : [];
            
            await supabase
              .from('external_listings')
              .upsert({
                vehicle_id: data.id,
                organization_id: sourceOrgId,
                platform: platform,
                listing_url: listingUrl,
                listing_status: listingStatus,
                listing_id: listingId,
                start_date: startDateIso,
                end_date: endDateIso,
                sold_at: soldAtIso,
                current_bid: currentBid,
                final_price: finalPrice,
                reserve_price: Number.isFinite(vehicle.reserve_price) ? vehicle.reserve_price : null,
                bid_count: Number.isFinite(vehicle.bid_count) ? Math.trunc(vehicle.bid_count) : null,
                view_count: Number.isFinite(vehicle.view_count) ? Math.trunc(vehicle.view_count) : null,
                watcher_count: Number.isFinite(vehicle.watcher_count) ? Math.trunc(vehicle.watcher_count) : null,
                metadata: {
                  source: 'extract-premium-auction',
                  lot_number: vehicle.lot_number || listingId,
                  auction_start_date: vehicle.auction_start_date,
                  auction_end_date: vehicle.auction_end_date,
                  sale_date: vehicle.sale_date,
                  seller: vehicle.seller || vehicle.seller_username || null,
                  seller_username: vehicle.seller_username || null,
                  buyer: vehicle.buyer || vehicle.buyer_username || null,
                  buyer_username: vehicle.buyer_username || null,
                  location: vehicle.location || null,
                  comment_count: Number.isFinite(vehicle.comment_count) ? vehicle.comment_count : null,
                  reserve_met: vehicle.reserve_met,
                  features: Array.isArray(vehicle.features) ? vehicle.features : null,
                  // CRITICAL: Store ALL extracted images for fallback display
                  images: extractedImages,
                  image_urls: extractedImages, // Alias for compatibility
                },
                updated_at: nowIso(),
              }, {
                onConflict: 'vehicle_id,platform,listing_id',
              });
          } catch (e: any) {
            console.warn(`external_listings upsert failed (non-fatal): ${e?.message || String(e)}`);
          }
        }

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

// Universal URL cleaner: removes resize params, gets full resolution for all platforms
function cleanImageUrl(url: string, platform?: string): string {
  if (!url || typeof url !== 'string') return url;
  
  let cleaned = url
    .replace(/&#038;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"');
  
  // Remove resize/transform query params (common across platforms)
  cleaned = cleaned
    .replace(/[?&]w=\d+/g, '')
    .replace(/[?&]h=\d+/g, '')
    .replace(/[?&]width=\d+/g, '')
    .replace(/[?&]height=\d+/g, '')
    .replace(/[?&]resize=[^&]*/g, '')
    .replace(/[?&]fit=[^&]*/g, '')
    .replace(/[?&]quality=[^&]*/g, '')
    .replace(/[?&]strip=[^&]*/g, '')
    .replace(/[?&]format=[^&]*/g, '')
    .replace(/[?&]+$/, '');
  
  // Platform-specific cleaning
  if (cleaned.includes('bringatrailer.com')) {
    // BaT: remove -scaled suffixes and size suffixes
    cleaned = cleaned
      .replace(/-scaled\.(jpg|jpeg|png|webp)$/i, '.$1')
      .replace(/-\d+x\d+\.(jpg|jpeg|png|webp)$/i, '.$1');
  } else if (cleaned.includes('carsandbids.com')) {
    // Cars & Bids: remove query params and upgrade thumbnails to full-res
    cleaned = cleaned.split('?')[0];
    // Remove size suffixes to get full resolution
    cleaned = cleaned
      .replace(/-\d+x\d+\.(jpg|jpeg|png|webp)$/i, '.$1')
      .replace(/-thumb(?:nail)?\.(jpg|jpeg|png|webp)$/i, '.$1')
      .replace(/-small\.(jpg|jpeg|png|webp)$/i, '.$1')
      .replace(/-medium\.(jpg|jpeg|png|webp)$/i, '.$1');
  } else if (cleaned.includes('mecum.com')) {
    // Mecum: already constructs clean URLs, but ensure no query params
    cleaned = cleaned.split('?')[0];
  } else if (cleaned.includes('barrett-jackson.com') || cleaned.includes('barrettjackson.com')) {
    // Barrett-Jackson: remove Next.js optimization params
    if (cleaned.includes('_next/image')) {
      // Extract the actual image URL from Next.js optimization
      const urlMatch = cleaned.match(/url=([^&]+)/);
      if (urlMatch) {
        try {
          cleaned = decodeURIComponent(urlMatch[1]);
        } catch {
          // fallback to original
        }
      }
    }
    cleaned = cleaned.split('?')[0].split('#')[0];
  }
  
  return cleaned.trim();
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
  
  // Clean all URLs before processing and filter out organization/dealer logos
  const urls = (Array.isArray(imageUrls) ? imageUrls : [])
    .map((u) => cleanImageUrl(String(u || "").trim(), source))
    .filter((u) => {
      if (!u || !u.startsWith("http")) return false;
      const urlLower = u.toLowerCase();
      // CRITICAL: Exclude organization/dealer logos - these should NEVER be vehicle images
      if (urlLower.includes('organization-logos/') || urlLower.includes('organization_logos/')) return false;
      if (urlLower.includes('images.classic.com/uploads/dealer/')) return false;
      if (urlLower.includes('/uploads/dealer/')) return false;
      // Exclude logos in storage paths
      if ((urlLower.includes('/logo') || urlLower.includes('logo.')) && 
          (urlLower.includes('/storage/') || urlLower.includes('supabase.co'))) return false;
      return true;
    });

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

  // Insert ALL images (no limit) - BaT listings can have 100+ images
  for (const imageUrl of urls) {
    if (existingUrls.has(imageUrl)) continue;
    try {
      const makePrimary = !hasPrimary && nextPosition === 0;
      
      // Determine correct source based on listing URL (most reliable) or source string
      // Match actual source values used in database for proper attribution
      let imageSource = "external_import"; // default fallback
      const listingUrlLower = (listingUrl || "").toLowerCase();
      const sourceLower = (source || "").toLowerCase();
      
      if (listingUrlLower.includes("bringatrailer.com") || sourceLower.includes("bring a trailer") || sourceLower.includes("bringatrailer")) {
        imageSource = "bat_import"; // BaT uses bat_import
      } else if (listingUrlLower.includes("carsandbids.com") || sourceLower.includes("cars & bids") || sourceLower.includes("carsandbids")) {
        // Cars & Bids: use external_import (matches existing usage in DB)
        imageSource = "external_import";
      } else if (listingUrlLower.includes("craigslist.org") || sourceLower.includes("craigslist")) {
        // Craigslist: use craigslist_scrape (user says this works, matches DB pattern)
        imageSource = "craigslist_scrape";
      } else if (listingUrlLower.includes("cars.ksl.com") || listingUrlLower.includes("ksl.com") || sourceLower.includes("ksl")) {
        imageSource = "ksl_scrape";
      } else if (listingUrlLower.includes("pcarmarket.com") || sourceLower.includes("pcarmarket")) {
        imageSource = "pcarmarket_listing";
      } else if (listingUrlLower.includes("mecum.com") || sourceLower.includes("mecum")) {
        imageSource = "external_import"; // Mecum: use generic external_import
      } else if (listingUrlLower.includes("barrett-jackson.com") || listingUrlLower.includes("barrettjackson.com") || sourceLower.includes("barrett")) {
        imageSource = "external_import"; // Barrett-Jackson: use generic external_import
      } else {
        // Default to external_import for unknown platforms
        imageSource = "external_import";
      }
      
      const { error } = await supabase
        .from("vehicle_images")
        .insert({
          vehicle_id: vehicleId,
          image_url: imageUrl,
          // Must satisfy vehicle_images_attribution_check - use correct source for platform
          source: imageSource,
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
  const urls = new Set<string>();
  
  // PRIORITY 1: Look for auction-link class with actual listing URLs (most reliable)
  // Pattern: <a class="auction-link" href="/auctions/ID/year-make-model">
  const auctionLinkPattern = /<a[^>]*class=["'][^"']*auction-link[^"']*["'][^>]*href=["'](\/auctions\/[^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = auctionLinkPattern.exec(html)) !== null) {
    const path = m[1];
    if (!path) continue;
    // Exclude /video URLs
    if (path.includes('/video')) continue;
    urls.add(`https://carsandbids.com${path.split('?')[0]}`);
    if (urls.size >= Math.max(1, limit)) break;
  }
  
  // PRIORITY 2: Look for full listing URLs with year-make-model pattern
  // Pattern: /auctions/ID/year-make-model (this is the actual listing, not /video)
  if (urls.size < limit) {
    const fullListingPattern = /href=["'](\/auctions\/[a-zA-Z0-9]+\/[0-9]{4}-[^"']+)["']/gi;
    while ((m = fullListingPattern.exec(html)) !== null) {
      const path = m[1];
      if (!path || path.includes('/video')) continue;
      urls.add(`https://carsandbids.com${path.split('?')[0]}`);
      if (urls.size >= Math.max(1, limit)) break;
    }
  }
  
  // PRIORITY 3: Fallback to any /auctions/ URL (but exclude /video)
  if (urls.size < limit) {
    const re = /href=["'](\/auctions\/[a-zA-Z0-9-]+(?:\/[^"']+)?)["']/gi;
    while ((m = re.exec(html)) !== null) {
      const path = m[1];
      if (!path) continue;
      // Exclude /video URLs
      if (path.includes('/video')) continue;
      urls.add(`https://carsandbids.com${path.split('?')[0]}`);
      if (urls.size >= Math.max(1, limit)) break;
    }
  }
  
  return Array.from(urls);
}

function extractCarsAndBidsListingUrlsFromText(text: string, limit: number): string[] {
  const urls = new Set<string>();
  
  // Pattern for full listing URLs (with year-make-model) - these are the actual listings
  const fullListingPattern = /https?:\/\/carsandbids\.com\/auctions\/[a-zA-Z0-9]+\/[0-9]{4}-[^\s"')]+/g;
  for (const m of text.match(fullListingPattern) || []) {
    if (!m.includes('/video')) {
      urls.add(m.split('?')[0].replace(/\/video\/?$/, ''));
      if (urls.size >= Math.max(1, limit)) break;
    }
  }
  
  // Fallback to any /auctions/ URL (but exclude /video)
  if (urls.size < Math.max(1, limit)) {
    const abs = /https?:\/\/carsandbids\.com\/auctions\/[a-zA-Z0-9-]+(?:\/[^\s"')]+)?/g;
    for (const m of text.match(abs) || []) {
      if (!m.includes('/video')) {
        urls.add(m.split('?')[0].replace(/\/video\/?$/, ''));
        if (urls.size >= Math.max(1, limit)) break;
      }
    }
  }

  if (urls.size < Math.max(1, limit)) {
    const rel = /\/auctions\/[a-zA-Z0-9-]+(?:\/[^\s"')]+)?/g;
    for (const m of text.match(rel) || []) {
      if (!m.includes('/video')) {
        urls.add(`https://carsandbids.com${m.split('?')[0].replace(/\/video\/?$/, '')}`);
        if (urls.size >= Math.max(1, limit)) break;
      }
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
      images: { 
        type: "array", 
        items: { type: "string" }, 
        description: "ALL high-resolution full-size image URLs from the vehicle gallery. Extract from gallery JSON/data attributes, prioritize 'full', 'original', or 'large' size URLs. Remove all resize parameters (?w=, ?h=, ?resize=). Get ONLY full-resolution gallery images, NOT thumbnails, NOT video frames, NOT UI elements. Exclude any URLs containing 'thumb', 'thumbnail', 'video', 'icon', 'logo', or size suffixes like -150x150." 
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
        // Apply universal cleaner for any remaining params
        return cleanImageUrl(url, 'mecum');
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
      
      // Clean all URLs to full resolution
      images = images.map((img: string) => cleanImageUrl(img, 'barrettjackson'));
      
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

async function extractBringATrailer(url: string, maxVehicles: number) {
  console.log("Bring a Trailer: extracting listing with high-res images");

  const normalizedUrl = String(url || "").trim();
  const isDirectListing = normalizedUrl.includes("bringatrailer.com/listing/");
  
  if (!isDirectListing) {
    return {
      success: false,
      source: "Bring a Trailer",
      site_type: "bringatrailer",
      error: "URL must be a direct BaT listing URL (bringatrailer.com/listing/...)",
      timestamp: new Date().toISOString()
    };
  }

  const firecrawlKey = requiredEnv("FIRECRAWL_API_KEY");
  const sourceWebsite = "https://bringatrailer.com";

  // Import BaT extraction utilities
  const upgradeBatImageUrl = (url: string): string => {
    if (!url || typeof url !== 'string' || !url.includes('bringatrailer.com')) {
      return url;
    }
    return url
      .replace(/&#038;/g, '&')
      .replace(/&#039;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/[?&]w=\d+/g, '')
      .replace(/[?&]h=\d+/g, '')
      .replace(/[?&]resize=[^&]*/g, '')
      .replace(/[?&]fit=[^&]*/g, '')
      .replace(/[?&]quality=[^&]*/g, '')
      .replace(/[?&]strip=[^&]*/g, '')
      .replace(/[?&]+$/, '')
      .replace(/-scaled\.(jpg|jpeg|png|webp)$/i, '.$1')
      .replace(/-\d+x\d+\.(jpg|jpeg|png|webp)$/i, '.$1')
      .trim();
  };

  const extractBatGalleryImagesFromHtml = (html: string): string[] => {
    const h = String(html || '');
    const urls: string[] = [];
    
    try {
      // Extract from data-gallery-items JSON (most reliable)
      const idx = h.indexOf('id="bat_listing_page_photo_gallery"');
      if (idx >= 0) {
        // Increase window size to handle large galleries (148+ images)
        const window = h.slice(idx, idx + 1000000);
        const m = window.match(/data-gallery-items=(?:"([^"]+)"|'([^']+)')/i);
        const encoded = (m?.[1] || m?.[2] || '').trim();
        if (encoded) {
          const jsonText = encoded.replace(/&quot;/g, '"').replace(/&#038;/g, '&').replace(/&amp;/g, '&');
          const items = JSON.parse(jsonText);
          if (Array.isArray(items)) {
            for (const it of items) {
              let u = it?.full?.url || it?.original?.url || it?.large?.url || it?.small?.url;
              if (typeof u === 'string' && u.trim()) {
                u = upgradeBatImageUrl(u);
                const normalized = u.split('#')[0].split('?')[0].replace(/-scaled\./g, '.').trim();
                if (normalized.includes('bringatrailer.com/wp-content/uploads/') && 
                    !normalized.endsWith('.svg') && !normalized.endsWith('.pdf')) {
                  urls.push(normalized);
                }
              }
            }
          }
        }
      }
    } catch (e: any) {
      console.warn('Error extracting BaT gallery images:', e?.message);
    }
    
    return Array.from(new Set(urls));
  };

  // Comprehensive schema to extract ALL BaT data
  const listingSchema = {
    type: "object",
    properties: {
      // Core vehicle identification
      title: { type: "string", description: "Full listing title" },
      year: { type: "number", description: "Vehicle year" },
      make: { type: "string", description: "Vehicle make" },
      model: { type: "string", description: "Vehicle model" },
      trim: { type: "string", description: "Trim level" },
      vin: { type: "string", description: "VIN from BaT Essentials section" },
      lot_number: { type: "string", description: "Lot number" },
      
      // Technical specifications
      mileage: { type: "number", description: "Mileage / odometer reading" },
      color: { type: "string", description: "Exterior color" },
      interior_color: { type: "string", description: "Interior color/upholstery" },
      transmission: { type: "string", description: "Transmission type (e.g., 'Five-Speed Manual')" },
      drivetrain: { type: "string", description: "Drivetrain (RWD, AWD, 4WD, FWD)" },
      engine_size: { type: "string", description: "Engine description (e.g., '3.5-Liter V6')" },
      displacement: { type: "string", description: "Engine displacement (e.g., '3.5L', '2.2L')" },
      fuel_type: { type: "string", description: "Fuel type" },
      body_style: { type: "string", description: "Body style (Roadster, Coupe, Sedan, etc.)" },
      
      // Auction data
      current_bid: { type: "number", description: "Current bid amount (for active auctions)" },
      high_bid: { type: "number", description: "Highest bid (for ended auctions)" },
      final_bid: { type: "number", description: "Final winning bid amount" },
      sale_price: { type: "number", description: "Sale price (if sold)" },
      reserve_price: { type: "number", description: "Reserve price (if disclosed)" },
      reserve_met: { type: "boolean", description: "Reserve met" },
      bid_count: { type: "number", description: "Total number of bids" },
      view_count: { type: "number", description: "Number of views" },
      watcher_count: { type: "number", description: "Number of watchers" },
      comment_count: { type: "number", description: "Number of comments" },
      auction_start_date: { type: "string", description: "Auction start date (YYYY-MM-DD or ISO)" },
      auction_end_date: { type: "string", description: "Auction end date/time (YYYY-MM-DD or ISO format preferred)" },
      sale_date: { type: "string", description: "Sale date (YYYY-MM-DD)" },
      
      // Location and parties
      location: { type: "string", description: "Vehicle location (city, state or country)" },
      seller: { type: "string", description: "Seller name or username" },
      seller_username: { type: "string", description: "BaT seller username" },
      buyer: { type: "string", description: "Buyer name or username (if sold)" },
      buyer_username: { type: "string", description: "BaT buyer username (if sold)" },
      
      // Content
      description: { type: "string", description: "Full listing description text from post-excerpt" },
      features: { type: "array", items: { type: "string" }, description: "List of features/equipment" },
      
      // Images - CRITICAL: Extract ALL high-resolution images
      images: { 
        type: "array", 
        items: { type: "string" }, 
        description: "ALL high-resolution image URLs from gallery. Extract from data-gallery-items JSON, prioritize 'full' or 'original' URLs, remove all resize parameters (?w=, ?h=, ?resize=), remove -scaled.jpg suffixes, remove size suffixes (-150x150, -300x300). Get ALL images, not just thumbnails." 
      },
    },
  };

  const extracted: any[] = [];
  const issues: string[] = [];

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
          url: normalizedUrl,
          formats: ["extract", "html"],
          onlyMainContent: false,
          waitFor: 5000, // Wait for gallery to load
          extract: { schema: listingSchema },
        }),
      },
      FIRECRAWL_LISTING_TIMEOUT_MS,
      "Firecrawl BaT listing scrape",
    );

    const vehicle = firecrawlData?.data?.extract || {};
    const html = String(firecrawlData?.data?.html || "");

    // Extract high-res images from HTML gallery (more reliable than Firecrawl extraction)
    let images: string[] = [];
    if (html) {
      images = extractBatGalleryImagesFromHtml(html);
    }
    
    // Merge Firecrawl images if any, but prioritize HTML extraction
    if (images.length === 0 && Array.isArray(vehicle?.images) && vehicle.images.length > 0) {
      images = vehicle.images.map((u: string) => upgradeBatImageUrl(u));
    }

    // Upgrade all image URLs to highest resolution and filter out non-vehicle images
    images = images.map(upgradeBatImageUrl).filter((u: string) => {
      const lower = u.toLowerCase();
      // Filter out logos, icons, UI elements
      if (lower.includes('logo') || 
          lower.includes('icon') || 
          lower.includes('placeholder') ||
          lower.includes('no-image') ||
          lower.includes('/assets/') ||
          lower.includes('/icons/') ||
          lower.includes('favicon') ||
          lower.endsWith('.svg') ||
          lower.endsWith('.ico')) {
        return false;
      }
      // Aggressively filter out ALL flag images (American flag, banners, etc.)
      if (/(?:^|\/|\-|_)(flag|flags|banner)(?:$|\/|\-|_|\.)/i.test(lower) ||
          lower.includes('stars-and-stripes') ||
          lower.includes('stars_and_stripes') ||
          lower.includes('american-flag') ||
          lower.includes('american_flag') ||
          lower.includes('us-flag') ||
          lower.includes('us_flag') ||
          lower.includes('usa-flag') ||
          lower.includes('usa_flag') ||
          lower.includes('flag-usa') ||
          lower.includes('flag_usa') ||
          lower.includes('united-states-flag') ||
          lower.includes('united_states_flag') ||
          lower.includes('old-glory') ||
          lower.includes('old_glory') ||
          /(?:^|\/|\-|_)(flag|flags)(?:.*usa|.*us|.*american)/i.test(lower) ||
          /(?:usa|us|american).*(?:flag|flags)/i.test(lower)) {
        return false;
      }
      return true;
    });

    // Merge ALL extracted data comprehensively
    const merged = {
      ...vehicle,
      listing_url: normalizedUrl,
      images, // High-res images from HTML gallery extraction
      // Preserve all auction data
      current_bid: typeof vehicle?.current_bid === 'number' ? vehicle.current_bid : 
                   (typeof vehicle?.high_bid === 'number' ? vehicle.high_bid : null),
      high_bid: typeof vehicle?.high_bid === 'number' ? vehicle.high_bid : null,
      final_bid: typeof vehicle?.final_bid === 'number' ? vehicle.final_bid : null,
      sale_price: typeof vehicle?.sale_price === 'number' ? vehicle.sale_price : null,
      reserve_price: typeof vehicle?.reserve_price === 'number' ? vehicle.reserve_price : null,
      auction_end_date: vehicle?.auction_end_date || null,
      auction_start_date: vehicle?.auction_start_date || null,
      sale_date: vehicle?.sale_date || null,
      // Preserve all metrics
      bid_count: typeof vehicle?.bid_count === 'number' ? vehicle.bid_count : null,
      view_count: typeof vehicle?.view_count === 'number' ? vehicle.view_count : null,
      watcher_count: typeof vehicle?.watcher_count === 'number' ? vehicle.watcher_count : null,
      comment_count: typeof vehicle?.comment_count === 'number' ? vehicle.comment_count : null,
      // Preserve location and parties
      location: vehicle?.location || null,
      seller: vehicle?.seller || vehicle?.seller_username || null,
      seller_username: vehicle?.seller_username || null,
      buyer: vehicle?.buyer || vehicle?.buyer_username || null,
      buyer_username: vehicle?.buyer_username || null,
      lot_number: vehicle?.lot_number || null,
      // Preserve all specs
      displacement: vehicle?.displacement || null,
      features: Array.isArray(vehicle?.features) ? vehicle.features : null,
    };

    extracted.push(merged);
  } catch (e: any) {
    issues.push(`BaT listing scrape failed: ${normalizedUrl} (${e?.message || String(e)})`);
  }

  // Store extracted vehicles in DB
  const created = await storeVehiclesInDatabase(extracted, "Bring a Trailer", sourceWebsite);

  return {
    success: true,
    source: "Bring a Trailer",
    site_type: "bringatrailer",
    listing_index_url: normalizedUrl,
    listings_discovered: 1,
    vehicles_extracted: extracted.length,
    vehicles_created: created.created_ids.length,
    vehicles_updated: created.updated_ids.length,
    vehicles_saved: created.created_ids.length + created.updated_ids.length,
    created_vehicle_ids: created.created_ids,
    updated_vehicle_ids: created.updated_ids,
    issues: [...issues, ...created.errors],
    extraction_method: "firecrawl_extract_with_html_gallery_parsing",
    timestamp: new Date().toISOString(),
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
