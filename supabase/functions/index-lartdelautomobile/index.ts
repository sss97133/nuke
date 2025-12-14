import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type ListingStatus = 'in_stock' | 'sold';

type ExtractListing = {
  title?: string | null;
  url?: string | null;
  price?: number | null;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  mileage?: number | null;
  thumbnail_url?: string | null;
};

function safeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return s ? s : null;
}

function normalizeUrlToOrigin(raw: string): string {
  const url = new URL(raw);
  return url.origin.replace(/\/$/, '');
}

function withTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function absolutizeUrl(href: string, baseUrl: string): string | null {
  const h = href.trim();
  if (!h) return null;
  if (h.startsWith('mailto:') || h.startsWith('tel:') || h.startsWith('javascript:')) return null;
  try {
    return new URL(h, baseUrl).href;
  } catch {
    return null;
  }
}

function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function extractLinksFromHtml(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  const re = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const abs = absolutizeUrl(m[1] || '', baseUrl);
    if (!abs) continue;
    out.push(abs);
  }
  return uniq(out);
}

function pickSectionUrl(links: string[], baseOrigin: string, slug: string): string | null {
  // Prefer same-origin and containing the slug.
  const sameOrigin = links.filter((u) => {
    try {
      return new URL(u).origin === baseOrigin;
    } catch {
      return false;
    }
  });
  const candidates = sameOrigin.filter((u) => u.toLowerCase().includes(slug.toLowerCase()));
  if (candidates.length === 0) return null;
  // Prefer shortest path (usually the index page).
  candidates.sort((a, b) => a.length - b.length);
  return candidates[0];
}

async function firecrawlScrape(url: string, schema?: any): Promise<{ html: string; extract: any | null }> {
  const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (!firecrawlApiKey) {
    throw new Error('FIRECRAWL_API_KEY not configured');
  }

  const body: any = {
    url,
    formats: schema ? ['html', 'extract'] : ['html'],
    onlyMainContent: false,
    waitFor: 2500,
  };
  if (schema) {
    body.extract = { schema };
  }

  const resp = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${firecrawlApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Firecrawl scrape failed (${resp.status}): ${text.slice(0, 200)}`);
  }

  const json = await resp.json();
  if (!json?.success) {
    throw new Error(`Firecrawl scrape failed: ${JSON.stringify(json)?.slice(0, 300)}`);
  }

  return {
    html: String(json.data?.html || ''),
    extract: json.data?.extract || null,
  };
}

async function fetchHtml(url: string): Promise<string> {
  const resp = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTML fetch failed (${resp.status}): ${text.slice(0, 120)}`);
  }
  return await resp.text();
}

function extractNextPageUrlFromHtml(html: string, baseUrl: string): string | null {
  // Best-effort. Site may not paginate; return null in that case.
  const relNext = /<a\b[^>]*\brel=["']next["'][^>]*\bhref=["']([^"']+)["'][^>]*>/i.exec(html);
  const clsNext = /<a\b[^>]*\bclass=["'][^"']*\bnext\b[^"']*["'][^>]*\bhref=["']([^"']+)["'][^>]*>/i.exec(html);
  const href = (relNext?.[1] || clsNext?.[1] || '').trim();
  if (!href) return null;
  return absolutizeUrl(href, baseUrl);
}

function extractDetailUrlsFromIndex(indexUrl: string, html: string): string[] {
  const base = withTrailingSlash(indexUrl);
  const links = extractLinksFromHtml(html, indexUrl);
  // Keep only links under the index section path and exclude the index itself.
  const urls = links.filter((u) => {
    if (!u.startsWith(base)) return false;
    if (u === base || u === indexUrl) return false;
    try {
      const parsed = new URL(u);
      if (parsed.search) return false;
      if (parsed.hash) return false;
      // Must have at least one extra path segment beyond the index path.
      const basePath = new URL(base).pathname.split('/').filter(Boolean);
      const path = parsed.pathname.split('/').filter(Boolean);
      return path.length > basePath.length;
    } catch {
      return false;
    }
  });
  return uniq(urls);
}

function extractFicheUrls(html: string, baseUrl: string): string[] {
  // L'Art lists vehicles on /voitures-a-vendre and /voitures-vendues but the detail pages live at /fiche/<slug>.
  // We must collect /fiche/ links regardless of the section path.
  const found = new Set<string>();
  const re = /<a\b[^>]*\bhref=["']([^"']*\/fiche\/[^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const abs = absolutizeUrl(m[1] || '', baseUrl);
    if (!abs) continue;
    try {
      const u = new URL(abs);
      if (!u.pathname.includes('/fiche/')) continue;
      // Drop query/hash
      u.search = '';
      u.hash = '';
      found.add(u.href);
    } catch {
      // ignore
    }
  }
  return Array.from(found);
}

function normalizeExtractListings(extract: any): ExtractListing[] {
  if (!extract || typeof extract !== 'object') return [];
  const listings = (extract.listings || extract.vehicles || null) as any;
  if (!Array.isArray(listings)) return [];
  return listings
    .map((l: any) => ({
      title: safeString(l?.title),
      url: safeString(l?.url),
      price: typeof l?.price === 'number' ? l.price : null,
      year: typeof l?.year === 'number' ? l.year : null,
      make: safeString(l?.make),
      model: safeString(l?.model),
      mileage: typeof l?.mileage === 'number' ? l.mileage : null,
      thumbnail_url: safeString(l?.thumbnail_url),
    }))
    .filter((l) => !!l.url);
}

async function ensureBusinessForDealer(supabase: any, baseOrigin: string, dealer: {
  business_name: string;
  website: string;
  phone?: string | null;
  city?: string | null;
  country?: string | null;
  description?: string | null;
  logo_url?: string | null;
  inventory_url?: string | null;
  sold_url?: string | null;
}): Promise<{ id: string; business_name: string }> {
  const { data: existing } = await supabase
    .from('businesses')
    .select('id, business_name, website')
    .eq('website', baseOrigin)
    .maybeSingle();

  if (existing?.id) {
    // Best-effort enrich (only fill blanks).
    const updates: any = {};
    if (dealer.logo_url && !existing.logo_url) updates.logo_url = dealer.logo_url;
    if (dealer.phone) updates.phone = dealer.phone;
    if (dealer.city) updates.city = dealer.city;
    if (dealer.country) updates.country = dealer.country;
    if (dealer.description) updates.description = dealer.description;
    updates.metadata = {
      ...(existing.metadata || {}),
      dealer_site: baseOrigin,
      inventory_url: dealer.inventory_url || null,
      sold_url: dealer.sold_url || null,
      auto_indexed: true,
    };

    try {
      await supabase.from('businesses').update(updates).eq('id', existing.id);
    } catch {
      // swallow enrichment failures
    }

    return { id: existing.id, business_name: existing.business_name };
  }

  const insertRow: any = {
    business_name: dealer.business_name,
    business_type: 'dealership',
    website: baseOrigin,
    phone: dealer.phone || null,
    city: dealer.city || null,
    country: dealer.country || 'FR',
    description: dealer.description || null,
    logo_url: dealer.logo_url || null,
    is_public: true,
    is_verified: false,
    status: 'active',
    metadata: {
      dealer_site: baseOrigin,
      inventory_url: dealer.inventory_url || null,
      sold_url: dealer.sold_url || null,
      auto_indexed: true,
    },
  };

  const { data: created, error } = await supabase
    .from('businesses')
    .insert(insertRow)
    .select('id, business_name')
    .single();

  if (error) throw new Error(`Failed to create businesses row: ${error.message}`);
  return { id: created.id, business_name: created.business_name };
}

async function ensureScrapeSourceId(supabase: any, url: string, name: string, source_type: string): Promise<string | null> {
  try {
    const { data: existing } = await supabase
      .from('scrape_sources')
      .select('id')
      .eq('url', url)
      .maybeSingle();
    if (existing?.id) return existing.id;

    const { data: created } = await supabase
      .from('scrape_sources')
      .insert({
        name,
        url,
        source_type,
        inventory_url: url,
        last_scraped_at: new Date().toISOString(),
        last_successful_scrape: new Date().toISOString(),
      })
      .select('id')
      .single();

    return created?.id || null;
  } catch {
    return null;
  }
}

async function queueListings(params: {
  supabase: any;
  sourceId: string | null;
  organizationId: string;
  indexUrl: string;
  status: ListingStatus;
  listings: ExtractListing[];
  discoveredUrlsFallback: string[];
  maxListings: number;
}): Promise<{ queued: number; updated: number; duplicates: number }> {
  const allUrls = new Map<string, ExtractListing>();
  for (const l of params.listings) {
    if (!l.url) continue;
    allUrls.set(l.url, l);
  }
  for (const u of params.discoveredUrlsFallback) {
    if (!u) continue;
    if (!allUrls.has(u)) allUrls.set(u, { url: u });
  }

  const urls = Array.from(allUrls.values()).slice(0, params.maxListings);
  let queued = 0;
  let updated = 0;
  let duplicates = 0;

  const rows: any[] = [];
  for (const listing of urls) {
    const listingUrl = listing.url ? listing.url : null;
    if (!listingUrl) continue;
    rows.push({
      source_id: params.sourceId,
      listing_url: listingUrl,
      listing_title: listing.title || null,
      listing_price: listing.price || null,
      listing_year: listing.year || null,
      listing_make: listing.make || null,
      listing_model: listing.model || null,
      thumbnail_url: listing.thumbnail_url || null,
      raw_data: {
        ...listing,
        source_index_url: params.indexUrl,
        organization_id: params.organizationId,
        business_type: 'dealer',
        inventory_extraction: true,
        listing_status: params.status,
      },
      priority: 0,
    });
  }

  const BATCH_SIZE = 75;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    // Step 1: insert new rows only (ignore duplicates)
    const { error: insErr } = await params.supabase
      .from('import_queue')
      .upsert(batch, { onConflict: 'listing_url', ignoreDuplicates: true });

    if (insErr) {
      // If a batch fails (network, etc), fall back to per-row inserts to salvage progress.
      for (const row of batch) {
        const { error: rowErr } = await params.supabase.from('import_queue').insert(row);
        if (rowErr) {
          if (rowErr.code === '23505') duplicates++;
        } else {
          queued++;
        }
      }
    } else {
      // NOTE: ignoreDuplicates makes it impossible to know exact inserts; we’ll compute updates below.
      // Count "attempted inserts" as queued best-effort (legacy behavior).
      queued += batch.length;
    }

    // Step 2: backfill existing rows (raw_data is missing in many legacy L'Art queues).
    try {
      const listingUrls = batch.map((r: any) => r.listing_url).filter(Boolean);
      if (listingUrls.length > 0) {
        const { data: existingRows, error: selErr } = await params.supabase
          .from('import_queue')
          .select('id, listing_url, raw_data')
          .in('listing_url', listingUrls);
        if (!selErr && existingRows && Array.isArray(existingRows)) {
          const byUrl = new Map<string, any>();
          for (const r of batch) byUrl.set(r.listing_url, r);

          const updates: any[] = [];
          for (const ex of existingRows) {
            const desired = byUrl.get(ex.listing_url);
            if (!desired) continue;
            const existingRaw = (ex.raw_data && typeof ex.raw_data === 'object') ? ex.raw_data : {};
            const desiredRaw = (desired.raw_data && typeof desired.raw_data === 'object') ? desired.raw_data : {};
            const nextRaw = { ...existingRaw, ...desiredRaw };

            // Only update if we are actually adding signal.
            const hasInv = (existingRaw as any).inventory_extraction === true || (existingRaw as any).inventory_extraction === 'true';
            const hasStatus = typeof (existingRaw as any).listing_status === 'string' && (existingRaw as any).listing_status.length > 0;
            if (hasInv && hasStatus) continue;

            updates.push({ id: ex.id, raw_data: nextRaw, source_id: desired.source_id || null });
          }

          // Apply updates sequentially in small batches to avoid rate limiting.
          const U_BATCH = 25;
          for (let j = 0; j < updates.length; j += U_BATCH) {
            const chunk = updates.slice(j, j + U_BATCH);
            await Promise.all(
              chunk.map((u) =>
                params.supabase
                  .from('import_queue')
                  .update({ raw_data: u.raw_data, source_id: u.source_id })
                  .eq('id', u.id)
              )
            );
          }

          updated += updates.length;
        }
      }
    } catch {
      // non-blocking; listing ingestion should proceed even if backfill fails
    }
  }

  return { queued, updated, duplicates };
}

interface IndexRequest {
  base_url?: string;
  max_listings_per_section?: number;
  max_pages_per_section?: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    const body: IndexRequest = await req.json().catch(() => ({}));
    const baseUrlRaw = safeString(body.base_url) || 'https://www.lartdelautomobile.com/';
    const baseOrigin = normalizeUrlToOrigin(baseUrlRaw);
    const maxListingsPerSection = typeof body.max_listings_per_section === 'number' ? body.max_listings_per_section : 500;
    const maxPagesPerSection = typeof body.max_pages_per_section === 'number' ? body.max_pages_per_section : 10;

    // Step 1: fetch homepage HTML to discover inventory/sold URLs (faster + more reliable than Firecrawl here).
    const homepageHtml = await fetchHtml(baseOrigin);
    const homepageLinks = extractLinksFromHtml(homepageHtml, baseOrigin);
    const inventoryUrl =
      pickSectionUrl(homepageLinks, baseOrigin, 'voitures-a-vendre') ||
      pickSectionUrl(homepageLinks, baseOrigin, 'voitures') ||
      `${withTrailingSlash(baseOrigin)}voitures-a-vendre/`;
    const soldUrl =
      pickSectionUrl(homepageLinks, baseOrigin, 'voitures-vendues') ||
      `${withTrailingSlash(baseOrigin)}voitures-vendues/`;

    const dealerExtract = null;
    const dealerName = "L'Art de l'Automobile";

    const dealer = await ensureBusinessForDealer(supabase, baseOrigin, {
      business_name: dealerName,
      website: baseOrigin,
      phone: safeString(dealerExtract?.phone) || '+33 1 42 18 48 97',
      city: safeString(dealerExtract?.city) || 'Paris',
      country: safeString(dealerExtract?.country) || 'FR',
      description: safeString(dealerExtract?.description),
      logo_url: safeString(dealerExtract?.logo_url),
      inventory_url: inventoryUrl,
      sold_url: soldUrl,
    });

    // Step 2: fetch both sections, extract /fiche/ urls deterministically, and queue everything.
    async function scrapeSection(sectionUrl: string, status: ListingStatus): Promise<{ pages: number; queued: number; duplicates: number; discovered: number }> {
      const sourceId = await ensureScrapeSourceId(
        supabase,
        sectionUrl,
        `${dealer.business_name} (${status === 'sold' ? 'sold' : 'inventory'})`,
        'dealer_website'
      );

      let currentUrl: string | null = sectionUrl;
      let pages = 0;
      let queuedTotal = 0;
      let dupTotal = 0;
      let discoveredTotal = 0;

      // Keep track of seen page urls to avoid loops.
      const seenPages = new Set<string>();

      while (currentUrl && pages < maxPagesPerSection) {
        if (seenPages.has(currentUrl)) break;
        seenPages.add(currentUrl);

        const html = await fetchHtml(currentUrl);
        const extracted: ExtractListing[] = [];
        const discoveredUrls = extractFicheUrls(html, baseOrigin);
        discoveredTotal += discoveredUrls.length;

        const { queued, duplicates } = await queueListings({
          supabase,
          sourceId,
          organizationId: dealer.id,
          indexUrl: sectionUrl,
          status,
          listings: extracted,
          discoveredUrlsFallback: discoveredUrls,
          maxListings: maxListingsPerSection,
        });

        queuedTotal += queued;
        dupTotal += duplicates;
        pages++;

        // Pagination: best-effort parse from HTML; otherwise stop.
        currentUrl = extractNextPageUrlFromHtml(html, currentUrl);
      }

      return { pages, queued: queuedTotal, duplicates: dupTotal, discovered: discoveredTotal };
    }

    const inventoryResult = await scrapeSection(inventoryUrl, 'in_stock');
    const soldResult = await scrapeSection(soldUrl, 'sold');

    return new Response(
      JSON.stringify({
        success: true,
        base_origin: baseOrigin,
        organization_id: dealer.id,
        organization_name: dealer.business_name,
        inventory_url: inventoryUrl,
        sold_url: soldUrl,
        inventory: inventoryResult,
        sold: soldResult,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error?.message || String(error) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});


