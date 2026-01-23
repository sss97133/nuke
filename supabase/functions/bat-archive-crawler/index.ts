/**
 * BaT Archive Crawler
 *
 * Crawls bringatrailer.com/auctions/ to discover all historical listing URLs
 * Uses Firecrawl's map/crawl feature to handle JS-rendered pagination
 *
 * Strategy:
 * 1. Use Firecrawl map to discover all /listing/ URLs
 * 2. Queue URLs into import_queue for extraction
 * 3. Track progress in bat_crawl_state table
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CrawlResult {
  urls_found: number;
  urls_queued: number;
  urls_skipped: number;
  errors: string[];
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
  if (!firecrawlKey) {
    return new Response(JSON.stringify({ error: 'FIRECRAWL_API_KEY not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    const {
      mode = 'map',  // 'map' for URL discovery, 'crawl' for deep extraction
      limit = 5000,  // Max URLs to discover
      search = '',   // Optional search filter (e.g., "porsche 911")
    } = await req.json().catch(() => ({}));

    console.log(`[bat-archive-crawler] Starting ${mode} mode, limit=${limit}`);

    const result: CrawlResult = {
      urls_found: 0,
      urls_queued: 0,
      urls_skipped: 0,
      errors: [],
    };

    // Use Firecrawl's map feature to discover all listing URLs
    // Map is faster and cheaper than crawl for URL discovery
    const mapResponse = await fetch('https://api.firecrawl.dev/v1/map', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${firecrawlKey}`,
      },
      body: JSON.stringify({
        url: 'https://bringatrailer.com/auctions/',
        search: search || undefined,
        ignoreSitemap: false,
        includeSubdomains: false,
        limit: limit,
      }),
    });

    if (!mapResponse.ok) {
      const errorText = await mapResponse.text();
      throw new Error(`Firecrawl map failed: ${mapResponse.status} - ${errorText}`);
    }

    const mapResult = await mapResponse.json();

    if (!mapResult.success || !mapResult.links) {
      throw new Error(`Firecrawl map returned no links: ${JSON.stringify(mapResult)}`);
    }

    console.log(`[bat-archive-crawler] Firecrawl returned ${mapResult.links.length} URLs`);

    // Filter for listing URLs only
    const listingUrls = mapResult.links.filter((url: string) =>
      url.includes('/listing/') &&
      url.includes('bringatrailer.com')
    );

    result.urls_found = listingUrls.length;
    console.log(`[bat-archive-crawler] Found ${listingUrls.length} listing URLs`);

    // Check which URLs we already have
    const { data: existingUrls } = await supabase
      .from('vehicles')
      .select('discovery_url, listing_url, bat_auction_url')
      .or(`discovery_url.in.(${listingUrls.map((u: string) => `"${u}"`).join(',')}),bat_auction_url.in.(${listingUrls.map((u: string) => `"${u}"`).join(',')})`);

    const existingSet = new Set<string>();
    for (const v of existingUrls || []) {
      if (v.discovery_url) existingSet.add(v.discovery_url);
      if (v.listing_url) existingSet.add(v.listing_url);
      if (v.bat_auction_url) existingSet.add(v.bat_auction_url);
    }

    // Also check import_queue
    const { data: queuedUrls } = await supabase
      .from('import_queue')
      .select('url')
      .in('url', listingUrls);

    for (const q of queuedUrls || []) {
      existingSet.add(q.url);
    }

    // Queue new URLs
    const newUrls = listingUrls.filter((url: string) => !existingSet.has(url));
    result.urls_skipped = listingUrls.length - newUrls.length;

    console.log(`[bat-archive-crawler] ${newUrls.length} new URLs to queue, ${result.urls_skipped} already exist`);

    // Batch insert into import_queue
    if (newUrls.length > 0) {
      const queueRecords = newUrls.map((url: string) => ({
        url,
        source: 'bat_archive_crawler',
        status: 'pending',
        priority: 1,  // Low priority for backfill
        metadata: { discovered_at: new Date().toISOString() },
      }));

      // Insert in batches of 1000
      for (let i = 0; i < queueRecords.length; i += 1000) {
        const batch = queueRecords.slice(i, i + 1000);
        const { error: insertError } = await supabase
          .from('import_queue')
          .insert(batch)
          .onConflict('url')
          .ignore();

        if (insertError) {
          result.errors.push(`Batch ${i/1000}: ${insertError.message}`);
        } else {
          result.urls_queued += batch.length;
        }
      }
    }

    console.log(`[bat-archive-crawler] Complete: ${result.urls_queued} queued, ${result.urls_skipped} skipped`);

    return new Response(JSON.stringify({
      success: true,
      ...result,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('[bat-archive-crawler] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
