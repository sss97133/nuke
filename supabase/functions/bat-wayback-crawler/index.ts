/**
 * BaT Wayback Machine Crawler
 *
 * Discovers BaT listing URLs from Internet Archive's Wayback Machine (FREE!)
 * The CDX API provides access to all archived URLs.
 *
 * Strategy:
 * 1. Query Wayback CDX API for all bringatrailer.com/listing/* URLs
 * 2. Deduplicate and filter for valid listing slugs
 * 3. Queue URLs for extraction
 *
 * This is completely free and can discover 100k+ URLs!
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CrawlState {
  last_resume_key: string | null;
  total_discovered: number;
  total_queued: number;
  pages_crawled: number;
  last_run: string;
}

// CDX API returns max 10k results per page, need to paginate with resumeKey
const CDX_PAGE_SIZE = 10000;

async function fetchWaybackPage(resumeKey: string | null): Promise<{
  urls: string[];
  nextResumeKey: string | null;
  total: number;
}> {
  const params = new URLSearchParams({
    url: 'bringatrailer.com/listing/*',
    matchType: 'prefix',
    output: 'json',
    fl: 'original,statuscode',
    filter: 'statuscode:200',  // Only successful responses
    collapse: 'urlkey',  // Deduplicate by URL
    limit: CDX_PAGE_SIZE.toString(),
  });

  if (resumeKey) {
    params.set('resumeKey', resumeKey);
  }

  const cdxUrl = `https://web.archive.org/cdx/search/cdx?${params.toString()}`;
  console.log(`[bat-wayback] Fetching: ${cdxUrl.slice(0, 100)}...`);

  const response = await fetch(cdxUrl, {
    headers: {
      'User-Agent': 'NukeVehicleExtractor/1.0 (research; contact@example.com)',
    },
  });

  if (!response.ok) {
    throw new Error(`CDX API returned ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();

  // First row is header
  const header = data[0];
  const rows = data.slice(1);

  // Extract URLs
  const urls: string[] = [];
  for (const row of rows) {
    const original = row[0];  // original URL
    if (original && original.includes('/listing/')) {
      // Normalize URL
      const clean = original
        .split('?')[0]
        .split('#')[0]
        .replace(/\/$/, '')
        .replace(/^http:/, 'https:');

      // Filter out invalid patterns
      if (
        clean.includes('/listing/') &&
        !clean.includes('/feed') &&
        !clean.includes('/javascript') &&
        !clean.includes('/page/') &&
        !clean.endsWith('/listing') &&
        !clean.match(/\/listing\/\d+$/) // Just numeric IDs are invalid
      ) {
        urls.push(clean + '/');  // Normalize to trailing slash
      }
    }
  }

  // Get resume key from response headers (Wayback CDX uses this for pagination)
  const nextResumeKey = response.headers.get('x-cdx-resumekey');

  return {
    urls: [...new Set(urls)],  // Dedupe within page
    nextResumeKey: rows.length >= CDX_PAGE_SIZE ? nextResumeKey : null,
    total: rows.length,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const {
      action = 'crawl',
      pages_per_run = 5,  // Each page is 10k URLs
      reset = false,
    } = await req.json().catch(() => ({}));

    // Get or create crawl state
    let { data: stateRow } = await supabase
      .from('system_state')
      .select('value')
      .eq('key', 'bat_wayback_crawl')
      .single();

    let crawlState: CrawlState = stateRow?.value || {
      last_resume_key: null,
      total_discovered: 0,
      total_queued: 0,
      pages_crawled: 0,
      last_run: new Date().toISOString(),
    };

    if (reset) {
      crawlState = {
        last_resume_key: null,
        total_discovered: 0,
        total_queued: 0,
        pages_crawled: 0,
        last_run: new Date().toISOString(),
      };
    }

    if (action === 'status') {
      return new Response(JSON.stringify({
        success: true,
        state: crawlState,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get existing URLs
    console.log('[bat-wayback] Loading existing URLs...');
    const { data: existingVehicles } = await supabase
      .from('vehicles')
      .select('bat_auction_url, discovery_url')
      .or('bat_auction_url.not.is.null,discovery_url.ilike.%bringatrailer%');

    const existingSet = new Set<string>();
    for (const v of existingVehicles || []) {
      if (v.bat_auction_url) existingSet.add(v.bat_auction_url);
      if (v.discovery_url) existingSet.add(v.discovery_url);
    }

    // Check import_queue too
    const { data: queuedUrls } = await supabase
      .from('import_queue')
      .select('url')
      .ilike('url', '%bringatrailer%');

    for (const q of queuedUrls || []) {
      existingSet.add(q.url);
    }

    console.log(`[bat-wayback] ${existingSet.size} URLs already known`);

    const results = {
      pages_crawled: 0,
      urls_discovered: 0,
      urls_queued: 0,
      urls_skipped: 0,
      errors: [] as string[],
      complete: false,
    };

    let resumeKey = crawlState.last_resume_key;

    // Crawl pages
    for (let i = 0; i < pages_per_run; i++) {
      try {
        const page = await fetchWaybackPage(resumeKey);

        results.urls_discovered += page.urls.length;
        results.pages_crawled++;

        // Filter new URLs
        const newUrls = page.urls.filter(url => !existingSet.has(url));
        results.urls_skipped += page.urls.length - newUrls.length;

        console.log(`[bat-wayback] Page ${i + 1}: ${page.urls.length} URLs, ${newUrls.length} new`);

        // Queue new URLs in batches
        if (newUrls.length > 0) {
          const queueRecords = newUrls.map(url => ({
            url,
            source: 'bat_wayback_crawler',
            status: 'pending',
            priority: 2,  // Medium priority for historical backfill
            metadata: {
              discovered_via: 'wayback_machine',
              discovered_at: new Date().toISOString(),
            },
          }));

          // Insert in batches of 1000
          for (let j = 0; j < queueRecords.length; j += 1000) {
            const batch = queueRecords.slice(j, j + 1000);
            const { error: insertError } = await supabase
              .from('import_queue')
              .upsert(batch, { onConflict: 'url', ignoreDuplicates: true });

            if (insertError) {
              results.errors.push(`Batch insert: ${insertError.message}`);
            } else {
              results.urls_queued += batch.length;
              // Add to existing set to avoid re-processing
              batch.forEach(r => existingSet.add(r.url));
            }
          }
        }

        resumeKey = page.nextResumeKey;

        if (!resumeKey) {
          results.complete = true;
          console.log('[bat-wayback] Reached end of CDX results');
          break;
        }

        // Rate limit - be nice to Wayback Machine
        await new Promise(r => setTimeout(r, 1000));

      } catch (pageError: any) {
        results.errors.push(`Page ${i + 1}: ${pageError.message}`);
        console.error(`[bat-wayback] Page error:`, pageError.message);
        break;  // Stop on error to avoid hammering the API
      }
    }

    // Update state
    crawlState.last_resume_key = resumeKey;
    crawlState.total_discovered += results.urls_discovered;
    crawlState.total_queued += results.urls_queued;
    crawlState.pages_crawled += results.pages_crawled;
    crawlState.last_run = new Date().toISOString();

    await supabase.from('system_state').upsert({
      key: 'bat_wayback_crawl',
      value: crawlState,
      updated_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({
      success: true,
      ...results,
      state: crawlState,
      next_action: results.complete ? 'complete' : 'continue',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('[bat-wayback] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
