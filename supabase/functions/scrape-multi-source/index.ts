import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractAndCacheFavicon } from "../_shared/extractFavicon.ts";
import { extractBrandAssetsFromHtml } from "../_shared/extractBrandAssets.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type DealerInfo = {
  name?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  dealer_license?: string | null;
  specialties?: string[] | null;
  description?: string | null;
};

function safeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s) return null;
  return s;
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || /^www\./i.test(value);
}

function normalizeWebsiteUrl(raw: unknown): string | null {
  const s = safeString(raw);
  if (!s) return null;
  const candidate = s.startsWith('http://') || s.startsWith('https://') ? s : (s.startsWith('www.') ? `https://${s}` : s);
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    // Normalize to origin (drop paths/params) to improve dedupe matching.
    return url.origin.replace(/\/$/, '');
  } catch {
    return null;
  }
}

function normalizeEmail(raw: unknown): string | null {
  const s = safeString(raw);
  if (!s) return null;
  const cleaned = s.replace(/^mailto:/i, '').trim();
  // Very lightweight sanity check (DB-level validation is separate).
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) return null;
  return cleaned.toLowerCase();
}

function normalizeState(raw: unknown): string | null {
  const s = safeString(raw);
  if (!s) return null;
  const two = s.toUpperCase();
  if (/^[A-Z]{2}$/.test(two)) return two;
  return null;
}

function normalizeZip(raw: unknown): string | null {
  const s = safeString(raw);
  if (!s) return null;
  const digits = s.replace(/[^\d]/g, '');
  if (digits.length === 5) return digits;
  if (digits.length === 9) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return null;
}

function normalizePhone(raw: unknown): string | null {
  const s = safeString(raw);
  if (!s) return null;
  const digits = s.replace(/[^\d]/g, '');
  // US-only normalization for now; keep null if it doesn't look plausible.
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits.startsWith('1')) return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return null;
}

function normalizeTextArray(raw: unknown, maxItems = 25): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw.slice(0, maxItems)) {
    const s = safeString(item);
    if (!s) continue;
    const cleaned = s.replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;
    // Drop obviously bad values.
    if (cleaned.length > 120) continue;
    if (looksLikeUrl(cleaned)) continue;
    out.push(cleaned);
  }
  return Array.from(new Set(out));
}

function sanitizeSourceName(raw: string | null | undefined, url: string): string {
  const title = safeString(raw);
  if (!title) {
    return extractDomainName(url);
  }
  
  // Detect error pages / search queries - use domain name instead
  const titleLower = title.toLowerCase();
  const isErrorPage = /^(403|404|error|forbidden|page not found|not found|you searched|page not found)/i.test(title) ||
                      /code not found/i.test(titleLower) ||
                      /you searched for/i.test(titleLower);
  
  if (isErrorPage) {
    return extractDomainName(url);
  }
  
  return title;
}

function extractDomainName(url: string): string {
  try {
    const urlObj = new URL(url);
    let domain = urlObj.hostname.replace(/^www\./, '');
    // Convert domain to readable name
    domain = domain.replace(/\.(com|net|org|io|co|us)$/i, '');
    domain = domain.replace(/[._-]/g, ' ');
    // Title case
    return domain.split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  } catch {
    return 'Unknown Source';
  }
}

function normalizeDealerInfo(raw: any): DealerInfo | null {
  if (!raw || typeof raw !== 'object') return null;

  const name = safeString(raw.name);
  // If the model hallucinated a URL into "name", drop it.
  const cleanName = name && !looksLikeUrl(name) ? name.replace(/\s+/g, ' ').trim() : null;

  const website = normalizeWebsiteUrl(raw.website);
  const email = normalizeEmail(raw.email);
  const phone = normalizePhone(raw.phone);
  const state = normalizeState(raw.state);
  const zip = normalizeZip(raw.zip);
  const address = safeString(raw.address);
  const city = safeString(raw.city);
  const dealer_license = safeString(raw.dealer_license);
  const description = safeString(raw.description);
  const specialties = normalizeTextArray(raw.specialties);

  // “Greenlight” for creating/updating a business profile:
  // - require a real name, and at least one strong contact/location signal.
  const hasStrongSignal = !!(website || phone || email || (city && state) || dealer_license);
  if (!cleanName || !hasStrongSignal) return null;

  return {
    name: cleanName,
    website,
    email,
    phone,
    address: address ? address.replace(/\s+/g, ' ').trim() : null,
    city: city ? city.replace(/\s+/g, ' ').trim() : null,
    state,
    zip,
    dealer_license,
    description: description ? description.replace(/\s+/g, ' ').trim() : null,
    specialties,
  };
}

async function fetchHtmlBestEffort(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

async function tryBhccInventoryExtract(
  sourceUrl: string,
  limit: number,
  offset: number,
  mode: 'available' | 'sold' = 'available'
) {
  try {
    const base = new URL(sourceUrl);
    const safeLimit = Math.max(1, Math.min(Math.floor(limit || 0) || 50, 500));
    const safeOffset = Math.max(0, Math.floor(offset || 0));
    const soldParam = mode === 'sold' ? '&sold=Sold' : '';
    const apiUrl = `${base.origin}/isapi_xml.php?module=inventory${soldParam}&limit=${safeLimit}&offset=${safeOffset}`;

    let txt: string | null = null;
    try {
      const resp = await fetch(apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/plain,text/html,*/*',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(15000),
      });
      if (resp.ok) {
        txt = await resp.text();
      }
    } catch {
      // swallow; try Firecrawl fallback below
    }

    // If direct fetch fails (some dealer sites block Supabase outbound IPs), fall back to Firecrawl.
    if (!txt) {
      const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
      if (FIRECRAWL_API_KEY) {
        try {
          const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${FIRECRAWL_API_KEY}`
            },
            body: JSON.stringify({
              url: apiUrl,
              formats: ['html', 'markdown'],
              onlyMainContent: false,
              waitFor: 0
            }),
            signal: AbortSignal.timeout(30000),
          });
          if (firecrawlResponse.ok) {
            const firecrawlData = await firecrawlResponse.json();
            if (firecrawlData?.success) {
              // Prefer raw-ish body; for non-HTML responses Firecrawl may surface it in markdown.
              txt = (firecrawlData?.data?.html || firecrawlData?.data?.markdown || null);
            }
          }
        } catch {
          // swallow
        }
      }
    }

    if (!txt) return null;

    const lines = txt.split('\n');
    const total = parseInt((lines[0] || '').trim(), 10);

    // Listing URLs are embedded in JSON-LD snippets.
    const urlRe = /"url"\s*:\s*"(https:\/\/www\.beverlyhillscarclub\.com\/[^"]+-c-\d+\.htm)"/gi;
    const found = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = urlRe.exec(txt)) !== null) {
      if (m[1]) found.add(m[1]);
    }
    const urls = Array.from(found);
    if (urls.length === 0) return null;

    return {
      api_url: apiUrl,
      total_listings_reported: Number.isFinite(total) ? total : null,
      listing_urls: urls,
      mode,
    };
  } catch {
    return null;
  }
}

async function tryBhccDealerPhone(sourceUrl: string): Promise<string | null> {
  try {
    const url = new URL(sourceUrl);
    const resp = await fetch(sourceUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;
    const html = await resp.text();

    // AIOSEO JSON-LD contains `"telephone":"+13109750272"` for BHCC.
    const telMatch = html.match(/"telephone"\s*:\s*"([^"]{7,30})"/i);
    const raw = (telMatch?.[1] || '').trim();
    if (!raw) return null;
    // Normalize a little (keep digits). normalizePhone() will format US numbers later.
    return raw;
  } catch {
    return null;
  }
}

interface ScrapeRequest {
  source_url: string;
  source_type: 'dealer' | 'auction' | 'auction_house' | 'dealer_website' | 'marketplace' | 'classifieds';
  search_query?: string;
  extract_listings?: boolean;
  extract_dealer_info?: boolean;
  use_llm_extraction?: boolean;
  // Some dealer sites expose a deterministic "sold inventory" feed. BHCC supports this.
  include_sold?: boolean;
  // Force a listing status label for the queued items (helps when scraping "sold archive" URLs).
  // This does NOT directly change any DB rows; it only tags items in import_queue raw_data.
  force_listing_status?: 'sold' | 'in_stock';
  // Cheapest run mode:
  // - Skip OpenAI fallback extraction entirely
  // - Skip Firecrawl when possible (use direct HTML fetch + deterministic URL enumeration)
  cheap_mode?: boolean;
  max_listings?: number;
  max_results?: number; // Alias for max_listings
  start_offset?: number; // For large inventories: process a stable slice of discovered URLs
  organization_id?: string; // Optional: link inventory directly to existing organization
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

    const body: ScrapeRequest = await req.json();
    const { 
      source_url, 
      source_type = 'dealer',
      search_query,
      extract_listings = true,
      extract_dealer_info = true,
      use_llm_extraction = true,
      include_sold = false,
      force_listing_status,
      cheap_mode = false,
      max_listings = 100,
      max_results,
      organization_id,
      start_offset = 0
    } = body;
    
    const maxListingsToProcess = max_results || max_listings || 100;
    const startOffset = Number.isFinite(start_offset) ? Math.max(0, Math.floor(start_offset)) : 0;

    // Detect and normalize source type based on URL patterns
    const urlLower = source_url.toLowerCase();
    let normalizedSourceType = source_type;
    
    // Motorious detection - marketplace for dealers
    const isMotorious = urlLower.includes('buy.motorious.com') || urlLower.includes('motorious.com/inventory');
    if (isMotorious && source_type === 'dealer_website') {
      normalizedSourceType = 'marketplace';
      console.log(`Motorious detected: treating as marketplace instead of dealer_website`);
    }

    console.log(`Scraping ${source_url} (${normalizedSourceType})`);

    const isLartIndex =
      source_url.includes('lartdelautomobile.com/voitures-a-vendre') ||
      source_url.includes('lartdelautomobile.com/voitures-vendues');

    const isBhccInventory = (() => {
      try {
        const u = new URL(source_url);
        const host = u.hostname.replace(/^www\./, '');
        return host === 'beverlyhillscarclub.com' && /(sold-)?inventory\.htm$/i.test(u.pathname);
      } catch {
        return false;
      }
    })();

    // Step 1: Scrape with Firecrawl STRUCTURED EXTRACTION (AGGRESSIVE)
    if (cheap_mode) {
      console.log('Cheap mode enabled: skipping OpenAI and minimizing Firecrawl usage');
    } else {
      console.log('Using Firecrawl structured extraction for inventory...');
    }
    
    const isAuctionHouse = normalizedSourceType === 'auction' || normalizedSourceType === 'auction_house';
    // Motorious needs extra wait time for JavaScript-rendered content
    const needsExtendedWait = isMotorious;
    const extractionSchema = {
      type: 'object',
      properties: {
        dealer_info: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            address: { type: 'string' },
            city: { type: 'string' },
            state: { type: 'string' },
            zip: { type: 'string' },
            phone: { type: 'string' },
            email: { type: 'string' },
            website: { type: 'string' },
            dealer_license: { type: 'string' },
            specialties: {
              type: 'array',
              items: { type: 'string' }
            },
            description: { type: 'string' }
          }
        },
        listings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              url: { type: 'string' },
              price: { type: 'number' },
              year: { type: 'number' },
              make: { type: 'string' },
              model: { type: 'string' },
              trim: { type: 'string' },
              mileage: { type: 'number' },
              location: { type: 'string' },
              thumbnail_url: { type: 'string' },
              // Inventory grids often expose small image URLs. These are valuable as a fallback
              // when per-listing pages block scraping (downstream image analysis depends on this).
              image_urls: { type: 'array', items: { type: 'string' } },
              description_snippet: { type: 'string' },
              vin: { type: 'string' },
              is_squarebody: { type: 'boolean' }
            }
          }
        },
        next_page_url: { type: 'string' },
        total_listings_on_page: { type: 'number' }
      }
    };

    // Firecrawl first, but fall back to direct fetch if Firecrawl times out (common on huge pages).
    let markdown: string | null = null;
    let html: string | null = null;
    let metadata: any = null;
    let extract: any = null;

    if (isBhccInventory) {
      console.log(`⚡ BHCC inventory detected; using /isapi_xml.php?module=inventory for deterministic listing URLs`);
      const u = new URL(source_url);
      const wantsSoldOnly = /sold-inventory\.htm$/i.test(u.pathname);
      const modes: Array<'available' | 'sold'> = wantsSoldOnly ? ['sold'] : (include_sold ? ['available', 'sold'] : ['available']);

      const bhccPhone = await tryBhccDealerPhone(source_url);
      const allListings: any[] = [];
      const apiUrls: string[] = [];
      let totalReported: number | null = null;

      const parseBhccIdentityFromListingUrl = (listingUrl: string): { year: number | null; make: string | null; model: string | null; title: string | null } => {
        try {
          const uu = new URL(listingUrl);
          const m = uu.pathname.match(/\/(\d{4})-([^/]+?)-c-\d+\.htm$/i);
          if (!m?.[1] || !m?.[2]) return { year: null, make: null, model: null, title: null };
          const year = parseInt(m[1], 10);
          const slug = String(m[2] || '').trim().toLowerCase();
          if (!Number.isFinite(year)) return { year: null, make: null, model: null, title: null };

          const makeMap: Array<[string, string]> = [
            ['mercedes-benz', 'Mercedes-Benz'],
            ['alfa-romeo', 'Alfa Romeo'],
            ['aston-martin', 'Aston Martin'],
            ['rolls-royce', 'Rolls-Royce'],
            ['land-rover', 'Land Rover'],
            ['austin-healey', 'Austin Healey'],
            ['de-tomaso', 'De Tomaso'],
          ];

          const words = slug.split('-').filter(Boolean);
          if (words.length === 0) return { year, make: null, model: null, title: String(year) };

          let make: string | null = null;
          let modelSlug: string | null = null;

          for (const [prefix, canonical] of makeMap) {
            if (slug === prefix || slug.startsWith(prefix + '-')) {
              make = canonical;
              modelSlug = slug.slice(prefix.length).replace(/^-+/, '');
              break;
            }
          }

          if (!make) {
            make = words[0] ? (words[0].slice(0, 1).toUpperCase() + words[0].slice(1)) : null;
            modelSlug = words.slice(1).join('-') || null;
          }

          const model = modelSlug ? modelSlug.split('-').filter(Boolean).map((w) => {
            // Keep numeric tokens like 911, 300sl, etc.
            if (/^\d+[a-z0-9]*$/i.test(w)) return w.toUpperCase();
            return w.slice(0, 1).toUpperCase() + w.slice(1);
          }).join(' ') : null;

          const title = make && model ? `${year} ${make} ${model}` : (make ? `${year} ${make}` : String(year));
          return { year, make, model, title };
        } catch {
          return { year: null, make: null, model: null, title: null };
        }
      };

      for (const mode of modes) {
        const bhcc = await tryBhccInventoryExtract(source_url, maxListingsToProcess, startOffset, mode);
        if (!bhcc?.listing_urls?.length) continue;
        if (bhcc.api_url) apiUrls.push(bhcc.api_url);
        if (typeof bhcc.total_listings_reported === 'number') totalReported = bhcc.total_listings_reported;
        for (const url of bhcc.listing_urls) {
          const id = parseBhccIdentityFromListingUrl(url);
          allListings.push({
            title: id.title,
            url,
            price: null,
            year: id.year,
            make: id.make,
            model: id.model,
            thumbnail_url: null,
            listing_status: mode === 'sold' ? 'sold' : 'in_stock',
            raw: {
              source: 'bhcc_isapi_xml',
              mode,
              api_url: bhcc.api_url,
              total_listings_reported: bhcc.total_listings_reported,
            }
          });
        }
      }

      if (allListings.length) {
        // Deduplicate by URL; if any URL appears in sold + available, prefer sold.
        const byUrl = new Map<string, any>();
        for (const l of allListings) {
          const prev = byUrl.get(l.url);
          if (!prev) byUrl.set(l.url, l);
          else if (prev.listing_status !== 'sold' && l.listing_status === 'sold') byUrl.set(l.url, l);
        }
        const deduped = Array.from(byUrl.values());

        extract = {
          dealer_info: {
            name: 'Beverly Hills Car Club',
            website: normalizeWebsiteUrl(source_url),
            phone: bhccPhone,
          },
          listings: deduped,
          next_page_url: null,
          total_listings_on_page: deduped.length,
        };
        metadata = { source: 'bhcc_isapi_xml', api_urls: apiUrls, total_listings_reported: totalReported };
      }
    } else if (isLartIndex) {
      // L'Art pages are static HTML and include all /fiche/ links. Firecrawl+LLM is slow here and can
      // exceed Edge runtime limits, so fetch HTML directly and enumerate deterministically.
      console.log(`⚡ Lart index detected; skipping Firecrawl/LLM and using direct HTML fetch`);
      const resp = await fetch(source_url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) {
        throw new Error(`Direct fetch failed: ${resp.status} ${resp.statusText}`);
      }
      html = await resp.text();
    } else {
      // Some “index” pages (notably BaT Live Auctions and Classic.com auctions) are JS-driven and
      // return almost no listing links without a renderer. In those cases we allow Firecrawl even
      // when `cheap_mode=true` (we still skip LLM extraction; we only want HTML for URL enumeration).
      const baseForMode = new URL(source_url);
      const baseHostForMode = baseForMode.hostname.replace(/^www\./, '').toLowerCase();
      const isBatAuctionsIndex =
        baseHostForMode === 'bringatrailer.com' &&
        (baseForMode.pathname === '/auctions/' || baseForMode.pathname === '/auctions');
      const isClassicAuctionsIndex =
        baseHostForMode === 'classic.com' &&
        (baseForMode.pathname === '/auctions/' || baseForMode.pathname === '/auctions');

      // Firecrawl is expensive and can be rate-limited/busy. Strategy:
      // - Prefer direct HTML fetch first.
      // - Only use Firecrawl when we need JS rendering (e.g., BaT /auctions/) OR when direct fetch yields too few links.
      const shouldUseFirecrawlBase =
        !!FIRECRAWL_API_KEY &&
        (
          // Standard behavior: only use Firecrawl when not cheap_mode.
          (!cheap_mode) ||
          // Exception: allow Firecrawl for known JS index pages, but only as a fallback.
          (cheap_mode && (isBatAuctionsIndex || isClassicAuctionsIndex))
        );

      try {
        // For index pages, try direct fetch first and see if we already have enough listing links.
        if (shouldUseFirecrawlBase && cheap_mode && (isBatAuctionsIndex || isClassicAuctionsIndex)) {
          try {
            const resp = await fetch(source_url, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
              },
              signal: AbortSignal.timeout(15000),
            });
            if (resp.ok) {
              const candidate = await resp.text();
              const minLinkCount = 50;
              const n =
                isBatAuctionsIndex
                  ? (candidate.match(/href="[^"]*\/listing\/[^"]+/gi) || []).length
                  : (candidate.match(/href="[^"]*\/l\/[^"]+/gi) || []).length;
              if (n >= minLinkCount) {
                console.log(`✅ Index direct-fetch already contains ${n} listing links; skipping Firecrawl`);
                html = candidate;
              } else {
                console.log(`ℹ️ Index direct-fetch contains only ${n} listing links; will try Firecrawl fallback`);
              }
            }
          } catch {
            // ignore; Firecrawl fallback below
          }
        }

        const shouldUseFirecrawl = shouldUseFirecrawlBase && !html;
        if (shouldUseFirecrawl) {
          // For cheap_mode “index” pages, don't request `extract` to keep the Firecrawl job light.
          const formats =
            cheap_mode
              ? ['html']
              : ['markdown', 'html', 'extract'];
          const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${FIRECRAWL_API_KEY}`
            },
            body: JSON.stringify({
              url: source_url,
              formats,
              ...(cheap_mode ? {} : { extract: { schema: extractionSchema } }),
              onlyMainContent: false,
              // Give JS-heavy pages (BaT /auctions, Classic /auctions, Motorious) time to render listing cards.
              // Motorious needs significantly more time as it's a heavily JavaScript-rendered marketplace.
              // Also use actions to ensure we wait for vehicle listings to load.
              waitFor: needsExtendedWait ? 12000 : (cheap_mode ? 6500 : 4000),
              // For Motorious, also wait for specific selectors if available
              ...(needsExtendedWait ? { actions: [] } : {})
            }),
            signal: AbortSignal.timeout(30000),
          });

          if (firecrawlResponse.ok) {
            const firecrawlData = await firecrawlResponse.json();
            if (firecrawlData.success) {
              markdown = firecrawlData.data?.markdown ?? null;
              html = firecrawlData.data?.html ?? null;
              metadata = firecrawlData.data?.metadata ?? null;
              extract = firecrawlData.data?.extract ?? null;
            } else {
              console.warn(`Firecrawl returned success=false: ${JSON.stringify(firecrawlData.error || firecrawlData).slice(0, 300)}`);
            }
          } else {
            const errorText = await firecrawlResponse.text();
            console.warn(`Firecrawl error ${firecrawlResponse.status}: ${errorText.slice(0, 200)}`);
          }
        } else {
          // Cheap/general fallback: pull HTML directly so our deterministic URL enumeration (Step 4/4b) can run.
          const resp = await fetch(source_url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.9',
            },
            signal: AbortSignal.timeout(15000),
          });
          if (resp.ok) {
            html = await resp.text();
          } else {
            console.warn(`Direct fetch failed: ${resp.status} ${resp.statusText}`);
          }
        }
      } catch (e: any) {
        console.warn(`Firecrawl request failed: ${e?.message || e}`);
      }
    }

    if (!html) {
      console.log('Falling back to direct fetch for HTML...');
      const resp = await fetch(source_url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      if (!resp.ok) {
        throw new Error(`Direct fetch failed: ${resp.status} ${resp.statusText}`);
      }
      html = await resp.text();
    }

    console.log(`Scraped ${markdown?.length || 0} chars markdown, ${html?.length || 0} chars html`);

    let dealerInfo = null;
    let listings: any[] = [];

    // Step 2: Use Firecrawl structured extraction results
    if (extract) {
      console.log('Firecrawl structured extraction successful');
      dealerInfo = extract.dealer_info || null;
      listings = extract.listings || [];
      console.log(`Firecrawl extracted: dealer=${!!dealerInfo}, listings=${listings.length}`);
      
      // Handle pagination if next_page_url exists (loop bounded for safety)
      // We keep this conservative to avoid runaway costs/timeouts.
      try {
        let nextUrl = extract.next_page_url as string | null | undefined;
        const visited = new Set<string>();
        let pagesFetched = 0;
        const PAGE_FETCH_LIMIT = 8; // cap pagination depth
        const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');

        while (
          FIRECRAWL_API_KEY &&
          nextUrl &&
          typeof nextUrl === 'string' &&
          nextUrl.trim().length > 0 &&
          pagesFetched < PAGE_FETCH_LIMIT
        ) {
          const canonicalNext = (() => {
            try {
              const u = new URL(nextUrl);
              return u.toString();
            } catch {
              // Make relative URLs absolute using the source origin
              try {
                const base = new URL(source_url);
                const abs = `${base.origin}${nextUrl.startsWith('/') ? '' : '/'}${nextUrl}`;
                return new URL(abs).toString();
              } catch {
                return null;
              }
            }
          })();
          if (!canonicalNext || visited.has(canonicalNext)) break;
          visited.add(canonicalNext);
          pagesFetched++;

          console.log(`Fetching paginated page ${pagesFetched}: ${canonicalNext}`);
          const resp = await fetch('https://api.firecrawl.dev/v1/scrape', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${FIRECRAWL_API_KEY}`
            },
            body: JSON.stringify({
              url: canonicalNext,
              formats: ['extract', 'html'],
              onlyMainContent: false,
              waitFor: 4000,
              extract: { schema: extractionSchema }
            }),
            signal: AbortSignal.timeout(30000),
          });

          if (!resp.ok) {
            console.warn(`Firecrawl pagination fetch error ${resp.status}: ${await resp.text().catch(()=>'')}`);
            break;
          }
          const data = await resp.json().catch(() => null);
          const pageExtract = data?.data?.extract;
          const pageListings: any[] = Array.isArray(pageExtract?.listings) ? pageExtract.listings : [];
          console.log(`Paginated page returned ${pageListings.length} listings`);
          if (pageListings.length > 0) {
            // Merge, de-dupe by URL
            const seen = new Set<string>(listings.map((l: any) => String(l?.url || '').trim()).filter(Boolean));
            for (const l of pageListings) {
              const u = String(l?.url || '').trim();
              if (!u || seen.has(u)) continue;
              listings.push(l);
              seen.add(u);
            }
            nextUrl = pageExtract?.next_page_url || null;
          } else {
            break; // stop if page is empty
          }

          // Friendly pacing
          await new Promise(r => setTimeout(r, 500));
        }
      } catch (e: any) {
        console.warn(`Pagination fetch failed (non-blocking): ${e?.message || String(e)}`);
      }
    }

    // Step 3: LLM Extraction fallback if Firecrawl extract failed
    const allowLlmExtraction = !cheap_mode && !isLartIndex && use_llm_extraction && OPENAI_API_KEY;
    if (listings.length === 0 && allowLlmExtraction) {
      console.log('Running LLM extraction...');

      const extractionPrompt = `You are a data extraction expert for automotive listings. Analyze this webpage and extract structured data.

SOURCE URL: ${source_url}
SOURCE TYPE: ${source_type}
${search_query ? `SEARCH QUERY: ${search_query}` : ''}

WEBPAGE CONTENT:
${markdown?.substring(0, 30000) || ''}

EXTRACT THE FOLLOWING:

1. DEALER/ORGANIZATION INFO (if this is a dealer page):
{
  "name": "dealer name",
  "address": "full address",
  "city": "city",
  "state": "state abbreviation",
  "zip": "zip code",
  "phone": "phone number",
  "email": "email if found",
  "website": "main website URL",
  "dealer_license": "license number if shown",
  "specialties": ["list of specialties like 'classic trucks', 'muscle cars'"],
  "description": "brief description of the dealer"
}

2. VEHICLE LISTINGS (extract ALL vehicles found, especially Chevrolet/GMC trucks 1967-1991):
[
  {
    "title": "listing title",
    "url": "full URL to listing",
    "price": 12500,
    "year": 1985,
    "make": "Chevrolet",
    "model": "K10",
    "trim": "Scottsdale",
    "mileage": 85000,
    "location": "City, ST",
    "thumbnail_url": "image URL",
    "description_snippet": "first 200 chars of description",
    "is_squarebody": true
  }
]

Focus on finding:
- Chevrolet C10, C20, C30, K10, K20, K30 (1967-1991)
- GMC C1500, C2500, K1500, K2500 (1967-1991)
- Chevrolet Blazer, Suburban (1967-1991)
- GMC Jimmy, Suburban (1967-1991)

Return ONLY valid JSON in this format:
{
  "dealer_info": { ... } or null,
  "listings": [ ... ],
  "total_listings_on_page": number,
  "squarebody_count": number,
  "next_page_url": "URL if pagination found" or null
}`;

      const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: 'You extract structured data from webpages. Return only valid JSON, no markdown formatting.' },
            { role: 'user', content: extractionPrompt }
          ],
          temperature: 0.1,
          max_tokens: 4000
        })
      });

      if (openaiResponse.ok) {
        const openaiData = await openaiResponse.json();
        const content = openaiData.choices?.[0]?.message?.content || '';
        
        try {
          // Clean up potential markdown formatting
          let jsonStr = content.trim();
          if (jsonStr.startsWith('```json')) {
            jsonStr = jsonStr.slice(7);
          }
          if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.slice(3);
          }
          if (jsonStr.endsWith('```')) {
            jsonStr = jsonStr.slice(0, -3);
          }
          
          const extracted = JSON.parse(jsonStr.trim());
          dealerInfo = extracted.dealer_info;
          listings = extracted.listings || [];
          
          console.log(`LLM extracted: dealer=${!!dealerInfo}, listings=${listings.length}`);
        } catch (parseError) {
          console.error('Failed to parse LLM response:', parseError);
          console.log('Raw response:', content.substring(0, 500));
        }
      } else {
        console.error('OpenAI API error:', await openaiResponse.text());
      }
    }

    // Step 4: Last resort - try Firecrawl again with different approach (sitemap or deeper crawl)
    if (listings.length === 0 && html) {
      console.log('No listings found, attempting deeper extraction...');
      
      // Try scraping with actions to interact with page (if needed)
      // For now, fallback to basic URL extraction
      const listingPatterns = [
        /href="([^"]*\/listing\/[^"]+)"/gi,
        /href="([^"]*\/vehicle\/[^"]+)"/gi,
        // TBTFW (Webflow + AutoManager embed): listing detail pages use /am-inventory/<slug>
        /href="([^"]*\/am-inventory\/[^"]+)"/gi,
        // Classic.com listing detail pages often use /l/<id-or-slug>/
        /href="([^"]*\/l\/[^"]+)"/gi,
        // Cars & Bids: listing detail pages use /auctions/<id>/<slug>
        /href="([^"]*\/auctions\/[^"]+)"/gi,
        // L'Art de L'Automobile (and similar) uses /fiche/<slug> for vehicle detail pages.
        /href="([^"]*\/fiche\/[^"]+)"/gi,
        // Beverly Hills Car Club: listing detail pages end with -c-<id>.htm (no /inventory/ segment)
        /href="([^"]*-c-\d+\.htm)"/gi,
        // Facebook Marketplace listing pages
        /href="([^"]*\/marketplace\/item\/\d+[^"]*)"/gi,
        /href="([^"]*facebook\.com\/marketplace\/item\/\d+[^"]*)"/gi,
        /href="([^"]*\/inventory\/[^"]+)"/gi,
        /href="([^"]*\/cars\/[^"]+)"/gi,
        /href="([^"]*\/trucks\/[^"]+)"/gi,
        /href="([^"]*\/inventory\/[^/]+\/[^"]+)"/gi,
        /data-url="([^"]+)"/gi,
        /data-href="([^"]+)"/gi
      ];
      
      const foundUrls = new Set<string>();
      for (const pattern of listingPatterns) {
        let match;
        while ((match = pattern.exec(html)) !== null) {
          let url = match[1];
          if (!url.startsWith('http')) {
            const baseUrl = new URL(source_url);
            url = `${baseUrl.origin}${url.startsWith('/') ? '' : '/'}${url}`;
          }
          // Filter out non-vehicle URLs
          if (
            url.match(/\/(vehicle|listing|inventory|cars|trucks|detail|detail\.aspx|fiche|auctions)\b/i) ||
            url.match(/-c-\d+\.htm$/i) ||
            url.includes('/marketplace/item/')
          ) {
            foundUrls.add(url);
          }
        }
      }
      
      // Normalize Facebook Marketplace listing URLs to canonical /marketplace/item/<id>/ form for dedupe.
      const baseHost = (() => {
        try { return new URL(source_url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
      })();
      const normalizeFacebookItemUrl = (raw: string): string | null => {
        try {
          const u = new URL(raw);
          const m1 = u.pathname.match(/\/marketplace\/item\/(\d{5,})/i);
          const id = m1?.[1] || u.searchParams.get('item_id') || null;
          if (!id) return null;
          return `https://www.facebook.com/marketplace/item/${id}/`;
        } catch {
          return null;
        }
      };

      const normalizedUrls = Array.from(foundUrls)
        .map((u) => (baseHost.endsWith('facebook.com') ? (normalizeFacebookItemUrl(u) || u) : u));

      listings = normalizedUrls.slice(0, maxListingsToProcess).map(url => ({
        url,
        title: null,
        price: null,
        year: null,
        make: null,
        model: null
      }));
      
      console.log(`Fallback extracted ${listings.length} listing URLs`);
    }

    // Step 4b: Deterministic URL enumeration (preferred for large dealer inventories)
    // Firecrawl "extract" and LLM extraction can under-count when there are many listing cards.
    // If the raw HTML contains many vehicle detail links, prefer enumerating them and let downstream
    // `process-import-queue` + `scrape-vehicle` extract the full details.
    if (html) {
      try {
        const baseUrl = new URL(source_url);
        const found = new Set<string>();

        // Prefer explicit card anchors first (common pattern on dealer sites).
        const carCardHref = /<a[^>]+class="[^"]*carCard[^"]*"[^>]*href="([^"]+)"/gi;
        let m: RegExpExecArray | null;
        while ((m = carCardHref.exec(html)) !== null) {
          const raw = (m[1] || '').trim();
          if (!raw) continue;
          const abs = raw.startsWith('http') ? raw : `${baseUrl.origin}${raw.startsWith('/') ? '' : '/'}${raw}`;
          // L'Art de L'Automobile uses /fiche/<slug> for vehicle detail pages.
          if (abs.includes('/fiche/')) found.add(abs);
        }

        // Also catch any other /fiche/ hrefs.
        const anyFicheHref = /href="([^"]*\/fiche\/[^"]+)"/gi;
        while ((m = anyFicheHref.exec(html)) !== null) {
          const raw = (m[1] || '').trim();
          if (!raw) continue;
          const abs = raw.startsWith('http') ? raw : `${baseUrl.origin}${raw.startsWith('/') ? '' : '/'}${raw}`;
          if (abs.includes('/fiche/')) found.add(abs);
        }

        // TBTFW: enumerate /am-inventory/ links (detail pages include VIN/stock in URL).
        const anyAmInventoryHref = /href="([^"]*\/am-inventory\/[^"]+)"/gi;
        while ((m = anyAmInventoryHref.exec(html)) !== null) {
          const raw = (m[1] || '').trim();
          if (!raw) continue;
          const abs = raw.startsWith('http') ? raw : `${baseUrl.origin}${raw.startsWith('/') ? '' : '/'}${raw}`;
          // Avoid pulling unrelated "inventory" anchors; /am-inventory/ is strongly indicative.
          if (abs.includes('/am-inventory/')) found.add(abs);
        }

        // Classic.com: enumerate listing detail URLs from seller pages.
        // We keep this conservative: only pick /l/ links and normalize to the current origin.
        const baseHost = baseUrl.hostname.replace(/^www\./, '').toLowerCase();
        if (baseHost.endsWith('facebook.com')) {
          // Facebook Marketplace: collect item detail links and normalize for dedupe.
          const fbHref = /href="([^"]*\/marketplace\/item\/\d+[^"]*)"/gi;
          let fm: RegExpExecArray | null;
          while ((fm = fbHref.exec(html)) !== null) {
            const raw = (fm[1] || '').trim();
            if (!raw) continue;
            const abs = raw.startsWith('http') ? raw : `${baseUrl.origin}${raw.startsWith('/') ? '' : '/'}${raw}`;
            const m1 = abs.match(/\/marketplace\/item\/(\d{5,})/i);
            const id = m1?.[1] || null;
            if (!id) continue;
            found.add(`https://www.facebook.com/marketplace/item/${id}/`);
          }
        }
        if (baseHost === 'classic.com') {
          const anyClassicListingHref = /href="([^"]*\/l\/[^"]+)"/gi;
          while ((m = anyClassicListingHref.exec(html)) !== null) {
            const raw = (m[1] || '').trim();
            if (!raw) continue;
            // Make absolute, but keep within the same origin to avoid pulling external links.
            const abs = raw.startsWith('http') ? raw : `${baseUrl.origin}${raw.startsWith('/') ? '' : '/'}${raw}`;
            try {
              const u = new URL(abs);
              if (u.hostname.replace(/^www\./, '').toLowerCase() !== 'classic.com') continue;
              if (!u.pathname.toLowerCase().startsWith('/l/')) continue;
              // Normalize trailing slash
              const normalized = u.pathname.endsWith('/') ? `${u.origin}${u.pathname}` : `${u.origin}${u.pathname}/`;
              found.add(normalized);
            } catch {
              // ignore
            }
          }
        }

        // Bring a Trailer: enumerate listing detail URLs from live auction index pages.
        if (baseHost === 'bringatrailer.com') {
          const anyBatListingHref = /href="([^"]*\/listing\/[^"]+)"/gi;
          while ((m = anyBatListingHref.exec(html)) !== null) {
            const raw = (m[1] || '').trim();
            if (!raw) continue;
            const abs = raw.startsWith('http') ? raw : `${baseUrl.origin}${raw.startsWith('/') ? '' : '/'}${raw}`;
            try {
              const u = new URL(abs);
              if (u.hostname.replace(/^www\./, '').toLowerCase() !== 'bringatrailer.com') continue;
              if (!u.pathname.toLowerCase().startsWith('/listing/')) continue;
              const normalized = u.pathname.endsWith('/') ? `${u.origin}${u.pathname}` : `${u.origin}${u.pathname}/`;
              found.add(normalized);
            } catch {
              // ignore
            }
          }

          // Attempt naive pagination on BaT /auctions index (common patterns: /page/N/, ?page=N, ?pg=N, ?paged=N)
          // We fetch a few additional pages and collect links until no new links are found or limit reached.
          try {
            const basePath = baseUrl.pathname.replace(/\/+$/, '');
            const isAuctionsIndex = basePath === '/auctions';
            const canPaginate = isAuctionsIndex;
            const PAGE_LIMIT = 8; // cap to avoid long runs
            const paginationPatterns: ((p: number) => string)[] = [
              (p) => p === 1 ? `${baseUrl.origin}${basePath}/` : `${baseUrl.origin}${basePath}/page/${p}/`,
              (p) => p === 1 ? `${baseUrl.origin}${basePath}/` : `${baseUrl.origin}${basePath}/?page=${p}`,
              (p) => p === 1 ? `${baseUrl.origin}${basePath}/` : `${baseUrl.origin}${basePath}/?pg=${p}`,
              (p) => p === 1 ? `${baseUrl.origin}${basePath}/` : `${baseUrl.origin}${basePath}/?paged=${p}`,
            ];
            if (canPaginate) {
              const seenBefore = new Set<string>(found);
              for (let page = 2; page <= PAGE_LIMIT; page++) {
                let pageFetched = false;
                for (const pattern of paginationPatterns) {
                  const pageUrl = pattern(page);
                  if (!pageUrl) continue;
                  try {
                    const resp = await fetch(pageUrl, {
                      headers: {
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.9',
                      },
                      signal: AbortSignal.timeout(12000),
                    });
                    if (!resp.ok) continue;
                    const pageHtml = await resp.text();
                    const re = /href="([^"]*\/listing\/[^"]+)"/gi;
                    let added = 0;
                    let mm: RegExpExecArray | null;
                    while ((mm = re.exec(pageHtml)) !== null) {
                      const raw = (mm[1] || '').trim();
                      if (!raw) continue;
                      const abs = raw.startsWith('http') ? raw : `${baseUrl.origin}${raw.startsWith('/') ? '' : '/'}${raw}`;
                      try {
                        const u = new URL(abs);
                        if (u.hostname.replace(/^www\./, '').toLowerCase() !== 'bringatrailer.com') continue;
                        if (!u.pathname.toLowerCase().startsWith('/listing/')) continue;
                        const normalized = u.pathname.endsWith('/') ? `${u.origin}${u.pathname}` : `${u.origin}${u.pathname}/`;
                        if (!seenBefore.has(normalized)) {
                          found.add(normalized);
                          seenBefore.add(normalized);
                          added++;
                        }
                      } catch {
                        // ignore
                      }
                    }
                    if (added > 0) {
                      pageFetched = true;
                      console.log(`BaT pagination page ${page}: added ${added} new listings`);
                      // Pace requests slightly
                      await new Promise(r => setTimeout(r, 400));
                      break; // next page number with first successful pattern
                    }
                  } catch {
                    // try next pattern
                  }
                }
                if (!pageFetched) {
                  // no new links or all patterns failed; stop paginating
                  break;
                }
              }
            }
          } catch (e: any) {
            console.warn(`BaT pagination failed (non-blocking): ${e?.message || String(e)}`);
          }
        }

        // Cars & Bids: enumerate listing detail URLs from /auctions/ index pages.
        if (baseHost === 'carsandbids.com') {
          const anyCbAuctionHref = /href="([^"]*\/auctions\/[^"]+)"/gi;
          while ((m = anyCbAuctionHref.exec(html)) !== null) {
            const raw = (m[1] || '').trim();
            if (!raw) continue;
            const abs = raw.startsWith('http') ? raw : `${baseUrl.origin}${raw.startsWith('/') ? '' : '/'}${raw}`;
            try {
              const u = new URL(abs);
              if (u.hostname.replace(/^www\./, '').toLowerCase() !== 'carsandbids.com') continue;
              if (!u.pathname.toLowerCase().startsWith('/auctions/')) continue;
              if (u.pathname.toLowerCase() === '/auctions' || u.pathname.toLowerCase() === '/auctions/') continue;
              const normalized = u.pathname.endsWith('/') ? `${u.origin}${u.pathname}` : `${u.origin}${u.pathname}/`;
              found.add(normalized);
            } catch {
              // ignore
            }
          }
        }

        const enumeratedUrls = Array.from(found);
        if (enumeratedUrls.length > listings.length) {
          console.log(`URL enumeration found ${enumeratedUrls.length} listing links (overriding prior listings=${listings.length})`);
          listings = enumeratedUrls.map((url) => ({
            url,
            title: null,
            price: null,
            year: null,
            make: null,
            model: null,
          }));
        }
      } catch (e: any) {
        console.warn(`URL enumeration failed: ${e?.message || e}`);
      }
    }

    // Step 4: Create/update source in database
    let sourceId: string | null = null;
    const totalListingsFound = listings.length;
    // `scrape_sources.source_type` is constrained; normalize newer request types to legacy enum values.
    // Motorious should be treated as marketplace, not dealer_website
    const scrapeSourceTypeForDb = 
      normalizedSourceType === 'marketplace' ? 'marketplace' :
      normalizedSourceType === 'dealer_website' ? 'dealer' :
      normalizedSourceType;
    
    const { data: existingSource } = await supabase
      .from('scrape_sources')
      .select('id')
      .eq('url', source_url)
      .single();

    if (existingSource) {
      sourceId = existingSource.id;
      await supabase
        .from('scrape_sources')
        .update({
          last_scraped_at: new Date().toISOString(),
          last_successful_scrape: new Date().toISOString(),
          total_listings_found: totalListingsFound,
          squarebody_count: listings.filter((l: any) => l.is_squarebody).length,
          updated_at: new Date().toISOString()
        })
        .eq('id', sourceId);
    } else {
      // Sanitize source name to avoid error page titles
      const sourceName = dealerInfo?.name || sanitizeSourceName(metadata?.title, source_url);
      
      const { data: newSource, error: sourceError } = await supabase
        .from('scrape_sources')
        .insert({
          name: sourceName,
          url: source_url,
          source_type: scrapeSourceTypeForDb,
          inventory_url: source_url,
          contact_info: dealerInfo ? {
            phone: dealerInfo.phone,
            email: dealerInfo.email
          } : {},
          location: dealerInfo ? {
            address: dealerInfo.address,
            city: dealerInfo.city,
            state: dealerInfo.state,
            zip: dealerInfo.zip
          } : {},
          last_scraped_at: new Date().toISOString(),
          last_successful_scrape: new Date().toISOString(),
          total_listings_found: totalListingsFound,
          squarebody_count: listings.filter((l: any) => l.is_squarebody).length
        })
        .select('id')
        .single();

      if (newSource) {
        sourceId = newSource.id;
      }
    }

    // Step 5: Create/update business if dealer info found or use provided organization_id
    let organizationId: string | null = organization_id || null;
    
    // If organization_id provided, verify it exists and get business type
    let businessType: 'dealer' | 'auction_house' = 'dealer';
    if (organizationId) {
      const { data: existingOrg } = await supabase
        .from('businesses')
        .select('id, type, business_name')
        .eq('id', organizationId)
        .maybeSingle();
      
      if (!existingOrg) {
        console.warn(`Provided organization_id ${organizationId} not found, will create new organization`);
        organizationId = null;
      } else {
        businessType = (existingOrg.type === 'auction_house' || source_type === 'auction_house') ? 'auction_house' : 'dealer';
        console.log(`Using provided organization: ${existingOrg.business_name} (${businessType})`);
      }
    }
    
    // Normalize/sanitize dealer info before writing to the businesses table.
    const normalizedDealer = normalizeDealerInfo(dealerInfo);
    if (!normalizedDealer && dealerInfo && dealerInfo.name) {
      console.warn('Dealer info extracted but failed validation; skipping business create/update to protect DB quality.');
    }

    if (!organizationId && normalizedDealer && normalizedDealer.name) {
        businessType = (source_type === 'auction' || source_type === 'auction_house') ? 'auction_house' : 'dealer';
        
        // Try to find existing business by website (strongest signal)
      let existingOrg = null;
      let existingOrgFull: any = null;

      if (normalizedDealer.website) {
        const { data } = await supabase
          .from('businesses')
          .select('id, business_name, website, dealer_license, type, business_type, address, city, state, zip_code, phone, email')
          .eq('website', normalizedDealer.website)
          .maybeSingle();
        existingOrg = data;
        existingOrgFull = data;
      }
      
      // Fallback: match by name + city + state if no website match
      if (!existingOrg && normalizedDealer.name && normalizedDealer.city && normalizedDealer.state) {
        const { data } = await supabase
          .from('businesses')
          .select('id, business_name, website, dealer_license, type, business_type, address, city, state, zip_code, phone, email')
          .ilike('business_name', `%${normalizedDealer.name}%`)
          .ilike('city', `%${normalizedDealer.city}%`)
          .eq('state', normalizedDealer.state)
          .maybeSingle();
        existingOrg = data;
        existingOrgFull = data;
      }

      if (existingOrg) {
        organizationId = existingOrg.id;
        businessType = (existingOrg.type === 'auction_house' || source_type === 'auction_house') ? 'auction_house' : 'dealer';
        console.log(`Found existing business: ${existingOrg.business_name} (${organizationId})`);
        
        // Update inventory counts if we have them
        const updates: any = {
          updated_at: new Date().toISOString()
        };
        
        // Only update if we have actual data
        if (listings.length > 0) {
          updates.total_vehicles = listings.length;
        }
        
        // Update missing fields only (never overwrite existing with new scrape unless empty).
        if (normalizedDealer.website && !existingOrgFull?.website) {
          updates.website = normalizedDealer.website;
        }
        if (normalizedDealer.dealer_license && !existingOrgFull?.dealer_license) {
          updates.dealer_license = normalizedDealer.dealer_license;
        }
        if (normalizedDealer.address && !existingOrgFull?.address) updates.address = normalizedDealer.address;
        if (normalizedDealer.city && !existingOrgFull?.city) updates.city = normalizedDealer.city;
        if (normalizedDealer.state && !existingOrgFull?.state) updates.state = normalizedDealer.state;
        if (normalizedDealer.zip && !existingOrgFull?.zip_code) updates.zip_code = normalizedDealer.zip;
        if (normalizedDealer.phone && !existingOrgFull?.phone) updates.phone = normalizedDealer.phone;
        if (normalizedDealer.email && !existingOrgFull?.email) updates.email = normalizedDealer.email;
        if (normalizedDealer.description && !existingOrgFull?.description) updates.description = normalizedDealer.description;
        if (Array.isArray(normalizedDealer.specialties) && normalizedDealer.specialties.length > 0 && (!existingOrgFull?.specializations || existingOrgFull?.specializations?.length === 0)) {
          updates.specializations = normalizedDealer.specialties;
        }
        
        await supabase
          .from('businesses')
          .update(updates)
          .eq('id', organizationId);
      } else {
        // Create new business
        const { data: newOrg, error: orgError } = await supabase
          .from('businesses')
          .insert({
            business_name: normalizedDealer.name,
            type: businessType,
            // Auction houses are a first-class organization type (do not bucket into "other")
            business_type: businessType === 'auction_house' ? 'auction_house' : 'dealership',
            description: normalizedDealer.description,
            address: normalizedDealer.address,
            city: normalizedDealer.city,
            state: normalizedDealer.state,
            zip_code: normalizedDealer.zip,
            phone: normalizedDealer.phone,
            email: normalizedDealer.email,
            website: normalizedDealer.website,
            dealer_license: normalizedDealer.dealer_license,
            specializations: normalizedDealer.specialties || [],
            total_vehicles: listings.length || 0,
            source_url: source_url,
            discovered_via: 'scraper',
            metadata: {
              scrape_source_id: sourceId,
              inventory_url: source_url,
              squarebody_count: listings.filter((l: any) => l.is_squarebody).length,
              raw_dealer_info: dealerInfo || null
            }
          })
          .select('id, business_name')
          .single();

        if (newOrg) {
          organizationId = newOrg.id;
          console.log(`Created new business: ${newOrg.business_name} (${organizationId})`);
        } else if (orgError) {
          console.error('Error creating business:', orgError);
        }
      }
    }

    // Step 5b: Brand DNA extraction (favicon/logo/svg/banner/primary images)
    // Keep this scoped to the org profile only; do not mix with vehicle extraction.
    if (organizationId) {
      try {
        // Determine best URL to represent the org brand.
        const orgWebsite =
          normalizedDealer?.website ||
          (dealerInfo?.website ? normalizeWebsiteUrl(dealerInfo.website) : null) ||
          (() => {
            try {
              return new URL(source_url).origin;
            } catch {
              return null;
            }
          })();

        if (orgWebsite) {
          // Favicon: cache via source_favicons (Google s2). This powers UI continuity across the app.
          const faviconUrl = await extractAndCacheFavicon(
            supabase,
            orgWebsite,
            businessType,
            normalizedDealer?.name || dealerInfo?.name || null
          );

          // Brand images: prefer homepage HTML when possible (inventory pages are often JS shells).
          const brandHtml =
            (isBhccInventory ? await fetchHtmlBestEffort(orgWebsite) : null) ||
            (source_url === orgWebsite ? html : null) ||
            (await fetchHtmlBestEffort(orgWebsite));

          if (brandHtml) {
            const assets = extractBrandAssetsFromHtml(brandHtml, orgWebsite);

            // Only fill missing media fields; never overwrite existing brand assets.
            // Some deployments may not have `cover_image_url` yet. Keep this query compatible.
            const { data: existingBiz } = await supabase
              .from('businesses')
              .select('logo_url, banner_url, portfolio_images, metadata')
              .eq('id', organizationId)
              .maybeSingle();

            const updates: any = { updated_at: new Date().toISOString() };
            const looksLikeFavicon = (u: string) => {
              const s = String(u || '').toLowerCase();
              return s.includes('google.com/s2/favicons') || s.includes('/s2/favicons') || s.includes('favicon') || s.endsWith('.ico');
            };

            if (assets.logo_url && !existingBiz?.logo_url) updates.logo_url = assets.logo_url;
            // Never store favicons as banner images; they are tiny and will be stretched in the hero.
            if (assets.banner_url && !existingBiz?.banner_url && !looksLikeFavicon(assets.banner_url)) {
              updates.banner_url = assets.banner_url;
            }
            // NOTE: some deployments don't have businesses.favicon_url; store favicon under metadata.brand_assets instead.

            const existingPortfolio: string[] = Array.isArray(existingBiz?.portfolio_images) ? existingBiz!.portfolio_images : [];
            const mergedPortfolio = Array.from(new Set([...(existingPortfolio || []), ...(assets.primary_image_urls || [])])).slice(0, 12);
            if (mergedPortfolio.length > existingPortfolio.length) updates.portfolio_images = mergedPortfolio;

            // Persist extra assets in metadata for continuity (svg logo, favicon url, raw candidates).
            const meta = existingBiz?.metadata || {};
            updates.metadata = {
              ...meta,
              brand_assets: {
                ...(meta?.brand_assets || {}),
                favicon_url: faviconUrl || meta?.brand_assets?.favicon_url || null,
                logo_svg_url: assets.logo_svg_url || meta?.brand_assets?.logo_svg_url || null,
                extracted_at: new Date().toISOString(),
                source_url: orgWebsite,
                raw: assets.raw || null,
              }
            };

            // Only write if we have anything meaningful.
            const hasMediaUpdate =
              updates.logo_url ||
              updates.banner_url ||
              updates.portfolio_images ||
              updates.metadata;

            if (hasMediaUpdate) {
              await supabase.from('businesses').update(updates).eq('id', organizationId);
            }
          }
        }
      } catch (err: any) {
        console.warn(`Brand DNA extraction failed (non-blocking): ${err?.message || String(err)}`);
      }
    }

    // Step 6: Process listings - queue for import OR directly create dealer_inventory/auction records
    let queuedCount = 0;
    let duplicateCount = 0;
    let inventoryCreatedCount = 0;
    const inferredListingStatus =
      force_listing_status
        ? force_listing_status
        : (
          source_url.includes('/voitures-vendues') ||
          source_url.includes('voitures-vendues') ||
          /\/sold\b/i.test(source_url) ||
          /sold-?inventory/i.test(source_url) ||
          /sold-?vehicles/i.test(source_url) ||
          /\/archive\b/i.test(source_url)
            ? 'sold'
            : 'in_stock'
        );

    // Stable paging for very large inventories (e.g., sold archives).
    // Sort by URL so `start_offset` is deterministic across runs.
    const sortedListings = [...listings]
      .filter((l: any) => !!l?.url)
      .sort((a: any, b: any) => (a.url || '').localeCompare(b.url || ''));
    // BHCC already applies offset at the upstream API level (isapi_xml.php?offset=...).
    // Do NOT double-apply `start_offset` locally or we will skip chunks when scaling.
    const effectiveLocalOffset = isBhccInventory ? 0 : startOffset;
    const listingsToProcess = sortedListings.slice(effectiveLocalOffset, effectiveLocalOffset + maxListingsToProcess);

    // If we have an organization_id and this is dealer inventory, we can create dealer_inventory records
    // For auction houses, we'll still queue since they need auction_events/auction_lots structure
    const shouldCreateInventoryDirectly = organizationId && businessType === 'dealer' && listings.length > 0;
    
    if (shouldCreateInventoryDirectly) {
      console.log(`Creating dealer inventory records for organization ${organizationId}...`);
      
      // Bulk upsert listings to import_queue (critical for large inventories)
      const rows = listingsToProcess.map((listing: any) => ({
        source_id: sourceId,
        listing_url: listing.url,
        listing_title: listing.title || null,
        listing_price: typeof listing.price === 'number' ? listing.price : null,
        listing_year: typeof listing.year === 'number' ? listing.year : null,
        listing_make: listing.make || null,
        listing_model: listing.model || null,
        thumbnail_url: listing.thumbnail_url || null,
        raw_data: {
          ...listing,
          organization_id: organizationId, // Tag with org ID for processing
          inventory_extraction: true,
          listing_status: listing?.listing_status || inferredListingStatus,
        },
        priority: listing.is_squarebody ? 10 : 0,
      }));

      const chunkSize = 100;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const { error: upsertErr } = await supabase
          .from('import_queue')
          .upsert(chunk, { onConflict: 'listing_url' });
        if (upsertErr) {
          console.error('Queue upsert error:', upsertErr);
        } else {
          queuedCount += chunk.length;
        }

        // Update "seen" tracker so we can detect disappearance later.
        // Best-effort; do NOT fail scrape on tracker issues.
        try {
          const seenRows = chunk
            .filter((r: any) => typeof r?.listing_url === 'string' && r.listing_url.startsWith('http'))
            .map((r: any) => ({
              dealer_id: organizationId,
              listing_url: r.listing_url,
              last_seen_at: new Date().toISOString(),
              last_seen_status: (r?.raw_data?.listing_status === 'sold' || inferredListingStatus === 'sold') ? 'sold' : 'in_stock',
              last_seen_source_url: source_url,
              seen_count: 1,
            }));

          if (seenRows.length > 0) {
            await supabase
              .from('dealer_inventory_seen')
              .upsert(seenRows, { onConflict: 'dealer_id,listing_url' } as any);
          }
        } catch (seenErr: any) {
          console.warn(`dealer_inventory_seen upsert failed (non-blocking): ${seenErr?.message || String(seenErr)}`);
        }
      }
      
      console.log(`Queued ${queuedCount} listings for vehicle creation (will auto-link to dealer inventory via process-import-queue)`);
    } else if (organizationId && businessType === 'auction_house') {
      // For auction houses, we need to structure as auction events/lots
      // This will be handled separately since auction structure is more complex
      console.log('Auction house detected - listings will be processed as auction events/lots');
      
      const rows = listingsToProcess.map((listing: any) => ({
        source_id: sourceId,
        listing_url: listing.url,
        listing_title: listing.title || null,
        listing_price: typeof listing.price === 'number' ? listing.price : null,
        listing_year: typeof listing.year === 'number' ? listing.year : null,
        listing_make: listing.make || null,
        listing_model: listing.model || null,
        thumbnail_url: listing.thumbnail_url || null,
        raw_data: {
          ...listing,
          organization_id: organizationId,
          business_type: 'auction_house',
          auction_extraction: true,
          listing_status: listing?.listing_status || inferredListingStatus,
        },
        priority: listing.is_squarebody ? 10 : 0,
      }));

      const chunkSize = 100;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const { error: upsertErr } = await supabase
          .from('import_queue')
          .upsert(chunk, { onConflict: 'listing_url' });
        if (upsertErr) {
          console.error('Queue upsert error:', upsertErr);
        } else {
          queuedCount += chunk.length;
        }
      }
    } else {
      // Standard queue process (when no org_id provided)
      const rows = listingsToProcess.map((listing: any) => ({
        source_id: sourceId,
        listing_url: listing.url,
        listing_title: listing.title || null,
        listing_price: typeof listing.price === 'number' ? listing.price : null,
        listing_year: typeof listing.year === 'number' ? listing.year : null,
        listing_make: listing.make || null,
        listing_model: listing.model || null,
        thumbnail_url: listing.thumbnail_url || null,
        raw_data: listing,
        priority: listing.is_squarebody ? 10 : 0,
      }));

      const chunkSize = 100;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const { error: upsertErr } = await supabase
          .from('import_queue')
          .upsert(chunk, { onConflict: 'listing_url' });
        if (upsertErr) {
          console.error('Queue upsert error:', upsertErr);
        } else {
          queuedCount += chunk.length;
        }
      }

      console.log(`Queued ${queuedCount} listings (upserted by listing_url)`);
    }

    return new Response(JSON.stringify({
      success: true,
      source_id: sourceId,
      organization_id: organizationId,
      dealer_info: dealerInfo,
      listings_found: totalListingsFound,
      listings_queued: queuedCount,
      duplicates_skipped: duplicateCount,
      squarebody_count: listings.filter((l: any) => l.is_squarebody).length,
      start_offset: startOffset,
      max_results: maxListingsToProcess,
      sample_listings: listingsToProcess.slice(0, 5)
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Scrape error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

