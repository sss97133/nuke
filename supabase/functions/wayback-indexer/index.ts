/**
 * WAYBACK INDEXER
 *
 * Background worker that systematically indexes vehicle listings from Wayback Machine.
 * Respects rate limits (0.8 req/sec) and tracks progress.
 *
 * Modes:
 * - discover: Find new category pages to index
 * - index: Extract vehicles from known pages
 * - status: Check indexing progress
 *
 * Run periodically via cron or manually trigger batches.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const WAYBACK_CDX_API = 'https://web.archive.org/cdx/search/cdx';

// Rate limit: 0.8 requests per second (48/minute, under the 60/min limit)
const RATE_LIMIT_MS = 1250;

// Priority domains and their category patterns
const INDEX_TARGETS = [
  // eBay Motors category pages (highest value)
  { domain: 'motors.ebay.com', pattern: 'Cars-Trucks*', years: [2005, 2010], priority: 1 },
  { domain: 'cgi.ebay.com', pattern: 'ebaymotors/*', years: [2004, 2009], priority: 1 },

  // Craigslist (regional)
  { domain: 'sfbay.craigslist.org', pattern: 'cto/*', years: [2006, 2010], priority: 2 },
  { domain: 'losangeles.craigslist.org', pattern: 'cto/*', years: [2006, 2010], priority: 2 },
  { domain: 'chicago.craigslist.org', pattern: 'cto/*', years: [2006, 2010], priority: 2 },
  { domain: 'newyork.craigslist.org', pattern: 'cto/*', years: [2006, 2010], priority: 2 },

  // Classic car sites
  { domain: 'hemmings.com', pattern: 'classifieds/*', years: [2005, 2012], priority: 2 },
  { domain: 'classiccars.com', pattern: 'listings/*', years: [2006, 2012], priority: 2 },
];

interface IndexerRequest {
  mode: 'discover' | 'index' | 'status' | 'batch';
  batch_size?: number;  // How many pages to process (default 10)
  target_domain?: string;  // Optionally filter to specific domain
}

interface IndexProgress {
  domain: string;
  pages_discovered: number;
  pages_indexed: number;
  vehicles_extracted: number;
  last_indexed_at: string;
}

// Sleep helper for rate limiting
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Search CDX with rate limiting - returns UNIQUE original URLs with one snapshot each
async function searchCDX(
  url: string,
  from: number,
  to: number,
  limit: number = 50,
  offset: number = 0
): Promise<string[]> {
  const params = new URLSearchParams({
    url,
    matchType: 'prefix',
    from: `${from}0101`,
    to: `${to}1231`,
    output: 'json',
    limit: String(limit + offset + 100),  // Get extra to allow deduping
    filter: 'statuscode:200',
    collapse: 'urlkey',  // CRITICAL: collapse by URL to get unique listings
    fl: 'timestamp,original'
  });

  try {
    const response = await fetch(`${WAYBACK_CDX_API}?${params}`, {
      headers: { 'User-Agent': 'NukeVehicleIndexer/1.0 (research project)' }
    });

    if (response.status === 429) {
      console.log('[wayback-indexer] Rate limited, backing off...');
      await sleep(5000);
      return [];
    }

    if (!response.ok) {
      console.log(`[wayback-indexer] CDX error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    if (!Array.isArray(data) || data.length < 2) return [];

    // Dedupe by original URL (not snapshot URL) - keep first snapshot of each
    const seen = new Set<string>();
    const uniqueUrls: string[] = [];

    for (const row of data.slice(1)) {
      const originalUrl = row[1]
        .replace(/^https?:\/\//, '')
        .replace(/:80\//, '/')
        .replace(/\?.*$/, '');  // Normalize URL

      if (!seen.has(originalUrl)) {
        seen.add(originalUrl);
        uniqueUrls.push(`https://web.archive.org/web/${row[0]}/${row[1]}`);
      }
    }

    // Apply offset and limit
    return uniqueUrls.slice(offset, offset + limit);
  } catch (e) {
    console.error('[wayback-indexer] CDX fetch error:', e);
    return [];
  }
}

// Check if URL was already processed
async function isUrlProcessed(supabase: any, snapshotUrl: string): Promise<boolean> {
  const normalizedUrl = snapshotUrl
    .replace(/.*\/web\/\d+\//, '')  // Strip wayback prefix
    .replace(/^https?:\/\//, '')
    .replace(/:80\//, '/')
    .slice(-60);  // Last 60 chars for matching

  const { data } = await supabase
    .from('vehicle_observations')
    .select('id')
    .ilike('source_url', `%${normalizedUrl}%`)
    .limit(1);

  return (data?.length || 0) > 0;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body: IndexerRequest = await req.json();
    const { mode, batch_size = 10, target_domain } = body;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    switch (mode) {
      case 'discover': {
        // Discover new pages to index
        const discovered: { url: string; domain: string }[] = [];
        const targets = target_domain
          ? INDEX_TARGETS.filter(t => t.domain.includes(target_domain))
          : INDEX_TARGETS;

        for (const target of targets.slice(0, 3)) {  // Limit targets per run
          console.log(`[wayback-indexer] Discovering ${target.domain}/${target.pattern}...`);

          const urls = await searchCDX(
            `${target.domain}/${target.pattern}`,
            target.years[0],
            target.years[1],
            20
          );

          for (const url of urls) {
            discovered.push({ url, domain: target.domain });
          }

          await sleep(RATE_LIMIT_MS);  // Rate limit between domains
        }

        // Store discovered pages (would use a queue table in production)
        return new Response(
          JSON.stringify({
            mode: 'discover',
            pages_discovered: discovered.length,
            pages: discovered.slice(0, 50)
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'index': {
        // Index a batch of pages
        const results: { url: string; vehicles: number; success: boolean }[] = [];
        let totalVehicles = 0;

        // First discover some pages to index
        const targets = target_domain
          ? INDEX_TARGETS.filter(t => t.domain.includes(target_domain))
          : INDEX_TARGETS;

        const pagesToIndex: string[] = [];

        for (const target of targets.slice(0, 2)) {
          const urls = await searchCDX(
            `${target.domain}/${target.pattern}`,
            target.years[0],
            target.years[1],
            batch_size
          );
          pagesToIndex.push(...urls);
          await sleep(RATE_LIMIT_MS);

          if (pagesToIndex.length >= batch_size) break;
        }

        // Index each page
        for (const url of pagesToIndex.slice(0, batch_size)) {
          try {
            const response = await fetch(
              `${supabaseUrl}/functions/v1/extract-wayback-index`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${serviceRoleKey}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ snapshot_url: url, ingest: true })
              }
            );

            if (response.ok) {
              const result = await response.json();
              results.push({
                url,
                vehicles: result.ingested || 0,
                success: true
              });
              totalVehicles += result.ingested || 0;
            } else {
              results.push({ url, vehicles: 0, success: false });
            }
          } catch (e) {
            results.push({ url, vehicles: 0, success: false });
          }

          await sleep(RATE_LIMIT_MS);  // Rate limit between pages
        }

        return new Response(
          JSON.stringify({
            mode: 'index',
            pages_processed: results.length,
            vehicles_extracted: totalVehicles,
            results
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'batch': {
        // Run a larger batch in the background
        // This would be called by a cron job
        const startTime = Date.now();
        const maxRunTime = 50000;  // 50 seconds max (edge function limit is 60s)
        let pagesProcessed = 0;
        let vehiclesExtracted = 0;
        let skippedAlreadyProcessed = 0;

        // Use random offset to get different URLs each batch
        const randomOffset = Math.floor(Math.random() * 500);

        const targets = INDEX_TARGETS.filter(t => t.priority === 1);  // High priority only

        for (const target of targets) {
          if (Date.now() - startTime > maxRunTime) break;

          const urls = await searchCDX(
            `${target.domain}/${target.pattern}`,
            target.years[0],
            target.years[1],
            10,  // Get more URLs
            randomOffset  // Random offset to avoid repeating
          );

          for (const url of urls) {
            if (Date.now() - startTime > maxRunTime) break;

            // Skip already processed URLs
            if (await isUrlProcessed(supabase, url)) {
              skippedAlreadyProcessed++;
              continue;
            }

            try {
              const response = await fetch(
                `${supabaseUrl}/functions/v1/extract-wayback-index`,
                {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${serviceRoleKey}`,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({ snapshot_url: url, ingest: true })
                }
              );

              if (response.ok) {
                const result = await response.json();
                vehiclesExtracted += result.ingested || 0;
              }
              pagesProcessed++;
            } catch (e) {
              console.log(`[wayback-indexer] Page failed: ${url}`);
            }

            await sleep(RATE_LIMIT_MS);
          }

          await sleep(RATE_LIMIT_MS);
        }

        return new Response(
          JSON.stringify({
            mode: 'batch',
            run_time_ms: Date.now() - startTime,
            pages_processed: pagesProcessed,
            vehicles_extracted: vehiclesExtracted,
            skipped_duplicates: skippedAlreadyProcessed,
            offset_used: randomOffset
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'status': {
        // Get indexing status (exclude duplicates marked with [DUPLICATE])
        const { count: vehicleCount } = await supabase
          .from('vehicles')
          .select('*', { count: 'exact', head: true })
          .ilike('notes', '%Wayback%')
          .not('notes', 'ilike', '%[DUPLICATE]%');

        const { count: dupeCount } = await supabase
          .from('vehicles')
          .select('*', { count: 'exact', head: true })
          .ilike('notes', '%[DUPLICATE]%Wayback%');

        const { count: observationCount } = await supabase
          .from('vehicle_observations')
          .select('*', { count: 'exact', head: true })
          .eq('source_id', (await supabase.from('observation_sources').select('id').eq('slug', 'wayback-machine').single()).data?.id);

        return new Response(
          JSON.stringify({
            mode: 'status',
            wayback_vehicles: vehicleCount || 0,
            wayback_duplicates_marked: dupeCount || 0,
            wayback_observations: observationCount || 0,
            index_targets: INDEX_TARGETS.length,
            rate_limit: `${1000 / RATE_LIMIT_MS} requests/second`
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: `Unknown mode: ${mode}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

  } catch (error: any) {
    console.error('[wayback-indexer] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
