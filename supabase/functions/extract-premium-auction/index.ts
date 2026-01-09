import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';

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

const STORAGE_BUCKET = 'vehicle-data';

const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v1/scrape";
const FIRECRAWL_MAP_URL = "https://api.firecrawl.dev/v1/map";
const FIRECRAWL_LISTING_TIMEOUT_MS = 60000; // Increased to 60s for Cars & Bids (large galleries take time)

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

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(String(input || ''));
  const buf = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(buf);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
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

async function fetchJsonWithRetry(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
  maxRetries: number = 3,
): Promise<any> {
  let lastError: any = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
        console.log(`⏳ Retry ${attempt}/${maxRetries - 1} for ${label} after ${delay}ms delay...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      return await fetchJsonWithTimeout(url, init, timeoutMs, label);
    } catch (error: any) {
      lastError = error;
      const isRetryable = error?.message?.includes('timeout') || 
                        error?.message?.includes('aborted') ||
                        error?.message?.includes('network') ||
                        (error?.message?.includes('failed') && !error?.message?.includes('(4') && !error?.message?.includes('(5'));
      
      if (!isRetryable || attempt === maxRetries - 1) {
        throw error;
      }
      
      console.warn(`⚠️ ${label} attempt ${attempt + 1} failed (retryable: ${isRetryable}): ${error?.message}`);
    }
  }
  
  throw lastError;
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
    let upgraded = url;
    
    // Cars & Bids CDN: Remove width/quality params and use full resolution
    // Example: cdn-cgi/image/width=456,quality=70/... -> cdn-cgi/image/... (full res)
    if (upgraded.includes('cdn-cgi/image/')) {
      // Remove width and quality parameters from CDN URL
      upgraded = upgraded.replace(/cdn-cgi\/image\/width=\d+,quality=\d+\//, 'cdn-cgi/image/');
      upgraded = upgraded.replace(/cdn-cgi\/image\/width=\d+\//, 'cdn-cgi/image/');
      upgraded = upgraded.replace(/cdn-cgi\/image\/quality=\d+\//, 'cdn-cgi/image/');
    }
    
    // Remove all query params (resize, width, height, etc.)
    upgraded = upgraded.split('?')[0];
    
    // Remove size suffixes like -150x150, -300x300, -thumb, -small
    upgraded = upgraded
      .replace(/-\d+x\d+\.(jpg|jpeg|png|webp)$/i, '.$1')
      .replace(/-thumb(?:nail)?\.(jpg|jpeg|png|webp)$/i, '.$1')
      .replace(/-small\.(jpg|jpeg|png|webp)$/i, '.$1')
      .replace(/-medium\.(jpg|jpeg|png|webp)$/i, '.$1')
      .trim();
    
    return upgraded;
  };
  
  // Universal filter to exclude non-vehicle images (logos, icons, SVGs, etc.)
  const isGarbageImage = (url: string): boolean => {
    if (!url || typeof url !== 'string') return true;
    const lower = url.toLowerCase();
    
    // ALWAYS exclude SVGs (never vehicle photos)
    if (lower.endsWith('.svg') || lower.includes('.svg?')) return true;
    
    // CRITICAL: Exclude edit/preview/draft images - these are NOT final vehicle photos
    // Pattern: filename contains "(edit)", "(preview)", "(draft)", "edit)" without opening paren, etc.
    if (lower.includes('(edit)') || lower.includes('(preview)') || lower.includes('(draft)') || 
        lower.includes('edit).') || lower.includes('preview).') || lower.includes('draft).') ||
        lower.match(/\(edit/i) || lower.match(/edit\)/i)) {
      return true;
    }
    
    // Exclude paths with /edit/ that aren't in /photos/ context (editing interface, not gallery)
    if (lower.includes('/edit/') && !lower.includes('/photos/')) return true;
    
    // Exclude org branding and UI elements (these belong in org-assets bucket)
    if (lower.includes('/countries/')) return true; // Country flags
    if (lower.includes('/logo') || lower.includes('/logos/')) return true;
    if (lower.includes('/icon') || lower.includes('/icons/')) return true;
    if (lower.includes('/assets/') || lower.includes('/static/')) return true;
    if (lower.includes('/button') || lower.includes('/badge')) return true;
    if (lower.includes('/avatar') || lower.includes('/profile_pic')) return true;
    if (lower.includes('/favicon')) return true;
    if (lower.includes('/seller/')) return true;
    if (lower.includes('placeholder')) return true;
    
    // Exclude social sharing images
    if (lower.includes('linkedin.com') || lower.includes('shareArticle')) return true;
    if (lower.includes('facebook.com/sharer')) return true;
    if (lower.includes('twitter.com/share')) return true;
    
    return false;
  };
  
  // Filter function to exclude non-vehicle images (but KEEP documents - they're valuable!)
  const isVehicleImage = (url: string): boolean => {
    if (!url || typeof url !== 'string') return false;
    
    // Universal garbage filter first
    if (isGarbageImage(url)) return false;
    
    const lower = url.toLowerCase();
    // Must be from media.carsandbids.com (or cdn.carsandbids.com for CDN URLs)
    if (!lower.includes('media.carsandbids.com') && !lower.includes('cdn.carsandbids.com')) return false;
    
    // CRITICAL: Exclude Vimeo CDN thumbnails (these are video thumbnails, not vehicle photos)
    if (lower.includes('vimeocdn.com')) return false;
    if (lower.includes('vimeo.com')) return false;
    
    // Exclude video thumbnails/freeze frames
    if (lower.includes('/video') || lower.includes('/videos/') || lower.match(/video[\/\-]/)) return false;
    
    // Exclude thumbnail paths that are clearly UI elements, not gallery images
    if (lower.includes('/thumbnail') || lower.includes('/thumbnails/')) {
      // Only allow thumbnails if they're in a gallery/photos context
      if (!lower.match(/\/photos\/|\/images\/|\/gallery\/|\/auctions\//)) return false;
    }
    
    // Exclude tiny thumbnails by URL parameters (width=80, width=100, width=120, etc.)
    // These are UI thumbnails, not full-resolution vehicle images
    if (lower.includes('width=80') || lower.includes('width=100') || lower.includes('width=120')) {
      // Only allow if it's clearly a gallery image that will be upgraded
      if (!lower.match(/\/photos\/|\/images\/|\/gallery\/|\/auctions\//)) return false;
    }
    
    // Exclude avatar/profile images
    if (lower.includes('/avatar') || lower.includes('/profile') || lower.includes('/user/')) return false;
    
    // Exclude social sharing/preview images
    if (lower.includes('/og-image') || lower.includes('/preview') || lower.includes('/share')) return false;
    
    // Exclude icons/logos
    if (lower.includes('/icon') || lower.includes('/logo')) return false;
    
    // CRITICAL: Exclude edit/preview/draft images in filenames - these are NOT final vehicle photos
    // Pattern: filename contains "(edit)", "-(edit)", "(preview)", "(draft)", or variations
    // Examples: 3vpGQDzR.O-8lX-AMW-(edit).jpg, 3vpGQDzR.m870SuvV7-(edit).jpg
    // Valid images typically have paths like: /photos/s-1pEmzwg32wR.jpg or /photos/exterior/...
    if (lower.includes('(edit)') || lower.includes('-(edit)') || lower.includes('(preview)') || lower.includes('(draft)') ||
        lower.includes('edit).') || lower.includes('preview).') || lower.includes('draft).') ||
        lower.match(/\(edit/i) || lower.match(/edit\)/i) || lower.match(/[\.\-]edit\)/i) || lower.match(/\(edit[\.\-]/i)) {
      return false;
    }
    
    // Exclude application/upload paths that are clearly not gallery photos
    // Cars & Bids uses /photos/exterior/, /photos/interior/, /photos/other/ for real photos
    // But /photos/application/ often contains upload previews, not final gallery images
    if (lower.includes('/photos/application/') || lower.includes('/application/')) {
      // Only exclude if it's clearly an upload/preview, not a final photo
      // Keep if it looks like a final photo path (has proper filename structure)
      const filename = lower.split('/').pop() || '';
      // If filename looks like an upload preview (very short, or has upload markers)
      if (filename.length < 10 || filename.includes('upload') || filename.includes('temp') || filename.includes('preview')) {
        return false;
      }
    }
    
    // NOTE: Documents (window stickers, spec sheets, etc.) are KEPT - they're valuable data
    // They'll just be marked as is_document=true and excluded from primary selection
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
    
    // Extract img src, prioritizing full-res gallery images (pswp__img) then data-src, then src
    // Look for full-res gallery images first (Photoswipe pattern)
    const pswpImgPattern = /<img[^>]*class=["'][^"']*pswp__img[^"']*["'][^>]*src=["']([^"']+)["'][^>]*>/gi;
    let pswpMatch;
    while ((pswpMatch = pswpImgPattern.exec(searchHtml)) !== null) {
      const url = pswpMatch[1];
      if (url && isVehicleImage(url)) {
        const upgraded = upgradeToFullRes(url);
        if (upgraded) urls.add(upgraded);
      }
    }
    
    // Then extract from regular img tags, prioritizing data-src (lazy loading) then src, then data-full
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
  
  // Method 4: Extract from JSON-LD structured data (if present)
  try {
    const jsonLdPattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis;
    let jsonLdMatch;
    while ((jsonLdMatch = jsonLdPattern.exec(h)) !== null) {
      try {
        const jsonData = JSON.parse(jsonLdMatch[1]);
        // Look for image arrays in structured data
        if (jsonData.image && Array.isArray(jsonData.image)) {
          for (const img of jsonData.image) {
            const url = typeof img === 'string' ? img : (img.url || img.contentUrl || null);
            if (url && isVehicleImage(url)) {
              const upgraded = upgradeToFullRes(url);
              if (upgraded) urls.add(upgraded);
            }
          }
        }
      } catch {
        // Not valid JSON, continue
      }
    }
  } catch (e: any) {
    console.warn('Error extracting from JSON-LD:', e?.message);
  }
  
  // Method 5: Extract from __NEXT_DATA__ (PRIORITY - Cars & Bids uses Next.js)
  try {
    const nextDataPattern = /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>(.*?)<\/script>/gis;
    const nextDataMatch = h.match(nextDataPattern);
    if (nextDataMatch && nextDataMatch[1]) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        
        // CRITICAL: Cars & Bids stores images at props.pageProps.auction.images or props.pageProps.auction.photos
        // Navigate directly to the auction object (most reliable path)
        const auction = nextData?.props?.pageProps?.auction || 
                       nextData?.props?.pageProps?.data?.auction ||
                       nextData?.props?.pageProps?.listing ||
                       nextData?.props?.auction ||
                       nextData?.auction;
        
        // Recursive function to find ALL images in the __NEXT_DATA__ structure
        // This is critical because Cars & Bids may store images in various nested locations
        const findImagesInObject = (obj: any, depth = 0, seen = new Set<any>()): string[] => {
          if (depth > 12) return []; // Increased depth limit
          if (!obj || typeof obj !== 'object') return [];
          if (seen.has(obj)) return []; // Avoid circular references
          seen.add(obj);
          
          const found: string[] = [];
          
          // Check if this is an array of images
          if (Array.isArray(obj)) {
            for (const item of obj) {
              if (typeof item === 'string' && isVehicleImage(item)) {
                found.push(upgradeToFullRes(item));
              } else if (typeof item === 'object' && item !== null) {
                // Check if this object represents an image (has url/src properties)
                const imgUrl = item.url || item.src || item.full || item.original || item.large || item.image || item.photo || null;
                if (imgUrl && typeof imgUrl === 'string' && isVehicleImage(imgUrl)) {
                  found.push(upgradeToFullRes(imgUrl));
                  // Also check variants
                  const variants = [item.full, item.original, item.large, item.medium, item.highRes, item.high_res];
                  for (const variant of variants) {
                    if (variant && typeof variant === 'string' && isVehicleImage(variant)) {
                      found.push(upgradeToFullRes(variant));
                    }
                  }
                }
                // Recursively search nested objects
                found.push(...findImagesInObject(item, depth + 1, seen));
              }
            }
          } else {
            // Check known image array keys first
            const imageKeys = ['images', 'photos', 'gallery', 'media', 'imageUrls', 'photoUrls', 'image_urls', 'photo_urls', 'items', 'results'];
            for (const key of imageKeys) {
              const value = obj[key];
              if (Array.isArray(value)) {
                for (const img of value) {
                  if (typeof img === 'string' && isVehicleImage(img)) {
                    found.push(upgradeToFullRes(img));
                  } else if (typeof img === 'object' && img !== null) {
                    const imgUrl = img.url || img.src || img.full || img.original || img.large || img.image || img.photo || null;
                    if (imgUrl && typeof imgUrl === 'string' && isVehicleImage(imgUrl)) {
                      found.push(upgradeToFullRes(imgUrl));
                      // Check variants
                      const variants = [img.full, img.original, img.large, img.medium, img.highRes, img.high_res];
                      for (const variant of variants) {
                        if (variant && typeof variant === 'string' && isVehicleImage(variant)) {
                          found.push(upgradeToFullRes(variant));
                        }
                      }
                    }
                  }
                }
              } else if (typeof value === 'string' && isVehicleImage(value)) {
                found.push(upgradeToFullRes(value));
              }
            }
            
            // Recursively search ALL nested objects (not just known keys)
            // This catches images stored in unexpected locations
            if (depth < 8) {
              for (const key of Object.keys(obj)) {
                const value = obj[key];
                // Skip already-processed image keys to avoid duplicates
                if (imageKeys.includes(key)) continue;
                // Skip non-object values (primitives won't contain images)
                if (value && typeof value === 'object') {
                  found.push(...findImagesInObject(value, depth + 1, seen));
                }
                // Also check if the value itself is an image URL string
                if (typeof value === 'string' && isVehicleImage(value)) {
                  found.push(upgradeToFullRes(value));
                }
              }
            }
          }
          
          return found;
        };
        
        // First try direct paths (faster)
        if (auction) {
          const imageArrays = [
            auction.images,
            auction.photos,
            auction.gallery,
            auction.media,
            auction.photoUrls,
            auction.imageUrls,
            auction.image_urls,
            auction.photo_urls,
          ].filter(Boolean);
          
          for (const imageArray of imageArrays) {
            if (Array.isArray(imageArray)) {
              for (const img of imageArray) {
                let url: string | null = null;
                if (typeof img === 'string') {
                  url = img;
                } else if (typeof img === 'object' && img !== null) {
                  url = img.url || img.src || img.full || img.original || img.large || img.image || img.photo || null;
                }
                
                if (url && typeof url === 'string' && isVehicleImage(url)) {
                  const upgraded = upgradeToFullRes(url);
                  if (upgraded) {
                    urls.add(upgraded);
                    // Also add variants
                    if (img && typeof img === 'object') {
                      const variants = [img.full, img.original, img.large, img.medium, img.highRes, img.high_res];
                      for (const variant of variants) {
                        if (variant && typeof variant === 'string' && isVehicleImage(variant)) {
                          urls.add(upgradeToFullRes(variant));
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
        
        // ALWAYS do recursive search to find ALL images (not just when urls.size === 0)
        // Cars & Bids may store images in nested structures that direct paths miss
        const nextDataImages = findImagesInObject(auction || nextData);
        for (const img of nextDataImages) {
          if (img) urls.add(img);
        }
        
        if (urls.size > 0) {
          console.log(`✅ Extracted ${urls.size} images from __NEXT_DATA__`);
        }
      } catch (e: any) {
        console.warn('Error parsing __NEXT_DATA__ for images:', e?.message);
      }
    }
  } catch (e: any) {
    console.warn('Error extracting from __NEXT_DATA__:', e?.message);
  }
  
  // Method 6: Aggressive extraction - find ALL media.carsandbids.com URLs in HTML
  // This catches images that might be in data attributes, CSS, or other places
  const mediaCarsAndBidsPattern = /https?:\/\/media\.carsandbids\.com\/[^"'\\s>]+?\.(?:jpg|jpeg|png|webp)(?:\?[^"'\\s>]*)?/gi;
  const allMediaUrls = h.match(mediaCarsAndBidsPattern) || [];
  for (const urlMatch of allMediaUrls) {
    const url = urlMatch.trim();
    if (isVehicleImage(url)) {
      const upgraded = upgradeToFullRes(url);
      if (upgraded) urls.add(upgraded);
    }
  }
  
  // Method 7: Extract from srcset attributes (responsive images)
  const srcsetPattern = /srcset=["']([^"']+)["']/gi;
  let srcsetMatch;
  while ((srcsetMatch = srcsetPattern.exec(h)) !== null) {
    const srcsetValue = srcsetMatch[1];
    // Parse srcset: "url1 1x, url2 2x" or "url1 800w, url2 1200w"
    const urlMatches = srcsetValue.match(/https?:\/\/media\.carsandbids\.com\/[^"'\\s,>]+?\.(?:jpg|jpeg|png|webp)(?:\?[^"'\\s,>]*)?/gi);
    if (urlMatches) {
      for (const url of urlMatches) {
        if (isVehicleImage(url)) {
          const upgraded = upgradeToFullRes(url);
          if (upgraded) urls.add(upgraded);
        }
      }
    }
  }
  
  // Method 8: Look for gallery JSON in script tags with more flexible patterns
  try {
    const scriptPattern = /<script[^>]*>(.*?)<\/script>/gis;
    let scriptMatch;
    while ((scriptMatch = scriptPattern.exec(h)) !== null && urls.size < 200) {
      const scriptContent = scriptMatch[1];
      // Look for arrays of image objects or URLs
      const flexiblePatterns = [
        /(?:photos|images|gallery|media)\s*[:=]\s*\[([^\]]{0,500000})\]/gi,
        /\[([^\]]{0,500000})\]/g, // Any large array that might contain images
      ];
      
      for (const pattern of flexiblePatterns) {
        const matches = scriptContent.matchAll(pattern);
        for (const match of matches) {
          try {
            // Try to parse as JSON array
            const jsonStr = `[${match[1]}]`;
            const parsed = JSON.parse(jsonStr);
            if (Array.isArray(parsed)) {
              for (const item of parsed) {
                if (typeof item === 'string' && item.includes('media.carsandbids.com')) {
                  if (isVehicleImage(item)) {
                    urls.add(upgradeToFullRes(item));
                  }
                } else if (typeof item === 'object' && item !== null) {
                  // Check all string properties for image URLs
                  for (const value of Object.values(item)) {
                    if (typeof value === 'string' && value.includes('media.carsandbids.com')) {
                      if (isVehicleImage(value)) {
                        urls.add(upgradeToFullRes(value));
                      }
                    }
                  }
                }
              }
            }
          } catch {
            // Not valid JSON, try regex extraction from the match
            const urlMatches = match[1].match(/https?:\/\/media\.carsandbids\.com\/[^"'\\s,>]+?\.(?:jpg|jpeg|png|webp)(?:\?[^"'\\s,>]*)?/gi);
            if (urlMatches) {
              for (const url of urlMatches) {
                if (isVehicleImage(url)) {
                  urls.add(upgradeToFullRes(url));
                }
              }
            }
          }
        }
      }
    }
  } catch (e: any) {
    console.warn('Error in flexible script extraction:', e?.message);
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
  
  // Return ALL images - no limit (galleries can have 100+ images)
  return finalUrls;
}

function extractCarsAndBidsAuctionData(html: string): {
  current_bid?: number | null;
  bid_count?: number | null;
  reserve_met?: boolean | null;
  reserve_price?: number | null;
  auction_end_date?: string | null;
  final_price?: number | null;
  sale_date?: string | null;
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
  
  // Extract final/sale price (for ended auctions) - improved patterns
  const finalPricePatterns = [
    // Cars & Bids specific: "Sold for <span class="bid-value">$19,500</span>"
    /Sold\s+for[^>]*>.*?<span[^>]*class=["'][^"']*bid[_-]?value[^"']*["'][^>]*>\$?([\d,]+)<\/span>/i,
    /Sold\s+for[^>]*>.*?\$([\d,]+)/i,
    /<span[^>]*class=["'][^"']*bid[_-]?value[^"']*["'][^>]*>\$?([\d,]+)<\/span>/i,
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
  
  // Extract sale date (for ended auctions) - e.g., "5/22/25" or "May 22, 2025"
  const saleDatePatterns = [
    // Cars & Bids pattern: <span class="time-ended">5/22/25</span>
    /<span[^>]*class[^>]*time-ended[^>]*>(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    // Generic patterns
    /Sold\s+(?:for|on)[^>]*>.*?(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /Sold\s+on[^>]*>.*?(\w+\s+\d{1,2},\s+\d{4})/i,
    /Ended[^>]*>.*?(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    // JSON
    /"saleDate"\s*:\s*"([^"]+)"/i,
    /"soldAt"\s*:\s*"([^"]+)"/i,
  ];
  
  for (const pattern of saleDatePatterns) {
    const match = h.match(pattern);
    if (match && match[1]) {
      const dateStr = match[1].trim();
      // Parse date string (handles M/D/YY, MM/DD/YYYY, and "Month DD, YYYY" formats)
      const parsed = Date.parse(dateStr);
      if (Number.isFinite(parsed)) {
        result.sale_date = new Date(parsed).toISOString().split('T')[0]; // Store as YYYY-MM-DD
        break;
      }
      // Try manual parsing for M/D/YY format (e.g., "5/22/25")
      const mdyMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
      if (mdyMatch) {
        const month = parseInt(mdyMatch[1], 10);
        const day = parseInt(mdyMatch[2], 10);
        let year = parseInt(mdyMatch[3], 10);
        // Convert 2-digit year to 4-digit (assume 2000s if < 50, else 1900s)
        if (year < 100) {
          year = year < 50 ? 2000 + year : 1900 + year;
        }
        try {
          const date = new Date(year, month - 1, day);
          if (Number.isFinite(date.getTime())) {
            result.sale_date = date.toISOString().split('T')[0];
            break;
          }
        } catch {
          // continue to next pattern
        }
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

function extractCarsAndBidsVIN(html: string): string | null {
  const h = String(html || "");
  
  // Pattern 1: VIN in specs table - look for "VIN:" label followed by VIN
  const vinPatterns = [
    /VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i,
    /VIN[:\s]*<[^>]*>([A-HJ-NPR-Z0-9]{17})/i,
    /VIN[:\s]*<\/[^>]*>([A-HJ-NPR-Z0-9]{17})/i,
    /<td[^>]*>VIN[:\s]*<\/td>\s*<td[^>]*>([A-HJ-NPR-Z0-9]{17})/i,
    /<dt[^>]*>VIN[:\s]*<\/dt>\s*<dd[^>]*>([A-HJ-NPR-Z0-9]{17})/i,
    // Pattern 2: VIN in title/heading
    /VIN:\s*([A-HJ-NPR-Z0-9]{17})/i,
    // Pattern 3: Standalone 17-character VIN (alphanumeric, no I, O, Q)
    /\b([A-HJ-NPR-Z0-9]{17})\b/,
  ];
  
  for (const pattern of vinPatterns) {
    const match = h.match(pattern);
    if (match && match[1]) {
      const vin = match[1].trim().toUpperCase();
      // Validate VIN format (17 chars, no I, O, Q)
      if (vin.length === 17 && /^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
        return vin;
      }
    }
  }
  
  return null;
}

function extractCarsAndBidsDescription(html: string): string | null {
  const h = String(html || "");
  
  // Pattern 1: Look for description in common containers
  const descriptionPatterns = [
    // Cars & Bids specific patterns
    /<div[^>]*class=["'][^"']*description[^"']*["'][^>]*>([\s\S]{100,10000})<\/div>/i,
    /<section[^>]*class=["'][^"']*description[^"']*["'][^>]*>([\s\S]{100,10000})<\/section>/i,
    /<div[^>]*id=["'][^"']*description[^"']*["'][^>]*>([\s\S]{100,10000})<\/div>/i,
    // Generic content areas
    /<article[^>]*>([\s\S]{200,10000})<\/article>/i,
    /<div[^>]*class=["'][^"']*content[^"']*["'][^>]*>([\s\S]{200,10000})<\/div>/i,
    // Look for paragraphs after title/heading
    /<h[1-6][^>]*>[\s\S]{0,200}<\/h[1-6]>[\s\S]{0,50}(<p[^>]*>[\s\S]{100,5000}<\/p>)/i,
  ];
  
  for (const pattern of descriptionPatterns) {
    const match = h.match(pattern);
    if (match && match[1]) {
      // Clean HTML tags and extract text
      let text = match[1]
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
      
      // Filter out very short or very long text (likely not description)
      if (text.length >= 100 && text.length <= 10000) {
        // Remove common noise patterns
        if (!text.toLowerCase().includes('cookie') && 
            !text.toLowerCase().includes('privacy policy') &&
            !text.toLowerCase().includes('terms of service')) {
          return text;
        }
      }
    }
  }
  
  // Pattern 2: Extract all paragraph text and combine
  const paragraphPattern = /<p[^>]*>([\s\S]{50,2000})<\/p>/gi;
  const paragraphs: string[] = [];
  let paraMatch;
  while ((paraMatch = paragraphPattern.exec(h)) !== null && paragraphs.length < 10) {
    let text = paraMatch[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
    
    if (text.length >= 50 && text.length <= 2000) {
      // Skip navigation, footer, header text
      const lower = text.toLowerCase();
      if (!lower.includes('sign up') && 
          !lower.includes('log in') &&
          !lower.includes('cookie') &&
          !lower.includes('privacy')) {
        paragraphs.push(text);
      }
    }
  }
  
  if (paragraphs.length > 0) {
    const combined = paragraphs.join('\n\n').trim();
    if (combined.length >= 100) {
      return combined;
    }
  }
  
  return null;
}

function extractCarsAndBidsBidHistory(html: string): Array<{ amount: number; timestamp?: string; bidder?: string }> {
  const h = String(html || "");
  const bids: Array<{ amount: number; timestamp?: string; bidder?: string }> = [];
  
  // PRIORITY: Extract from __NEXT_DATA__ (Next.js embeds all data here)
  try {
    const nextDataPattern = /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>(.*?)<\/script>/gis;
    const nextDataMatch = h.match(nextDataPattern);
    if (nextDataMatch && nextDataMatch[1]) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        // Navigate through Next.js structure: props.pageProps.auction.bids or similar
        const auction = nextData?.props?.pageProps?.auction || 
                       nextData?.props?.pageProps?.data?.auction ||
                       nextData?.props?.auction ||
                       nextData?.auction;
        
        if (auction) {
          // Extract bids from Next.js data
          if (Array.isArray(auction.bids)) {
            for (const bid of auction.bids) {
              if (bid.amount && typeof bid.amount === 'number') {
                bids.push({
                  amount: bid.amount,
                  timestamp: bid.timestamp || bid.created_at || bid.date,
                  bidder: bid.bidder || bid.username || bid.user?.username,
                });
              }
            }
          }
          
          // Also check bid_history
          if (Array.isArray(auction.bid_history)) {
            for (const bid of auction.bid_history) {
              if (bid.amount && typeof bid.amount === 'number') {
                bids.push({
                  amount: bid.amount,
                  timestamp: bid.timestamp || bid.created_at || bid.date,
                  bidder: bid.bidder || bid.username || bid.user?.username,
                });
              }
            }
          }
        }
      } catch (e: any) {
        console.warn('Failed to parse __NEXT_DATA__ for bids:', e?.message);
      }
    }
  } catch (e: any) {
    console.warn('Error extracting bids from __NEXT_DATA__:', e?.message);
  }
  
  // If we got bids from __NEXT_DATA__, return them (more reliable)
  if (bids.length > 0) {
    return bids.sort((a, b) => (b.amount || 0) - (a.amount || 0));
  }
  
  // Fallback: Parse from HTML
  // Helper to parse currency
  const parseCurrency = (text: string): number | null => {
    const match = text.match(/[\$]?([\d,]+)/);
    if (match && match[1]) {
      const amount = parseInt(match[1].replace(/,/g, ''), 10);
      return Number.isFinite(amount) && amount > 0 ? amount : null;
    }
    return null;
  };
  
  // Helper to parse timestamp
  const parseTimestamp = (text: string): string | undefined => {
    // Look for date patterns: "on 12/30/24", "December 30, 2024", etc.
    const datePatterns = [
      /on\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
      /(\d{1,2}\/\d{1,2}\/\d{2,4})/,
      /(\w+\s+\d{1,2},\s+\d{4})/,
    ];
    
    for (const pattern of datePatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        try {
          const date = new Date(match[1]);
          if (Number.isFinite(date.getTime())) {
            return date.toISOString();
          }
        } catch {
          // Try manual parsing for M/D/YY format
          const mdyMatch = match[1].match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
          if (mdyMatch) {
            const month = parseInt(mdyMatch[1], 10);
            const day = parseInt(mdyMatch[2], 10);
            let year = parseInt(mdyMatch[3], 10);
            if (year < 100) {
              year = year < 50 ? 2000 + year : 1900 + year;
            }
            const date = new Date(year, month - 1, day);
            if (Number.isFinite(date.getTime())) {
              return date.toISOString();
            }
          }
        }
      }
    }
    return undefined;
  };
  
  // Pattern 1: Bid comments - "USD $X bid placed by username on date"
  const bidCommentPatterns = [
    /USD\s*\$([0-9,]+)\s+bid\s+placed\s+by\s+([A-Za-z0-9_]+)[^<]*(?:on\s+([^<]+))?/gi,
    /\$([0-9,]+)\s+bid\s+placed\s+by\s+([A-Za-z0-9_]+)[^<]*(?:on\s+([^<]+))?/gi,
    /Bid\s+of\s+\$([0-9,]+)\s+by\s+([A-Za-z0-9_]+)[^<]*(?:on\s+([^<]+))?/gi,
  ];
  
  for (const pattern of bidCommentPatterns) {
    let match;
    while ((match = pattern.exec(h)) !== null) {
      const amount = parseCurrency(match[1]);
      const bidder = match[2]?.trim();
      const timestamp = match[3] ? parseTimestamp(match[3]) : undefined;
      
      if (amount && bidder) {
        bids.push({ amount, timestamp, bidder });
      }
    }
  }
  
  // Pattern 2: Bid history table/list
  const bidTablePattern = /<[^>]*class=["'][^"']*(?:bid[_-]?history|bid[_-]?list|bids[_-]?table)[^"']*["'][^>]*>([\s\S]{0,5000})<\/[^>]+>/i;
  const tableMatch = h.match(bidTablePattern);
  if (tableMatch) {
    const tableHtml = tableMatch[1];
    const rowPattern = /<tr[^>]*>[\s\S]{0,500}<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowPattern.exec(tableHtml)) !== null) {
      const rowHtml = rowMatch[0];
      const amountMatch = rowHtml.match(/\$([0-9,]+)/);
      const bidderMatch = rowHtml.match(/>([A-Za-z0-9_]+)</);
      const dateMatch = rowHtml.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
      
      if (amountMatch) {
        const amount = parseCurrency(amountMatch[1]);
        const bidder = bidderMatch ? bidderMatch[1] : undefined;
        const timestamp = dateMatch ? parseTimestamp(dateMatch[1]) : undefined;
        
        if (amount) {
          bids.push({ amount, timestamp, bidder });
        }
      }
    }
  }
  
  // Sort by amount (descending) and remove duplicates
  const uniqueBids = new Map<string, { amount: number; timestamp?: string; bidder?: string }>();
  for (const bid of bids) {
    const key = `${bid.amount}-${bid.bidder || ''}`;
    if (!uniqueBids.has(key) || (bid.timestamp && !uniqueBids.get(key)?.timestamp)) {
      uniqueBids.set(key, bid);
    }
  }
  
  return Array.from(uniqueBids.values()).sort((a, b) => b.amount - a.amount);
}

function extractCarsAndBidsStructuredSections(html: string): {
  dougs_take?: string;
  highlights?: string[];
  equipment?: string[];
  modifications?: string[];
  known_flaws?: string[];
  recent_service_history?: string;
  other_items?: string[];
  ownership_history?: string;
  seller_notes?: string;
} {
  const h = String(html || "");
  const result: any = {};
  
  // PRIORITY: Extract from __NEXT_DATA__ (Next.js embeds all data here)
  try {
    const nextDataPattern = /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>(.*?)<\/script>/gis;
    const nextDataMatch = h.match(nextDataPattern);
    if (nextDataMatch && nextDataMatch[1]) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        // Navigate through Next.js structure
        const auction = nextData?.props?.pageProps?.auction || 
                       nextData?.props?.pageProps?.data?.auction ||
                       nextData?.props?.auction ||
                       nextData?.auction;
        
        if (auction) {
          // Extract structured sections from Next.js data
          if (auction.dougs_take || auction.dougsTake) {
            result.dougs_take = auction.dougs_take || auction.dougsTake;
          }
          if (Array.isArray(auction.highlights)) {
            result.highlights = auction.highlights;
          }
          if (Array.isArray(auction.equipment)) {
            result.equipment = auction.equipment;
          }
          if (Array.isArray(auction.modifications)) {
            result.modifications = auction.modifications;
          }
          if (Array.isArray(auction.known_flaws) || Array.isArray(auction.knownFlaws)) {
            result.known_flaws = auction.known_flaws || auction.knownFlaws;
          }
          if (auction.recent_service_history || auction.recentServiceHistory) {
            result.recent_service_history = auction.recent_service_history || auction.recentServiceHistory;
          }
          if (Array.isArray(auction.other_items) || Array.isArray(auction.otherItems)) {
            result.other_items = auction.other_items || auction.otherItems;
          }
          if (auction.ownership_history || auction.ownershipHistory) {
            result.ownership_history = auction.ownership_history || auction.ownershipHistory;
          }
          if (auction.seller_notes || auction.sellerNotes) {
            result.seller_notes = auction.seller_notes || auction.sellerNotes;
          }
          
          // If we got data from __NEXT_DATA__, return it (more reliable)
          if (Object.keys(result).length > 0) {
            return result;
          }
        }
      } catch (e: any) {
        console.warn('Failed to parse __NEXT_DATA__ for structured sections:', e?.message);
      }
    }
  } catch (e: any) {
    console.warn('Error extracting structured sections from __NEXT_DATA__:', e?.message);
  }
  
  // Fallback: Extract from HTML
  // Extract "Doug's Take" section - try multiple patterns
  const dougsTakePatterns = [
    /<div[^>]*class=["'][^"']*dougs[_-]?take[^"']*["'][^>]*>[\s\S]*?<div[^>]*class=["'][^"']*detail[_-]?body[^"']*["'][^>]*>([\s\S]{0,10000})<\/div>/i,
    /<h4[^>]*>Doug['"]s\s+Take<\/h4>[\s\S]*?<div[^>]*class=["'][^"']*detail[_-]?body[^"']*["'][^>]*>([\s\S]{0,10000})<\/div>/i,
    /<section[^>]*class=["'][^"']*dougs[_-]?take[^"']*["'][^>]*>([\s\S]{0,10000})<\/section>/i,
    /"dougsTake":\s*"([^"]+)"/i,
    /"dougs_take":\s*"([^"]+)"/i,
  ];
  
  for (const pattern of dougsTakePatterns) {
    const match = h.match(pattern);
    if (match && match[1]) {
      result.dougs_take = match[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/\\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (result.dougs_take.length > 50) break; // Found valid content
    }
  }
  
  // Extract Highlights (ul list) - try multiple patterns
  const highlightsPatterns = [
    /<h4[^>]*>Highlights<\/h4>[\s\S]*?<div[^>]*class=["'][^"']*detail[_-]?body[^"']*["'][^>]*>([\s\S]{0,20000})<\/div>/i,
    /<h3[^>]*>Highlights<\/h3>[\s\S]*?<ul[^>]*>([\s\S]{0,20000})<\/ul>/i,
    /"highlights":\s*\[([^\]]+)\]/i,
  ];
  
  for (const pattern of highlightsPatterns) {
    const match = h.match(pattern);
    if (match && match[1]) {
      const liMatches = match[1].matchAll(/<li[^>]*>([^<]+(?:<[^>]+>[^<]+<\/[^>]+>)*[^<]*)<\/li>/gi);
      result.highlights = [];
      for (const liMatch of liMatches) {
        const text = liMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (text.length > 10) result.highlights.push(text);
      }
      // Also try JSON array format
      if (result.highlights.length === 0 && pattern.source.includes('"highlights"')) {
        try {
          const jsonArray = JSON.parse(`[${match[1]}]`);
          if (Array.isArray(jsonArray)) {
            result.highlights = jsonArray.filter((item: any) => typeof item === 'string' && item.length > 10);
          }
        } catch {
          // Not valid JSON, continue
        }
      }
      if (result.highlights.length > 0) break; // Found valid highlights
    }
  }
  
  // Helper function to extract list sections
  const extractListSection = (sectionName: string, html: string, maxLength = 20000): string[] => {
    const patterns = [
      new RegExp(`<h4[^>]*>${sectionName}<\\/h4>[\\s\\S]*?<div[^>]*class=["'][^"']*detail[_-]?body[^"']*["'][^>]*>([\\s\\S]{0,${maxLength}})<\\/div>`, 'i'),
      new RegExp(`<h3[^>]*>${sectionName}<\\/h3>[\\s\\S]*?<ul[^>]*>([\\s\\S]{0,${maxLength}})<\\/ul>`, 'i'),
      new RegExp(`"${sectionName.toLowerCase().replace(/\s+/g, '_')}":\\s*\\[([^\\]]+)\\]`, 'i'),
    ];
    
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        const items: string[] = [];
        // Try HTML list items
        const liMatches = match[1].matchAll(/<li[^>]*>([^<]+(?:<[^>]+>[^<]+<\/[^>]+>)*[^<]*)<\/li>/gi);
        for (const liMatch of liMatches) {
          const text = liMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          if (text.length > 5) items.push(text);
        }
        // If no HTML items found, try JSON array
        if (items.length === 0 && pattern.source.includes('"')) {
          try {
            const jsonArray = JSON.parse(`[${match[1]}]`);
            if (Array.isArray(jsonArray)) {
              items.push(...jsonArray.filter((item: any) => typeof item === 'string' && item.length > 5));
            }
          } catch {
            // Not valid JSON, continue
          }
        }
        if (items.length > 0) return items;
      }
    }
    return [];
  };
  
  // Extract Equipment (ul list)
  result.equipment = extractListSection('Equipment', h, 20000);
  
  // Extract Modifications
  result.modifications = extractListSection('Modifications', h, 30000);
  
  // Extract Known Flaws
  result.known_flaws = extractListSection('Known Flaws', h, 20000);
  
  // Helper function to extract text sections
  const extractTextSection = (sectionName: string, html: string, maxLength = 10000): string | null => {
    const patterns = [
      new RegExp(`<h4[^>]*>${sectionName}<\\/h4>[\\s\\S]*?<div[^>]*class=["'][^"']*detail[_-]?body[^"']*["'][^>]*>([\\s\\S]{0,${maxLength}})<\\/div>`, 'i'),
      new RegExp(`<h3[^>]*>${sectionName}<\\/h3>[\\s\\S]*?<div[^>]*class=["'][^"']*content[^"']*["'][^>]*>([\\s\\S]{0,${maxLength}})<\\/div>`, 'i'),
      new RegExp(`"${sectionName.toLowerCase().replace(/\s+/g, '_')}":\\s*"([^"]+)"`, 'i'),
    ];
    
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        const text = match[1]
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/\\n/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (text.length > 20) return text;
      }
    }
    return null;
  };
  
  // Extract Recent Service History
  result.recent_service_history = extractTextSection('Recent Service History', h, 20000);
  
  // Extract Other Items
  result.other_items = extractListSection('Other Items Included in Sale', h, 20000);
  
  // Extract Ownership History
  result.ownership_history = extractTextSection('Ownership History', h, 10000);
  
  // Extract Seller Notes
  result.seller_notes = extractTextSection('Seller Notes', h, 10000);
  
  return result;
}

function extractCarsAndBidsBidders(html: string): Array<{ username: string; profile_url: string; is_buyer?: boolean; is_seller?: boolean }> {
  const h = String(html || "");
  const bidders = new Map<string, { username: string; profile_url: string; is_buyer?: boolean; is_seller?: boolean }>();
  
  // PRIORITY: Extract from __NEXT_DATA__ (Next.js embeds all data here)
  try {
    const nextDataPattern = /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>(.*?)<\/script>/gis;
    const nextDataMatch = h.match(nextDataPattern);
    if (nextDataMatch && nextDataMatch[1]) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        // Navigate through Next.js structure
        const auction = nextData?.props?.pageProps?.auction || 
                       nextData?.props?.pageProps?.data?.auction ||
                       nextData?.props?.auction ||
                       nextData?.auction;
        
        if (auction) {
          // Extract buyer
          if (auction.buyer || auction.winning_bidder) {
            const buyer = auction.buyer || auction.winning_bidder;
            const username = buyer.username || buyer.handle || buyer.name || String(buyer);
            const profileUrl = buyer.profile_url || buyer.url || `https://carsandbids.com/user/${username}`;
            if (username) {
              bidders.set(username, { username, profile_url: profileUrl, is_buyer: true });
            }
          }
          
          // Extract seller
          if (auction.seller) {
            const seller = auction.seller;
            const username = seller.username || seller.handle || seller.name || String(seller);
            const profileUrl = seller.profile_url || seller.url || `https://carsandbids.com/user/${username}`;
            if (username) {
              bidders.set(username, { username, profile_url: profileUrl, is_seller: true });
            }
          }
          
          // Extract all bidders from bids
          if (Array.isArray(auction.bids) || Array.isArray(auction.bid_history)) {
            const bidList = auction.bids || auction.bid_history || [];
            for (const bid of bidList) {
              const bidder = bid.bidder || bid.username || bid.user?.username;
              if (bidder && !bidders.has(bidder)) {
                bidders.set(bidder, {
                  username: bidder,
                  profile_url: bid.profile_url || bid.user?.profile_url || `https://carsandbids.com/user/${bidder}`,
                });
              }
            }
          }
          
          // Extract bidders from comments
          if (Array.isArray(auction.comments)) {
            for (const comment of auction.comments) {
              const author = comment.author || comment.username || comment.user?.username;
              if (author && !bidders.has(author)) {
                bidders.set(author, {
                  username: author,
                  profile_url: comment.profile_url || comment.user?.profile_url || `https://carsandbids.com/user/${author}`,
                });
              }
            }
          }
        }
      } catch (e: any) {
        console.warn('Failed to parse __NEXT_DATA__ for bidders:', e?.message);
      }
    }
  } catch (e: any) {
    console.warn('Error extracting bidders from __NEXT_DATA__:', e?.message);
  }
  
  // Fallback: Extract from HTML
  // Extract buyer (Sold to)
  const soldToMatch = h.match(/Sold\s+to[^>]*>[\s\S]*?<a[^>]*title=["']([^"']+)["'][^>]*class=["'][^"']*user[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/i);
  if (soldToMatch && soldToMatch[1] && soldToMatch[2]) {
    const username = soldToMatch[1].trim();
    const profileUrl = soldToMatch[2].startsWith('http') ? soldToMatch[2] : `https://carsandbids.com${soldToMatch[2]}`;
    if (!bidders.has(username)) {
      bidders.set(username, { username, profile_url: profileUrl, is_buyer: true });
    }
  }
  
  // Extract all user links (bidders, commenters, etc.)
  const userLinkPattern = /<a[^>]*title=["']([^"']+)["'][^>]*class=["'][^"']*user[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
  let userMatch;
  while ((userMatch = userLinkPattern.exec(h)) !== null) {
    const username = userMatch[1].trim();
    const profileUrl = userMatch[2].startsWith('http') ? userMatch[2] : `https://carsandbids.com${userMatch[2]}`;
    if (username && !bidders.has(username)) {
      bidders.set(username, { username, profile_url: profileUrl });
    }
  }
  
  // Extract from bid history (bidder usernames)
  const bidderPattern = /bid\s+placed\s+by\s+([A-Za-z0-9_]+)/gi;
  let bidderMatch;
  while ((bidderMatch = bidderPattern.exec(h)) !== null) {
    const username = bidderMatch[1].trim();
    if (username && !bidders.has(username)) {
      bidders.set(username, { 
        username, 
        profile_url: `https://carsandbids.com/user/${username}` 
      });
    }
  }
  
  return Array.from(bidders.values());
}

function extractCarsAndBidsComments(html: string): Array<{ author: string; text: string; timestamp?: string; is_seller?: boolean; is_bid?: boolean; bid_amount?: number; profile_url?: string }> {
  const h = String(html || "");
  const comments: Array<{ author: string; text: string; timestamp?: string; is_seller?: boolean; is_bid?: boolean; bid_amount?: number; profile_url?: string }> = [];

  const isGarbageCommentText = (text: string): boolean => {
    const t = String(text || '').trim();
    if (!t) return true;
    const lower = t.toLowerCase();
    // Common C&B UI chrome that we must never store as a comment
    if (lower.includes('comments & bids')) return true;
    if (lower.includes('most upvoted')) return true;
    if (lower.includes('newest')) return true;
    if (lower.includes('add a comment')) return true;
    if (lower.includes('bid history')) return true;
    if (lower.includes('you just commented')) return true;
    if (lower.startsWith('comments ')) return true;
    // Very short nav-like strings
    if (t.length < 8) return true;
    return false;
  };

  const sanitizeCommentText = (text: string): string => {
    let t = String(text || '');

    // Normalize whitespace first so tokens like "Ico\nn" become "Ico n" and match patterns.
    t = t.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();

    // Strip leading relative time prefixes that sometimes get merged into the text (e.g. "3d ...", "1h ...").
    t = t
      .replace(/^[^A-Za-z0-9$]*?/g, '')
      .replace(/^\d+\s*(?:m|h|d|w|mo|y)\s+/i, '');

    // Strip common UI chrome strings that sometimes get embedded in the comment body.
    // We keep the actual message content (often after "Re:").
    t = t
      .replace(/^follow\s+[A-Za-z0-9_\-]+\s+/i, '')
      .replace(/\breputation\s+icon\b\s*[0-9]+(?:\.[0-9]+)?k?\b/gi, ' ')
      .replace(/\breputation\s+icon\b/gi, ' ')
      .replace(/\bseller\b\s*[0-9]+(?:\.[0-9]+)?k?\s*(?:m|h|d|w|mo|y)\b/gi, ' ')
      .replace(/\breply\b\s*flag\s+as\s+inappropriate\b/gi, ' ')
      .replace(/\bflag\s+as\s+inappropriate\b/gi, ' ')
      .replace(/\breply\b\s*$/i, ' ')
      .replace(/\s+\|\s+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return t;
  };

  const findCommentsArray = (root: any): any[] | null => {
    const seen = new Set<any>();
    const stack: Array<{ v: any; depth: number }> = [{ v: root, depth: 0 }];
    while (stack.length) {
      const { v, depth } = stack.pop()!;
      if (!v || typeof v !== 'object') continue;
      if (seen.has(v)) continue;
      seen.add(v);
      if (depth > 8) continue;

      // Common shapes
      const candidateArrays = [
        (v as any)?.comments,
        (v as any)?.commentThreads,
        (v as any)?.comment_threads,
      ];
      for (const arr of candidateArrays) {
        if (Array.isArray(arr) && arr.length > 0) return arr;
      }

      // Sometimes comments are in GraphQL relay structure
      const edges = (v as any)?.comments?.edges;
      if (Array.isArray(edges) && edges.length > 0) return edges;

      // Traverse
      if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) {
          stack.push({ v: v[i], depth: depth + 1 });
        }
      } else {
        for (const k of Object.keys(v)) {
          stack.push({ v: (v as any)[k], depth: depth + 1 });
        }
      }
    }
    return null;
  };
  
  // PRIORITY: Extract from __NEXT_DATA__ (Next.js embeds all data here)
  try {
    const nextDataPattern = /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i;
    const nextDataMatch = nextDataPattern.exec(h);
    if (nextDataMatch && nextDataMatch[1]) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        // Try common locations first
        const auction = nextData?.props?.pageProps?.auction ||
          nextData?.props?.pageProps?.data?.auction ||
          nextData?.props?.auction ||
          nextData?.auction ||
          null;

        const rawArr = findCommentsArray(auction || nextData);
        if (rawArr && rawArr.length > 0) {
          for (const raw of rawArr) {
            const comment = raw?.node ? raw.node : raw;
            const rawText = comment?.text || comment?.body || comment?.content || comment?.message || '';
            const text = sanitizeCommentText(rawText);
            if (isGarbageCommentText(text)) continue;

            const author = comment?.author || comment?.username || comment?.user?.username || comment?.user?.handle || 'Unknown';
            const profileUrl = comment?.profile_url || comment?.user?.profile_url ||
              (author !== 'Unknown' ? `https://carsandbids.com/user/${author}` : undefined);

            // Drop "system status" lines that sometimes get mixed into the comment array
            // (We represent auction status via auction_events/outcome, not as a fake comment.)
            if (author === 'Unknown') {
              const lower = text.toLowerCase();
              if (lower.startsWith('reserve not met, bid to $')) continue;
              if (lower.startsWith('sold to ') || lower.startsWith('sold after for $')) continue;
            }

            const isBid = Boolean(comment?.is_bid) || comment?.type === 'bid' || /bid\s+placed\s+by|bid\s+of/i.test(text);
            const bidMatch = text.match(/\$([0-9,]+)/);
            const bidAmount = isBid ? (comment?.bid_amount || comment?.amount ||
              (bidMatch?.[1] ? parseInt(String(bidMatch[1]).replace(/,/g, ''), 10) : undefined)) : undefined;

            const isSeller = Boolean(comment?.is_seller) || comment?.type === 'seller' || comment?.author_type === 'seller' ||
              Boolean(comment?.user?.is_seller) || Boolean(comment?.user?.seller) || false;

            if (text.length >= 10) {
              comments.push({
                author,
                text,
                timestamp: comment?.timestamp || comment?.created_at || comment?.date || comment?.posted_at,
                is_seller: isSeller,
                is_bid: isBid,
                bid_amount: bidAmount,
                profile_url: profileUrl,
              });
            }
          }
        }
      } catch (e: any) {
        console.warn('Failed to parse __NEXT_DATA__ for comments:', e?.message);
      }
    }
  } catch (e: any) {
    console.warn('Error extracting comments from __NEXT_DATA__:', e?.message);
  }
  
  // If we got comments from __NEXT_DATA__, return them (more reliable)
  if (comments.length > 0) {
    return comments;
  }
  
  // Fallback: Parse from HTML
  // Helper to parse timestamp
  const parseTimestamp = (text: string): string | undefined => {
    const datePatterns = [
      /(\d{1,2}\/\d{1,2}\/\d{2,4})/,
      /(\w+\s+\d{1,2},\s+\d{4})/,
      /(\d{4}-\d{2}-\d{2})/,
    ];
    
    for (const pattern of datePatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        try {
          const date = new Date(match[1]);
          if (Number.isFinite(date.getTime())) {
            return date.toISOString();
          }
        } catch {
          // continue
        }
      }
    }
    return undefined;
  };
  
  // Pattern 1: Comment containers - look for common comment class patterns
  const commentContainerPatterns = [
    /<div[^>]*class=["'][^"']*comment[^"']*["'][^>]*>([\s\S]{0,2000})<\/div>/gi,
    /<article[^>]*class=["'][^"']*comment[^"']*["'][^>]*>([\s\S]{0,2000})<\/article>/gi,
    /<li[^>]*class=["'][^"']*comment[^"']*["'][^>]*>([\s\S]{0,2000})<\/li>/gi,
  ];
  
  for (const pattern of commentContainerPatterns) {
    let match;
    while ((match = pattern.exec(h)) !== null && comments.length < 200) {
      const commentHtml = match[1];
      
      // Extract author and profile URL
      const authorPatterns = [
        /<a[^>]*title=["']([^"']+)["'][^>]*class=["'][^"']*user[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/i,
        /<[^>]*class=["'][^"']*author[^"']*["'][^>]*>([^<]+)<\/[^>]+>/i,
        /<[^>]*class=["'][^"']*username[^"']*["'][^>]*>([^<]+)<\/[^>]+>/i,
        /<strong[^>]*>([^<]+)<\/strong>/,
        /by\s+([A-Za-z0-9_]+)/i,
      ];
      
      let author = 'Unknown';
      let profileUrl: string | undefined = undefined;
      for (const authorPattern of authorPatterns) {
        const authorMatch = commentHtml.match(authorPattern);
        if (authorMatch && authorMatch[1]) {
          author = authorMatch[1].trim();
          // If pattern captured profile URL (first pattern)
          if (authorMatch[2]) {
            profileUrl = authorMatch[2].startsWith('http') ? authorMatch[2] : `https://carsandbids.com${authorMatch[2]}`;
          }
          break;
        }
      }
      
      // Extract text
      let text = commentHtml
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim();

      text = sanitizeCommentText(text);
      if (isGarbageCommentText(text)) continue;
      
      // Extract timestamp
      const timestamp = parseTimestamp(commentHtml);
      
      // Check if it's a bid comment
      const isBid = /bid\s+placed\s+by|bid\s+of/i.test(text);
      let bidAmount: number | undefined = undefined;
      if (isBid) {
        const bidMatch = text.match(/\$([0-9,]+)/);
        if (bidMatch) {
          bidAmount = parseInt(bidMatch[1].replace(/,/g, ''), 10);
        }
      }
      
      // Check if it's a seller comment
      const isSeller = /seller|owner|listed\s+by/i.test(text) || 
                      commentHtml.toLowerCase().includes('seller') ||
                      commentHtml.toLowerCase().includes('owner');
      
      if (text.length >= 10) { // Only include substantial comments
        comments.push({
          author,
          text,
          timestamp,
          is_seller: isSeller,
          is_bid: isBid,
          bid_amount: bidAmount,
          profile_url: profileUrl,
        });
      }
    }
  }
  
  return comments;
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

/**
 * Extract lot header data (lot number, date, location) from Mecum listing HTML
 * Extracts from: <p class="LotHeader_number__80rBB">...</p>
 */
function extractMecumLotHeader(html: string): { lot_number: string | null; date: string | null; location: string | null } {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (!doc) {
      return { lot_number: null, date: null, location: null };
    }

    // Find the lot header element
    const lotHeader = doc.querySelector('[class*="LotHeader_number"], [class*="lotHeader_number"]');
    if (!lotHeader) {
      return { lot_number: null, date: null, location: null };
    }

    const text = lotHeader.textContent || '';
    
    // Extract lot number: "Lot S109" or "Lot 1154350"
    let lotNumber: string | null = null;
    const lotMatch = text.match(/Lot\s+([A-Z]?\d+)/i);
    if (lotMatch && lotMatch[1]) {
      lotNumber = lotMatch[1];
    }

    // Extract date: <time datetime="2026-01-17">Saturday, January 17th</time>
    let date: string | null = null;
    const timeElement = lotHeader.querySelector('time[datetime]');
    if (timeElement) {
      const datetime = timeElement.getAttribute('datetime');
      if (datetime) {
        date = datetime;
      }
    } else {
      // Fallback: try to extract date from text
      const dateMatch = text.match(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d+)(?:st|nd|rd|th)?/i);
      if (dateMatch) {
        // Try to parse the date
        try {
          const dateStr = `${dateMatch[2]} ${dateMatch[1]} ${new Date().getFullYear()}`;
          const parsed = new Date(dateStr);
          if (Number.isFinite(parsed.getTime())) {
            date = parsed.toISOString().split('T')[0];
          }
        } catch {
          // ignore
        }
      }
    }

    // Extract location: text after the last "//" separator
    let location: string | null = null;
    const parts = text.split('//');
    if (parts.length >= 3) {
      location = parts[parts.length - 1].trim();
    }

    return { lot_number: lotNumber, date, location };
  } catch (e: any) {
    console.warn(`Mecum lot header extraction error: ${e?.message || String(e)}`);
    return { lot_number: null, date: null, location: null };
  }
}

/**
 * Extract structured sections from Mecum listing HTML
 * Extracts HIGHLIGHTS (bullet list), THE STORY (narrative), and full description
 * DOM paths provided:
 * - HIGHLIGHTS: div.Group_group__fEouc > ul.List_list__xS3rG > li items
 * - THE STORY: div.Group_group__fEouc > div.ExpandShowMore_expandShowMore__bF34c > p elements
 */
function extractMecumStructuredSections(html: string): {
  highlights: string[];
  story: string;
  description: string;
} {
  const result = {
    highlights: [] as string[],
    story: '',
    description: '',
  };
  
  try {
    const h = String(html || '');
    
    // Extract HIGHLIGHTS section
    // Look for the section with "HIGHLIGHTS" heading followed by a list
    const highlightsMatch = h.match(/<h2[^>]*data-text=["']HIGHLIGHTS["'][^>]*>[\s\S]*?<\/h2>\s*<ul[^>]*class=["'][^"']*List_list[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i);
    if (highlightsMatch && highlightsMatch[1]) {
      const listContent = highlightsMatch[1];
      const liMatches = listContent.matchAll(/<li[^>]*>([^<]+(?:<[^>]+>[^<]+<\/[^>]+>)*[^<]*)<\/li>/gi);
      for (const liMatch of liMatches) {
        const text = liMatch[1]
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/\s+/g, ' ')
          .trim();
        if (text.length > 10) {
          result.highlights.push(text);
        }
      }
    }
    
    // Extract THE STORY section
    // Look for the section with "THE STORY" heading followed by paragraphs
    const storyMatch = h.match(/<h2[^>]*data-text=["']THE STORY["'][^>]*>[\s\S]*?<\/h2>\s*<div[^>]*class=["'][^"']*ExpandShowMore[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>|<hr)/i);
    if (storyMatch && storyMatch[1]) {
      const storyContent = storyMatch[1];
      const paragraphs: string[] = [];
      const pMatches = storyContent.matchAll(/<p[^>]*class=["'][^"']*RichText_richtext[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi);
      for (const pMatch of pMatches) {
        const text = pMatch[1]
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/\s+/g, ' ')
          .trim();
        if (text.length > 20) {
          paragraphs.push(text);
        }
      }
      result.story = paragraphs.join('\n\n');
    }
    
    // Also try alternative patterns for story (without class selectors)
    if (!result.story) {
      const storyAltMatch = h.match(/data-text=["']THE STORY["'][^>]*>[\s\S]*?<\/h2>[\s\S]*?(<p[^>]*>[\s\S]*?<\/p>(?:\s*<p[^>]*>[\s\S]*?<\/p>)*)/i);
      if (storyAltMatch && storyAltMatch[1]) {
        const paragraphs: string[] = [];
        const pMatches = storyAltMatch[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi);
        for (const pMatch of pMatches) {
          const text = pMatch[1]
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/\s+/g, ' ')
            .trim();
          if (text.length > 20 && !text.toLowerCase().includes('read more') && !text.toLowerCase().includes('read less')) {
            paragraphs.push(text);
          }
        }
        result.story = paragraphs.join('\n\n');
      }
    }
    
    // Build full description from highlights + story
    if (result.highlights.length > 0 || result.story) {
      const parts: string[] = [];
      if (result.highlights.length > 0) {
        parts.push('HIGHLIGHTS:\n• ' + result.highlights.join('\n• '));
      }
      if (result.story) {
        parts.push('THE STORY:\n' + result.story);
      }
      result.description = parts.join('\n\n');
    }
    
    return result;
  } catch (e: any) {
    console.warn(`Mecum structured sections extraction error: ${e?.message || String(e)}`);
    return result;
  }
}

/**
 * Extract structured vehicle specs from Mecum highlights/story text
 * Parses engine codes, transmission, colors, etc. into proper DB fields
 */
function extractMecumStructuredSpecs(highlights: string[], story: string): {
  engine_code?: string;
  displacement?: string;
  engine_size?: string;
  horsepower?: number;
  engine_type?: string;
  transmission?: string;
  transmission_type?: string;
  transmission_model?: string;
  color?: string;
  color_primary?: string;
  secondary_color?: string;
  drivetrain?: string;
  series?: string;
  trim?: string;
  trim_level?: string;
  has_racing_stripes?: boolean;
  previous_owners?: number;
  purchase_location?: string;
  is_show_car?: boolean;
} {
  const specs: Record<string, any> = {};
  const allText = [...highlights, story].join(' ');
  
  // Engine code patterns: L72, LS6, L78, ZL1, etc.
  const engineCodeMatch = allText.match(/\b(L\d{2}|LS\d|LT\d|ZL\d|ZZ\d|LM\d|LQ\d)\b/i);
  if (engineCodeMatch) specs.engine_code = engineCodeMatch[1].toUpperCase();
  
  // COPO codes for trim
  const copoMatch = allText.match(/COPO\s*(\d{4}(?:\/\d{4})?)/i);
  if (copoMatch) specs.trim = `COPO ${copoMatch[1]}`;
  
  // Displacement: 427, 454, 350, 302, 396, etc.
  const displacementMatch = allText.match(/\b(302|327|350|383|396|400|402|427|454|455|502)\s*(?:ci|cubic|V-?8)?/i);
  if (displacementMatch) {
    specs.displacement = displacementMatch[1];
    specs.engine_size = `${displacementMatch[1]} V-8`;
    specs.engine_type = 'V-8';
  }
  
  // Horsepower: 425 HP, 450hp, 375 horsepower
  const hpMatch = allText.match(/(\d{3,4})\s*(?:HP|hp|horsepower)/);
  if (hpMatch) specs.horsepower = parseInt(hpMatch[1], 10);
  
  // Transmission: M21, M22, Muncie, TH400, 4-speed, automatic
  const transMatch = allText.match(/\b(M2[012]|M40|TH\d{3}|Turbo\s*\d{3}|Muncie)\b/i);
  if (transMatch) {
    specs.transmission_model = transMatch[1].toUpperCase();
    specs.transmission_type = /M2[012]|Muncie/i.test(transMatch[1]) ? 'Manual' : 'Automatic';
  }
  
  // 4-speed, 5-speed patterns
  const speedMatch = allText.match(/\b(\d)-speed\s*(manual|automatic)?/i);
  if (speedMatch) {
    const speeds = speedMatch[1];
    const type = speedMatch[2] ? speedMatch[2].charAt(0).toUpperCase() + speedMatch[2].slice(1).toLowerCase() : 
                 (parseInt(speeds) <= 5 ? 'Manual' : 'Automatic');
    if (!specs.transmission) {
      specs.transmission = `${speeds}-Speed ${type}`;
    } else {
      specs.transmission = `${specs.transmission_model} ${speeds}-Speed ${type}`;
    }
    specs.transmission_type = type;
  }
  
  // Colors: Olympic Gold, Marina Blue, Hugger Orange, etc.
  const colorPatterns = [
    /\b(Olympic Gold|Marina Blue|Hugger Orange|Fathom Green|Cortez Silver|LeMans Blue|Daytona Yellow|Cranberry Red|Burnished Brown|Monza Red|Tuxedo Black|Ermine White|Dover White|Classic White|Butternut Yellow|Glacier Blue|Astro Blue|Dusk Blue|Verdoro Green|Forest Green|Frost Green|Rally Green|Champagne Gold|Autumn Gold|Shadow Gray|Teal Blue|Nevada Silver|Flame Orange|Inferno Orange|Bronze|Gold|Silver|White|Black|Red|Blue|Green|Yellow|Orange)\b/gi
  ];
  
  for (const pattern of colorPatterns) {
    const colorMatch = allText.match(pattern);
    if (colorMatch) {
      specs.color = colorMatch[1];
      specs.color_primary = colorMatch[1];
      break;
    }
  }
  
  // Secondary color / graphics
  if (/white\s*(?:graphics|stripes|stripe)/i.test(allText)) {
    specs.secondary_color = 'White';
    specs.has_racing_stripes = true;
  } else if (/black\s*(?:graphics|stripes|stripe)/i.test(allText)) {
    specs.secondary_color = 'Black';
    specs.has_racing_stripes = true;
  }
  
  // Series: Yenko, Baldwin-Motion, Nickey, Dana, etc.
  const seriesMatch = allText.match(/\b(Yenko|Baldwin[-\s]?Motion|Nickey|Dana|Berger|Gibb|Fred Gibb|Don Yenko)\b/i);
  if (seriesMatch) specs.series = seriesMatch[1].replace(/[-\s]+/g, '-');
  
  // Count previous owners mentioned
  const ownerMatches = allText.match(/from\s+(?:the\s+)?original\s+owner|acquired\s+(?:from|by)|previous\s+owner/gi);
  if (ownerMatches && ownerMatches.length > 0) {
    specs.previous_owners = Math.min(ownerMatches.length + 1, 5);
  }
  
  // Original dealer location
  const dealerMatch = allText.match(/sold\s+(?:new\s+)?(?:at|by)\s+([^,]+),\s*([A-Za-z]+)/i);
  if (dealerMatch) {
    specs.purchase_location = `${dealerMatch[1].trim()}, ${dealerMatch[2].trim()}`;
  }
  
  // Show car indicators
  if (/award\s*winner|multiple\s*awards?|concours|trophy|trophies|featured\s+(?:cover\s+)?car/i.test(allText)) {
    specs.is_show_car = true;
  }
  
  // Drivetrain (assume RWD for classic muscle cars)
  if (specs.engine_type === 'V-8' || specs.displacement) {
    specs.drivetrain = 'RWD';
  }
  
  return specs;
}

/**
 * Extract sold price from Mecum listing HTML using DOM parsing
 * Based on user-provided DOM paths for sold listings
 * CRITICAL: Excludes lot header elements (lot number, date, location) to avoid false matches
 */
function extractMecumSoldPrice(html: string): { sale_price: number | null; method: string } {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (!doc) {
      return { sale_price: null, method: 'none' };
    }

    // Helper: Check if element is in lot header (should be excluded)
    const isLotHeaderElement = (el: any): boolean => {
      if (!el) return false;
      const className = (el.className || '').toLowerCase();
      const id = (el.id || '').toLowerCase();
      const tagName = (el.tagName || '').toLowerCase();
      
      // Exclude lot header elements
      if (className.includes('lotheader') || id.includes('lotheader')) {
        return true;
      }
      
      // Exclude time elements (dates) and elements containing lot numbers
      if (tagName === 'time' || className.includes('lot') && className.includes('num')) {
        return true;
      }
      
      // Check parent chain for lot header
      let parent = el.parentElement;
      let depth = 0;
      while (parent && depth < 5) {
        const parentClass = (parent.className || '').toLowerCase();
        const parentId = (parent.id || '').toLowerCase();
        if (parentClass.includes('lotheader') || parentId.includes('lotheader')) {
          return true;
        }
        parent = parent.parentElement;
        depth++;
      }
      
      return false;
    };

    // Helper: Check if text looks like lot number, date, or location (not a price)
    const isInvalidPriceText = (text: string, price: number): boolean => {
      const lower = text.toLowerCase();
      
      // Exclude if contains lot number patterns (Lot S109, Lot #123, etc.)
      if (/\blot\s*[#s]?\s*\d+/i.test(lower)) {
        return true;
      }
      
      // Exclude if contains date patterns (January 17, 2026, 2026-01-17, etc.)
      if (/\b(january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})\b/i.test(lower)) {
        return true;
      }
      
      // Exclude if contains location keywords (Kissimmee, Las Vegas, etc.)
      if (/\b(kissimmee|las vegas|indianapolis|dallas|kansas city|monterey|scottsdale|auction|location)\b/i.test(lower)) {
        return true;
      }
      
      // Exclude if price looks like a year (1900-2100 range, especially if near date/lot context)
      if (price >= 1900 && price <= 2100) {
        // Only exclude if it's in a context that suggests it's a year
        if (/\b(19|20)\d{2}\b/.test(lower) && (lower.includes('lot') || lower.includes('january') || lower.includes('february') || lower.includes('march') || lower.includes('april') || lower.includes('may') || lower.includes('june') || lower.includes('july') || lower.includes('august') || lower.includes('september') || lower.includes('october') || lower.includes('november') || lower.includes('december'))) {
          return true;
        }
      }
      
      return false;
    };

    // Strategy 1: Try the specific classes mentioned by user
    // TopNLots_price__DKxnz or TopNLots_saleResult__Y0Ayv
    const priceSelectors = [
      '.TopNLots_price__DKxnz',
      '.TopNLots_saleResult__Y0Ayv',
      '[class*="TopNLots_price"]',
      '[class*="TopNLots_saleResult"]',
      '[class*="saleResult"]',
    ];

    for (const selector of priceSelectors) {
      const element = doc.querySelector(selector);
      if (element && !isLotHeaderElement(element)) {
        const text = element.textContent || '';
        const priceMatch = text.match(/\$?([\d,]+)/);
        if (priceMatch) {
          const price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
          if (price >= 1000 && price < 100000000 && !isInvalidPriceText(text, price)) {
            return { sale_price: price, method: `dom:${selector}` };
          }
        }
      }
    }

    // Strategy 2: Look for "Top N Lots" section and find price within it
    // DOM path: div.TopNLot._topNLot > div.TopNLot._re.ultCard > div.TopNLot._meta > div.TopNLot._.aleRe.ult
    const topNLotsSection = doc.querySelector('[class*="TopNLot"]') || 
                            doc.querySelector('[class*="topNLot"]') ||
                            doc.querySelector('[class*="saleResult"]');
    
    if (topNLotsSection && !isLotHeaderElement(topNLotsSection)) {
      // Look for price-like text in the section, but exclude lot header children
      const allElements = topNLotsSection.querySelectorAll('*');
      for (const el of Array.from(allElements)) {
        if (isLotHeaderElement(el as Element)) continue;
        
        const text = (el as Element).textContent || '';
        const pricePatterns = [
          /\$([\d,]+)/g,
          /USD\s*\$([\d,]+)/gi,
        ];

        for (const pattern of pricePatterns) {
          const matches = text.matchAll(pattern);
          for (const match of matches) {
            const price = parseInt(match[1].replace(/,/g, ''), 10);
            if (price >= 1000 && price < 100000000 && !isInvalidPriceText(text, price)) {
              return { sale_price: price, method: 'dom:topNLots_section' };
            }
          }
        }
      }
    }

    // Strategy 3: Look for "sold" context with price in nearby elements
    // Exclude lot header elements from body text search
    const bodyClone = doc.body?.cloneNode(true) as any;
    if (bodyClone) {
      // Remove lot header elements from cloned body
      const lotHeaders = bodyClone.querySelectorAll('[class*="LotHeader"], [class*="lotHeader"], [id*="LotHeader"], [id*="lotHeader"]');
      lotHeaders.forEach((el: any) => el.remove());
      
      const bodyText = bodyClone.textContent || '';
      const soldPricePatterns = [
        /sold\s+for\s+\$?([\d,]+)/i,
        /sold\s+\$?([\d,]+)/i,
        /final\s+price[:\s]*\$?([\d,]+)/i,
        /hammer\s+price[:\s]*\$?([\d,]+)/i,
      ];

      for (const pattern of soldPricePatterns) {
        const match = bodyText.match(pattern);
        if (match) {
          const price = parseInt(match[1].replace(/,/g, ''), 10);
          if (price >= 1000 && price < 100000000 && !isInvalidPriceText(match[0], price)) {
            return { sale_price: price, method: 'text:sold_pattern' };
          }
        }
      }
    }

    // Strategy 4: Look for large numbers that look like prices in "sold" context
    // Find elements containing "sold" and look for price nearby, but exclude lot headers
    const soldElements = Array.from(doc.querySelectorAll('*')).filter((el: any) => {
      if (isLotHeaderElement(el)) return false;
      const text = (el.textContent || '').toLowerCase();
      return text.includes('sold') || text.includes('final price') || text.includes('hammer');
    });

    for (const el of soldElements) {
      const elText = (el as Element).textContent || '';
      const priceMatch = elText.match(/\$?([\d,]+)/);
      if (priceMatch) {
        const price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
        if (price >= 1000 && price < 100000000 && !isInvalidPriceText(elText, price)) {
          return { sale_price: price, method: 'dom:sold_context' };
        }
      }
    }

    return { sale_price: null, method: 'none' };
  } catch (e: any) {
    console.warn(`Mecum sold price extraction error: ${e?.message || String(e)}`);
    return { sale_price: null, method: 'error' };
  }
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
    const { url, site_type, max_vehicles = 10, debug = false, download_images } = await req.json();
    
    if (!url) {
      throw new Error('Missing url parameter');
    }
    
    const startedAt = Date.now();
    console.log(`Extracting from: ${url}`);
    
    // Detect site or use provided type
    const detectedSite = site_type || detectAuctionSite(url);
    console.log(`Site type: ${detectedSite}`);
    
    // Default download_images based on site (Cars & Bids defaults to true due to large image counts)
    let shouldDownload = download_images;
    if (shouldDownload === undefined) {
      shouldDownload = detectedSite === 'carsandbids'; // Default to true for Cars & Bids
    }
    
    if (shouldDownload) {
      console.log(`📥 Slow image download enabled (will capture URLs first, then download in batches)`);
    }
    
    // Route to site-specific extractor
    let result;
    switch (detectedSite) {
      case 'carsandbids':
        result = await extractCarsAndBids(url, max_vehicles, Boolean(debug), Boolean(shouldDownload));
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
      case 'broadarrow':
        result = await extractBroadArrow(url, max_vehicles);
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
    if (domain.includes('broadarrowauctions.com')) return 'broadarrow';
    
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

async function extractCarsAndBids(url: string, maxVehicles: number, debug: boolean, downloadImages: boolean = true) {
  console.log("Cars & Bids: discovering listing URLs then extracting per-listing");
  // Slow downloads enabled by default for Cars & Bids (often have 100+ images)
  // URLs captured first, then downloaded in batches to avoid timeouts/rate limits
  if (downloadImages) {
    console.log("📥 Slow image download enabled - URLs will be captured first, then downloaded in batches");
  }

  const normalizedUrl = String(url || "").trim();
  const isDirectListing =
    normalizedUrl.includes("carsandbids.com/auctions/") &&
    !normalizedUrl.replace(/\/+$/, "").endsWith("/auctions");

  const indexUrl = isDirectListing ? "https://carsandbids.com/auctions" : (normalizedUrl.includes("carsandbids.com/auctions") ? normalizedUrl : "https://carsandbids.com/auctions");
  // ⚠️ FREE MODE: Firecrawl is optional - we'll use direct fetch + __NEXT_DATA__ extraction
  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY") || null;
  const sourceWebsite = "https://carsandbids.com";

  // Step 1: Try to discover listing URLs (Firecrawl is optional now)
  let listingUrls: string[] = [];
  let mapRaw: any = null;

  if (isDirectListing) {
    // Strip /video suffix - that's not the actual listing URL
    let cleanUrl = normalizedUrl.split("?")[0].replace(/\/video\/?$/, '');
    listingUrls = [cleanUrl];
  }

  // Try Firecrawl discovery only if API key is available
  if (listingUrls.length === 0 && firecrawlKey) {
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
      console.warn("Firecrawl index discovery failed (or not configured), will try direct fetch:", e?.message || String(e));
    }

    // Fallback: Firecrawl scrape the index page to get markdown, then extract listing URLs from that text.
    if (listingUrls.length === 0 && firecrawlKey) {
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
  }

  // Fallback: direct fetch link discovery (FREE - works when page has links in HTML)
  if (listingUrls.length === 0) {
    try {
      console.log("📡 FREE MODE: Using direct fetch for index discovery (no Firecrawl)");
      const indexHtml = await fetchTextWithTimeout(indexUrl, 12000, "Cars & Bids index fetch");
      listingUrls = extractCarsAndBidsListingUrls(indexHtml, 300);
      if (listingUrls.length === 0) {
        console.warn("⚠️ Direct fetch found no listing URLs - may need Firecrawl for index pages");
      } else {
        console.log(`✅ Direct fetch found ${listingUrls.length} listing URLs`);
      }
    } catch (e: any) {
      console.warn(`⚠️ Direct index fetch failed: ${e?.message || String(e)}`);
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
      vin: { type: "string", description: "VIN if available - look in specs table, title, or description. Format: 17 alphanumeric characters (no I, O, Q). Example: 1G1YY32G5X5114539" },
      mileage: { type: "number", description: "Mileage / odometer" },
      color: { type: "string", description: "Exterior color" },
      interior_color: { type: "string", description: "Interior color" },
      transmission: { type: "string", description: "Transmission" },
      drivetrain: { type: "string", description: "Drivetrain" },
      engine_size: { type: "string", description: "Engine" },
      fuel_type: { type: "string", description: "Fuel type" },
      body_style: { type: "string", description: "Body style" },
      current_bid: { type: "number", description: "Current bid amount in USD" },
      bid_count: { type: "number", description: "Total number of bids placed" },
      bid_history: { 
        type: "array", 
        items: { 
          type: "object",
          properties: {
            amount: { type: "number" },
            timestamp: { type: "string" },
            bidder: { type: "string" }
          }
        },
        description: "ALL bid history - extract every bid with amount, timestamp, and bidder username. Look in comments section, bid history table, or bid timeline. Format: [{\"amount\": 50000, \"timestamp\": \"2024-12-30T15:19:00Z\", \"bidder\": \"username\"}]"
      },
      comment_count: { type: "number", description: "Total number of comments on the listing" },
      comments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            author: { type: "string" },
            text: { type: "string" },
            timestamp: { type: "string" },
            is_seller: { type: "boolean" },
            is_bid: { type: "boolean" },
            bid_amount: { type: "number" }
          }
        },
        description: "ALL comments from the listing - extract every comment with author, text, timestamp. Mark if it's a bid comment (is_bid: true, bid_amount: number) or seller comment (is_seller: true). Extract from comments section, discussion thread, or comment feed."
      },
      reserve_met: { type: "boolean", description: "Reserve met" },
      reserve_price: { type: "number", description: "Reserve price if disclosed" },
      auction_end_date: { type: "string", description: "Auction end time/date" },
      sale_price: { type: "number", description: "Final sale price if auction ended (look for 'Sold for $X' or 'Final Price')" },
      sale_date: { type: "string", description: "Sale date if auction ended" },
      location: { type: "string", description: "Location" },
      seller: { type: "string", description: "Seller username/handle (listing owner) if shown" },
      buyer: { type: "string", description: "Buyer / winning bidder username/handle if auction ended and shown" },
      description: { type: "string", description: "FULL listing description - all text content describing the vehicle, its condition, history, modifications, etc. Extract from description section, article content, or main content area. Include ALL paragraphs and details. Minimum 100 characters." },
      images: { 
        type: "array", 
        items: { type: "string" }, 
        description: "ALL high-resolution full-size image URLs from the vehicle gallery. CRITICAL: Extract EVERY image from the gallery - Cars & Bids listings typically have 40-100+ photos. Look in: 1) Gallery JSON data in script tags, 2) data-src/data-full attributes, 3) img src attributes in gallery containers, 4) srcset attributes, 5) background-image CSS. Prioritize 'full', 'original', or 'large' size URLs. Remove all resize parameters (?w=, ?h=, ?resize=). Get ONLY full-resolution gallery images from media.carsandbids.com, NOT thumbnails, NOT video frames, NOT UI elements. Exclude any URLs containing 'thumb', 'thumbnail', 'video', 'icon', 'logo', or size suffixes like -150x150. Return ALL images found, not just a few." 
      },
    },
  };

  const extracted: any[] = [];
  const issues: string[] = [];

  // For single URL extraction (direct listing), always process it (even if exists - we want to update)
  // For index pages, prefer unseen URLs to avoid repeatedly re-importing the same top listing.
  let urlsToScrape = listingUrls;
  const isSingleDirectListing = listingUrls.length === 1 && listingUrls[0].includes('/auctions/');
  
  if (!isSingleDirectListing) {
    // Only filter for index pages, not direct listings
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
  }

  // Track LLM extraction results for visibility
  const llmResults: Array<{ url: string; called: boolean; fields_found: string[]; raw_response?: any }> = [];

  for (const listingUrl of urlsToScrape) {
    try {
      let vehicle: any = {};
      let html = "";
      let llmExtractedForThisVehicle: Record<string, any> = {};
      
      // ⚠️ FREE MODE: Try direct fetch first (extracts from __NEXT_DATA__), Firecrawl is optional
      let firecrawlAttempted = false;
      
      // Try direct fetch first (FREE - Cars & Bids embeds data in __NEXT_DATA__)
      try {
        console.log(`📡 FREE MODE: Fetching ${listingUrl} directly (extracting from __NEXT_DATA__)`);
        html = await fetchTextWithTimeout(listingUrl, 30000, "Direct HTML fetch");
        console.log(`✅ Got HTML via direct fetch (${html.length} chars)`);
        
        // Check for __NEXT_DATA__ - this is where Cars & Bids stores all vehicle data
        if (html.includes('__NEXT_DATA__')) {
          console.log(`✅ Found __NEXT_DATA__ in HTML - can extract images/vehicle data without Firecrawl`);
          const nextDataMatch = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>/i);
          if (nextDataMatch) {
            console.log(`✅ Found __NEXT_DATA__ script tag - full extraction possible`);
          }
          
          // Extract vehicle data from __NEXT_DATA__ (if not already extracted by Firecrawl)
          if (!vehicle || Object.keys(vehicle).length === 0) {
            try {
              const nextDataPattern = /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>(.*?)<\/script>/gis;
              const nextDataMatch = html.match(nextDataPattern);
              if (nextDataMatch && nextDataMatch[1]) {
                const nextData = JSON.parse(nextDataMatch[1]);
                const auction = nextData?.props?.pageProps?.auction || 
                               nextData?.props?.pageProps?.data?.auction ||
                               nextData?.props?.pageProps?.listing ||
                               nextData?.props?.auction ||
                               nextData?.auction;
                
                if (auction) {
                  // Recursive function to find field values in nested structures
                  const findFieldValue = (obj: any, fieldNames: string[], depth = 0, seen = new Set<any>()): any => {
                    if (depth > 10 || !obj || typeof obj !== 'object') return null;
                    if (seen.has(obj)) return null;
                    seen.add(obj);
                    
                    // Check direct keys
                    for (const fieldName of fieldNames) {
                      if (obj[fieldName] !== null && obj[fieldName] !== undefined && obj[fieldName] !== '') {
                        return obj[fieldName];
                      }
                    }
                    
                    // Recursively search nested objects
                    if (depth < 6) {
                      for (const value of Object.values(obj)) {
                        if (value && typeof value === 'object') {
                          const found = findFieldValue(value, fieldNames, depth + 1, seen);
                          if (found !== null) return found;
                        }
                      }
                    }
                    
                    return null;
                  };
                  
                  // Extract basic vehicle info from __NEXT_DATA__ with recursive search
                  vehicle = {
                    year: findFieldValue(auction, ['year', 'modelYear', 'model_year'], 0, new Set()) || vehicle.year,
                    make: findFieldValue(auction, ['make', 'manufacturer'], 0, new Set()) || vehicle.make,
                    model: findFieldValue(auction, ['model', 'modelName', 'model_name'], 0, new Set()) || vehicle.model,
                    trim: findFieldValue(auction, ['trim', 'trimLevel', 'trim_level'], 0, new Set()) || vehicle.trim,
                    vin: findFieldValue(auction, ['vin', 'vehicleIdentificationNumber', 'vehicle_id'], 0, new Set()) || vehicle.vin,
                    mileage: findFieldValue(auction, ['mileage', 'odometer', 'odometerReading', 'odometer_reading', 'miles'], 0, new Set()) || vehicle.mileage,
                    color: findFieldValue(auction, ['color', 'exteriorColor', 'exterior_color', 'paintColor', 'paint_color', 'exterior'], 0, new Set()) || vehicle.color,
                    interior_color: findFieldValue(auction, ['interiorColor', 'interior_color', 'interior'], 0, new Set()) || vehicle.interior_color,
                    transmission: findFieldValue(auction, ['transmission', 'trans', 'transmissionType', 'transmission_type'], 0, new Set()) || vehicle.transmission,
                    drivetrain: findFieldValue(auction, ['drivetrain', 'driveTrain', 'drive_train', 'driveType', 'drive_type'], 0, new Set()) || vehicle.drivetrain,
                    engine_size: findFieldValue(auction, ['engine', 'engineSize', 'engine_size', 'engineDescription', 'engine_description', 'displacement'], 0, new Set()) || vehicle.engine_size,
                    fuel_type: findFieldValue(auction, ['fuelType', 'fuel_type', 'fuel'], 0, new Set()) || vehicle.fuel_type,
                    body_style: findFieldValue(auction, ['bodyStyle', 'body_style', 'bodyType', 'body_type'], 0, new Set()) || vehicle.body_style,
                    current_bid: findFieldValue(auction, ['currentBid', 'current_bid', 'highestBid', 'highest_bid', 'currentPrice', 'current_price'], 0, new Set()) || vehicle.current_bid,
                    bid_count: (findFieldValue(auction, ['bidCount', 'bid_count', 'bids'], 0, new Set()) || 
                               (Array.isArray(auction.bids) ? auction.bids.length : null)) || vehicle.bid_count,
                    comment_count: (findFieldValue(auction, ['commentCount', 'comment_count', 'comments'], 0, new Set()) ||
                                   (Array.isArray(auction.comments) ? auction.comments.length : null)) || vehicle.comment_count,
                  };
                  console.log(`✅ Extracted vehicle data from __NEXT_DATA__ (with recursive search)`);
                }
              }
            } catch (nextDataError: any) {
              console.warn(`⚠️ Failed to parse __NEXT_DATA__: ${nextDataError?.message}`);
            }
          }
        } else {
          console.warn(`⚠️ No __NEXT_DATA__ found in HTML - page may require JavaScript rendering`);
          // If no __NEXT_DATA__ and we have Firecrawl key, try Firecrawl as fallback
          if (firecrawlKey && !firecrawlAttempted) {
            firecrawlAttempted = true;
            throw new Error("No __NEXT_DATA__ found, will try Firecrawl");
          }
        }
      } catch (directError: any) {
        // If direct fetch failed or no __NEXT_DATA__, try Firecrawl (if available)
        if (firecrawlKey && !firecrawlAttempted) {
          firecrawlAttempted = true;
          console.warn(`⚠️ Direct fetch failed or incomplete, trying Firecrawl fallback (${directError?.message})`);
          try {
            const firecrawlData = await fetchJsonWithRetry(
              FIRECRAWL_SCRAPE_URL,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${firecrawlKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  url: listingUrl,
                  formats: ["html", "extract"],
                  onlyMainContent: false,
                  waitFor: 10000,
                  actions: [
                    { type: "wait", milliseconds: 3000 },
                    { type: "scroll", direction: "down", pixels: 2000 },
                    { type: "wait", milliseconds: 3000 },
                    { type: "scroll", direction: "down", pixels: 3000 },
                    { type: "wait", milliseconds: 3000 },
                  ],
                  extract: { schema: listingSchema },
                }),
              },
              FIRECRAWL_LISTING_TIMEOUT_MS,
              "Firecrawl listing scrape",
              3,
            );

            vehicle = firecrawlData?.data?.extract || {};
            html = String(firecrawlData?.data?.html || "");
            console.log(`✅ Got HTML via Firecrawl (${html.length} chars)`);
          } catch (firecrawlError: any) {
            console.error(`❌ Firecrawl also failed: ${firecrawlError?.message}`);
            // If both failed and we don't have HTML, throw error
            if (!html) {
              throw new Error(`Both direct fetch and Firecrawl failed: ${directError?.message || 'No HTML obtained'}`);
            }
            // Otherwise continue with partial HTML from direct fetch
          }
        } else {
          // No Firecrawl key or already tried - just use what we have or throw
          if (!html) {
            throw new Error(`Direct fetch failed and Firecrawl not available: ${directError?.message}`);
          }
        }
      }
    
    // Debug: Log extraction results
    if (debug && html) {
      const hasNextData = html.includes('__NEXT_DATA__');
      const imageCount = extractCarsAndBidsImagesFromHtml(html).length;
      const commentCount = extractCarsAndBidsComments(html).length;
      const bidderCount = extractCarsAndBidsBidders(html).length;
      console.log(`🔍 Debug: HTML analysis - __NEXT_DATA__: ${hasNextData}, Images: ${imageCount}, Comments: ${commentCount}, Bidders: ${bidderCount}`);
    }

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
      
      // Extract bid history from HTML
      let bidHistory: any[] = [];
      if (html) {
        bidHistory = extractCarsAndBidsBidHistory(html);
      }
      
      // Extract comments from HTML
      let comments: any[] = [];
      if (html) {
        comments = extractCarsAndBidsComments(html);
      }
      
      // Extract structured sections (Doug's Take, Highlights, Equipment, etc.)
      let structuredSections: any = {};
      if (html) {
        structuredSections = extractCarsAndBidsStructuredSections(html);
      }
      
      // Extract bidder profiles
      let bidders: any[] = [];
      if (html) {
        bidders = extractCarsAndBidsBidders(html);
      }
      
      // Extract VIN from HTML (often visible in specs table)
      let vinFromHtml: string | null = null;
      if (html) {
        vinFromHtml = extractCarsAndBidsVIN(html);
      }
      
      // Extract description from HTML (full listing description)
      let descriptionFromHtml: string | null = null;
      if (html) {
        descriptionFromHtml = extractCarsAndBidsDescription(html);
      }
      
      // LLM-based extraction - TWO PHASE APPROACH
      // Phase 1: Analyze page structure to find WHERE data is located
      // Phase 2: Extract data using that map
      let llmExtracted: Record<string, any> = {};
      const missingKeyFields = !vehicle?.mileage || !vehicle?.color || !vehicle?.transmission || !vehicle?.engine_size || !vehicle?.vin;
      
      if (html && html.length > 1000 && missingKeyFields) {
        try {
          const openaiKey = Deno.env.get('OPENAI_API_KEY');
          if (openaiKey) {
            const { analyzePageStructure, extractWithLLM } = await import('./llm-extractor.ts');
            const supabaseForLLM = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"));
            
            // PHASE 1: Analyze structure first
            console.log('🔍 Phase 1: Analyzing page structure to find data locations...');
            const { strategy, extraction_map } = await analyzePageStructure(html, listingUrl, openaiKey);
            
            // PHASE 2: Always try code extraction first (even if map is empty, it will do smart search)
            console.log('📥 Phase 2: Extracting data using CODE...');
            const { extractUsingStrategy } = await import('./data-extractor.ts');
            const codeExtracted = extractUsingStrategy(html, strategy, extraction_map);
            
            if (Object.keys(extraction_map).length > 0) {
              console.log(`✅ LLM found ${Object.keys(extraction_map).length} data locations`);
              console.log(`📋 Extraction strategy: ${strategy.extraction_strategy || 'unknown'}`);
            } else {
              console.log('⚠️ LLM structure analysis found no locations, using smart search in __NEXT_DATA__...');
            }
            
            // If code extraction found data, use it. Otherwise fall back to LLM extraction
            if (Object.keys(codeExtracted).filter(k => codeExtracted[k] !== null).length > 0) {
              console.log(`✅ Code extraction found ${Object.keys(codeExtracted).filter(k => codeExtracted[k] !== null).length} fields`);
              llmExtracted = codeExtracted;
            } else {
              console.log('⚠️ Code extraction found nothing, falling back to LLM extraction...');
              llmExtracted = await extractWithLLM(html, listingUrl, supabaseForLLM, openaiKey, extraction_map);
            }
            
            llmExtractedForThisVehicle = llmExtracted;
            if (Object.keys(llmExtracted).length > 0) {
              const nonNullFields = Object.keys(llmExtracted).filter(k => llmExtracted[k] !== null && llmExtracted[k] !== undefined);
              if (nonNullFields.length > 0) {
                console.log(`✅ LLM extracted ${nonNullFields.length} non-null fields: ${nonNullFields.join(', ')}`);
                console.log(`📋 LLM values being merged:`, JSON.stringify(Object.fromEntries(nonNullFields.map(k => [k, llmExtracted[k]])), null, 2));
                llmResults.push({
                  url: listingUrl,
                  called: true,
                  fields_found: nonNullFields,
                  raw_response: {
                    strategy: strategy.extraction_strategy,
                    extraction_map: extraction_map,
                    extracted_values: Object.fromEntries(nonNullFields.map(k => [k, llmExtracted[k]]))
                  }
                });
              } else {
                console.log(`⚠️ LLM returned ${Object.keys(llmExtracted).length} fields but all are null - no data found`);
                llmResults.push({
                  url: listingUrl,
                  called: true,
                  fields_found: [],
                  raw_response: {
                    strategy: strategy.extraction_strategy,
                    extraction_map: extraction_map,
                    extracted_values: llmExtracted
                  }
                });
              }
            } else {
              console.log(`⚠️ LLM extraction returned empty object - no fields extracted`);
              llmResults.push({
                url: listingUrl,
                called: true,
                fields_found: [],
                raw_response: {
                  strategy: strategy.extraction_strategy,
                  extraction_map: extraction_map,
                  extracted_values: {}
                }
              });
            }
          } else {
            console.log('⚠️ OPENAI_API_KEY not found, skipping LLM extraction');
            llmResults.push({ url: listingUrl, called: false, fields_found: [] });
          }
        } catch (llmError: any) {
          console.warn(`LLM extraction failed (non-fatal): ${llmError?.message || String(llmError)}`);
          llmResults.push({ url: listingUrl, called: true, fields_found: [], raw_response: { error: llmError?.message } });
        }
      } else if (!missingKeyFields) {
        console.log('ℹ️ Skipping LLM extraction - key fields already present');
        llmResults.push({ url: listingUrl, called: false, fields_found: [], raw_response: { reason: 'key_fields_already_present' } });
      } else {
        llmResults.push({ url: listingUrl, called: false, fields_found: [], raw_response: { reason: 'html_too_short' } });
      }
      
      // CRITICAL: Clean listing URL - strip /video suffix
      const cleanListingUrl = listingUrl.replace(/\/video\/?$/, '');
      
      const merged = {
        ...(empty ? {} : vehicle),
        listing_url: cleanListingUrl,
        // Prioritize: LLM extraction > HTML regex extraction > Firecrawl > fallback
        year: llmExtracted.year ?? (vehicle?.year ?? fallback.year) ?? null,
        make: llmExtracted.make ?? (vehicle?.make ?? fallback.make) ?? null,
        model: llmExtracted.model ?? (vehicle?.model ?? fallback.model) ?? null,
        title: llmExtracted.title ?? (vehicle?.title ?? fallback.title) ?? null,
        vin: llmExtracted.vin ?? vinFromHtml ?? vehicle?.vin ?? null,
        mileage: llmExtracted.mileage ?? vehicle?.mileage ?? null,
        color: llmExtracted.color ?? vehicle?.color ?? null,
        interior_color: llmExtracted.interior_color ?? vehicle?.interior_color ?? null,
        transmission: llmExtracted.transmission ?? vehicle?.transmission ?? null,
        engine_size: llmExtracted.engine_size ?? vehicle?.engine_size ?? null,
        drivetrain: llmExtracted.drivetrain ?? vehicle?.drivetrain ?? null,
        fuel_type: llmExtracted.fuel_type ?? vehicle?.fuel_type ?? null,
        body_style: llmExtracted.body_style ?? vehicle?.body_style ?? null,
        location: llmExtracted.location ?? vehicle?.location ?? null,
        seller: llmExtracted.seller ?? vehicle?.seller ?? vehicle?.seller_username ?? null,
        buyer: llmExtracted.buyer ?? vehicle?.buyer ?? vehicle?.buyer_username ?? null,
        description: llmExtracted.description ?? descriptionFromHtml ?? vehicle?.description ?? null,
        images, // Cleaned high-res images
        // Auction data - prioritize LLM > HTML extraction > Firecrawl
        current_bid: llmExtracted.current_bid ?? auctionData.current_bid ?? vehicle?.current_bid ?? null,
        bid_count: llmExtracted.bid_count ?? (bidHistory.length > 0 ? bidHistory.length : (auctionData.bid_count ?? vehicle?.bid_count ?? null)),
        bid_history: bidHistory.length > 0 ? bidHistory : (vehicle?.bid_history || []),
        comment_count: llmExtracted.comment_count ?? (comments.length > 0 ? comments.length : (vehicle?.comment_count ?? null)),
        comments: comments.length > 0 ? comments : (vehicle?.comments || []),
        structured_sections: llmExtracted.structured_sections ?? (Object.keys(structuredSections).length > 0 ? structuredSections : (vehicle?.structured_sections || {})),
        bidders: bidders.length > 0 ? bidders : (vehicle?.bidders || []),
        reserve_met: llmExtracted.reserve_met ?? auctionData.reserve_met ?? vehicle?.reserve_met ?? null,
        reserve_price: llmExtracted.reserve_price ?? auctionData.reserve_price ?? vehicle?.reserve_price ?? null,
        auction_end_date: llmExtracted.auction_end_date ?? auctionData.auction_end_date ?? vehicle?.auction_end_date ?? null,
        final_price: auctionData.final_price ?? vehicle?.final_price ?? vehicle?.sale_price ?? null,
        sale_price: auctionData.final_price ?? vehicle?.final_price ?? vehicle?.sale_price ?? null, // Also set sale_price
        sale_date: auctionData.sale_date ?? vehicle?.sale_date ?? null,
        view_count: auctionData.view_count ?? vehicle?.view_count ?? null,
        watcher_count: auctionData.watcher_count ?? vehicle?.watcher_count ?? null,
      };

      extracted.push(merged);
    } catch (e: any) {
      issues.push(`listing scrape failed: ${listingUrl} (${e?.message || String(e)})`);
    }
  }

  // Step 3: Store extracted vehicles in DB + link to source org profile
  // Enable slow downloads by default for Cars & Bids (they often have 100+ images)
  // This prevents timeouts and rate limiting when extracting large galleries
  const shouldDownload = downloadImages !== false; // Default to true for Cars & Bids
  const created = await storeVehiclesInDatabase(extracted, "Cars & Bids", sourceWebsite, shouldDownload);

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
    llm_extraction_results: llmResults, // Show what LLM found
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
  downloadImages: boolean = false,
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

  const preferNonEmptyArray = (candidate: any, fallback: any): any[] => {
    if (Array.isArray(candidate) && candidate.length > 0) return candidate;
    if (Array.isArray(fallback) && fallback.length > 0) return fallback;
    return Array.isArray(candidate) ? candidate : (Array.isArray(fallback) ? fallback : []);
  };

  const deriveSellerBuyer = (vehicle: any): { seller: string | null; buyer: string | null } => {
    const explicitSeller = (vehicle?.seller || vehicle?.seller_username || null) as string | null;
    const explicitBuyer = (vehicle?.buyer || vehicle?.buyer_username || null) as string | null;
    const bidders = Array.isArray(vehicle?.bidders) ? vehicle.bidders : [];
    const comments = Array.isArray(vehicle?.comments) ? vehicle.comments : [];
    const sellerFromBidders = bidders.find((b: any) => b?.is_seller)?.username || null;
    const buyerFromBidders = bidders.find((b: any) => b?.is_buyer)?.username || null;
    const sellerFromComments = comments.find((c: any) => c?.is_seller && c?.author)?.author || null;
    return {
      seller: explicitSeller || sellerFromBidders || sellerFromComments || null,
      buyer: explicitBuyer || buyerFromBidders || null,
    };
  };

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
      let listingUrl = vehicle.listing_url || vehicle.platform_url || vehicle.url || null;
      // CRITICAL: Reject /video URLs - these are not actual listing pages
      if (listingUrl && (listingUrl.includes('/video') || listingUrl.endsWith('/video'))) {
        console.warn(`⚠️ Rejecting /video URL: ${listingUrl}`);
        errors.push(`Rejected /video URL: ${listingUrl}`);
        continue;
      }
      // Clean any /video suffix just in case (multiple passes to catch edge cases)
      if (listingUrl) {
        listingUrl = listingUrl.replace(/\/video\/?$/, '').replace(/\/video\//, '/').replace(/\/video$/, '');
        // Double-check after cleaning
        if (listingUrl.includes('/video')) {
          console.warn(`⚠️ Rejecting /video URL after cleaning: ${listingUrl}`);
          errors.push(`Rejected /video URL after cleaning: ${listingUrl}`);
          continue;
        }
      }
      const title = vehicle.title || vehicle.listing_title || null;
      const vinRaw = typeof vehicle.vin === "string" ? vehicle.vin.trim().toUpperCase() : "";
      // Accept 17-character VINs (modern) OR 4-16 character chassis numbers (vintage vehicles)
      // Vintage vehicles like BMW 507 have chassis numbers like "70077" (5 digits) instead of 17-char VINs
      const isModernVin = vinRaw.length === 17 && /^[A-HJ-NPR-Z0-9]{17}$/.test(vinRaw);
      const isVintageChassis = vinRaw.length >= 4 && vinRaw.length <= 16 && /^[A-HJ-NPR-Z0-9]{4,16}$/.test(vinRaw);
      const isValidVin = isModernVin || isVintageChassis;
      const vin = isValidVin ? vinRaw : null;
      
      if (vinRaw && !isValidVin) {
        console.log(`⚠️ Invalid VIN/chassis detected: "${vinRaw}" (length: ${vinRaw.length}) - using discovery_url for lookup`);
      } else if (vin && isVintageChassis) {
        console.log(`✅ Found vintage chassis number: "${vin}" (${vin.length} chars)`);
      }
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
          trim_level: vehicle.trim_level || null,
          series: vehicle.series || null,
          vin,
          mileage: Number.isFinite(vehicle.mileage) ? Math.trunc(vehicle.mileage) : null,
          color: vehicle.color || null,
          color_primary: vehicle.color_primary || vehicle.color || null,
          secondary_color: vehicle.secondary_color || null,
          interior_color: vehicle.interior_color || null,
          transmission: vehicle.transmission || null,
          transmission_type: vehicle.transmission_type || null,
          transmission_model: vehicle.transmission_model || null,
          engine_size: vehicle.engine_size || null,
          engine_code: vehicle.engine_code || null,
          engine_type: vehicle.engine_type || null,
          horsepower: Number.isFinite(vehicle.horsepower) ? vehicle.horsepower : null,
          drivetrain: vehicle.drivetrain || null,
          fuel_type: vehicle.fuel_type || null,
          body_style: vehicle.body_style || null,
          displacement: vehicle.displacement || null,
          previous_owners: Number.isFinite(vehicle.previous_owners) ? vehicle.previous_owners : null,
          purchase_location: vehicle.purchase_location || null,
          is_show_car: vehicle.is_show_car === true ? true : null,
          has_racing_stripes: vehicle.has_racing_stripes === true ? true : null,
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
            discovery_url: listingUrl, // Store cleaned URL (not video URL)
            structured_sections: vehicle.structured_sections || null, // Doug's Take, Highlights, Equipment, etc.
          },
          origin_metadata: {
            import_source: source.toLowerCase(),
            import_date: nowIso().split('T')[0],
            discovery_url: listingUrl, // Store cleaned URL (not video URL)
            source_url: listingUrl,
            images: Array.isArray(vehicle.images) ? vehicle.images : [],
            image_urls: Array.isArray(vehicle.images) ? vehicle.images : [],
            structured_sections: vehicle.structured_sections || {},
            // Store highlights and story from Mecum extraction
            highlights: Array.isArray(vehicle.highlights) ? vehicle.highlights : [],
            story: typeof vehicle.story === 'string' ? vehicle.story : null,
            bid_history: Array.isArray(vehicle.bid_history) ? vehicle.bid_history : [],
            comments: Array.isArray(vehicle.comments) ? vehicle.comments : [],
            bidders: Array.isArray(vehicle.bidders) ? vehicle.bidders : [],
            seller: deriveSellerBuyer(vehicle).seller,
            buyer: deriveSellerBuyer(vehicle).buyer,
            auction_id: vehicle.auction_id || null,
            auction_name: vehicle.auction_name || null,
            auction_location: vehicle.auction_location || null,
            listing_status: vehicle.listing_status || 'active',
            // Store contributor/contact information (flexible format for multiple sources)
            // Structure: { name, title, phone, email, context, source_type, discovered_at }
            // Context types: 'auction_specialist', 'dealer_contact', 'service_provider', 'contact'
            // Source types: 'curated_contact', 'schema_extracted', 'generic_listing', 'user_submitted'
            contributor: vehicle.contributor || null,
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
          // For updates, merge origin_metadata instead of replacing
          const { data: existingVehicle } = await supabase
            .from("vehicles")
            .select("origin_metadata")
            .eq("id", existing.id)
            .single();
          
          const existingOriginMetadata = (existingVehicle?.origin_metadata as any) || {};
          const newOriginMetadata = {
            ...existingOriginMetadata,
            import_source: source.toLowerCase(),
            import_date: nowIso().split('T')[0],
            discovery_url: listingUrl,
            source_url: listingUrl,
            images: preferNonEmptyArray(vehicle.images, existingOriginMetadata.images),
            image_urls: preferNonEmptyArray(vehicle.images, existingOriginMetadata.image_urls),
            structured_sections: vehicle.structured_sections || existingOriginMetadata.structured_sections || {},
            // Store highlights and story from Mecum extraction
            highlights: Array.isArray(vehicle.highlights) ? vehicle.highlights : (existingOriginMetadata.highlights || []),
            story: typeof vehicle.story === 'string' ? vehicle.story : (existingOriginMetadata.story || null),
            bid_history: preferNonEmptyArray(vehicle.bid_history, existingOriginMetadata.bid_history),
            comments: preferNonEmptyArray(vehicle.comments, existingOriginMetadata.comments),
            bidders: preferNonEmptyArray(vehicle.bidders, existingOriginMetadata.bidders),
            seller: deriveSellerBuyer(vehicle).seller || existingOriginMetadata.seller || null,
            buyer: deriveSellerBuyer(vehicle).buyer || existingOriginMetadata.buyer || null,
            auction_id: vehicle.auction_id || existingOriginMetadata.auction_id || null,
            listing_status: vehicle.listing_status || existingOriginMetadata.listing_status || 'active',
            // Store contributor/consignment consultant information (Broad Arrow) - prefer new data
            contributor: vehicle.contributor || existingOriginMetadata.contributor || null,
            last_updated: nowIso(),
          };
          
          payload.origin_metadata = newOriginMetadata;
          
          // CRITICAL: Only update fields that have actual values - preserve existing data when extraction yields null/empty
          const { data: existingVehicleDataForVin } = await supabase
            .from("vehicles")
            .select("mileage, color, transmission, engine_size, drivetrain, year, make, model, trim")
            .eq("id", existing.id)
            .single();
          
          const existingDataForVin = existingVehicleDataForVin || {};
          
          // Build update payload that preserves existing values when extraction yields null/empty
          const updatePayloadForVin: any = {
            ...payload,
            mileage: payload.mileage !== null && payload.mileage !== undefined ? payload.mileage : existingDataForVin.mileage,
            color: payload.color || existingDataForVin.color,
            transmission: payload.transmission || existingDataForVin.transmission,
            engine_size: payload.engine_size || existingDataForVin.engine_size,
            drivetrain: payload.drivetrain || existingDataForVin.drivetrain,
            year: payload.year !== null && payload.year !== undefined ? payload.year : existingDataForVin.year,
            make: payload.make !== "Unknown" ? payload.make : (existingDataForVin.make || payload.make),
            model: payload.model !== "Unknown" ? payload.model : (existingDataForVin.model || payload.model),
            trim: payload.trim || existingDataForVin.trim,
          };
          
          const { data: updated, error: updateErr } = await supabase
            .from("vehicles")
            .update(updatePayloadForVin)
            .eq("id", existing.id)
            .select("id")
            .single();
          data = updated;
          error = updateErr;
          if (!updateErr && updated?.id) {
            updatedIds.push(String(updated.id));
            // CRITICAL: Also insert images for updated vehicles (only if we found new images)
            if (vehicle.images && Array.isArray(vehicle.images) && vehicle.images.length > 0) {
              console.log(`Inserting ${vehicle.images.length} images for UPDATED vehicle ${updated.id}`);
              const img = await insertVehicleImages(supabase, updated.id, vehicle.images, source, listingUrl, { 
                downloadImages,
                batchSize: 5,
                delayMs: 1000,
              });
              console.log(`Inserted ${img.inserted} images${img.downloaded ? `, downloaded ${img.downloaded}` : ''} for updated vehicle, ${img.errors.length} errors`);
              errors.push(...img.errors);
            } else {
              console.log(`No new images found for updated vehicle ${updated.id} - preserving existing images`);
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
        console.log(`VIN is null/empty. Checking for existing vehicle by discovery_url: "${listingUrl}"`);
        
        // Use raw SQL to ensure we find the existing vehicle (supabase-js maybeSingle can be unreliable)
        let existingByUrl: any = null;
        let urlCheckErr: any = null;
        
        try {
          const { data: sqlResult, error: sqlErr } = await supabase.rpc('get_vehicle_id_by_discovery_url', {
            p_discovery_url: listingUrl
          });
          
          if (sqlErr) {
            console.log(`RPC lookup failed, trying direct query:`, sqlErr.message);
            // Fallback to direct query
            const { data: directResult, error: directErr } = await supabase
              .from("vehicles")
              .select("id")
              .eq("discovery_url", listingUrl)
              .limit(1);
            
            if (directErr) {
              urlCheckErr = directErr;
            } else if (directResult && directResult.length > 0) {
              existingByUrl = directResult[0];
            }
          } else if (sqlResult) {
            existingByUrl = { id: sqlResult };
          }
        } catch (e: any) {
          console.log(`Lookup exception:`, e?.message);
          // Last resort - direct query
          const { data: directResult, error: directErr } = await supabase
            .from("vehicles")
            .select("id")
            .eq("discovery_url", listingUrl)
            .limit(1);
          
          if (!directErr && directResult && directResult.length > 0) {
            existingByUrl = directResult[0];
          } else {
            urlCheckErr = directErr;
          }
        }
        
        console.log(`existingByUrl lookup result:`, existingByUrl?.id || 'NOT FOUND', 'error:', urlCheckErr?.message);
        
        if (urlCheckErr) {
          error = urlCheckErr;
        } else if (existingByUrl?.id) {
          // For updates by discovery_url, merge origin_metadata instead of replacing
          const { data: existingVehicle } = await supabase
            .from("vehicles")
            .select("origin_metadata")
            .eq("id", existingByUrl.id)
            .single();
          
          const existingOriginMetadata = (existingVehicle?.origin_metadata as any) || {};
          const newOriginMetadata = {
            ...existingOriginMetadata,
            import_source: source.toLowerCase(),
            import_date: nowIso().split('T')[0],
            discovery_url: listingUrl,
            source_url: listingUrl,
            images: preferNonEmptyArray(vehicle.images, existingOriginMetadata.images),
            image_urls: preferNonEmptyArray(vehicle.images, existingOriginMetadata.image_urls),
            structured_sections: vehicle.structured_sections || existingOriginMetadata.structured_sections || {},
            // Store highlights and story from Mecum extraction
            highlights: Array.isArray(vehicle.highlights) ? vehicle.highlights : (existingOriginMetadata.highlights || []),
            story: typeof vehicle.story === 'string' ? vehicle.story : (existingOriginMetadata.story || null),
            bid_history: preferNonEmptyArray(vehicle.bid_history, existingOriginMetadata.bid_history),
            comments: preferNonEmptyArray(vehicle.comments, existingOriginMetadata.comments),
            bidders: preferNonEmptyArray(vehicle.bidders, existingOriginMetadata.bidders),
            seller: deriveSellerBuyer(vehicle).seller || existingOriginMetadata.seller || null,
            buyer: deriveSellerBuyer(vehicle).buyer || existingOriginMetadata.buyer || null,
            auction_id: vehicle.auction_id || existingOriginMetadata.auction_id || null,
            listing_status: vehicle.listing_status || existingOriginMetadata.listing_status || 'active',
            // Store contributor/consignment consultant information (Broad Arrow) - prefer new data
            contributor: vehicle.contributor || existingOriginMetadata.contributor || null,
            last_updated: nowIso(),
          };
          
          payload.origin_metadata = newOriginMetadata;
          
          // CRITICAL: Only update fields that have actual values - preserve existing data when extraction yields null/empty
          // This prevents overwriting existing data when old listings don't have complete __NEXT_DATA__
          const { data: existingVehicleData } = await supabase
            .from("vehicles")
            .select("mileage, color, transmission, engine_size, drivetrain, year, make, model, trim, vin")
            .eq("id", existingByUrl.id)
            .single();
          
          const existingData = existingVehicleData || {};
          
          // Build update payload that preserves existing values when extraction yields null/empty
          const updatePayload: any = {
            ...payload,
            // Only update these fields if extraction found actual values (not null/empty)
            mileage: payload.mileage !== null && payload.mileage !== undefined ? payload.mileage : existingData.mileage,
            color: payload.color || existingData.color,
            transmission: payload.transmission || existingData.transmission,
            engine_size: payload.engine_size || existingData.engine_size,
            drivetrain: payload.drivetrain || existingData.drivetrain,
            // Preserve basic vehicle info if extraction is incomplete
            year: payload.year !== null && payload.year !== undefined ? payload.year : existingData.year,
            make: payload.make !== "Unknown" ? payload.make : (existingData.make || payload.make),
            model: payload.model !== "Unknown" ? payload.model : (existingData.model || payload.model),
            trim: payload.trim || existingData.trim,
            vin: payload.vin || existingData.vin,
          };
          
          // Update existing vehicle (preserving existing data when extraction is incomplete)
          const { data: updated, error: updateErr } = await supabase
            .from("vehicles")
            .update(updatePayload)
            .eq("id", existingByUrl.id)
            .select("id")
            .single();
          data = updated;
          error = updateErr;
          if (!updateErr && updated?.id) {
            updatedIds.push(String(updated.id));
            // CRITICAL: Also insert images for updated vehicles (only if we found new images)
            if (vehicle.images && Array.isArray(vehicle.images) && vehicle.images.length > 0) {
              console.log(`Inserting ${vehicle.images.length} images for UPDATED vehicle ${updated.id}`);
              const img = await insertVehicleImages(supabase, updated.id, vehicle.images, source, listingUrl, { 
                downloadImages,
                batchSize: 5,
                delayMs: 1000,
              });
              console.log(`Inserted ${img.inserted} images${img.downloaded ? `, downloaded ${img.downloaded}` : ''} for updated vehicle, ${img.errors.length} errors`);
              errors.push(...img.errors);
            } else {
              console.log(`No new images found for updated vehicle ${updated.id} - preserving existing images`);
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
          else if (urlLower.includes('carsandbids.com')) platform = 'cars_and_bids';
          else if (urlLower.includes('mecum.com')) platform = 'mecum';
          else if (urlLower.includes('barrett-jackson.com') || urlLower.includes('barrettjackson.com')) platform = 'barrettjackson';
          else if (urlLower.includes('russoandsteele.com')) platform = 'russoandsteele';
          else if (urlLower.includes('broadarrowauctions.com')) platform = 'broadarrow';
        }
        
        // Fallback to source name if URL detection failed
        if (!platform) {
          const sourceLower = String(source).toLowerCase();
          if (sourceLower.includes('bring a trailer') || sourceLower.includes('bat')) platform = 'bat';
          else if (sourceLower.includes('cars & bids') || sourceLower.includes('carsandbids')) platform = 'cars_and_bids';
          else if (sourceLower.includes('mecum')) platform = 'mecum';
          else if (sourceLower.includes('barrett')) platform = 'barrettjackson';
          else if (sourceLower.includes('russo')) platform = 'russoandsteele';
          else if (sourceLower.includes('broad arrow') || sourceLower.includes('broadarrow')) platform = 'broadarrow';
        }
        
        if (platform && listingUrl) {
          try {
            // Extract listing ID from URL (platform-specific)
            let listingId: string | null = null;
            if (platform === 'bat') {
              const lotMatch = String(listingUrl).match(/-(\d+)\/?$/);
              listingId = vehicle.lot_number || (lotMatch ? lotMatch[1] : null);
            } else if (platform === 'cars_and_bids') {
              const match = String(listingUrl).match(/\/auctions\/([^\/\?#]+)/i);
              listingId = match?.[1] || null;
            } else if (platform === 'mecum') {
              const lotMatch = String(listingUrl).match(/\/lots\/(?:detail\/)?([^\/]+)/);
              listingId = vehicle.lot_number || (lotMatch ? lotMatch[1] : null);
            } else if (platform === 'barrettjackson') {
              const itemMatch = String(listingUrl).match(/\/Item\/([^\/]+)/);
              listingId = vehicle.lot_number || (itemMatch ? itemMatch[1] : null) || listingUrl.split('/').filter(Boolean).pop() || null;
            } else if (platform === 'broadarrow') {
              // Broad Arrow URL pattern: /vehicles/{auction_id}/{slug}
              // Use the last part of the URL path as listing ID
              const pathParts = listingUrl.split('/').filter(Boolean);
              listingId = vehicle.lot_number || pathParts[pathParts.length - 1] || null;
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

            const { data: existingListing } = await supabase
              .from('external_listings')
              .select('id,current_bid,final_price,bid_count,watcher_count,view_count,start_date,end_date,sold_at,metadata')
              .eq('vehicle_id', data.id)
              .eq('platform', platform)
              .eq('listing_id', listingId)
              .maybeSingle();

            const existingMeta = (existingListing?.metadata as any) || {};
            const existingImages = Array.isArray(existingMeta?.images) ? existingMeta.images : [];
            const mergedImages = extractedImages.length > 0 ? extractedImages : existingImages;
            const mergedBidCount = (Number.isFinite(vehicle.bid_count) && Math.trunc(vehicle.bid_count) > 0) ? Math.trunc(vehicle.bid_count) : (existingListing?.bid_count ?? null);
            const mergedViewCount = (Number.isFinite(vehicle.view_count) && Math.trunc(vehicle.view_count) > 0) ? Math.trunc(vehicle.view_count) : (existingListing?.view_count ?? null);
            const mergedWatcherCount = (Number.isFinite(vehicle.watcher_count) && Math.trunc(vehicle.watcher_count) > 0) ? Math.trunc(vehicle.watcher_count) : (existingListing?.watcher_count ?? null);
            const mergedCurrentBid = (Number.isFinite(currentBid) && Number(currentBid) > 0) ? currentBid : (existingListing?.current_bid ?? null);
            const mergedFinalPrice = (Number.isFinite(finalPrice) && Number(finalPrice) > 0) ? finalPrice : (existingListing?.final_price ?? null);
            const mergedStartDate = startDateIso || (existingListing?.start_date ?? null);
            const mergedEndDate = endDateIso || (existingListing?.end_date ?? null);
            const mergedSoldAt = soldAtIso || (existingListing?.sold_at ?? null);
            
            await supabase
              .from('external_listings')
              .upsert({
                vehicle_id: data.id,
                organization_id: sourceOrgId,
                platform: platform,
                listing_url: listingUrl,
                listing_status: listingStatus,
                listing_id: listingId,
                start_date: mergedStartDate,
                end_date: mergedEndDate,
                sold_at: mergedSoldAt,
                current_bid: mergedCurrentBid,
                final_price: mergedFinalPrice,
                reserve_price: Number.isFinite(vehicle.reserve_price) ? vehicle.reserve_price : null,
                bid_count: mergedBidCount,
                view_count: mergedViewCount,
                watcher_count: mergedWatcherCount,
                metadata: {
                  source: 'extract-premium-auction',
                  lot_number: vehicle.lot_number || listingId,
                  auction_start_date: vehicle.auction_start_date,
                  auction_end_date: vehicle.auction_end_date,
                  sale_date: vehicle.sale_date,
                  seller: deriveSellerBuyer(vehicle).seller,
                  seller_username: vehicle.seller_username || null,
                  buyer: deriveSellerBuyer(vehicle).buyer,
                  buyer_username: vehicle.buyer_username || null,
                  location: vehicle.location || null,
                  comment_count: Number.isFinite(vehicle.comment_count) ? vehicle.comment_count : null,
                  reserve_met: vehicle.reserve_met,
                  features: Array.isArray(vehicle.features) ? vehicle.features : null,
                  // CRITICAL: Store ALL extracted images for fallback display
                  images: mergedImages,
                  image_urls: mergedImages, // Alias for compatibility
                  // Store bid history
                  bid_history: Array.isArray(vehicle.bid_history) && vehicle.bid_history.length > 0 ? vehicle.bid_history : null,
                },
                updated_at: nowIso(),
              }, {
                onConflict: 'vehicle_id,platform,listing_id',
              });
          } catch (e: any) {
            console.warn(`external_listings upsert failed (non-fatal): ${e?.message || String(e)}`);
          }
        }
        
        // Store comments and bid history in auction_comments table
        // NOTE: Production schema uses auction_events(source, source_url) and auction_comments dedupe key (vehicle_id, content_hash).
        // Hoist auctionEventId to outer scope so it can be used in bidders block.
        let auctionEventId: string | null = null;

        // ⚠️ CRITICAL: Always create/update auction_events for BaT listings (not just when comments/bid_history exist)
        // This ensures we track sale status, outcomes, and auction data even if comments extraction happens later
        if (data?.id && listingUrl) {
          try {
            // Determine auction_events.source for this listing
            const eventSource = platform === 'cars_and_bids' ? 'cars_and_bids' : (platform || 'unknown');

            // Create or get auction_event (unique key in prod: (vehicle_id, source_url))
            const { data: existingEvent } = await supabase
              .from('auction_events')
              .select('id')
              .eq('vehicle_id', data.id)
              .eq('source_url', listingUrl)
              .maybeSingle();

            if (existingEvent?.id) {
              auctionEventId = existingEvent.id;

              const sourceListingIdFromUrl = String(listingUrl).match(/\/auctions\/([^\/\?#]+)/i)?.[1] || null;
              
              // ⚠️ CRITICAL: Re-calculate outcome when updating (may have been wrong before)
              const endDate = vehicle.auction_end_date ? new Date(vehicle.auction_end_date) : null;
              const hasSalePrice = Number.isFinite(vehicle.sale_price) && vehicle.sale_price > 0;
              const hasHighBid = Number.isFinite(vehicle.high_bid) && vehicle.high_bid > 0;
              const hasFinalBid = Number.isFinite(vehicle.final_bid) && vehicle.final_bid > 0;
              
              const outcome: string =
                hasSalePrice ? 'sold' : // Only sold if we have sale_price (from "Sold for")
                (vehicle.reserve_met === false ? 'reserve_not_met' :
                  (hasHighBid || hasFinalBid ? 'bid_to' : // Has bids but no sale = "bid to" status
                    (endDate && Number.isFinite(endDate.getTime()) && endDate > new Date() ? 'pending' : 'no_sale')));

              await supabase
                .from('auction_events')
                .update({
                  source: eventSource,
                  source_listing_id: vehicle.auction_id || vehicle.listing_id || sourceListingIdFromUrl,
                  outcome, // ⚠️ CRITICAL: Update outcome (fixes wrong sale status)
                  // high_bid: highest bid regardless of outcome
                  high_bid: Number.isFinite(vehicle.high_bid) ? vehicle.high_bid :
                            (Number.isFinite(vehicle.final_bid) ? vehicle.final_bid :
                             (Number.isFinite(vehicle.current_bid) ? vehicle.current_bid : null)),
                  // winning_bid: ONLY set if actually sold (has sale_price)
                  winning_bid: hasSalePrice ? (Number.isFinite(vehicle.sale_price) ? vehicle.sale_price : null) : null,
                  winning_bidder: (hasSalePrice && (vehicle.buyer_username || vehicle.buyer)) ? (vehicle.buyer_username || vehicle.buyer) : null,
                  seller_name: deriveSellerBuyer(vehicle).seller,
                  comments_count: Array.isArray(vehicle.comments) ? vehicle.comments.length : (Number.isFinite(vehicle.comment_count) ? vehicle.comment_count : null),
                  bid_history: Array.isArray(vehicle.bid_history) ? vehicle.bid_history : null,
                  updated_at: nowIso(),
                })
                .eq('id', existingEvent.id);
            } else {
              const endDate = vehicle.auction_end_date ? new Date(vehicle.auction_end_date) : null;
              // auction_events.outcome CHECK constraint:
              // sold, reserve_not_met, no_sale, bid_to, cancelled, relisted, pending
              // ⚠️ CRITICAL: Only mark as 'sold' if sale_price exists (from "Sold for", not "Bid to")
              // If we have high_bid but NO sale_price, it's NOT sold (reserve not met or no sale)
              const hasSalePrice = Number.isFinite(vehicle.sale_price) && vehicle.sale_price > 0;
              const hasHighBid = Number.isFinite(vehicle.high_bid) && vehicle.high_bid > 0;
              const hasFinalBid = Number.isFinite(vehicle.final_bid) && vehicle.final_bid > 0;
              
              const outcome: string =
                hasSalePrice ? 'sold' : // Only sold if we have sale_price (from "Sold for")
                (vehicle.reserve_met === false ? 'reserve_not_met' :
                  (hasHighBid || hasFinalBid ? 'bid_to' : // Has bids but no sale = "bid to" status
                    (endDate && Number.isFinite(endDate.getTime()) && endDate > new Date() ? 'pending' : 'no_sale')));
              const { data: newEvent, error: eventError } = await supabase
                .from('auction_events')
                .upsert({
                  vehicle_id: data.id,
                  source: eventSource,
                  source_url: listingUrl,
                  source_listing_id: vehicle.auction_id || vehicle.listing_id || null,
                  outcome,
                  // high_bid: highest bid regardless of outcome (can be from "Bid to" or "Sold for")
                  high_bid: Number.isFinite(vehicle.high_bid) ? vehicle.high_bid :
                            (Number.isFinite(vehicle.final_bid) ? vehicle.final_bid :
                             (Number.isFinite(vehicle.current_bid) ? vehicle.current_bid : null)),
                  // winning_bid: ONLY set if actually sold (has sale_price)
                  // DO NOT set from final_bid or high_bid if no sale_price (those are just "Bid to" amounts)
                  winning_bid: hasSalePrice ? (Number.isFinite(vehicle.sale_price) ? vehicle.sale_price : null) : null,
                  winning_bidder: (hasSalePrice && (vehicle.buyer_username || vehicle.buyer)) ? (vehicle.buyer_username || vehicle.buyer) : null,
                  seller_name: deriveSellerBuyer(vehicle).seller,
                  comments_count: Array.isArray(vehicle.comments) ? vehicle.comments.length : (Number.isFinite(vehicle.comment_count) ? vehicle.comment_count : null),
                  bid_history: Array.isArray(vehicle.bid_history) ? vehicle.bid_history : null,
                  raw_data: {
                    extracted_at: nowIso(),
                    platform,
                    listing_url: listingUrl,
                    listing_id: vehicle.auction_id || vehicle.listing_id || null,
                    bidders: Array.isArray(vehicle.bidders) ? vehicle.bidders : null,
                  },
                  updated_at: nowIso(),
                }, {
                  onConflict: 'vehicle_id,source_url',
                })
                .select('id')
                .single();

              if (!eventError && newEvent?.id) {
                auctionEventId = newEvent.id;
              } else if (eventError) {
                console.warn(`Failed to create/update auction_event: ${eventError.message}`);
              }
            }

            // Store comments (dedupe key: vehicle_id + content_hash)
            if (Array.isArray(vehicle.comments) && vehicle.comments.length > 0) {
              const platformForComments = platform || null;
              const rows = [] as any[];
              for (let idx = 0; idx < vehicle.comments.length; idx++) {
                const c = vehicle.comments[idx];
                const postedAt = c.timestamp ? new Date(c.timestamp).toISOString() : new Date().toISOString();
                const author = c.author || 'Unknown';
                let text = c.text || '';

                // Cars & Bids: aggressively strip UI chrome from comments before storing.
                // We do this here (persistence time) because upstream extraction can still
                // return comment objects with UI fragments in `text`.
                if (platform === 'cars_and_bids') {
                  text = String(text || '')
                    .replace(/[\r\n\t]+/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();

                  text = text
                    .replace(/^[^A-Za-z0-9$]*?/g, '')
                    .replace(/^\d+\s*(?:m|h|d|w|mo|y)\s+/i, '');

                  text = text
                    .replace(/^follow\s+[A-Za-z0-9_\-]+\s+/i, '')
                    .replace(/\breputation\s+icon\b\s*[0-9]+(?:\.[0-9]+)?k?\b/gi, ' ')
                    .replace(/\breputation\s+icon\b/gi, ' ')
                    .replace(/\bseller\b\s*[0-9]+(?:\.[0-9]+)?k?\s*(?:m|h|d|w|mo|y)\b/gi, ' ')
                    .replace(/\breply\b\s*flag\s+as\s+inappropriate\b/gi, ' ')
                    .replace(/\bflag\s+as\s+inappropriate\b/gi, ' ')
                    .replace(/\s+\|\s+/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();

                  const lower = text.toLowerCase();
                  if (!text) continue;
                  if (lower.includes('comments & bids')) continue;
                  if (lower.includes('most upvoted')) continue;
                  if (lower.includes('newest')) continue;
                  if (lower.includes('add a comment')) continue;
                  if (lower.includes('bid history')) continue;
                  if (lower.includes('you just commented')) continue;
                  if (lower.startsWith('comments ')) continue;

                  // Drop status-line pseudo-comments
                  if (author === 'Unknown') {
                    if (lower.startsWith('reserve not met, bid to $')) continue;
                    if (lower.startsWith('sold to ') || lower.startsWith('sold after for $')) continue;
                  }

                  if (text.length < 10) continue;
                }

                const bidAmount = c.bid_amount || (c.is_bid && text ? parseFloat(text.match(/\$([0-9,]+)/)?.[1]?.replace(/,/g, '') || '0') : null);
                const contentHash = await sha256Hex(`${data.id}|${listingUrl}|comment|${idx + 1}|${postedAt}|${author}|${text}|${bidAmount || ''}`);

                rows.push({
                  auction_event_id: auctionEventId,
                  vehicle_id: data.id,
                  platform: platformForComments,
                  source_url: listingUrl,
                  content_hash: contentHash,
                  sequence_number: idx + 1,
                  posted_at: postedAt,
                  author_username: author,
                  is_seller: c.is_seller || false,
                  comment_type: c.is_bid ? 'bid' : (c.is_seller ? 'seller_response' : 'observation'),
                  comment_text: text,
                  word_count: text.split(/\s+/).filter(Boolean).length,
                  bid_amount: bidAmount,
                  has_question: text.includes('?'),
                });
              }

              const batchSize = 25;
              for (let i = 0; i < rows.length; i += batchSize) {
                const batch = rows.slice(i, i + batchSize);
                const { error: commentError } = await supabase
                  .from('auction_comments')
                  .upsert(batch, {
                    onConflict: 'vehicle_id,content_hash',
                    ignoreDuplicates: false,
                  });
                if (commentError) {
                  console.warn(`Failed to upsert auction_comments batch ${i / batchSize + 1}: ${commentError.message}`);
                }
              }

              console.log(`✅ Stored ${rows.length} comments for vehicle ${data.id}`);
            }

            // Store bid history as comments (optional; same dedupe key)
            if (Array.isArray(vehicle.bid_history) && vehicle.bid_history.length > 0) {
              const platformForComments = platform || null;
              const rows = [] as any[];
              for (let idx = 0; idx < vehicle.bid_history.length; idx++) {
                const bid = vehicle.bid_history[idx];
                if (!bid?.amount || !bid?.bidder) continue;
                const postedAt = bid.timestamp ? new Date(bid.timestamp).toISOString() : new Date().toISOString();
                const author = bid.bidder || 'Unknown';
                const text = `Bid of $${Number(bid.amount).toLocaleString()} placed by ${author}`;
                const contentHash = await sha256Hex(`${data.id}|${listingUrl}|bid|${idx + 1}|${postedAt}|${author}|${bid.amount}`);

                rows.push({
                  auction_event_id: auctionEventId,
                  vehicle_id: data.id,
                  platform: platformForComments,
                  source_url: listingUrl,
                  content_hash: contentHash,
                  sequence_number: 10000 + idx,
                  posted_at: postedAt,
                  author_username: author,
                  is_seller: false,
                  comment_type: 'bid',
                  comment_text: text,
                  word_count: text.split(/\s+/).filter(Boolean).length,
                  bid_amount: bid.amount,
                  has_question: false,
                });
              }

              if (rows.length > 0) {
                const { error: bidError } = await supabase
                  .from('auction_comments')
                  .upsert(rows, {
                    onConflict: 'vehicle_id,content_hash',
                    ignoreDuplicates: false,
                  });
                if (bidError) {
                  console.warn(`Failed to upsert bid history: ${bidError.message}`);
                } else {
                  console.log(`✅ Stored ${rows.length} bid history entries for vehicle ${data.id}`);
                }
              }
            }
          } catch (e: any) {
            console.warn(`Failed to store comments/bid history (non-fatal): ${e?.message || String(e)}`);
          }
        }
        
        // Create external_identities for bidders and link them to comments/bids
        if (data?.id && Array.isArray(vehicle.bidders) && vehicle.bidders.length > 0) {
          try {
            const nowIso = new Date().toISOString();
            const identityRows = vehicle.bidders.map((bidder: any) => ({
              platform: 'cars_and_bids',
              handle: bidder.username || 'Unknown',
              profile_url: bidder.profile_url || `https://carsandbids.com/user/${bidder.username}`,
              display_name: bidder.username,
              last_seen_at: nowIso,
              updated_at: nowIso,
              metadata: {
                is_buyer: bidder.is_buyer || false,
                is_seller: bidder.is_seller || false,
              },
            }));
            
            // Upsert external identities
            const { data: upsertedIdentities, error: identityError } = await supabase
              .from('external_identities')
              .upsert(identityRows, { onConflict: 'platform,handle' })
              .select('id, handle');
            
            if (identityError) {
              console.warn(`Failed to upsert external identities: ${identityError.message}`);
            } else if (upsertedIdentities && upsertedIdentities.length > 0) {
              // Create map of username to identity ID
              const handleToIdentityId = new Map<string, string>();
              upsertedIdentities.forEach((identity: any) => {
                if (identity.handle && identity.id) {
                  handleToIdentityId.set(identity.handle, identity.id);
                }
              });
              
              // Link comments to external identities
              if (Array.isArray(vehicle.comments) && vehicle.comments.length > 0 && auctionEventId) {
                const commentUpdates = vehicle.comments
                  .filter((c: any) => c.author && handleToIdentityId.has(c.author))
                  .map((c: any) => ({
                    auction_event_id: auctionEventId,
                    vehicle_id: data.id,
                    author_username: c.author,
                    external_identity_id: handleToIdentityId.get(c.author),
                  }));
                
                if (commentUpdates.length > 0) {
                  // Update comments with external_identity_id
                  for (const update of commentUpdates) {
                    await supabase
                      .from('auction_comments')
                      .update({ external_identity_id: update.external_identity_id })
                      .eq('auction_event_id', update.auction_event_id)
                      .eq('author_username', update.author_username);
                  }
                  
                  console.log(`✅ Linked ${commentUpdates.length} comments to external identities`);
                }
              }
              
              // Link bid history to external identities
              if (Array.isArray(vehicle.bid_history) && vehicle.bid_history.length > 0 && auctionEventId) {
                const bidUpdates = vehicle.bid_history
                  .filter((b: any) => b.bidder && handleToIdentityId.has(b.bidder))
                  .map((b: any) => ({
                    auction_event_id: auctionEventId,
                    vehicle_id: data.id,
                    author_username: b.bidder,
                    external_identity_id: handleToIdentityId.get(b.bidder),
                  }));
                
                if (bidUpdates.length > 0) {
                  // Update bid comments with external_identity_id
                  for (const update of bidUpdates) {
                    await supabase
                      .from('auction_comments')
                      .update({ external_identity_id: update.external_identity_id })
                      .eq('auction_event_id', update.auction_event_id)
                      .eq('author_username', update.author_username)
                      .eq('comment_type', 'bid');
                  }
                  
                  console.log(`✅ Linked ${bidUpdates.length} bids to external identities`);
                }
              }
            }
          } catch (e: any) {
            console.warn(`Failed to create external identities for bidders (non-fatal): ${e?.message || String(e)}`);
          }
        }

        // organization_vehicles link is created by DB trigger auto_link_vehicle_to_origin_org()
        // when origin_organization_id is set.
        if (vehicle.images && Array.isArray(vehicle.images) && vehicle.images.length > 0) {
          console.log(`Inserting ${vehicle.images.length} images for vehicle ${data.id}`);
          const img = await insertVehicleImages(supabase, data.id, vehicle.images, source, listingUrl, { 
            downloadImages,
            batchSize: 5,
            delayMs: 1000,
          });
          console.log(`Inserted ${img.inserted} images${img.downloaded ? `, downloaded ${img.downloaded}` : ''}, ${img.errors.length} errors`);
          errors.push(...img.errors);
        } else {
          console.log(`No images to insert for vehicle ${data.id} (images: ${vehicle.images ? 'exists but empty/invalid' : 'missing'})`);
        }
        
        // Insert videos as images with video metadata
        if (vehicle.videos && Array.isArray(vehicle.videos) && vehicle.videos.length > 0) {
          console.log(`Inserting ${vehicle.videos.length} videos for vehicle ${data.id}`);
          const videoErrors: string[] = [];
          let videoInserted = 0;
          
          for (const video of vehicle.videos) {
            try {
              // Use thumbnail as image_url, store video URL in metadata
              const thumbnailUrl = video.thumbnail || `https://img.youtube.com/vi/${video.url.match(/[?&]v=([a-zA-Z0-9_-]{11})/)?.[1] || ''}/maxresdefault.jpg`;
              
              const { error: videoError } = await supabase
                .from("vehicle_images")
                .insert({
                  vehicle_id: data.id,
                  image_url: thumbnailUrl,
                  source: source.toLowerCase(),
                  source_url: listingUrl,
                  is_external: true,
                  ai_processing_status: "pending",
                  position: 9999 + videoInserted, // Put videos after images
                  display_order: 9999 + videoInserted,
                  is_primary: false,
                  is_approved: true,
                  approval_status: "auto_approved",
                  redaction_level: "none",
                  exif_data: {
                    is_video: true,
                    video_url: video.url,
                    video_type: video.type,
                    video_thumbnail: video.thumbnail,
                    source_url: listingUrl,
                    discovery_url: listingUrl,
                    imported_from: source,
                  },
                });
              
              if (videoError) {
                videoErrors.push(`video insert failed (${data.id}): ${videoError.message}`);
              } else {
                videoInserted++;
              }
            } catch (e: any) {
              videoErrors.push(`video insert exception (${data.id}): ${e?.message || String(e)}`);
            }
          }
          
          console.log(`Inserted ${videoInserted} videos, ${videoErrors.length} errors`);
          errors.push(...videoErrors);
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

// Normalize website URL for consistent matching
function normalizeWebsiteForMatching(url: string | null): string | null {
  if (!url) return null;
  return url
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '')
    .trim();
}

async function ensureSourceBusiness(
  supabase: any,
  sourceName: string,
  website: string | null,
): Promise<string | null> {
  const w = website ? String(website).trim() : "";
  if (!w) return null;
  
  // Normalize website for matching
  const normalizedWebsite = normalizeWebsiteForMatching(w);
  
  try {
    // First try exact match
    const { data: existingExact } = await supabase
      .from("businesses")
      .select("id, website")
      .eq("website", w)
      .limit(1)
      .maybeSingle();
    if (existingExact?.id) return existingExact.id;
    
    // Then try normalized match (to catch www vs non-www, http vs https, trailing slash variations)
    if (normalizedWebsite) {
      const { data: allOrgs } = await supabase
        .from("businesses")
        .select("id, website")
        .not("website", "is", null)
        .limit(1000); // Get a reasonable batch to check
      
      if (allOrgs) {
        const match = allOrgs.find(org => {
          const orgNormalized = normalizeWebsiteForMatching(org.website);
          return orgNormalized === normalizedWebsite;
        });
        if (match?.id) {
          // Update the existing org to use the canonical website format
          await supabase
            .from("businesses")
            .update({ website: w }) // Use the provided format as canonical
            .eq("id", match.id);
          return match.id;
        }
      }
    }

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
    // Cars & Bids: Remove CDN path parameters to get full resolution
    // Example: /cdn-cgi/image/width=80,height=80,quality=70,fit=cover/... -> /cdn-cgi/image/...
    if (cleaned.includes('cdn-cgi/image/')) {
      // Remove path-based parameters (width=, height=, quality=, fit=)
      cleaned = cleaned.replace(/cdn-cgi\/image\/width=\d+,height=\d+,quality=\d+,fit=\w+\//, 'cdn-cgi/image/');
      cleaned = cleaned.replace(/cdn-cgi\/image\/width=\d+,height=\d+,quality=\d+\//, 'cdn-cgi/image/');
      cleaned = cleaned.replace(/cdn-cgi\/image\/width=\d+,height=\d+\//, 'cdn-cgi/image/');
      cleaned = cleaned.replace(/cdn-cgi\/image\/width=\d+,quality=\d+\//, 'cdn-cgi/image/');
      cleaned = cleaned.replace(/cdn-cgi\/image\/width=\d+\//, 'cdn-cgi/image/');
      cleaned = cleaned.replace(/cdn-cgi\/image\/quality=\d+\//, 'cdn-cgi/image/');
    }
    // Remove query params
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
  options?: { downloadImages?: boolean; batchSize?: number; delayMs?: number },
): Promise<{ inserted: number; errors: string[]; downloaded?: number }> {
  const errors: string[] = [];
  let inserted = 0;
  let downloaded = 0;
  const downloadImages = options?.downloadImages ?? false;
  const batchSize = options?.batchSize ?? 5; // Process 5 images at a time
  const delayMs = options?.delayMs ?? 1000; // 1 second delay between batches
  
  // Universal garbage filter - these should NEVER be vehicle images
  // Based on user feedback: "most the cars and bids dont" have images, suggesting many URLs are false flags
  const isGarbageUrl = (url: string): boolean => {
    if (!url || typeof url !== 'string') return true;
    const lower = url.toLowerCase();
    
    // ALWAYS exclude SVGs (never vehicle photos)
    if (lower.endsWith('.svg') || lower.includes('.svg?') || lower.includes('.svg#')) return true;
    
    // Exclude tiny thumbnails by URL parameters (80x80, 100x100, 120x120 etc.) - these are UI elements, not vehicle photos
    if (lower.includes('width=80') || lower.includes('width=100') || lower.includes('width=120')) {
      // Allow only if it's clearly a gallery image path that will be upgraded to full res
      if (!lower.match(/\/photos\/|\/images\/|\/gallery\/|\/auctions\//)) return true;
    }
    
    // Exclude Vimeo CDN thumbnails (video thumbnails, not vehicle photos)
    if (lower.includes('vimeocdn.com')) return true;
    if (lower.includes('vimeo.com')) return true;
    
    // Exclude video-related paths
    if (lower.includes('/video') || lower.includes('/videos/') || lower.match(/video[\/\-]/)) return true;
    
    // Exclude thumbnail paths that are UI elements, not gallery images
    if (lower.includes('/thumbnail') || lower.includes('/thumbnails/')) {
      // Only allow if clearly in a gallery/photos context
      if (!lower.match(/\/photos\/|\/images\/|\/gallery\/|\/auctions\//)) return true;
    }
    
    // Exclude org branding and UI elements
    if (lower.includes('/countries/')) return true;
    if (lower.includes('/logo') || lower.includes('/logos/') || lower.includes('logo.')) return true;
    if (lower.includes('/icon') || lower.includes('/icons/')) return true;
    if (lower.includes('/assets/') || lower.includes('/static/')) return true;
    if (lower.includes('/button') || lower.includes('/badge')) return true;
    if (lower.includes('/avatar') || lower.includes('/profile_pic') || lower.includes('/profile/')) return true;
    if (lower.includes('/favicon')) return true;
    if (lower.includes('/seller/')) return true;
    if (lower.includes('placeholder')) return true;
    
    // Exclude user/profile images
    if (lower.includes('/user/') || lower.includes('/users/')) return true;
    
    // Exclude social sharing images
    if (lower.includes('linkedin.com') || lower.includes('shareArticle')) return true;
    if (lower.includes('facebook.com/sharer')) return true;
    if (lower.includes('twitter.com/share')) return true;
    if (lower.includes('/og-image') || lower.includes('/preview') || lower.includes('/share')) return true;
    
    // CRITICAL: Exclude edit/preview/draft images in filenames - these are NOT final vehicle photos
    // Pattern: filename contains "(edit)", "-(edit)", "(preview)", "(draft)", or variations
    // Examples: 
    //   /photos/3vpGQDzR.O-8lX-AMW-(edit).jpg (editing preview - NOT a final photo)
    //   /photos/3vpGQDzR.m870SuvV7-(edit).jpg (editing preview - NOT a final photo)
    // Valid images typically have paths like: /photos/s-1pEmzwg32wR.jpg or /photos/exterior/...
    if (lower.includes('(edit)') || lower.includes('-(edit)') || lower.includes('(preview)') || lower.includes('(draft)') ||
        lower.includes('edit).') || lower.includes('preview).') || lower.includes('draft).') ||
        lower.match(/\(edit/i) || lower.match(/edit\)/i) || lower.match(/\(.*edit/i) ||
        lower.match(/[\.\-]edit\)/i) || lower.match(/\(edit[\.\-]/i)) {
      return true;
    }
    
    // Exclude application/upload paths that are upload previews, not final gallery images
    // Cars & Bids uses /photos/exterior/, /photos/interior/, /photos/other/ for real photos
    // But /photos/application/ often contains upload previews/editing images
    if (lower.includes('/photos/application/') || lower.includes('/application/')) {
      const filename = lower.split('/').pop() || '';
      // Exclude if it looks like an upload preview (short filename, or has edit/upload markers)
      if (filename.length < 10 || filename.includes('edit') || filename.includes('upload') || 
          filename.includes('temp') || filename.includes('preview') || filename.includes('(edit)')) {
        return true;
      }
    }
    
    // Organization/dealer logos
    if (lower.includes('organization-logos/') || lower.includes('organization_logos/')) return true;
    if (lower.includes('images.classic.com/uploads/dealer/')) return true;
    if (lower.includes('/uploads/dealer/')) return true;
    
    // Cars & Bids specific: Exclude CDN paths that are clearly thumbnails (not gallery images)
    // If the URL has very small size parameters and is not in a gallery context, it's likely a false flag
    if (lower.includes('cdn-cgi/image/')) {
      // Check for very small sizes in the path
      if (lower.match(/width=\d+/)) {
        const widthMatch = lower.match(/width=(\d+)/);
        if (widthMatch && parseInt(widthMatch[1]) < 200) {
          // If it's a very small width (< 200px) and not in a gallery context, exclude it
          if (!lower.match(/\/photos\/|\/images\/|\/gallery\/|\/auctions\/|\/media\//)) return true;
        }
      }
    }
    
    return false;
  };
  
  // Clean all URLs before processing and filter out garbage
  const urls = (Array.isArray(imageUrls) ? imageUrls : [])
    .map((u) => cleanImageUrl(String(u || "").trim(), source))
    .filter((u) => {
      if (!u || !u.startsWith("http")) return false;
      
      // Apply universal garbage filter
      if (isGarbageUrl(u)) {
        console.warn(`⚠️ Rejecting garbage image: ${u}`);
        return false;
      }
      
      const urlLower = u.toLowerCase();
      // CRITICAL: Reject Vimeo CDN thumbnails (low-quality video thumbnails, not vehicle photos)
      if (urlLower.includes('vimeocdn.com')) {
        // Check for thumbnail size parameters (mw=80, mw=100, mw=120 = very small thumbnails)
        if (urlLower.includes('mw=80') || urlLower.includes('mw=100') || urlLower.includes('mw=120')) {
          console.warn(`⚠️ Rejecting Vimeo thumbnail (too small): ${u}`);
          return false;
        }
        // Also reject if it's clearly a video thumbnail path
        if (urlLower.includes('/video/') && (urlLower.includes('?mw=') || urlLower.includes('&mw='))) {
          console.warn(`⚠️ Rejecting Vimeo video thumbnail: ${u}`);
          return false;
        }
      }
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

  // Helper to detect if URL is a document (window sticker, spec sheet, etc.)
  // Documents are valuable and should be extracted, just not used as primary images
  const isDocumentUrl = (url: string): boolean => {
    if (!url || typeof url !== 'string') return false;
    const lower = url.toLowerCase();
    return (
      lower.includes('window-sticker') || lower.includes('window_sticker') ||
      lower.includes('monroney') || lower.includes('spec-sheet') ||
      lower.includes('spec_sheet') || lower.includes('build-sheet') ||
      lower.includes('build_sheet') || lower.includes('spid') ||
      lower.includes('service-parts') || lower.includes('rpo') ||
      (lower.includes('document') && !lower.includes('photo')) ||
      (lower.includes('sticker') && !lower.includes('decal')) ||
      (lower.includes('sheet') && !lower.includes('bedsheet')) ||
      lower.includes('receipt') || lower.includes('invoice') ||
      lower.includes('title') || lower.includes('registration')
    );
  };

  // Insert ALL images (no limit) - BaT listings can have 100+ images
  // Documents are included but marked and excluded from primary selection
  for (const imageUrl of urls) {
    if (existingUrls.has(imageUrl)) continue;
    try {
      // Detect documents but still extract them - just don't make them primary
      const isDocument = isDocumentUrl(imageUrl);
      const makePrimary = !hasPrimary && nextPosition === 0 && !isDocument;
      
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
      } else if (listingUrlLower.includes("broadarrowauctions.com") || sourceLower.includes("broad arrow") || sourceLower.includes("broadarrow")) {
        imageSource = "external_import"; // Broad Arrow: use generic external_import
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
          is_document: isDocument, // Mark documents so they're excluded from primary selection
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

  // If downloadImages is true, slowly download images in batches
  if (downloadImages && inserted > 0) {
    console.log(`📥 Starting slow batch download of ${inserted} images for vehicle ${vehicleId}...`);
    
    // Get all external images we just created
    const { data: externalImages, error: fetchError } = await supabase
      .from("vehicle_images")
      .select("id, image_url")
      .eq("vehicle_id", vehicleId)
      .eq("is_external", true)
      .is("storage_path", null) // Only download images not yet in storage
      .order("position", { ascending: true })
      .limit(1000); // Safety limit

    if (fetchError) {
      errors.push(`Failed to fetch external images for download: ${fetchError.message}`);
    } else if (externalImages && externalImages.length > 0) {
      console.log(`📥 Downloading ${externalImages.length} images in batches of ${batchSize} with ${delayMs}ms delays...`);
      
      // Process in batches with delays
      for (let i = 0; i < externalImages.length; i += batchSize) {
        const batch = externalImages.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(externalImages.length / batchSize);
        
        console.log(`📥 Processing batch ${batchNum}/${totalBatches} (${batch.length} images)...`);
        
        // Process batch in parallel
        const batchResults = await Promise.allSettled(
          batch.map(async (img: any) => {
            try {
              const imageUrl = img.image_url;
              if (!imageUrl || !imageUrl.startsWith('http')) {
                return { success: false, error: 'Invalid URL' };
              }

              // Download image with proper headers (hotlink protection bypass)
              const headers: HeadersInit = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
              };
              // Add Referer for auction sites with hotlink protection
              if (imageUrl.includes('mecum.com') || imageUrl.includes('images.mecum.com')) {
                headers['Referer'] = 'https://www.mecum.com/';
              } else if (imageUrl.includes('barrett-jackson')) {
                headers['Referer'] = 'https://www.barrett-jackson.com/';
              } else if (imageUrl.includes('rmsothebys')) {
                headers['Referer'] = 'https://rmsothebys.com/';
              } else if (imageUrl.includes('bonhams')) {
                headers['Referer'] = 'https://www.bonhams.com/';
              } else if (imageUrl.includes('bringatrailer')) {
                headers['Referer'] = 'https://bringatrailer.com/';
              }
              const imageResponse = await fetch(imageUrl, {
                signal: AbortSignal.timeout(30000), // 30 second timeout
                headers,
              });

              if (!imageResponse.ok) {
                return { success: false, error: `HTTP ${imageResponse.status}` };
              }

              const imageBlob = await imageResponse.blob();
              const arrayBuffer = await imageBlob.arrayBuffer();
              const uint8Array = new Uint8Array(arrayBuffer);

              // Determine file extension
              const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
              const ext = contentType.includes('png') ? 'png' : 
                         contentType.includes('webp') ? 'webp' : 'jpg';
              
              // Generate storage path
              const fileName = `${Date.now()}_${img.id}.${ext}`;
              const storagePath = `vehicles/${vehicleId}/images/premium_auction/${fileName}`;

              // Upload to Supabase Storage
              const { data: uploadData, error: uploadError } = await supabase.storage
                .from(STORAGE_BUCKET)
                .upload(storagePath, uint8Array, {
                  contentType: contentType,
                  cacheControl: '3600',
                  upsert: false,
                });

              if (uploadError) {
                return { success: false, error: uploadError.message };
              }

              // Get public URL
              const { data: { publicUrl } } = supabase.storage
                .from(STORAGE_BUCKET)
                .getPublicUrl(storagePath);

              // Update vehicle_images record with storage path and remove is_external flag
              const { error: updateError } = await supabase
                .from("vehicle_images")
                .update({
                  image_url: publicUrl,
                  storage_path: storagePath,
                  is_external: false,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", img.id);

              if (updateError) {
                return { success: false, error: updateError.message };
              }

              return { success: true };
            } catch (e: any) {
              return { success: false, error: e?.message || String(e) };
            }
          })
        );

        // Count successes and errors
        let batchDownloaded = 0;
        for (const result of batchResults) {
          if (result.status === 'fulfilled' && result.value.success) {
            batchDownloaded++;
            downloaded++;
          } else {
            const errorMsg = result.status === 'rejected' 
              ? result.reason?.message || 'Unknown error'
              : result.value.error || 'Unknown error';
            errors.push(`Image download failed: ${errorMsg}`);
          }
        }

        console.log(`✅ Batch ${batchNum}/${totalBatches} complete: ${batchDownloaded}/${batch.length} downloaded`);

        // Delay between batches (except for the last batch)
        if (i + batchSize < externalImages.length) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }

      console.log(`✅ Slow download complete: ${downloaded}/${externalImages.length} images downloaded for vehicle ${vehicleId}`);
    }
  }

  return { inserted, errors, ...(downloadImages ? { downloaded } : {}) };
}

function extractCarsAndBidsListingUrls(html: string, limit: number): string[] {
  const urls = new Set<string>();
  
  // PRIORITY 1: Look for auction-item containers with hero links (most reliable - actual listings page structure)
  // Pattern: <li class="auction-item"><a class="hero" href="/auctions/ID/year-make-model">
  const auctionItemHeroPattern = /<li[^>]*class=["'][^"']*auction-item[^"']*["'][^>]*>[\s\S]*?<a[^>]*class=["'][^"']*hero[^"']*["'][^>]*href=["'](\/auctions\/[^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = auctionItemHeroPattern.exec(html)) !== null) {
    const path = m[1];
    if (!path) continue;
    // Exclude /video URLs
    if (path.includes('/video')) continue;
    urls.add(`https://carsandbids.com${path.split('?')[0]}`);
    if (urls.size >= Math.max(1, limit)) break;
  }
  
  // PRIORITY 2: Look for auction-link class with actual listing URLs (fallback)
  // Pattern: <a class="auction-link" href="/auctions/ID/year-make-model">
  if (urls.size < limit) {
    const auctionLinkPattern = /<a[^>]*class=["'][^"']*auction-link[^"']*["'][^>]*href=["'](\/auctions\/[^"']+)["']/gi;
    while ((m = auctionLinkPattern.exec(html)) !== null) {
      const path = m[1];
      if (!path) continue;
      // Exclude /video URLs
      if (path.includes('/video')) continue;
      urls.add(`https://carsandbids.com${path.split('?')[0]}`);
      if (urls.size >= Math.max(1, limit)) break;
    }
  }
  
  // PRIORITY 3: Look for hero class links (direct - covers listings page)
  // Pattern: <a class="hero" href="/auctions/ID/year-make-model">
  if (urls.size < limit) {
    const heroLinkPattern = /<a[^>]*class=["'][^"']*hero[^"']*["'][^>]*href=["'](\/auctions\/[^"']+)["']/gi;
    while ((m = heroLinkPattern.exec(html)) !== null) {
      const path = m[1];
      if (!path) continue;
      // Exclude /video URLs
      if (path.includes('/video')) continue;
      urls.add(`https://carsandbids.com${path.split('?')[0]}`);
      if (urls.size >= Math.max(1, limit)) break;
    }
  }
  
  // PRIORITY 4: Look for full listing URLs with year-make-model pattern (fallback pattern matching)
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

  // ⚠️ FREE MODE: Firecrawl is optional - use direct fetch where possible
  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY") || null;
  const sourceWebsite = "https://www.mecum.com";

  let listingUrls: string[] = [];
  let mapRaw: any = null;

  if (isDirectListing) {
    listingUrls = [indexUrl];
  }

  // Step 1: Discover listing URLs via Firecrawl map (optional - only if API key available)
  if (listingUrls.length === 0 && firecrawlKey) {
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

  // Fallback: scrape markdown and regex out listing URLs (only if Firecrawl key available)
  if (listingUrls.length === 0 && firecrawlKey) {
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

  // Fallback: direct fetch (FREE - works when page has links in HTML)
  if (listingUrls.length === 0) {
    try {
      console.log("📡 FREE MODE: Using direct fetch for Mecum index discovery");
      const html = await fetchTextWithTimeout(indexUrl, 12000, "Mecum index fetch");
      listingUrls = extractMecumListingUrlsFromText(html, 500);
      if (listingUrls.length > 0) {
        console.log(`✅ Direct fetch found ${listingUrls.length} Mecum listing URLs`);
      } else {
        console.warn("⚠️ Direct fetch found no listing URLs - may need Firecrawl for index pages");
      }
    } catch (e: any) {
      console.warn(`⚠️ Direct Mecum index fetch failed: ${e?.message || String(e)}`);
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
      
      // Step 1: Try direct fetch first (FREE), then Firecrawl if available and needed
      let vehicle: any = {};
      
      // Try direct fetch first (FREE MODE)
      try {
        console.log(`📡 FREE MODE: Fetching Mecum listing ${listingUrl} directly`);
        html = await fetchTextWithTimeout(listingUrl, 30000, "Direct Mecum listing fetch");
        console.log(`✅ Got HTML via direct fetch (${html.length} chars)`);
        
        // Extract images from HTML
        if (html) {
          const htmlImages = extractMecumImagesFromHtml(html);
          images = [...images, ...htmlImages];
        }
      } catch (directError: any) {
        console.warn(`⚠️ Direct fetch failed: ${directError?.message}`);
      }
      
      // Step 2: Try Firecrawl if available and we don't have enough data
      if (firecrawlKey && (images.length === 0 || !html)) {
        try {
          console.log(`🔥 Trying Firecrawl for Mecum listing (images: ${images.length}, html: ${html ? 'yes' : 'no'})`);
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
                formats: ["markdown", "html", "extract"],
                onlyMainContent: false,
                waitFor: 8000,
                actions: [
                  {
                    type: "wait",
                    milliseconds: 3000,
                  },
                  {
                    type: "scroll",
                    direction: "down",
                    pixels: 500,
                  },
                  {
                    type: "wait",
                    milliseconds: 2000,
                  },
                  {
                    type: "scroll",
                    direction: "down",
                    pixels: 1000,
                  },
                  {
                    type: "wait",
                    milliseconds: 2000,
                  },
                ],
                extract: { schema: listingSchema },
              }),
            },
            FIRECRAWL_LISTING_TIMEOUT_MS,
            "Firecrawl Mecum listing",
          );
          
          if (!html) {
            markdown = String(firecrawlMarkdown?.data?.markdown || firecrawlMarkdown?.markdown || "");
            html = String(firecrawlMarkdown?.data?.html || "");
          }
          
          // Extract images from markdown if we got it
          if (markdown && images.length === 0) {
            const markdownImages = extractMecumImagesFromHtml(markdown);
            images = [...images, ...markdownImages];
          }
          
          // Extract vehicle data if available
          vehicle = firecrawlMarkdown?.data?.extract || {};
        } catch (e: any) {
          console.warn(`Firecrawl failed: ${e?.message || String(e)}`);
        }
      }
        
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
      // Fetch HTML even if we have images, since we need it for sold price extraction
      if (images.length === 0 || !html) {
        try {
          html = await fetchTextWithTimeout(listingUrl, 20000, "Direct Mecum page fetch");
          if (html && images.length === 0) {
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

      // Extract sold price using DOM parsing (for sold listings)
      let domSoldPrice: number | null = null;
      if (html) {
        const soldPriceResult = extractMecumSoldPrice(html);
        if (soldPriceResult.sale_price) {
          domSoldPrice = soldPriceResult.sale_price;
          console.log(`Extracted sold price via ${soldPriceResult.method}: $${domSoldPrice.toLocaleString()}`);
        }
      }

      // Extract lot header data (lot number, date, location) from HTML
      let lotHeaderData: { lot_number: string | null; date: string | null; location: string | null } = { lot_number: null, date: null, location: null };
      if (html) {
        lotHeaderData = extractMecumLotHeader(html);
        if (lotHeaderData.lot_number || lotHeaderData.date || lotHeaderData.location) {
          console.log(`Extracted lot header: lot=${lotHeaderData.lot_number}, date=${lotHeaderData.date}, location=${lotHeaderData.location}`);
        }
      }

      // Extract structured sections (HIGHLIGHTS, THE STORY) from HTML
      let structuredSections: { highlights: string[]; story: string; description: string } = { highlights: [], story: '', description: '' };
      if (html) {
        structuredSections = extractMecumStructuredSections(html);
        if (structuredSections.highlights.length > 0) {
          console.log(`Extracted ${structuredSections.highlights.length} highlights`);
        }
        if (structuredSections.story) {
          console.log(`Extracted story (${structuredSections.story.length} chars)`);
        }
      }
      
      // Extract structured vehicle specs from highlights/story into proper DB fields
      const extractedSpecs = extractMecumStructuredSpecs(structuredSections.highlights, structuredSections.story);
      if (Object.keys(extractedSpecs).length > 0) {
        console.log(`Extracted specs: ${JSON.stringify(extractedSpecs)}`);
      }

      // Merge sold price: prioritize DOM extraction over Firecrawl (more reliable for sold listings)
      const finalSalePrice = domSoldPrice || vehicle?.sale_price || null;

      // Merge lot header data with vehicle data (lot header is more reliable)
      const finalLotNumber = lotHeaderData.lot_number || vehicle?.lot_number || null;
      const finalLocation = lotHeaderData.location || vehicle?.location || null;
      const finalSaleDate = lotHeaderData.date || vehicle?.sale_date || null;
      
      // Use DOM-extracted description if available (more complete than Firecrawl LLM extraction)
      const finalDescription = structuredSections.description || vehicle?.description || null;

      return {
        ...vehicle,
        listing_url: listingUrl,
        images, // CRITICAL: Always include images array, even if empty
        sale_price: finalSalePrice, // Use DOM-extracted sold price if available
        lot_number: finalLotNumber, // Use DOM-extracted lot number if available
        location: finalLocation, // Use DOM-extracted location if available
        sale_date: finalSaleDate, // Use DOM-extracted date if available
        description: finalDescription, // Use DOM-extracted full description if available
        highlights: structuredSections.highlights.length > 0 ? structuredSections.highlights : undefined,
        story: structuredSections.story || undefined,
        // Structured specs extracted from highlights/story
        ...extractedSpecs,
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

  // ⚠️ FREE MODE: Firecrawl is optional - use direct fetch where possible
  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY") || null;
  const sourceWebsite = "https://www.barrett-jackson.com";

  let listingUrls: string[] = [];
  let mapRaw: any = null;

  if (isDirectListing) {
    listingUrls = [indexUrl];
  }

  // Step 1: Discover listing URLs via Firecrawl map (optional - only if API key available)
  if (listingUrls.length === 0 && firecrawlKey) {
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

  // Fallback: scrape markdown and regex out listing URLs (only if Firecrawl key available)
  if (listingUrls.length === 0 && firecrawlKey) {
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

  // Fallback: direct fetch (FREE - works when page has links in HTML)
  if (listingUrls.length === 0) {
    try {
      console.log("📡 FREE MODE: Using direct fetch for Barrett-Jackson index discovery");
      const html = await fetchTextWithTimeout(indexUrl, 12000, "Barrett-Jackson index fetch");
      // Extract URLs from HTML directly if possible
      const extracted = extractBarrettJacksonListingUrlsFromText(html, 500);
      if (extracted.length > 0) {
        listingUrls = extracted;
        console.log(`✅ Direct fetch found ${listingUrls.length} Barrett-Jackson listing URLs`);
      } else {
        console.warn("⚠️ Direct fetch found no listing URLs - may need Firecrawl for index pages");
      }
    } catch (e: any) {
      console.warn(`⚠️ Direct Barrett-Jackson index fetch failed: ${e?.message || String(e)}`);
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
            waitFor: 12000, // Wait for PhotoSwipe gallery to render and expand
            actions: [
              {
                type: "wait",
                milliseconds: 3000, // Initial page load
              },
              {
                type: "scroll",
                direction: "down",
                pixels: 1000, // Scroll to gallery
              },
              {
                type: "wait",
                milliseconds: 2000, // Wait for gallery to render
              },
              {
                type: "click",
                selector: "button:has-text('Show more'), button:has-text('Load more'), button:has-text('View all'), [aria-label*='more'], [aria-label*='all']",
              },
              {
                type: "wait",
                milliseconds: 3000, // Wait for expanded images to load
              },
              {
                type: "scroll",
                direction: "down",
                pixels: 2000, // Scroll to load lazy-loaded images
              },
              {
                type: "wait",
                milliseconds: 2000, // Final wait for all images
              },
            ],
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

  // ⚠️ NO PAID APIs: Using direct fetch + HTML parsing only
  // Removed Firecrawl dependency due to budget constraints
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
        // Increase window size to handle large galleries (200+ images)
        const window = h.slice(idx, idx + 5000000);
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

  // HTML-based extraction for BaT specs (NO PAID APIs - direct HTML parsing)
  const extractBatSpecsFromHtml = (html: string): Record<string, any> => {
    const h = String(html || '');
    const specs: Record<string, any> = {};
    
    try {
      // Extract title/year/make/model from page title or heading
      const titleMatch = h.match(/<title[^>]*>([^<]+)<\/title>/i) || 
                        h.match(/<h1[^>]*>([^<]+)<\/h1>/i) ||
                        h.match(/"title"[:\s]*"([^"]+)"/i);
      if (titleMatch?.[1]) {
        specs.title = titleMatch[1].trim();
        // Parse year/make/model from title (e.g., "1965 Chevrolet Corvette")
        const titleParts = specs.title.match(/^(\d{4})\s+([A-Za-z][A-Za-z\s&]+?)\s+(.+?)(?:\s+on\s+Bring\s+a\s+Trailer|$)/i);
        if (titleParts) {
          specs.year = parseInt(titleParts[1], 10);
          specs.make = titleParts[2].trim();
          specs.model = titleParts[3].trim();
        }
      }
      
      // Extract from "essentials" or "listing-essentials" section
      // BaT uses a structured format like: <strong>Mileage</strong><span>36,000</span>
      
      // Mileage - look for patterns like "36,000 Miles" or "Mileage: 36,000"
      const mileagePatterns = [
        /(?:mileage|odometer)[:\s]*["']?([0-9,]+)(?:\s*miles)?/i,
        /(?:showing\s*)?([0-9,]+)\s*miles?\b/i,
        /"mileage"[:\s]*"?([0-9,]+)"?/i,
        />([0-9,]+)\s*Miles?</i,
      ];
      for (const pattern of mileagePatterns) {
        const m = h.match(pattern);
        if (m?.[1]) {
          const mileage = parseInt(m[1].replace(/,/g, ''), 10);
          if (mileage > 0 && mileage < 10000000) {
            specs.mileage = mileage;
            break;
          }
        }
      }
      
      // Color - look for exterior color mentions
      const colorPatterns = [
        /(?:exterior\s*)?color[:\s]*["']?([A-Za-z][A-Za-z\s]+?(?:Metallic|Pearl|Black|White|Red|Blue|Green|Silver|Gray|Grey|Yellow|Orange|Brown|Beige|Gold|Bronze|Purple|Maroon|Burgundy)?)\b/i,
        /painted\s+(?:in\s+)?([A-Za-z][A-Za-z\s]+?(?:Metallic|Pearl)?)\b/i,
        /"color"[:\s]*"([^"]+)"/i,
        /(?:finished|painted|refinished)\s+(?:in\s+)?([A-Za-z][A-Za-z\s]+)\s+(?:over|with)/i,
      ];
      for (const pattern of colorPatterns) {
        const m = h.match(pattern);
        if (m?.[1] && m[1].length > 2 && m[1].length < 50 && !m[1].toLowerCase().includes('interior')) {
          specs.color = m[1].trim();
          break;
        }
      }
      
      // Transmission
      const transPatterns = [
        /(?:transmission|gearbox)[:\s]*["']?([^<"'\n]{3,50})/i,
        /((?:five|six|four|three|seven|eight)\s*-?\s*speed\s*(?:manual|automatic|auto|sequential|dual-clutch|dct|dsg|tiptronic|pdk|smg))/i,
        /(\d-speed\s*(?:manual|automatic|auto|sequential|dual-clutch|dct|dsg|tiptronic|pdk|smg))/i,
        /"transmission"[:\s]*"([^"]+)"/i,
      ];
      for (const pattern of transPatterns) {
        const m = h.match(pattern);
        if (m?.[1] && m[1].length > 2 && m[1].length < 80) {
          specs.transmission = m[1].trim();
          break;
        }
      }
      
      // Engine
      const enginePatterns = [
        /(?:engine|motor|powertrain)[:\s]*["']?([^<"'\n]{3,80})/i,
        /(\d+(?:\.\d+)?\s*-?\s*(?:liter|L)\s*[A-Za-z0-9\s\-]+(?:engine|motor)?)/i,
        /((?:twin-turbo|turbo|supercharged|naturally\s*aspirated)?\s*\d+(?:\.\d+)?\s*(?:L|liter)\s*[VvIi]?\d*(?:\s*engine)?)/i,
        /"engine_size"[:\s]*"([^"]+)"/i,
        /"engine"[:\s]*"([^"]+)"/i,
      ];
      for (const pattern of enginePatterns) {
        const m = h.match(pattern);
        if (m?.[1] && m[1].length > 2 && m[1].length < 100) {
          specs.engine_size = m[1].trim();
          break;
        }
      }
      
      // Drivetrain
      const drivePatterns = [
        /(?:drivetrain|drive\s*type)[:\s]*["']?(AWD|4WD|RWD|FWD|4x4|All-Wheel|Rear-Wheel|Front-Wheel|Four-Wheel)/i,
        /\b(AWD|4WD|RWD|FWD|4x4|All-Wheel\s*Drive|Rear-Wheel\s*Drive|Front-Wheel\s*Drive|Four-Wheel\s*Drive)\b/i,
        /"drivetrain"[:\s]*"([^"]+)"/i,
      ];
      for (const pattern of drivePatterns) {
        const m = h.match(pattern);
        if (m?.[1]) {
          specs.drivetrain = m[1].trim();
          break;
        }
      }
      
      // VIN/Chassis - look for 17-character VINs (modern) OR shorter chassis numbers (vintage)
      // Vintage vehicles (pre-1981) often have chassis numbers like "70077" (5 digits) instead of 17-char VINs
      // Patterns: "VIN:", "Chassis:", "chassis 70077", etc.
      const vinPatterns = [
        // Modern VINs (17 characters)
        /(?:vin|vehicle\s*identification)[:\s#]*["']?([A-HJ-NPR-Z0-9]{17})\b/i,
        /\bvin[:\s#]*([A-HJ-NPR-Z0-9]{17})\b/i,
        /"vin"[:\s]*"([A-HJ-NPR-Z0-9]{17})"/i,
        // Chassis numbers (4-16 characters for vintage vehicles)
        /(?:chassis|chassis\s*no|chassis\s*number)[:\s#]*["']?([A-HJ-NPR-Z0-9]{4,16})\b/i,
        /\bchassis[:\s]*([A-HJ-NPR-Z0-9]{4,16})\b/i,
        /"chassis"[:\s]*"([A-HJ-NPR-Z0-9]{4,16})"/i,
        // Pattern: "chassis 70077" (in text, not just in structured data)
        /\bchassis\s+([A-HJ-NPR-Z0-9]{4,16})\b/i,
        // BaT essentials format: "<li>Chassis: 70077</li>" or "<li>Chassis: <a>70077</a></li>"
        /<li[^>]*>\s*Chassis:\s*<a[^>]*>([A-HJ-NPR-Z0-9]{4,16})<\/a>\s*<\/li>/i,
        /<li[^>]*>\s*Chassis:\s*([A-HJ-NPR-Z0-9]{4,16})\s*<\/li>/i,
      ];
      for (const pattern of vinPatterns) {
        const m = h.match(pattern);
        if (m?.[1]) {
          const value = m[1].toUpperCase().trim();
          // Accept 17-char VINs OR 4-16 char chassis numbers (no I, O, Q in either)
          if ((value.length === 17 && /^[A-HJ-NPR-Z0-9]{17}$/.test(value)) ||
              (value.length >= 4 && value.length <= 16 && /^[A-HJ-NPR-Z0-9]{4,16}$/.test(value))) {
            specs.vin = value;
            break;
          }
        }
      }
      
      // Location
      const locationPatterns = [
        /(?:location|located)[:\s]*["']?([A-Za-z][A-Za-z\s,]+(?:,\s*[A-Z]{2})?)/i,
        /"location"[:\s]*"([^"]+)"/i,
      ];
      for (const pattern of locationPatterns) {
        const m = h.match(pattern);
        if (m?.[1] && m[1].length > 2 && m[1].length < 100) {
          specs.location = m[1].trim();
          break;
        }
      }
      
      // ⚠️ CRITICAL: Distinguish "Bid to $X" (NOT SOLD) vs "Sold for $X" (SOLD)
      // BaT result pages show:
      // - "Bid to USD $X" = highest bid, but NOT sold (reserve not met or no sale)
      // - "Sold for $X" or "Sold to $X" = actually sold
      // - "This [vehicle] got away" = NOT SOLD
      
      // Check for "got away" or "not sold" indicators first
      const gotAwayPatterns = [
        /got\s+away/i,
        /did\s+not\s+sell/i,
        /no\s+sale/i,
        /not\s+sold/i,
        /reserve\s+not\s+met/i,
      ];
      const hasGotAway = gotAwayPatterns.some(pattern => pattern.test(h));
      
      // Extract "Bid to $X" (high bid, NOT sale price)
      const bidToMatch = h.match(/Bid\s+to\s+(?:USD\s*)?\$?([0-9,]+)/i);
      if (bidToMatch?.[1]) {
        const highBid = parseInt(bidToMatch[1].replace(/,/g, ''), 10);
        if (highBid > 100 && highBid < 100000000) {
          specs.high_bid = highBid;
          specs.final_bid = highBid;
          // DO NOT set sale_price - this is just the high bid, not a sale
          if (hasGotAway) {
            specs.reserve_met = false;
          }
        }
      }
      
      // Extract "Sold for $X" or "Sold to $X" (actual sale)
      const soldPatterns = [
        /Sold\s+(?:for|to)\s+(?:USD\s*)?\$?([0-9,]+)/i,
        /Sold\s+(?:USD\s*)?\$?([0-9,]+)\s+(?:on|for)/i,
        /(?:winning\s*bid|final\s*price|hammer\s*price)[:\s\$]*([0-9,]+)/i,
      ];
      for (const pattern of soldPatterns) {
        const m = h.match(pattern);
        if (m?.[1] && !h.match(/Bid\s+to/i)) { // Make sure it's not "Bid to"
          const price = parseInt(m[1].replace(/,/g, ''), 10);
          if (price > 100 && price < 100000000) {
            specs.sale_price = price;
            specs.final_bid = price;
            specs.high_bid = price;
            break;
          }
        }
      }
      
      // Fallback: JSON-LD or structured data
      const jsonPricePatterns = [
        /"sale_price"[:\s]*(\d+)/i,
        /"final_price"[:\s]*(\d+)/i,
      ];
      for (const pattern of jsonPricePatterns) {
        const m = h.match(pattern);
        if (m?.[1] && !specs.sale_price) {
          const price = parseInt(m[1].replace(/,/g, ''), 10);
          if (price > 100 && price < 100000000) {
            specs.sale_price = price;
            break;
          }
        }
      }
      
      // Extract high_bid from JSON if not already set
      if (!specs.high_bid) {
        const highBidMatch = h.match(/"high_bid"[:\s]*(\d+)/i);
        if (highBidMatch?.[1]) {
          const highBid = parseInt(highBidMatch[1].replace(/,/g, ''), 10);
          if (highBid > 100 && highBid < 100000000) {
            specs.high_bid = highBid;
          }
        }
      }
      
      // Extract bid count (separate from comment count)
      // Look for patterns like "X bids" or "X Bids" (not "X Comments")
      const bidCountPatterns = [
        /(\d+)\s+bids?/i,
        /"bid_count"[:\s]*(\d+)/i,
        /"bids"[:\s]*(\d+)/i,
      ];
      for (const pattern of bidCountPatterns) {
        const m = h.match(pattern);
        if (m?.[1]) {
          const bidCount = parseInt(m[1].replace(/,/g, ''), 10);
          if (bidCount >= 0 && bidCount < 100000) {
            specs.bid_count = bidCount;
            break;
          }
        }
      }
      
    } catch (e: any) {
      console.warn('Error extracting BaT specs from HTML:', e?.message);
    }
    
    return specs;
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
      // ⚠️ CRITICAL: Distinguish between "Bid to $X" (NOT SOLD) vs "Sold for $X" (SOLD)
      // - If page says "Bid to $X" or "got away" → set high_bid, final_bid, but NOT sale_price
      // - If page says "Sold for $X" or "Sold to $X" → set sale_price, final_bid, high_bid
      current_bid: { type: "number", description: "Current bid amount (for active auctions only)" },
      high_bid: { type: "number", description: "Highest bid amount (can be from 'Bid to $X' or 'Sold for $X')" },
      final_bid: { type: "number", description: "Final bid amount (can be high bid even if not sold)" },
      sale_price: { type: "number", description: "Sale price ONLY if auction actually sold (from 'Sold for $X', NOT 'Bid to $X'). Do NOT set this if page says 'got away' or 'Bid to'." },
      reserve_price: { type: "number", description: "Reserve price (if disclosed)" },
      reserve_met: { type: "boolean", description: "Reserve met (false if page says 'got away' or 'reserve not met')" },
      bid_count: { type: "number", description: "Total number of BIDS (not comments). Look for 'X bids' or 'X Bids' text." },
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
    // ⚠️ FREE MODE: Direct HTML fetch only (no Firecrawl, no AI)
    console.log(`🌐 Fetching BaT listing HTML directly (free mode)...`);
    const html = await fetchTextWithTimeout(normalizedUrl, 30000, "Direct BaT HTML fetch");
    
    // BaT pages have all data embedded in HTML/JSON, so we parse directly
    // No need for Firecrawl or AI - everything is in the HTML
    
    // Extract high-res images from HTML gallery
    const images = extractBatGalleryImagesFromHtml(html);
    
    // Parse vehicle data from HTML (extractBatSpecsFromHtml handles everything)
    const htmlSpecs = extractBatSpecsFromHtml(html);
    
    // Build vehicle object from HTML parsing (no AI needed)
    const vehicle: any = {
      title: htmlSpecs.title || null,
      year: htmlSpecs.year || null,
      make: htmlSpecs.make || null,
      model: htmlSpecs.model || null,
      trim: htmlSpecs.trim || null,
      vin: htmlSpecs.vin || null,
      mileage: htmlSpecs.mileage || null,
      color: htmlSpecs.color || null,
      interior_color: htmlSpecs.interior_color || null,
      transmission: htmlSpecs.transmission || null,
      drivetrain: htmlSpecs.drivetrain || null,
      engine_size: htmlSpecs.engine_size || null,
      displacement: htmlSpecs.displacement || null,
      location: htmlSpecs.location || null,
      // Auction data
      sale_price: htmlSpecs.sale_price || null,
      high_bid: htmlSpecs.high_bid || null,
      final_bid: htmlSpecs.final_bid || null,
      current_bid: htmlSpecs.current_bid || null,
      reserve_met: htmlSpecs.reserve_met ?? null,
      bid_count: htmlSpecs.bid_count || null,
      images: images,
    };

    // Upgrade all image URLs to highest resolution and filter out non-vehicle images
    const filteredImages = images.map(upgradeBatImageUrl).filter((u: string) => {
      const lower = u.toLowerCase();
      // CRITICAL: Exclude storage URLs - we want external BaT URLs only
      if (lower.includes('supabase.co') || lower.includes('storage/') || lower.includes('import_queue')) {
        return false;
      }
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

    console.log(`✅ BaT HTML extraction complete: ${filteredImages.length} images, specs extracted`);
    
    // ⚠️ VERIFICATION: Log what we extracted from HTML to verify against source
    if (htmlSpecs.high_bid && !htmlSpecs.sale_price) {
      console.log(`✅ VERIFIED: HTML shows "Bid to $${htmlSpecs.high_bid}" (NOT sold) - sale_price will be null`);
    } else if (htmlSpecs.sale_price) {
      console.log(`✅ VERIFIED: HTML shows "Sold for $${htmlSpecs.sale_price}" (SOLD) - sale_price will be set`);
    }
    if (htmlSpecs.bid_count !== undefined) {
      console.log(`✅ VERIFIED: HTML extracted ${htmlSpecs.bid_count} bids`);
    }

    // Build final merged object from HTML-extracted data
    // ⚠️ CRITICAL: HTML extraction distinguishes "Bid to $X" (not sold) vs "Sold for $X" (sold)
    const merged = {
      ...vehicle,
      listing_url: normalizedUrl,
      images: filteredImages, // High-res images from HTML gallery extraction
    };

    console.log(`Extracted merged object VIN: "${merged.vin}", mileage: ${merged.mileage}, images: ${merged.images?.length || 0}`);
    
    // ⚠️ VERIFICATION: Log final extracted values for cross-checking
    console.log(`📊 EXTRACTION VERIFICATION:`);
    console.log(`   sale_price: ${merged.sale_price || 'NULL'} ${merged.sale_price ? '(SOLD)' : '(NOT SOLD)'}`);
    console.log(`   high_bid: ${merged.high_bid || 'NULL'}`);
    console.log(`   final_bid: ${merged.final_bid || 'NULL'}`);
    console.log(`   bid_count: ${merged.bid_count || 'NULL'}`);
    console.log(`   Expected outcome: ${merged.sale_price ? 'sold' : (merged.high_bid ? 'bid_to' : 'no_sale')}`);
    
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
    extraction_method: "direct_html_parsing_free_mode",
    timestamp: new Date().toISOString(),
    // Debug info
    debug_extraction: extracted.length > 0 ? {
      vin: extracted[0]?.vin || null,
      mileage: extracted[0]?.mileage || null,
      color: extracted[0]?.color || null,
      transmission: extracted[0]?.transmission || null,
      engine_size: extracted[0]?.engine_size || null,
      images_count: extracted[0]?.images?.length || 0,
    } : null,
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

async function extractBroadArrow(url: string, maxVehicles: number) {
  console.log("Broad Arrow: discovering listing URLs then extracting per-listing");
  console.log("Note: Broad Arrow operates via auctions - extracting from available lots (upcoming) and results (past)");

  const normalizedUrl = String(url || "").trim();
  const isDirectListing = normalizedUrl.includes("broadarrowauctions.com/vehicles/") && 
                          !normalizedUrl.includes("/vehicles/results") &&
                          !normalizedUrl.includes("/vehicles/available");

  // Determine extraction source:
  // - "available" or "upcoming" = upcoming auction lots (treat as inventory)
  // - "results" or "past-auctions" = past auction results (sold/unsold)
  // - default = results page
  const isAvailableLots = normalizedUrl.includes("/available") || 
                          normalizedUrl.includes("/upcoming") ||
                          normalizedUrl.toLowerCase().includes("available");
  
  const indexUrl = isDirectListing
    ? normalizedUrl.split("?")[0]
    : isAvailableLots
    ? "https://www.broadarrowauctions.com/vehicles/available"
    : (normalizedUrl.includes("broadarrowauctions.com/vehicles") 
        ? normalizedUrl 
        : "https://www.broadarrowauctions.com/vehicles/results");

  // ⚠️ FREE MODE: Firecrawl is optional - use direct fetch where possible
  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY") || null;
  const sourceWebsite = "https://www.broadarrowauctions.com";

  let listingUrls: string[] = [];
  let mapRaw: any = null;

  if (isDirectListing) {
    listingUrls = [indexUrl];
  }

  // Step 1: Discover listing URLs via Firecrawl map (optional - only if API key available)
  if (listingUrls.length === 0 && firecrawlKey) {
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
            limit: 1000,
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
            u.includes("broadarrowauctions.com/vehicles/") &&
            !u.includes("/vehicles/results") &&
            !u.includes("/vehicles/available") &&
            !u.includes("/past-auctions") &&
            u.match(/\/vehicles\/[^\/]+\/[^\/]+$/) // Pattern: /vehicles/{auction_id}/{slug}
          )
          .slice(0, 500);
      }
    } catch (e: any) {
      console.warn("Broad Arrow map discovery failed:", e?.message || String(e));
    }
  }

  // Fallback: scrape markdown and regex out listing URLs (only if Firecrawl key available)
  if (listingUrls.length === 0 && firecrawlKey) {
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
      if (markdown) {
        // Extract URLs from markdown - pattern: /vehicles/{id}/{slug}
        const urlMatches = markdown.match(/\/vehicles\/[a-zA-Z0-9_-]+\/[^\/\s\)]+/g) || [];
        listingUrls = Array.from(new Set(urlMatches))
          .map((path: string) => `https://www.broadarrowauctions.com${path}`)
          .filter((u: string) => !u.includes("/results") && !u.includes("/available") && !u.includes("/past-auctions"))
          .slice(0, 500);
      }
    } catch (e: any) {
      console.warn("Broad Arrow markdown discovery failed:", e?.message || String(e));
    }
  }

  // Fallback: direct fetch (FREE - works when page has links in HTML)
  if (listingUrls.length === 0) {
    try {
      console.log("📡 FREE MODE: Using direct fetch for Broad Arrow index discovery");
      const html = await fetchTextWithTimeout(indexUrl, 12000, "Broad Arrow index fetch");
      // Extract URLs from HTML directly
      const urlMatches = html.match(/\/vehicles\/[a-zA-Z0-9_-]+\/[^\/\s\)"']+/g) || [];
      if (urlMatches.length > 0) {
        listingUrls = Array.from(new Set(urlMatches))
          .map((path: string) => `https://www.broadarrowauctions.com${path}`)
          .filter((u: string) => !u.includes("/results") && !u.includes("/available") && !u.includes("/past-auctions"))
          .slice(0, 500);
        console.log(`✅ Direct fetch found ${listingUrls.length} Broad Arrow listing URLs`);
      } else {
        console.warn("⚠️ Direct fetch found no listing URLs - may need Firecrawl for index pages");
      }
    } catch (e: any) {
      console.warn(`⚠️ Direct Broad Arrow index fetch failed: ${e?.message || String(e)}`);
    }
  }

  // Step 2: Per-listing extraction
  const listingSchema = {
    type: "object",
    properties: {
      title: { type: "string", description: "Listing title (e.g., '1956 Jaguar D-Type')" },
      lot_number: { type: "string", description: "Lot number if available" },
      year: { type: "number", description: "Vehicle year" },
      make: { type: "string", description: "Vehicle make" },
      model: { type: "string", description: "Vehicle model" },
      trim: { type: "string", description: "Trim level" },
      vin: { type: "string", description: "VIN if available" },
      mileage: { type: "number", description: "Mileage / odometer" },
      location: { type: "string", description: "Location" },
      description: { type: "string", description: "Description" },
      sale_price: { type: "number", description: "Sold price / hammer price if sold (extract from 'Sold Price:' text). IMPORTANT: Check currency selector - convert CHF/EUR/GBP to USD using approximate rates (CHF: 1.15, EUR: 1.10, GBP: 1.27)" },
      sale_date: { type: "string", description: "Sale date if available" },
      auction_end_date: { type: "string", description: "Auction end date" },
      auction_name: { type: "string", description: "Auction event name (e.g., 'The Zurich Auction 2025', 'The Amelia Auction 2025')" },
      auction_location: { type: "string", description: "Auction location/venue" },
      images: { 
        type: "array", 
        items: { type: "string" }, 
        description: "ALL vehicle image URLs from the page - gallery images, main photos, detail shots. Include full URLs. Exclude placeholder images, logos, and icons." 
      },
      videos: {
        type: "array",
        items: { 
          type: "object",
          properties: {
            url: { type: "string", description: "Full video URL (YouTube, Vimeo, etc.)" },
            type: { type: "string", description: "Video platform (youtube, vimeo, etc.)" },
            thumbnail: { type: "string", description: "Video thumbnail URL" }
          }
        },
        description: "All video URLs from the page (YouTube embeds, Vimeo links, etc.)"
      },
      contributor_name: { type: "string", description: "Consignment Consultant name from vdp-sales-row" },
      contributor_title: { type: "string", description: "Consignment Consultant title (e.g., 'Consignment Consultant')" },
      contributor_phone: { type: "string", description: "Consignment Consultant phone number" },
      contributor_email: { type: "string", description: "Consignment Consultant email address" },
    },
  };

  const extracted: any[] = [];
  const issues: string[] = [];

  // Prefer unseen URLs to avoid repeatedly re-importing the same top listings
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

  // PARALLEL scraping for speed - process multiple listings concurrently (increased to 12 for faster extraction)
  const urlsToProcess = urlsToScrape.slice(0, Math.max(1, maxVehicles));
  const CONCURRENCY = 12;
  const batches: string[][] = [];
  for (let i = 0; i < urlsToProcess.length; i += CONCURRENCY) {
    batches.push(urlsToProcess.slice(i, i + CONCURRENCY));
  }

  for (const batch of batches) {
    const scrapePromises = batch.map(async (listingUrl: string) => {
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
              waitFor: 5000, // Reduced from 8000ms for faster extraction
              actions: [
                {
                  type: "wait",
                  milliseconds: 1500, // Reduced from 2000ms
                },
                {
                  type: "scroll",
                  direction: "down",
                  pixels: 1000,
                },
                {
                  type: "wait",
                  milliseconds: 1500, // Reduced from 2000ms
                },
              ],
              extract: { schema: listingSchema },
            }),
          },
          FIRECRAWL_LISTING_TIMEOUT_MS,
          "Firecrawl listing scrape",
        );

        const vehicle = firecrawlData?.data?.extract || {};
        const html = String(firecrawlData?.data?.html || "");
        
        // Extract images and videos from HTML
        let images = Array.isArray(vehicle?.images) && vehicle.images.length > 0
          ? vehicle.images.filter((img: string) => 
              !img.toLowerCase().includes('no-car-image') && 
              !img.toLowerCase().includes('placeholder') &&
              !img.toLowerCase().includes('logo')
            )
          : [];
        
        // Extract videos (YouTube, Vimeo, etc.)
        const videos: Array<{url: string; type: string; thumbnail?: string}> = [];
        
        // YouTube video extraction
        const youtubePatterns = [
          /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/gi,
          /<iframe[^>]*src=["']([^"']*youtube[^"']*)["']/gi,
        ];
        
        for (const pattern of youtubePatterns) {
          const matches = html.match(pattern) || [];
          for (const match of matches) {
            const videoIdMatch = match.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/i);
            if (videoIdMatch?.[1]) {
              const videoId = videoIdMatch[1];
              const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
              const thumbnail = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
              
              if (!videos.find(v => v.url === videoUrl)) {
                videos.push({
                  url: videoUrl,
                  type: 'youtube',
                  thumbnail,
                });
              }
            }
          }
        }
        
        // Vimeo video extraction
        const vimeoPattern = /(?:vimeo\.com\/)(\d+)/gi;
        const vimeoMatches = html.match(vimeoPattern) || [];
        for (const match of vimeoMatches) {
          const videoIdMatch = match.match(/vimeo\.com\/(\d+)/i);
          if (videoIdMatch?.[1]) {
            const videoId = videoIdMatch[1];
            const videoUrl = `https://vimeo.com/${videoId}`;
            
            if (!videos.find(v => v.url === videoUrl)) {
              videos.push({
                url: videoUrl,
                type: 'vimeo',
              });
            }
          }
        }
        
        // Simple image extraction from HTML (look for img src in gallery sections)
        if (images.length === 0 && html) {
          const imgMatches = html.match(/<img[^>]+src=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/gi) || [];
          for (const match of imgMatches) {
            const srcMatch = match.match(/src=["']([^"']+)["']/i);
            if (srcMatch?.[1]) {
              const imgUrl = srcMatch[1];
              if (imgUrl.includes('broadarrow') && 
                  !imgUrl.includes('logo') && 
                  !imgUrl.includes('icon') &&
                  !imgUrl.includes('placeholder')) {
                images.push(imgUrl);
              }
            }
          }
          images = Array.from(new Set(images)).slice(0, 100); // Limit to 100 images
        }
        
        // Add video thumbnails to images array (videos are stored as images with is_video flag)
        for (const video of videos) {
          if (video.thumbnail) {
            images.push(video.thumbnail);
          }
        }

        // Detect currency from currency selector
        let detectedCurrency = 'USD'; // Default
        const currencyMatch = html.match(/<select[^>]*class=["'][^"']*currency-selector[^"']*["'][^>]*>[\s\S]*?<option[^>]*selected=["']selected["'][^>]*value=["']([^"']+)["']/i);
        if (currencyMatch && currencyMatch[1]) {
          detectedCurrency = currencyMatch[1].toUpperCase();
        }
        
        // Currency conversion rates (approximate, should use real-time API in production)
        const currencyRates: Record<string, number> = {
          'USD': 1.0,
          'EUR': 1.10, // 1 EUR = 1.10 USD (approximate)
          'GBP': 1.27, // 1 GBP = 1.27 USD (approximate)
          'CHF': 1.15, // 1 CHF = 1.15 USD (approximate)
        };
        const conversionRate = currencyRates[detectedCurrency] || 1.0;
        
        // Extract sale price from HTML with currency conversion
        if (!vehicle.sale_price && html) {
          // Try multiple patterns for price extraction
          const pricePatterns = [
            /Sold\s+Price:\s*[€£$]?\s*([\d,]+)/i,
            /Price[:\s]+[€£$]?\s*([\d,]+)/i,
            /Estimate[:\s]+[€£$]?\s*([\d,]+)/i,
          ];
          
          for (const pattern of pricePatterns) {
            const priceMatch = html.match(pattern);
            if (priceMatch?.[1]) {
              const rawPrice = parseInt(priceMatch[1].replace(/,/g, ''), 10);
              if (rawPrice > 0) {
                // Convert to USD (prices are stored in cents, so multiply by 100)
                vehicle.sale_price = Math.round(rawPrice * conversionRate * 100);
                vehicle.price_currency = detectedCurrency;
                break;
              }
            }
          }
        }
        
        // Also convert any existing price if it was extracted in wrong currency
        if (vehicle.sale_price && vehicle.sale_price < 1000000 && detectedCurrency !== 'USD') {
          // If price seems too low, it might be in wrong currency
          // Re-extract and convert
          const pricePatterns = [
            /Sold\s+Price:\s*[€£$]?\s*([\d,]+)/i,
            /Price[:\s]+[€£$]?\s*([\d,]+)/i,
          ];
          for (const pattern of pricePatterns) {
            const priceMatch = html.match(pattern);
            if (priceMatch?.[1]) {
              const rawPrice = parseInt(priceMatch[1].replace(/,/g, ''), 10);
              if (rawPrice > 0) {
                vehicle.sale_price = Math.round(rawPrice * conversionRate * 100);
                vehicle.price_currency = detectedCurrency;
                break;
              }
            }
          }
        }

        // Extract contributor/contact information from HTML
        // This handles multiple formats - Broad Arrow's curated format, generic listings, etc.
        let contributor: any = null;
        if (html) {
          // Broad Arrow specific format: vdp-sales-row div (curated, high-end contact)
          const nameMatch = html.match(/<div[^>]*class=["'][^"']*line[^"']*name[^"']*["'][^>]*>\s*([^<]+?)\s*<\/div>/i);
          const titleMatch = html.match(/<div[^>]*class=["'][^"']*line[^"']*sales_title[^"']*["'][^>]*>\s*([^<]+?)\s*<\/div>/i);
          
          // Generic contact extraction patterns (for other site formats)
          const genericNamePatterns = [
            /<div[^>]*class=["'][^"']*contact[^"']*name[^"']*["'][^>]*>\s*([^<]+?)\s*<\/div>/i,
            /<span[^>]*class=["'][^"']*contact[^"']*name[^"']*["'][^>]*>\s*([^<]+?)\s*<\/span>/i,
            /Contact:\s*([^<]+?)(?:<|$)/i,
          ];
          
          const genericTitlePatterns = [
            /<div[^>]*class=["'][^"']*contact[^"']*title[^"']*["'][^>]*>\s*([^<]+?)\s*<\/div>/i,
            /<span[^>]*class=["'][^"']*contact[^"']*title[^"']*["'][^>]*>\s*([^<]+?)\s*<\/span>/i,
            /Title:\s*([^<]+?)(?:<|$)/i,
          ];
          
          let name = nameMatch ? nameMatch[1].trim() : null;
          let title = titleMatch ? titleMatch[1].trim() : null;
          
          // Try generic patterns if Broad Arrow specific didn't match
          if (!name) {
            for (const pattern of genericNamePatterns) {
              const match = html.match(pattern);
              if (match?.[1]) {
                name = match[1].trim();
                break;
              }
            }
          }
          
          if (!title) {
            for (const pattern of genericTitlePatterns) {
              const match = html.match(pattern);
              if (match?.[1]) {
                title = match[1].trim();
                break;
              }
            }
          }
          
          // Extract contact info (phone, email) - works across formats
          const phoneMatch = html.match(/href=["']tel:([^"']+)["']/i) || html.match(/phone[:\s]+([+\d\s\-\(\)]+)/i);
          const phone = phoneMatch ? phoneMatch[1].trim() : null;
          
          const emailMatch = html.match(/href=["']mailto:([^"']+)["']/i) || html.match(/email[:\s]+([a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
          const email = emailMatch ? emailMatch[1].trim() : null;
          
          // Determine contact context/type based on source and role
          // High-end auction houses (Broad Arrow, Bonhams, etc.) = 'auction_specialist'
          // Generic dealers = 'dealer_contact'
          // Service providers (detailers, mechanics) = 'service_provider'
          // Default = 'contact'
          const contactContext = source.toLowerCase().includes('broadarrow') || 
                                 source.toLowerCase().includes('bonhams') ||
                                 source.toLowerCase().includes('auction')
            ? 'auction_specialist'
            : title && (title.toLowerCase().includes('detail') || title.toLowerCase().includes('mechanic') || title.toLowerCase().includes('service'))
            ? 'service_provider'
            : 'contact';
          
          // Only create contributor object if we found at least one field
          if (name || title || phone || email) {
            contributor = {
              name: name || vehicle.contributor_name || null,
              title: title || vehicle.contributor_title || null,
              phone: phone || vehicle.contributor_phone || null,
              email: email || vehicle.contributor_email || null,
              context: contactContext, // Classification for profile building
              source_type: 'curated_contact', // vs 'generic_listing', 'user_submitted', etc.
              discovered_at: new Date().toISOString(),
            };
          }
        }
        
        // Use schema-extracted contributor data if HTML extraction didn't find it
        if (!contributor && (vehicle.contributor_name || vehicle.contributor_title || vehicle.contributor_phone || vehicle.contributor_email)) {
          // Determine context from schema-extracted data
          const contactContext = title && (title.toLowerCase().includes('detail') || title.toLowerCase().includes('mechanic'))
            ? 'service_provider'
            : 'contact';
          
          contributor = {
            name: vehicle.contributor_name || null,
            title: vehicle.contributor_title || null,
            phone: vehicle.contributor_phone || null,
            email: vehicle.contributor_email || null,
            context: contactContext,
            source_type: 'schema_extracted',
            discovered_at: new Date().toISOString(),
          };
        }

        return {
          ...vehicle,
          listing_url: listingUrl,
          images,
          videos, // Separate videos array
          contributor,
          price_currency: vehicle.price_currency || detectedCurrency,
        };
      } catch (e: any) {
        issues.push(`listing scrape failed: ${listingUrl} (${e?.message || String(e)})`);
        return null;
      }
    });

    const results = await Promise.all(scrapePromises);
    extracted.push(...results.filter((r) => r !== null));
  }

  const created = await storeVehiclesInDatabase(extracted, "Broad Arrow Auctions", sourceWebsite);

  // Determine extraction context for reporting
  const extractionContext = isAvailableLots 
    ? "upcoming_auction_lots" 
    : "past_auction_results";

  return {
    success: true,
    source: "Broad Arrow Auctions",
    site_type: "broadarrow",
    listing_index_url: indexUrl,
    extraction_context: extractionContext, // "upcoming_auction_lots" or "past_auction_results"
    listings_discovered: listingUrls.length,
    vehicles_extracted: extracted.length,
    vehicles_created: created.created_ids.length,
    vehicles_updated: created.updated_ids.length,
    vehicles_saved: created.created_ids.length + created.updated_ids.length,
    created_vehicle_ids: created.created_ids,
    updated_vehicle_ids: created.updated_ids,
    issues: [...issues, ...created.errors],
    extraction_method: "index_link_discovery + firecrawl_per_listing_extract_parallel",
    timestamp: new Date().toISOString(),
    debug: {
      map_response_keys: mapRaw && typeof mapRaw === "object" ? Object.keys(mapRaw) : null,
      discovered_listing_urls: listingUrls.slice(0, 5),
      extraction_source: isAvailableLots ? "available_lots" : "results",
    },
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
