import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

interface ScrapeRequest {
  source_url: string;
  source_type: 'dealer' | 'auction' | 'auction_house' | 'dealer_website' | 'marketplace' | 'classifieds';
  search_query?: string;
  extract_listings?: boolean;
  extract_dealer_info?: boolean;
  use_llm_extraction?: boolean;
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

    if (!FIRECRAWL_API_KEY) {
      throw new Error('FIRECRAWL_API_KEY not configured');
    }

    const body: ScrapeRequest = await req.json();
    const { 
      source_url, 
      source_type = 'dealer',
      search_query,
      extract_listings = true,
      extract_dealer_info = true,
      use_llm_extraction = true,
      max_listings = 100,
      max_results,
      organization_id,
      start_offset = 0
    } = body;
    
    const maxListingsToProcess = max_results || max_listings || 100;
    const startOffset = Number.isFinite(start_offset) ? Math.max(0, Math.floor(start_offset)) : 0;

    console.log(`Scraping ${source_url} (${source_type})`);

    const isLartIndex =
      source_url.includes('lartdelautomobile.com/voitures-a-vendre') ||
      source_url.includes('lartdelautomobile.com/voitures-vendues');

    // Step 1: Scrape with Firecrawl STRUCTURED EXTRACTION (AGGRESSIVE)
    console.log('🔥 Using Firecrawl structured extraction for inventory...');
    
    const isAuctionHouse = source_type === 'auction' || source_type === 'auction_house';
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

    if (isLartIndex) {
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
      try {
        const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${FIRECRAWL_API_KEY}`
          },
          body: JSON.stringify({
            url: source_url,
            formats: ['markdown', 'html', 'extract'],
            extract: {
              schema: extractionSchema
            },
            onlyMainContent: false,
            waitFor: 4000 // More time for JS-heavy dealer sites
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
            console.warn(`⚠️ Firecrawl returned success=false: ${JSON.stringify(firecrawlData.error || firecrawlData).slice(0, 300)}`);
          }
        } else {
          const errorText = await firecrawlResponse.text();
          console.warn(`⚠️ Firecrawl error ${firecrawlResponse.status}: ${errorText.slice(0, 200)}`);
        }
      } catch (e: any) {
        console.warn(`⚠️ Firecrawl request failed: ${e?.message || e}`);
      }
    }

    if (!html) {
      console.log('📡 Falling back to direct fetch for HTML...');
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
      console.log('✅ Firecrawl structured extraction successful');
      dealerInfo = extract.dealer_info || null;
      listings = extract.listings || [];
      console.log(`Firecrawl extracted: dealer=${!!dealerInfo}, listings=${listings.length}`);
      
      // Handle pagination if next_page_url exists
      if (extract.next_page_url && listings.length > 0) {
        console.log(`📄 Pagination detected: ${extract.next_page_url}`);
        // Note: Could recursively scrape next pages here if needed
      }
    }

    // Step 3: LLM Extraction fallback if Firecrawl extract failed
    const allowLlmExtraction = !isLartIndex && use_llm_extraction && OPENAI_API_KEY;
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
      console.log('⚠️ No listings found, attempting Firecrawl with deeper extraction...');
      
      // Try scraping with actions to interact with page (if needed)
      // For now, fallback to basic URL extraction
      const listingPatterns = [
        /href="([^"]*\/listing\/[^"]+)"/gi,
        /href="([^"]*\/vehicle\/[^"]+)"/gi,
        // L'Art de L'Automobile (and similar) uses /fiche/<slug> for vehicle detail pages.
        /href="([^"]*\/fiche\/[^"]+)"/gi,
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
          if (url.match(/\/(vehicle|listing|inventory|cars|trucks|detail|detail\.aspx|fiche)\b/i)) {
            foundUrls.add(url);
          }
        }
      }
      
      listings = Array.from(foundUrls).slice(0, maxListingsToProcess).map(url => ({
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

        const enumeratedUrls = Array.from(found);
        if (enumeratedUrls.length > listings.length) {
          console.log(`✅ URL enumeration found ${enumeratedUrls.length} /fiche/ links (overriding prior listings=${listings.length})`);
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
        console.warn(`⚠️ URL enumeration failed: ${e?.message || e}`);
      }
    }

    // Step 4: Create/update source in database
    let sourceId: string | null = null;
    const totalListingsFound = listings.length;
    // `scrape_sources.source_type` is constrained; normalize newer request types to legacy enum values.
    const scrapeSourceTypeForDb =
      source_type === 'dealer_website'
        ? 'dealer'
        : source_type;
    
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
      const { data: newSource, error: sourceError } = await supabase
        .from('scrape_sources')
        .insert({
          name: dealerInfo?.name || metadata?.title || new URL(source_url).hostname,
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
        console.warn(`⚠️  Provided organization_id ${organizationId} not found, will create new organization`);
        organizationId = null;
      } else {
        businessType = (existingOrg.type === 'auction_house' || source_type === 'auction_house') ? 'auction_house' : 'dealer';
        console.log(`✅ Using provided organization: ${existingOrg.business_name} (${businessType})`);
      }
    }
    
    // Normalize/sanitize dealer info before writing to the businesses table.
    const normalizedDealer = normalizeDealerInfo(dealerInfo);
    if (!normalizedDealer && dealerInfo && dealerInfo.name) {
      console.warn('⚠️  Dealer info extracted but failed validation; skipping business create/update to protect DB quality.');
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
        console.log(`✅ Found existing business: ${existingOrg.business_name} (${organizationId})`);
        
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
            business_type: businessType === 'auction_house' ? 'other' : 'dealership',
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
          console.log(`✅ Created new business: ${newOrg.business_name} (${organizationId})`);
        } else if (orgError) {
          console.error('Error creating business:', orgError);
        }
      }
    }

    // Step 6: Process listings - queue for import OR directly create dealer_inventory/auction records
    let queuedCount = 0;
    let duplicateCount = 0;
    let inventoryCreatedCount = 0;
    const inferredListingStatus =
      source_url.includes('/voitures-vendues') || source_url.includes('voitures-vendues')
        ? 'sold'
        : 'in_stock';

    // Stable paging for very large inventories (e.g., sold archives).
    // Sort by URL so `start_offset` is deterministic across runs.
    const sortedListings = [...listings]
      .filter((l: any) => !!l?.url)
      .sort((a: any, b: any) => (a.url || '').localeCompare(b.url || ''));
    const listingsToProcess = sortedListings.slice(startOffset, startOffset + maxListingsToProcess);

    // If we have an organization_id and this is dealer inventory, we can create dealer_inventory records
    // For auction houses, we'll still queue since they need auction_events/auction_lots structure
    const shouldCreateInventoryDirectly = organizationId && businessType === 'dealer' && listings.length > 0;
    
    if (shouldCreateInventoryDirectly) {
      console.log(`📦 Creating dealer_inventory records directly for organization ${organizationId}...`);
      
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
          listing_status: inferredListingStatus,
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
      
      console.log(`✅ Queued ${queuedCount} listings for vehicle creation (will auto-link to dealer_inventory via process-import-queue)`);
    } else if (organizationId && businessType === 'auction_house') {
      // For auction houses, we need to structure as auction events/lots
      // This will be handled separately since auction structure is more complex
      console.log(`🏛️  Auction house detected - listings will be processed as auction events/lots`);
      
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
          listing_status: inferredListingStatus,
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

