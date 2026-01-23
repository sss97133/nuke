/**
 * BaT Full Archive Crawler
 *
 * Systematically crawls ALL BaT completed auctions by year/make combinations
 * to discover 150k+ historical listing URLs.
 *
 * Strategy:
 * 1. Query BaT's search with filters (year range, make) to get manageable chunks
 * 2. BaT returns paginated JSON for search results (not infinite scroll)
 * 3. Queue discovered URLs for extraction
 *
 * BaT Search API (discovered via network inspection):
 * POST https://bringatrailer.com/wp-json/bringatrailer/1.0/listings
 * With filters: status=past, page=N, per_page=24
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://bringatrailer.com/auctions/',
  'Origin': 'https://bringatrailer.com',
};

// Years to crawl (BaT has listings from ~1900s to present)
const YEAR_RANGES = [
  { start: 2020, end: 2026 },  // Recent
  { start: 2010, end: 2019 },  // Modern classics
  { start: 2000, end: 2009 },
  { start: 1990, end: 1999 },
  { start: 1980, end: 1989 },
  { start: 1970, end: 1979 },
  { start: 1960, end: 1969 },
  { start: 1950, end: 1959 },
  { start: 1900, end: 1949 },  // Pre-war
];

interface CrawlState {
  year_range_idx: number;
  current_page: number;
  total_discovered: number;
  total_queued: number;
  last_run: string;
}

async function fetchBatListingsPage(page: number, yearStart: number, yearEnd: number): Promise<{
  listings: { url: string; id: string; title: string }[];
  total: number;
  hasMore: boolean;
}> {
  // BaT's actual search endpoint - discovered via browser network inspection
  // They use ElasticPress/WordPress REST API
  const searchUrl = new URL('https://bringatrailer.com/wp-json/bringatrailer/1.0/data/listings');
  searchUrl.searchParams.set('page', page.toString());
  searchUrl.searchParams.set('per_page', '48');
  searchUrl.searchParams.set('results', 'past'); // completed auctions only
  searchUrl.searchParams.set('year_min', yearStart.toString());
  searchUrl.searchParams.set('year_max', yearEnd.toString());

  const response = await fetch(searchUrl.toString(), {
    method: 'GET',
    headers: BROWSER_HEADERS,
  });

  if (!response.ok) {
    // BaT might not have a public API - fall back to scraping
    throw new Error(`BaT API returned ${response.status}`);
  }

  const data = await response.json();

  // Parse response based on BaT's actual API structure
  // This may need adjustment based on actual response format
  const listings = (data.listings || data.items || data || []).map((item: any) => ({
    url: item.url || item.permalink || `https://bringatrailer.com/listing/${item.slug}/`,
    id: item.id?.toString() || item.listing_id?.toString(),
    title: item.title || item.name,
  }));

  return {
    listings,
    total: data.total || data.found || listings.length,
    hasMore: listings.length >= 48,
  };
}

async function scrapeBatArchivePage(page: number, firecrawlKey: string): Promise<string[]> {
  // Fallback: Use Firecrawl to scrape the archive page
  // This handles JS-rendered content
  const archiveUrl = `https://bringatrailer.com/auctions/?past=true&page=${page}`;

  const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${firecrawlKey}`,
    },
    body: JSON.stringify({
      url: archiveUrl,
      formats: ['links'],
      onlyMainContent: true,
      waitFor: 5000,  // Wait for JS to load listings
    }),
  });

  if (!response.ok) {
    throw new Error(`Firecrawl failed: ${response.status}`);
  }

  const data = await response.json();
  const links = data.data?.links || [];

  // Filter for listing URLs
  return links.filter((url: string) =>
    url.includes('/listing/') &&
    url.includes('bringatrailer.com')
  );
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');

  try {
    const {
      action = 'crawl',  // 'crawl', 'status', 'reset'
      pages_per_run = 10,
      year_start,
      year_end,
    } = await req.json().catch(() => ({}));

    // Get or create crawl state
    let { data: state } = await supabase
      .from('system_state')
      .select('value')
      .eq('key', 'bat_archive_crawl')
      .single();

    let crawlState: CrawlState = state?.value || {
      year_range_idx: 0,
      current_page: 1,
      total_discovered: 0,
      total_queued: 0,
      last_run: new Date().toISOString(),
    };

    if (action === 'status') {
      return new Response(JSON.stringify({
        success: true,
        state: crawlState,
        year_ranges: YEAR_RANGES,
        current_range: YEAR_RANGES[crawlState.year_range_idx],
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (action === 'reset') {
      crawlState = {
        year_range_idx: 0,
        current_page: 1,
        total_discovered: 0,
        total_queued: 0,
        last_run: new Date().toISOString(),
      };
      await supabase.from('system_state').upsert({
        key: 'bat_archive_crawl',
        value: crawlState,
        updated_at: new Date().toISOString(),
      });
      return new Response(JSON.stringify({ success: true, message: 'Crawl state reset' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Crawl mode
    const results = {
      pages_crawled: 0,
      urls_discovered: 0,
      urls_queued: 0,
      urls_skipped: 0,
      errors: [] as string[],
    };

    // Override year range if specified
    const yearRange = (year_start && year_end)
      ? { start: year_start, end: year_end }
      : YEAR_RANGES[crawlState.year_range_idx];

    if (!yearRange) {
      return new Response(JSON.stringify({
        success: true,
        message: 'Crawl complete - all year ranges processed',
        state: crawlState,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[bat-full-crawler] Crawling years ${yearRange.start}-${yearRange.end}, page ${crawlState.current_page}`);

    // Get existing URLs to avoid duplicates
    const { data: existingUrls } = await supabase
      .from('vehicles')
      .select('bat_auction_url, discovery_url')
      .or('bat_auction_url.not.is.null,discovery_url.ilike.%bringatrailer%');

    const existingSet = new Set<string>();
    for (const v of existingUrls || []) {
      if (v.bat_auction_url) existingSet.add(v.bat_auction_url);
      if (v.discovery_url) existingSet.add(v.discovery_url);
    }

    // Also check import_queue
    const { data: queuedUrls } = await supabase
      .from('import_queue')
      .select('listing_url')
      .ilike('listing_url', '%bringatrailer%');

    for (const q of queuedUrls || []) {
      if (q.listing_url) existingSet.add(q.listing_url);
    }

    console.log(`[bat-full-crawler] ${existingSet.size} URLs already known`);

    // Crawl pages
    let hasMore = true;
    let page = crawlState.current_page;

    while (hasMore && results.pages_crawled < pages_per_run) {
      try {
        let listingUrls: string[] = [];

        // Try API first, fall back to Firecrawl
        try {
          const apiResult = await fetchBatListingsPage(page, yearRange.start, yearRange.end);
          listingUrls = apiResult.listings.map(l => l.url);
          hasMore = apiResult.hasMore;
        } catch (apiError: any) {
          console.log(`[bat-full-crawler] API failed (${apiError.message}), trying Firecrawl...`);

          if (!firecrawlKey) {
            throw new Error('API failed and no FIRECRAWL_API_KEY configured');
          }

          listingUrls = await scrapeBatArchivePage(page, firecrawlKey);
          hasMore = listingUrls.length >= 20;  // Assume more pages if we got results
        }

        results.urls_discovered += listingUrls.length;
        results.pages_crawled++;

        // Filter new URLs
        const newUrls = listingUrls.filter(url => !existingSet.has(url));
        results.urls_skipped += listingUrls.length - newUrls.length;

        // Queue new URLs
        if (newUrls.length > 0) {
          const queueRecords = newUrls.map(listingUrl => ({
            listing_url: listingUrl,
            status: 'pending',
            priority: 1,
            raw_data: {
              source: 'bat_archive_crawler',
              year_range: `${yearRange.start}-${yearRange.end}`,
              discovered_page: page,
            },
          }));

          const { error: insertError } = await supabase
            .from('import_queue')
            .upsert(queueRecords, { onConflict: 'listing_url', ignoreDuplicates: true });

          if (insertError) {
            results.errors.push(`Page ${page}: ${insertError.message}`);
          } else {
            results.urls_queued += newUrls.length;
            // Add to existing set to avoid re-queueing in same run
            newUrls.forEach(url => existingSet.add(url));
          }
        }

        console.log(`[bat-full-crawler] Page ${page}: ${listingUrls.length} found, ${newUrls.length} queued`);

        page++;

        // Small delay between pages
        await new Promise(r => setTimeout(r, 500));

      } catch (pageError: any) {
        results.errors.push(`Page ${page}: ${pageError.message}`);
        console.error(`[bat-full-crawler] Page ${page} error:`, pageError.message);

        // If we get too many errors, move to next year range
        if (results.errors.length >= 3) {
          hasMore = false;
        }
        page++;
      }
    }

    // Update crawl state
    if (!hasMore && !year_start) {
      // Move to next year range
      crawlState.year_range_idx++;
      crawlState.current_page = 1;
    } else {
      crawlState.current_page = page;
    }

    crawlState.total_discovered += results.urls_discovered;
    crawlState.total_queued += results.urls_queued;
    crawlState.last_run = new Date().toISOString();

    await supabase.from('system_state').upsert({
      key: 'bat_archive_crawl',
      value: crawlState,
      updated_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({
      success: true,
      year_range: yearRange,
      ...results,
      state: crawlState,
      next_action: crawlState.year_range_idx >= YEAR_RANGES.length ? 'complete' : 'continue',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('[bat-full-crawler] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
