/**
 * CRAWL BAT ACTIVE AUCTIONS
 *
 * Discovers all active BaT auctions and queues them for extraction.
 * Sources:
 * 1. RSS feed (new listings)
 * 2. Firecrawl map (all discoverable links)
 * 3. Existing active listings (re-sync)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

// ============================================================================
// URL DISCOVERY
// ============================================================================

async function getListingsFromRss(): Promise<string[]> {
  console.log('[bat-crawl] Fetching RSS feeds (paginated)...');
  const allUrls: string[] = [];

  try {
    // Paginate through auctions feed - BaT has ~400 active auctions typically
    for (let page = 1; page <= 30; page++) {
      const response = await fetch(`https://bringatrailer.com/auctions/feed/?paged=${page}`, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        console.log(`[bat-crawl] RSS page ${page} returned ${response.status}, stopping pagination`);
        break;
      }

      const xml = await response.text();
      const urls = [...xml.matchAll(/<link>(https:\/\/bringatrailer\.com\/listing\/[^<]+)<\/link>/g)]
        .map(m => m[1])
        .filter(url => !url.includes('sign-') && !url.includes('memorabilia-'));

      if (urls.length === 0) {
        console.log(`[bat-crawl] RSS page ${page} empty, stopping pagination`);
        break;
      }

      allUrls.push(...urls);
      console.log(`[bat-crawl] RSS page ${page}: ${urls.length} listings (total: ${allUrls.length})`);

      // Small delay between pages
      await new Promise(r => setTimeout(r, 200));
    }

    // Also get main feed for newest listings
    const mainFeed = await fetch('https://bringatrailer.com/feed/', {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(15000),
    });

    if (mainFeed.ok) {
      const xml = await mainFeed.text();
      const urls = [...xml.matchAll(/<link>(https:\/\/bringatrailer\.com\/listing\/[^<]+)<\/link>/g)]
        .map(m => m[1])
        .filter(url => !url.includes('sign-') && !url.includes('memorabilia-'));
      allUrls.push(...urls);
    }

    const unique = [...new Set(allUrls)];
    console.log(`[bat-crawl] Found ${unique.length} unique listings from RSS feeds`);
    return unique;
  } catch (err: any) {
    console.error('[bat-crawl] RSS error:', err.message);
    return [...new Set(allUrls)];
  }
}

async function getListingsFromFirecrawlMap(): Promise<string[]> {
  const apiKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (!apiKey) {
    console.log('[bat-crawl] No Firecrawl API key, skipping map');
    return [];
  }

  console.log('[bat-crawl] Running Firecrawl map...');
  try {
    const response = await fetch('https://api.firecrawl.dev/v1/map', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: 'https://bringatrailer.com/auctions/',
        limit: 1000,
      }),
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      console.error('[bat-crawl] Firecrawl map failed:', response.status);
      return [];
    }

    const data = await response.json();
    const urls = (data.links || [])
      .filter((url: string) => url.includes('/listing/') && !url.includes('sign-'));

    console.log(`[bat-crawl] Found ${urls.length} listings via Firecrawl map`);
    return urls;
  } catch (err: any) {
    console.error('[bat-crawl] Firecrawl map error:', err.message);
    return [];
  }
}

async function getListingsFromSitemap(): Promise<string[]> {
  console.log('[bat-crawl] Checking sitemap...');
  try {
    // BaT has multiple sitemaps
    const sitemapUrls = [
      'https://bringatrailer.com/sitemap_index.xml',
      'https://bringatrailer.com/post-sitemap.xml',
      'https://bringatrailer.com/listing-sitemap.xml',
    ];

    const allUrls: string[] = [];

    for (const sitemapUrl of sitemapUrls) {
      try {
        const response = await fetch(sitemapUrl, {
          headers: BROWSER_HEADERS,
          signal: AbortSignal.timeout(15000),
        });

        if (response.ok) {
          const xml = await response.text();
          const urls = [...xml.matchAll(/<loc>(https:\/\/bringatrailer\.com\/listing\/[^<]+)<\/loc>/g)]
            .map(m => m[1]);
          allUrls.push(...urls);
        }
      } catch {
        // Continue to next sitemap
      }
    }

    console.log(`[bat-crawl] Found ${allUrls.length} listings in sitemaps`);
    return allUrls;
  } catch (err: any) {
    console.error('[bat-crawl] Sitemap error:', err.message);
    return [];
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const body = await req.json().catch(() => ({}));
    const {
      extract = true,        // Also run extraction
      max_extractions = 200, // Limit concurrent extractions
      skip_known = true,     // Skip URLs already in external_listings
    } = body;

    // Collect URLs from all sources in parallel
    const [rssUrls, mapUrls, sitemapUrls] = await Promise.all([
      getListingsFromRss(),
      getListingsFromFirecrawlMap(),
      getListingsFromSitemap(),
    ]);

    // Deduplicate and normalize
    const allUrls = [...new Set([...rssUrls, ...mapUrls, ...sitemapUrls])]
      .map(url => url.replace(/\/$/, '').toLowerCase())
      .filter(url => url.includes('/listing/'));

    console.log(`[bat-crawl] Total unique listing URLs: ${allUrls.length}`);

    // Get existing listings to skip
    let urlsToProcess = allUrls;
    if (skip_known && allUrls.length > 0) {
      const { data: existing } = await supabase
        .from('external_listings')
        .select('listing_url')
        .eq('platform', 'bat')
        .in('listing_url', allUrls.slice(0, 1000)); // Supabase IN limit

      const existingUrls = new Set((existing || []).map((e: any) => e.listing_url.toLowerCase()));
      urlsToProcess = allUrls.filter(url => !existingUrls.has(url));
      console.log(`[bat-crawl] New URLs to process: ${urlsToProcess.length}`);
    }

    // Queue for extraction
    let extracted = 0;
    let errors: string[] = [];

    if (extract && urlsToProcess.length > 0) {
      const toExtract = urlsToProcess.slice(0, max_extractions);
      console.log(`[bat-crawl] Extracting ${toExtract.length} listings...`);

      // Process in batches of 10 for parallelism
      const batchSize = 10;
      for (let i = 0; i < toExtract.length; i += batchSize) {
        const batch = toExtract.slice(i, i + batchSize);

        const results = await Promise.allSettled(
          batch.map(async (url) => {
            const response = await fetch(
              `${Deno.env.get('SUPABASE_URL')}/functions/v1/bat-simple-extract`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ url, save_to_db: true }),
                signal: AbortSignal.timeout(60000),
              }
            );

            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            if (!data.success) {
              throw new Error(data.error || 'Unknown error');
            }

            return { url, success: true };
          })
        );

        for (const result of results) {
          if (result.status === 'fulfilled') {
            extracted++;
          } else {
            errors.push(result.reason?.message || 'Unknown error');
          }
        }

        // Small delay between batches
        if (i + batchSize < toExtract.length) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000);

    return new Response(JSON.stringify({
      success: true,
      discovered: {
        rss: rssUrls.length,
        firecrawl_map: mapUrls.length,
        sitemap: sitemapUrls.length,
        total_unique: allUrls.length,
        new_urls: urlsToProcess.length,
      },
      extraction: {
        attempted: extract ? Math.min(urlsToProcess.length, max_extractions) : 0,
        succeeded: extracted,
        failed: errors.length,
        errors: errors.slice(0, 10), // First 10 errors
      },
      duration_seconds: duration,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[bat-crawl] Fatal error:', error);
    return new Response(JSON.stringify({
      error: error.message,
      duration_seconds: Math.round((Date.now() - startTime) / 1000),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
