import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';
import { normalizeListingLocation } from './normalizeListingLocation.ts';

export type BatDomFieldKey =
  | 'title'
  | 'identity'
  | 'lot_number'
  | 'location'
  | 'seller'
  | 'buyer'
  | 'auction_dates'
  | 'sale'
  | 'images'
  | 'description'
  | 'comments'
  | 'bids';

export interface BatDomFieldHealth {
  ok: boolean;
  method?: string;
  value_preview?: string | null;
  warnings?: string[];
}

export interface BatDomMapHealth {
  overall_score: number; // 0-100
  fields: Record<BatDomFieldKey, BatDomFieldHealth>;
  counts: {
    images: number;
    comments: number;
    bids: number;
  };
  warnings: string[];
  errors: string[];
}

export interface BatDomExtracted {
  url: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  lot_number: string | null;
  location_raw: string | null;
  location_clean: string | null;
  seller_username: string | null;
  buyer_username: string | null;
  auction_end_date: string | null; // YYYY-MM-DD
  auction_start_date: string | null; // YYYY-MM-DD (best-effort)
  sale_date: string | null; // YYYY-MM-DD
  sale_price: number | null;
  current_bid: number | null;
  image_urls: string[];
  description_text: string | null;
  comment_count: number;
  bid_count: number;
}

const textContent = (el: any): string =>
  String(el?.textContent || '')
    .replace(/\s+/g, ' ')
    .trim();

const asInt = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const n = Number(String(s).replace(/[^\d]/g, ''));
  return Number.isFinite(n) ? n : null;
};

function safeDecodeHtmlAttr(s: string): string {
  return String(s || '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#038;/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/**
 * Aggressively upgrade BaT image URLs to highest resolution available.
 * Removes resize params, scaled suffixes, and constructs original URLs.
 */
export function upgradeBatImageUrl(url: string): string {
  if (!url || typeof url !== 'string' || !url.includes('bringatrailer.com')) {
    return url;
  }

  let upgraded = url
    // Decode HTML entities first
    .replace(/&#038;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    // Remove ALL resize/width query parameters that force lower resolution
    .replace(/[?&]w=\d+/g, '')
    .replace(/[?&]h=\d+/g, '')
    .replace(/[?&]resize=[^&]*/g, '')
    .replace(/[?&]fit=[^&]*/g, '')
    .replace(/[?&]quality=[^&]*/g, '')
    .replace(/[?&]strip=[^&]*/g, '')
    // Clean up trailing ? or &
    .replace(/[?&]+$/, '')
    // Remove -scaled suffix to get original (BaT WordPress adds this for responsive images)
    .replace(/-scaled\.(jpg|jpeg|png|webp)$/i, '.$1')
    // Remove any size suffixes like -150x150, -300x300, -768x512, etc.
    .replace(/-\d+x\d+\.(jpg|jpeg|png|webp)$/i, '.$1')
    .trim();

  return upgraded;
}

export function extractGalleryImagesFromHtml(html: string): { urls: string[]; method: string } {
  const h = String(html || '');

  const normalize = (u: string) => {
    // First upgrade to highest resolution, then normalize
    const upgraded = upgradeBatImageUrl(u);
    return upgraded
      .split('#')[0]
      .split('?')[0]
      .replace(/&#038;/g, '&')
      .replace(/&amp;/g, '&')
      .replace(/-scaled\./g, '.')
      .trim();
  };

  const isOk = (u: string) => {
    const s = u.toLowerCase();
    return (
      u.startsWith('http') &&
      s.includes('bringatrailer.com/wp-content/uploads/') &&
      !s.endsWith('.svg') &&
      !s.endsWith('.pdf')
    );
  };

  // Enhanced noise detection - reject any images that match known BaT noise patterns
  const isNoise = (u: string): boolean => {
    const f = u.toLowerCase();
    return (
      f.includes('qotw') ||
      f.includes('winner-template') ||
      f.includes('weekly-weird') ||
      f.includes('mile-marker') ||
      f.includes('podcast') ||
      f.includes('merch') ||
      f.includes('dec-merch') ||
      f.includes('podcast-graphic') ||
      f.includes('site-post-') ||
      f.includes('thumbnail-template') ||
      f.includes('screenshot-') ||
      f.includes('countries/') ||
      f.includes('themes/') ||
      f.includes('assets/img/') ||
      /\/web-\d{3,}-/i.test(f)
    );
  };

  // Helper function to extract and parse gallery items from a JSON string
  const parseGalleryItems = (jsonText: string): string[] => {
    try {
      const items = JSON.parse(jsonText);
      if (!Array.isArray(items)) {
        console.warn(`[batDomMap] Gallery items is not an array, got: ${typeof items}`);
        return [];
      }
      
      console.log(`[batDomMap] Parsing ${items.length} gallery items from data-gallery-items`);
      
      const urls: string[] = [];
      let skippedNoUrl = 0;
      let skippedNotOk = 0;
      let skippedNoise = 0;
      
      for (const it of items) {
        // Prioritize highest resolution: full/original > large > small
        let u = it?.full?.url || it?.original?.url || it?.large?.url || it?.small?.url;
        if (typeof u !== 'string' || !u.trim()) {
          skippedNoUrl++;
          continue;
        }
        // Aggressively upgrade to highest resolution
        u = upgradeBatImageUrl(u);
        const nu = normalize(u);
        if (!isOk(nu)) {
          skippedNotOk++;
          continue;
        }
        // CRITICAL: Filter noise even from data-gallery-items (defense in depth)
        // The gallery should be clean, but we filter anyway to catch edge cases
        if (isNoise(nu)) {
          skippedNoise++;
          console.log(`[batDomMap] Filtered noise image from gallery: ${nu}`);
          continue;
        }
        urls.push(nu);
      }
      
      const unique = [...new Set(urls)];
      console.log(`[batDomMap] Extracted ${unique.length} unique images (skipped: ${skippedNoUrl} no-url, ${skippedNotOk} not-ok, ${skippedNoise} noise)`);
      return unique;
    } catch (e) {
      console.warn('[batDomMap] Error parsing gallery JSON:', e);
      if (e instanceof Error) {
        console.warn(`[batDomMap] Error message: ${e.message}`);
        console.warn(`[batDomMap] JSON text length: ${jsonText.length}, preview: ${jsonText.slice(0, 200)}`);
      }
      return [];
    }
  };

  // 1) Most reliable: embedded JSON gallery attribute from #bat_listing_page_photo_gallery div.
  // CRITICAL: This is the ONLY source of images for the subject vehicle.
  // We MUST only extract from this specific gallery element to avoid contamination from related listings.
  try {
    // Use DOMParser to specifically target #bat_listing_page_photo_gallery element
    const parser = new DOMParser();
    const doc = parser.parseFromString(h, 'text/html');
    const galleryDiv = doc?.getElementById('bat_listing_page_photo_gallery');
    
    if (galleryDiv) {
      console.log(`[batDomMap] Found #bat_listing_page_photo_gallery div`);
      // Extract data-gallery-items attribute from within the specific gallery container.
      // On BaT, `data-gallery-items` is typically on a nested div inside #bat_listing_page_photo_gallery.
      const galleryItemsAttr =
        galleryDiv.getAttribute('data-gallery-items') ||
        (galleryDiv.querySelector?.('[data-gallery-items]')?.getAttribute?.('data-gallery-items') ?? null);
      if (galleryItemsAttr) {
        const jsonText = safeDecodeHtmlAttr(galleryItemsAttr);
        const urls = parseGalleryItems(jsonText);
        if (urls.length > 0) {
          console.log(`[batDomMap] Extracted ${urls.length} images from #bat_listing_page_photo_gallery`);
          return { urls, method: 'attr:data-gallery-items:bat_listing_page_photo_gallery' };
        }
      }
    } else {
      console.warn(`[batDomMap] #bat_listing_page_photo_gallery div not found in HTML (HTML length: ${h.length})`);
      // Check if HTML contains the string at all (might be in a different format)
      if (h.includes('data-gallery-items')) {
        console.log(`[batDomMap] HTML contains 'data-gallery-items' but gallery div not found - trying alternative extraction`);
      } else {
        console.warn(`[batDomMap] HTML does not contain 'data-gallery-items' at all`);
      }
    }
    
    // Fallback 1: Search for ANY element with data-gallery-items (in case structure changed)
    // But only if we're on a BaT listing page (check for bringatrailer.com in URL or HTML)
    if (h.includes('bringatrailer.com')) {
      const allGalleryElements = doc?.querySelectorAll?.('[data-gallery-items]') || [];
      for (let i = 0; i < allGalleryElements.length; i++) {
        const el = allGalleryElements[i];
        const attr = el?.getAttribute?.('data-gallery-items');
        if (attr) {
          const jsonText = safeDecodeHtmlAttr(attr);
          const urls = parseGalleryItems(jsonText);
          if (urls.length > 0) {
            console.log(`[batDomMap] Extracted ${urls.length} images from data-gallery-items attribute (fallback)`);
            return { urls, method: 'attr:data-gallery-items:any-element' };
          }
        }
      }
    }
    
    // Fallback 2: substring+regex (less ideal, but still constrained to the gallery section).
    // Improved regex to handle HTML entities and both single and double quotes
    const idx = h.indexOf('bat_listing_page_photo_gallery');
    if (idx >= 0) {
      const window = h.slice(Math.max(0, idx - 5000), idx + 400000); // Include some context before
      // Try to match data-gallery-items with various quote styles and HTML entities
      // Use non-greedy matching to avoid capturing too much
      const patterns = [
        /data-gallery-items\s*=\s*"([^"]*(?:&quot;[^"]*)*)"/i,
        /data-gallery-items\s*=\s*'([^']*(?:&#039;[^']*)*)'/i,
        // More flexible: match until we find a closing quote (handles HTML entities)
        /data-gallery-items\s*=\s*"((?:[^"&]|&[^;]+;)*)"/i,
        /data-gallery-items\s*=\s*'((?:[^'&]|&[^;]+;)*)'/i,
      ];
      
      for (const pattern of patterns) {
        const m = window.match(pattern);
        if (m?.[1]) {
          console.warn('[batDomMap] Using regex fallback (DOMParser method failed)');
          const encoded = String(m[1]);
          const jsonText = safeDecodeHtmlAttr(encoded);
          const urls = parseGalleryItems(jsonText);
          if (urls.length > 0) {
            return { urls, method: 'attr:data-gallery-items:regex-fallback:scoped' };
          }
        }
      }
    }
    
    // Fallback 3: Search entire HTML for data-gallery-items (last resort, but still safer than old regex)
    // Only if we haven't found anything yet and we're confident this is a BaT listing page
    if (h.includes('bringatrailer.com') && h.includes('data-gallery-items')) {
      // Try to find data-gallery-items anywhere in the HTML
      // Use a more flexible pattern that handles HTML entities
      const globalPatterns = [
        /data-gallery-items\s*=\s*"((?:[^"&]|&[^;]+;)*)"/i,
        /data-gallery-items\s*=\s*'((?:[^'&]|&[^;]+;)*)'/i,
      ];
      
      for (const pattern of globalPatterns) {
        const globalMatch = h.match(pattern);
        if (globalMatch?.[1]) {
          console.warn('[batDomMap] Using global regex fallback (all other methods failed)');
          const encoded = String(globalMatch[1]);
          const jsonText = safeDecodeHtmlAttr(encoded);
          const urls = parseGalleryItems(jsonText);
          if (urls.length > 0) {
            return { urls, method: 'attr:data-gallery-items:regex-fallback:global' };
          }
        }
      }
    }
  } catch (e) {
    console.warn('[batDomMap] Error parsing gallery items:', e);
    // fall through
  }

  // 2) Regex fallback REMOVED: It was too greedy and captured images from related/recommended auctions.
  // If data-gallery-items parsing fails, return empty array rather than risking contamination.
  // This forces us to fix parsing issues rather than silently falling back to incorrect data.
  return { urls: [], method: 'none' };
}

function extractEssentialsKV(doc: any): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const essentials = doc.querySelector('.essentials');
    if (!essentials) return out;
    const lis = essentials.querySelectorAll('li') || [];
    for (const li of lis) {
      const t = textContent(li);
      const m = t.match(/^([A-Za-z][A-Za-z\s\/]+)\s*:\s*(.+)$/);
      if (!m?.[1] || !m?.[2]) continue;
      const k = m[1].trim().toLowerCase();
      const v = m[2].trim();
      if (!k || !v) continue;
      out[k] = v;
    }
  } catch {
    // ignore
  }
  return out;
}

function extractTitle(doc: any): { title: string | null; method: string } {
  const h1 = doc.querySelector('h1.post-title') || doc.querySelector('h1');
  const v = textContent(h1);
  if (v) return { title: v, method: h1?.classList?.contains?.('post-title') ? 'selector:h1.post-title' : 'selector:h1' };
  const titleEl = doc.querySelector('title');
  const t = textContent(titleEl);
  if (t) return { title: t.split('|')[0].trim(), method: 'selector:title' };
  return { title: null, method: 'none' };
}

function parseIdentityFromTitle(title: string | null): { year: number | null; make: string | null; model: string | null } {
  if (!title) return { year: null, make: null, model: null };
  const m = title.match(/\b(19|20)\d{2}\b/);
  if (!m) return { year: null, make: null, model: null };
  const year = Number(m[0]);
  if (!Number.isFinite(year) || year < 1885 || year > new Date().getFullYear() + 1) return { year: null, make: null, model: null };
  const afterYear = title.slice(title.indexOf(m[0]) + m[0].length).trim();
  const parts = afterYear.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { year, make: parts[0] || null, model: null };
  const make = parts[0];
  const model = parts.slice(1, 4).join(' '); // keep short; trim can be derived elsewhere
  return { year, make, model };
}

function extractLocation(
  doc: any,
  essentials: Record<string, string>
): { raw: string | null; clean: string | null; method: string; warnings: string[] } {
  const warnings: string[] = [];

  // 1) Badge with title="Listing location"
  try {
    const badge = doc.querySelector('[title="Listing location"]');
    const t = textContent(badge);
    if (t) {
      const cleaned = t
        .replace(/View all listings.*/i, '')
        .replace(/Notify me about new listings.*/i, '')
        .trim();
      const norm = normalizeListingLocation(cleaned);
      return { raw: norm.raw || cleaned, clean: norm.clean, method: 'selector:[title="Listing location"]', warnings };
    }
  } catch {
    // ignore
  }

  // 2) Essentials key
  const raw = essentials['location'] || null;
  if (raw) {
    const norm = normalizeListingLocation(raw);
    return { raw: norm.raw, clean: norm.clean, method: 'essentials:Location', warnings };
  }

  // 3) Fallback: look for "Location:" text nearby
  try {
    const any = doc.querySelector('.essentials') || doc.body;
    const t = textContent(any);
    const m = t.match(/\bLocation\s*:\s*([^|•\n\r]{2,80})/i);
    if (m?.[1]) {
      const norm = normalizeListingLocation(m[1].trim());
      warnings.push('location_fallback_used');
      return { raw: norm.raw, clean: norm.clean, method: 'text:fallback(Location:)', warnings };
    }
  } catch {
    // ignore
  }

  return { raw: null, clean: null, method: 'none', warnings };
}

function extractSellerBuyer(doc: any, essentials: Record<string, string>): { seller: string | null; buyer: string | null; method: string } {
  const bodyText = textContent(doc.body);
  const seller = essentials['seller'] || (bodyText.match(/\bSold by\s+([A-Za-z0-9_]+)\b/i)?.[1] || null);
  const buyer =
    essentials['buyer'] ||
    (bodyText.match(/\bSold to\s+([A-Za-z0-9_]+)\b/i)?.[1] || bodyText.match(/\bto\s+([A-Za-z0-9_]+)\s+for\b/i)?.[1] || null);
  const method = (seller && essentials['seller']) || (buyer && essentials['buyer']) ? 'essentials' : 'text:fallback';
  return { seller, buyer, method };
}

function extractLotNumber(essentials: Record<string, string>, url: string): { lot: string | null; method: string } {
  const fromEssentials = essentials['lot'] || essentials['lot #'] || null;
  if (fromEssentials) {
    const m = fromEssentials.match(/(\d{2,})/);
    return { lot: m?.[1] || fromEssentials, method: 'essentials' };
  }
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/listing\/.*-(\d+)\/?$/i);
    if (m?.[1]) return { lot: m[1], method: 'url' };
  } catch {
    // ignore
  }
  return { lot: null, method: 'none' };
}

function extractAuctionDates(
  doc: any,
  html: string
): { start: string | null; end: string | null; sale: string | null; method: string; warnings: string[] } {
  const warnings: string[] = [];
  const h = String(html || '');

  const ends = h.match(/data-auction-ends=["'](\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})["']/);
  if (ends?.[1]) {
    const parts = ends[1].split('-').map((x) => Number(x));
    if (parts.length === 6 && parts.every((x) => Number.isFinite(x))) {
      const dt = new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
      if (Number.isFinite(dt.getTime())) {
        const end = dt.toISOString().split('T')[0];
        const startDt = new Date(dt);
        startDt.setDate(startDt.getDate() - 7);
        const start = startDt.toISOString().split('T')[0];
        return { start, end, sale: null, method: 'attr:data-auction-ends', warnings };
      }
    }
  }

  const body = textContent(doc.body);
  const saleM =
    body.match(/\bSold for\b[\s\S]{0,120}?\bon\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i) ||
    body.match(/\bBid to\b[\s\S]{0,120}?\bon\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i) ||
    null;
  const parse = (d: string): string | null => {
    const dt = new Date(d);
    if (!Number.isFinite(dt.getTime())) return null;
    return dt.toISOString().split('T')[0];
  };
  const sale = saleM?.[1] ? parse(saleM[1]) : null;
  if (sale) {
    const end = sale;
    const sd = new Date(sale);
    sd.setDate(sd.getDate() - 7);
    const start = sd.toISOString().split('T')[0];
    warnings.push('start_date_calculated_minus_7d');
    return { start, end, sale, method: 'text:sold_or_bid_to', warnings };
  }

  return { start: null, end: null, sale: null, method: 'none', warnings };
}

function extractSaleAndCurrentBid(doc: any): { sale_price: number | null; current_bid: number | null; method: string } {
  const body = textContent(doc.body);
  const sold =
    body.match(/\bSold for\b[\s\S]{0,120}?\bUSD\s*\$([\d,]+)/i) || body.match(/\bSold for\b[\s\S]{0,120}?\$([\d,]+)/i);
  if (sold?.[1]) {
    const n = asInt(sold[1]);
    if (n && n >= 1000) return { sale_price: n, current_bid: n, method: 'text:sold_for' };
  }
  const bid =
    body.match(/\bCurrent Bid\b[\s\S]{0,120}?\bUSD\s*\$([\d,]+)/i) || body.match(/\bBid to\b[\s\S]{0,120}?\bUSD\s*\$([\d,]+)/i);
  if (bid?.[1]) {
    const n = asInt(bid[1]);
    if (n && n >= 1000) return { sale_price: null, current_bid: n, method: 'text:current_bid' };
  }
  return { sale_price: null, current_bid: null, method: 'none' };
}

function extractDescription(doc: any): { text: string | null; method: string } {
  const el =
    doc.querySelector('.post-content') ||
    doc.querySelector('#post-content') ||
    doc.querySelector('.post-excerpt') ||
    doc.querySelector('article.post') ||
    doc.querySelector('.card-body') ||
    doc.querySelector('.listing-description') ||
    doc.querySelector('[class*="description"]');

  if (!el) return { text: null, method: 'none' };

  // Prefer paragraph text to reduce UI noise.
  try {
    const ps = el.querySelectorAll?.('p') || [];
    const parr = Array.from(ps as any);
    const paraText = parr
      .map((p: any) => textContent(p))
      .filter((s: string) => s && s.length >= 10)
      .join('\n')
      .trim();

    if (paraText && paraText.length >= 50) {
      const cls = el?.className ? String(el.className).split(' ')[0] : 'description';
      return { text: paraText.slice(0, 4000), method: `selector:${cls}:p` };
    }
  } catch {
    // fall through
  }

  const t = textContent(el);
  if (t && t.length >= 50) {
    const cls = el?.className ? String(el.className).split(' ')[0] : 'description';
    return { text: t.slice(0, 4000), method: `selector:${cls}` };
  }

  return { text: null, method: 'none' };
}

function extractCommentsAndBids(doc: any, html: string): { comments: number; bids: number; method: string } {
  const h = String(html || '');

  try {
    const commentEls = doc.querySelectorAll('.comment') || [];
    const commentArr: any[] = Array.from(commentEls as any);

    let commentCount = Number(commentArr.length || 0);
    let bidCount = 0;

    for (const el of commentArr) {
      const p = el?.querySelector?.('p') || el;
      const t = textContent(p);
      if (!t) continue;
      if (/bid placed by/i.test(t)) bidCount++;
    }

    if (commentCount === 0) {
      const bodyText = textContent(doc.body);
      const cm = bodyText.match(/\b([\d,]+)\s+comments?\b/i);
      commentCount = asInt(cm?.[1]) || 0;
    }

    if (bidCount === 0) {
      const sm =
        h.match(/data-stats-item="bids"[^>]*>\s*([\d,]+)\s*bids?\s*</i) ||
        h.match(/\b([\d,]+)\s*bids?\b/i);
      bidCount = asInt(sm?.[1]) || 0;
    }
    if (bidCount === 0) {
      bidCount = (h.match(/\b(?:USD\s*)?\$[\d,]+\s+bid placed by\b/gi) || []).length;
    }

    return { comments: commentCount || 0, bids: bidCount || 0, method: commentArr.length ? 'dom:.comment' : 'text:headline_fallback' };
  } catch {
    const body = textContent(doc.body);
    const comments = asInt(body.match(/\b([\d,]+)\s+comments?\b/i)?.[1]) || 0;
    const bids = (h.match(/\b(?:USD\s*)?\$[\d,]+\s+bid placed by\b/gi) || []).length;
    return { comments, bids: bids || 0, method: 'text:fallback' };
  }
}

function computeScore(x: Partial<BatDomMapHealth>): number {
  const fields = x.fields || ({} as any);
  const counts = x.counts || { images: 0, comments: 0, bids: 0 };

  let score = 0;
  const add = (ok: boolean, w: number) => {
    if (ok) score += w;
  };

  add(!!fields.title?.ok, 10);
  add(!!fields.identity?.ok, 10);
  add(!!fields.location?.ok, 15);
  add(!!fields.images?.ok, 20);
  add(!!fields.description?.ok, 10);
  add(!!fields.seller?.ok, 5);
  add(!!fields.sale?.ok || !!fields.auction_dates?.ok, 10);
  add(counts.comments > 0, 10);
  add(counts.bids > 0, 10);

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function extractBatDomMap(html: string, url: string): { extracted: BatDomExtracted; health: BatDomMapHealth } {
  const warnings: string[] = [];
  const errors: string[] = [];

  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  if (!doc) {
    const emptyHealth: BatDomMapHealth = {
      overall_score: 0,
      fields: {
        title: { ok: false, method: 'none' },
        identity: { ok: false, method: 'none' },
        lot_number: { ok: false, method: 'none' },
        location: { ok: false, method: 'none' },
        seller: { ok: false, method: 'none' },
        buyer: { ok: false, method: 'none' },
        auction_dates: { ok: false, method: 'none' },
        sale: { ok: false, method: 'none' },
        images: { ok: false, method: 'none' },
        description: { ok: false, method: 'none' },
        comments: { ok: false, method: 'none' },
        bids: { ok: false, method: 'none' },
      },
      counts: { images: 0, comments: 0, bids: 0 },
      warnings,
      errors: ['DOMParser returned null document'],
    };
    return {
      extracted: {
        url,
        title: null,
        year: null,
        make: null,
        model: null,
        lot_number: null,
        location_raw: null,
        location_clean: null,
        seller_username: null,
        buyer_username: null,
        auction_end_date: null,
        auction_start_date: null,
        sale_date: null,
        sale_price: null,
        current_bid: null,
        image_urls: [],
        description_text: null,
        comment_count: 0,
        bid_count: 0,
      },
      health: emptyHealth,
    };
  }

  const essentials = extractEssentialsKV(doc);

  const { title, method: titleMethod } = extractTitle(doc);
  const identity = parseIdentityFromTitle(title);

  const { lot, method: lotMethod } = extractLotNumber(essentials, url);

  const loc = extractLocation(doc, essentials);
  warnings.push(...(loc.warnings || []));

  const sb = extractSellerBuyer(doc, essentials);

  const dates = extractAuctionDates(doc, html);
  warnings.push(...(dates.warnings || []));

  const sale = extractSaleAndCurrentBid(doc);

  const gallery = extractGalleryImagesFromHtml(html);

  const desc = extractDescription(doc);

  const cb = extractCommentsAndBids(doc, html);

  const extracted: BatDomExtracted = {
    url,
    title: title || null,
    year: identity.year,
    make: identity.make,
    model: identity.model,
    lot_number: lot,
    location_raw: loc.raw,
    location_clean: loc.clean,
    seller_username: sb.seller,
    buyer_username: sb.buyer,
    auction_end_date: dates.end,
    auction_start_date: dates.start,
    sale_date: dates.sale,
    sale_price: sale.sale_price,
    current_bid: sale.current_bid,
    image_urls: gallery.urls,
    description_text: desc.text,
    comment_count: cb.comments,
    bid_count: cb.bids,
  };

  const fields: Record<BatDomFieldKey, BatDomFieldHealth> = {
    title: { ok: !!title, method: titleMethod, value_preview: title ? title.slice(0, 120) : null },
    identity: {
      ok: !!identity.year && !!identity.make && !!identity.model,
      method: 'parse:title',
      value_preview: identity.year ? `${identity.year} ${identity.make || ''} ${identity.model || ''}`.trim().slice(0, 120) : null,
    },
    lot_number: { ok: !!lot, method: lotMethod, value_preview: lot },
    location: { ok: !!loc.clean || !!loc.raw, method: loc.method, value_preview: (loc.clean || loc.raw || null)?.slice(0, 120), warnings: loc.warnings },
    seller: { ok: !!sb.seller, method: sb.method, value_preview: sb.seller },
    buyer: { ok: !!sb.buyer, method: sb.method, value_preview: sb.buyer },
    auction_dates: { ok: !!dates.end || !!dates.sale, method: dates.method, value_preview: dates.end || dates.sale || null, warnings: dates.warnings },
    sale: {
      ok: !!sale.sale_price || !!sale.current_bid,
      method: sale.method,
      value_preview: sale.sale_price ? String(sale.sale_price) : sale.current_bid ? String(sale.current_bid) : null,
    },
    images: { ok: gallery.urls.length > 0, method: gallery.method, value_preview: gallery.urls[0] || null },
    description: { ok: !!desc.text, method: desc.method, value_preview: desc.text ? desc.text.slice(0, 120) : null },
    comments: { ok: cb.comments > 0, method: cb.method, value_preview: cb.comments ? String(cb.comments) : null },
    bids: { ok: cb.bids > 0, method: cb.method, value_preview: cb.bids ? String(cb.bids) : null },
  };

  const health: BatDomMapHealth = {
    overall_score: 0,
    fields,
    counts: { images: gallery.urls.length, comments: cb.comments, bids: cb.bids },
    warnings,
    errors,
  };
  health.overall_score = computeScore(health);

  return { extracted, health };
}


