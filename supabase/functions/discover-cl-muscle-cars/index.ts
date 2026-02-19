/**
 * Discover Craigslist Muscle Cars Edge Function
 *
 * Scans Craigslist search pages across regions to find classic muscle car
 * listings (1958-1973 primary, 1974-1991 secondary). Discovered listings
 * are inserted into craigslist_listing_queue AND acquisition_pipeline.
 *
 * Follows the same pattern as discover-cl-squarebodies but targets muscle
 * car segments with automatic pipeline integration.
 *
 * Input:  { max_regions?, regions?, chain_depth?, auto_proof? }
 * Output: { success, stats, message }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Top CL regions by classic car volume
const CRAIGSLIST_REGIONS = [
  'sfbay', 'losangeles', 'orangecounty', 'sandiego', 'sacramento', 'inlandempire',
  'phoenix', 'tucson', 'dallas', 'houston', 'austin', 'sanantonio',
  'atlanta', 'nashville', 'charlotte', 'raleigh',
  'chicago', 'detroit', 'minneapolis', 'milwaukee', 'indianapolis', 'columbus',
  'cleveland', 'cincinnati', 'stlouis', 'kansascity',
  'denver', 'boulder', 'fortcollins',
  'seattle', 'portland', 'boise',
  'newyork', 'longisland', 'boston', 'philadelphia', 'pittsburgh',
  'miami', 'tampa', 'orlando', 'jacksonville',
  'newjersey', 'baltimore', 'washingtondc', 'richmond', 'norfolk',
  'memphis', 'louisville', 'oklahomacity', 'albuquerque',
  'lasvegas', 'reno', 'saltlakecity',
  'ventura', 'santabarbara', 'bakersfield', 'fresno', 'stockton', 'modesto',
];

// Muscle car search terms - high-value segments
const MUSCLE_CAR_SEARCHES = [
  // Chevrolet
  { term: 'chevelle SS', make: 'Chevrolet', model_hint: 'Chevelle', priority: 'primary' },
  { term: 'camaro SS', make: 'Chevrolet', model_hint: 'Camaro', priority: 'primary' },
  { term: 'camaro Z28', make: 'Chevrolet', model_hint: 'Camaro', priority: 'primary' },
  { term: 'corvette 427', make: 'Chevrolet', model_hint: 'Corvette', priority: 'primary' },
  { term: 'corvette 454', make: 'Chevrolet', model_hint: 'Corvette', priority: 'primary' },
  { term: 'nova SS', make: 'Chevrolet', model_hint: 'Nova', priority: 'primary' },
  { term: 'el camino SS', make: 'Chevrolet', model_hint: 'El Camino', priority: 'primary' },
  // Dodge
  { term: 'challenger RT', make: 'Dodge', model_hint: 'Challenger', priority: 'primary' },
  { term: 'dodge challenger 440', make: 'Dodge', model_hint: 'Challenger', priority: 'primary' },
  { term: 'charger RT', make: 'Dodge', model_hint: 'Charger', priority: 'primary' },
  { term: 'dodge dart GTS', make: 'Dodge', model_hint: 'Dart', priority: 'primary' },
  // Plymouth
  { term: 'plymouth barracuda', make: 'Plymouth', model_hint: 'Barracuda', priority: 'primary' },
  { term: 'plymouth cuda', make: 'Plymouth', model_hint: 'Cuda', priority: 'primary' },
  { term: 'road runner', make: 'Plymouth', model_hint: 'Road Runner', priority: 'primary' },
  { term: 'plymouth GTX', make: 'Plymouth', model_hint: 'GTX', priority: 'primary' },
  // Pontiac
  { term: 'pontiac GTO', make: 'Pontiac', model_hint: 'GTO', priority: 'primary' },
  { term: 'trans am', make: 'Pontiac', model_hint: 'Trans Am', priority: 'primary' },
  { term: 'firebird 400', make: 'Pontiac', model_hint: 'Firebird', priority: 'primary' },
  // Ford
  { term: 'mustang boss', make: 'Ford', model_hint: 'Mustang Boss', priority: 'primary' },
  { term: 'mustang mach 1', make: 'Ford', model_hint: 'Mustang Mach 1', priority: 'primary' },
  { term: 'shelby GT500', make: 'Ford', model_hint: 'Shelby', priority: 'primary' },
  { term: 'ford torino cobra', make: 'Ford', model_hint: 'Torino', priority: 'primary' },
  // Oldsmobile
  { term: 'oldsmobile 442', make: 'Oldsmobile', model_hint: '442', priority: 'primary' },
  { term: 'olds 442', make: 'Oldsmobile', model_hint: '442', priority: 'primary' },
  // AMC
  { term: 'AMC AMX', make: 'AMC', model_hint: 'AMX', priority: 'primary' },
  { term: 'AMC javelin', make: 'AMC', model_hint: 'Javelin', priority: 'primary' },
  // Buick
  { term: 'buick GS', make: 'Buick', model_hint: 'GS', priority: 'primary' },
  { term: 'buick GSX', make: 'Buick', model_hint: 'GSX', priority: 'primary' },
];

interface DiscoveredListing {
  url: string;
  title: string | null;
  price: number | null;
  region: string;
  search_term: string;
  make_hint: string;
  model_hint: string;
  priority: string;
}

/**
 * Parse year from a CL listing title.
 * e.g. "1970 Chevelle SS 454 4-Speed" -> 1970
 */
function parseYear(title: string | null): number | null {
  if (!title) return null;
  const match = title.match(/\b(19[5-9]\d)\b/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Parse price from CL listing text (which may include embedded whitespace/newlines).
 * CL search results embed: "title\n$price\nlocation" in the link text.
 */
function parsePrice(text: string | null): number | null {
  if (!text) return null;
  const match = text.match(/\$([0-9,]+)/);
  if (!match) return null;
  const price = parseInt(match[1].replace(/,/g, ''), 10);
  // Filter out obviously wrong prices (like $28 for a Corvette)
  return price >= 500 && price < 10000000 ? price : null;
}

/**
 * Clean CL search result text: extract just the title (first line before price/location).
 */
function cleanTitle(raw: string | null): string | null {
  if (!raw) return null;
  // Take just the first line (before any newline/price text)
  const firstLine = raw.split('\n')[0].trim();
  return firstLine || null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 200 });
  }

  try {
    const {
      max_regions = 10,
      max_searches_per_region = 8,
      regions = null,
      chain_depth = 0,
      regions_processed = [],
      auto_proof = false,
    } = await req.json();

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    console.log('[discover-cl-muscle-cars] Starting discovery...');

    const regionsToSearch = regions
      || CRAIGSLIST_REGIONS.slice(0, max_regions);

    const allListings: DiscoveredListing[] = [];
    const seenUrls = new Set<string>();

    const stats = {
      regions_searched: 0,
      searches_performed: 0,
      listings_found: 0,
      listings_added_to_queue: 0,
      listings_added_to_pipeline: 0,
      duplicates_skipped: 0,
      errors: 0,
    };

    const searchTermsToUse = MUSCLE_CAR_SEARCHES.slice(0, max_searches_per_region);

    for (const region of regionsToSearch) {
      try {
        console.log(`[discover] Searching ${region}...`);
        stats.regions_searched++;

        for (const search of searchTermsToUse) {
          try {
            // CL search URL: cars+trucks, sort by date, year range 1958-1973
            const searchUrl = `https://${region}.craigslist.org/search/cta?query=${encodeURIComponent(search.term)}&sort=date&min_auto_year=1958&max_auto_year=1973`;

            stats.searches_performed++;

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);

            try {
              const response = await fetch(searchUrl, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                },
                signal: controller.signal,
              });

              clearTimeout(timeoutId);

              if (!response.ok) {
                console.warn(`  [${region}] ${search.term}: HTTP ${response.status}`);
                continue;
              }

              const html = await response.text();
              let foundInSearch = 0;

              // Regex-only parsing (no DOM parser - too slow for edge functions)
              // Extract listing URLs from CL search results HTML
              const urlPattern = /https?:\/\/[a-z]+\.craigslist\.org\/[a-z]{2,4}\/ct[aod]\/d\/[^"'\s<>]+\.html/g;
              const urlMatches = html.match(urlPattern) || [];

              // Also try relative URLs
              const relPattern = /href="(\/[a-z]{2,4}\/ct[aod]\/d\/[^"]+\.html)"/g;
              let relMatch;
              while ((relMatch = relPattern.exec(html)) !== null) {
                urlMatches.push(`https://${region}.craigslist.org${relMatch[1]}`);
              }

              // Extract prices near listing URLs using JSON-LD schema
              const priceMap = new Map<string, number>();
              const pricePattern = /"url":"([^"]+)"[^}]*"price":\s*"?(\d+)"?/g;
              let pm;
              while ((pm = pricePattern.exec(html)) !== null) {
                const p = parseInt(pm[2], 10);
                if (p >= 500 && p < 10000000) priceMap.set(pm[1], p);
              }

              // Extract titles from JSON-LD or result-title spans
              const titleMap = new Map<string, string>();
              const titlePattern = /"url":"([^"]+)"[^}]*"name":"([^"]+)"/g;
              let tm;
              while ((tm = titlePattern.exec(html)) !== null) {
                titleMap.set(tm[1], tm[2]);
              }

              for (const url of urlMatches) {
                const cleanUrl = url.replace(/[<>]/g, '').split('#')[0];
                if (!seenUrls.has(cleanUrl) && cleanUrl.includes('/d/')) {
                  seenUrls.add(cleanUrl);
                  foundInSearch++;

                  const title = titleMap.get(cleanUrl) || cleanTitle(cleanUrl.split('/d/')[1]?.replace(/\.html$/, '').replace(/-/g, ' ')) || null;
                  const price = priceMap.get(cleanUrl) || null;

                  allListings.push({
                    url: cleanUrl,
                    title,
                    price,
                    region,
                    search_term: search.term,
                    make_hint: search.make,
                    model_hint: search.model_hint,
                    priority: search.priority,
                  });
                }
              }

              stats.listings_found += foundInSearch;
              if (foundInSearch > 0) {
                console.log(`  [${region}] ${search.term}: ${foundInSearch} listings`);
              }
            } catch (fetchError: unknown) {
              clearTimeout(timeoutId);
              const msg = fetchError instanceof Error ? fetchError.message : String(fetchError);
              if (msg.includes('abort')) {
                console.warn(`  [${region}] ${search.term}: timeout`);
              }
              stats.errors++;
            }

            // Rate limiting between searches
            await new Promise((r) => setTimeout(r, 300));
          } catch {
            stats.errors++;
          }
        }

        // Rate limiting between regions
        await new Promise((r) => setTimeout(r, 200));
      } catch {
        stats.errors++;
      }
    }

    console.log(`[discover] Total unique listings: ${allListings.length}`);

    // -----------------------------------------------------------------------
    // Insert into craigslist_listing_queue (dedup by URL)
    // -----------------------------------------------------------------------
    if (allListings.length > 0) {
      const queueRows = allListings.map((l) => ({
        listing_url: l.url,
        status: 'pending',
        region: l.region,
        search_term: l.search_term,
        metadata: {
          make_hint: l.make_hint,
          model_hint: l.model_hint,
          title: l.title,
          price: l.price,
          priority: l.priority,
          discovered_by: 'discover-cl-muscle-cars',
        },
      }));

      const batchSize = 100;
      for (let i = 0; i < queueRows.length; i += batchSize) {
        const batch = queueRows.slice(i, i + batchSize);
        const { data, error } = await supabase
          .from('craigslist_listing_queue')
          .upsert(batch, { onConflict: 'listing_url', ignoreDuplicates: true })
          .select('id');

        if (error) {
          console.error(`[discover] Queue batch error: ${error.message}`);
          stats.errors++;
        } else {
          const added = data?.length || 0;
          stats.listings_added_to_queue += added;
          stats.duplicates_skipped += batch.length - added;
        }
      }
    }

    // -----------------------------------------------------------------------
    // Insert into acquisition_pipeline (only listings with title + year info)
    // -----------------------------------------------------------------------
    const pipelineInserts = allListings
      .filter((l) => l.title || l.make_hint)
      .map((l) => {
        const year = parseYear(l.title);
        return {
          discovery_source: 'craigslist',
          discovery_url: l.url,
          discovery_date: new Date().toISOString(),
          discovered_by: 'discover-cl-muscle-cars',
          year: year,
          make: l.make_hint,
          model: l.model_hint,
          asking_price: l.price,
          location_city: null,
          location_state: null,
          stage: 'discovered',
          priority: l.priority,
        };
      })
      .filter((r) => r.year && r.year >= 1958 && r.year <= 1991);

    if (pipelineInserts.length > 0) {
      // Use discovery_url for dedup since we don't have a unique constraint
      const existingUrls = new Set<string>();

      const { data: existing } = await supabase
        .from('acquisition_pipeline')
        .select('discovery_url')
        .in(
          'discovery_url',
          pipelineInserts.map((r) => r.discovery_url),
        );

      if (existing) {
        for (const row of existing) {
          existingUrls.add(row.discovery_url);
        }
      }

      const newInserts = pipelineInserts.filter((r) => !existingUrls.has(r.discovery_url));

      if (newInserts.length > 0) {
        const batchSize = 50;
        for (let i = 0; i < newInserts.length; i += batchSize) {
          const batch = newInserts.slice(i, i + batchSize);
          const { error } = await supabase.from('acquisition_pipeline').insert(batch);

          if (error) {
            console.error(`[discover] Pipeline insert error: ${error.message}`);
            stats.errors++;
          } else {
            stats.listings_added_to_pipeline += batch.length;
          }
        }
      }

      console.log(`[discover] Added ${stats.listings_added_to_pipeline} to pipeline (${existingUrls.size} already existed)`);
    }

    // -----------------------------------------------------------------------
    // Optional: Auto-market-proof new pipeline entries
    // -----------------------------------------------------------------------
    if (auto_proof && stats.listings_added_to_pipeline > 0) {
      const { data: unproofed } = await supabase
        .from('acquisition_pipeline')
        .select('id')
        .eq('stage', 'discovered')
        .eq('discovered_by', 'discover-cl-muscle-cars')
        .not('make', 'is', null)
        .limit(20);

      if (unproofed && unproofed.length > 0) {
        console.log(`[discover] Auto-proofing ${unproofed.length} new entries...`);
        const fnBase = `${supabaseUrl.replace(/\/$/, '')}/functions/v1`;

        for (const row of unproofed) {
          try {
            await fetch(`${fnBase}/market-proof`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${serviceRoleKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ pipeline_id: row.id }),
            });
          } catch {
            // Non-fatal
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // Function chaining
    // -----------------------------------------------------------------------
    const allRegions = regions || CRAIGSLIST_REGIONS;
    const processedRegions = [...(regions_processed || []), ...regionsToSearch];
    const remainingRegions = allRegions.filter((r: string) => !processedRegions.includes(r));

    if (remainingRegions.length > 0 && chain_depth > 0) {
      const fnBase = `${supabaseUrl.replace(/\/$/, '')}/functions/v1`;
      fetch(`${fnBase}/discover-cl-muscle-cars`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          max_regions,
          max_searches_per_region,
          regions: remainingRegions.slice(0, max_regions),
          chain_depth: chain_depth - 1,
          regions_processed: processedRegions,
          auto_proof,
        }),
      }).catch(() => {});

      console.log(`[discover] Chaining to next batch (${remainingRegions.length} regions remaining)`);
    }

    // -----------------------------------------------------------------------
    // Response
    // -----------------------------------------------------------------------
    return new Response(
      JSON.stringify({
        success: true,
        stats,
        regions_searched: regionsToSearch,
        sample_listings: allListings.slice(0, 10).map((l) => ({
          url: l.url,
          title: l.title,
          price: l.price,
          region: l.region,
          make: l.make_hint,
          model: l.model_hint,
        })),
        message: `Discovered ${allListings.length} listings across ${stats.regions_searched} regions. Added ${stats.listings_added_to_queue} to queue, ${stats.listings_added_to_pipeline} to pipeline.`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[discover-cl-muscle-cars] Error: ${message}`);
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 },
    );
  }
});
