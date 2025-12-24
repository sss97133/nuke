import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { search_url, max_listings = 50, user_id } = await req.json()
    
    if (!search_url || !search_url.includes('craigslist.org')) {
      return new Response(
        JSON.stringify({ error: 'Valid Craigslist search URL required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Get or create scrape source
    const { data: source, error: sourceError } = await supabase
      .from('scrape_sources')
      .select('id')
      .eq('domain', 'craigslist.org')
      .maybeSingle();

    let sourceId = source?.id;

    if (!sourceId) {
      const { data: newSource, error: createError } = await supabase
        .from('scrape_sources')
        .insert({
          domain: 'craigslist.org',
          source_name: 'Craigslist',
          source_type: 'classifieds',
          base_url: 'https://craigslist.org',
          is_active: true,
        })
        .select('id')
        .single();

      if (createError) {
        console.error('Error creating source:', createError);
      } else {
        sourceId = newSource?.id;
      }
    }

    console.log('🔍 Scraping Craigslist search results:', search_url)

    // Fetch the search results page
    const response = await fetch(search_url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status}`)
    }

    const html = await response.text()
    const doc = new DOMParser().parseFromString(html, 'text/html')

    if (!doc) {
      throw new Error('Failed to parse HTML')
    }

    // Extract individual listing URLs from search results
    const listingUrls: string[] = []
    
    // Craigslist search results have links like /cto/d/listing-id.html
    const links = doc.querySelectorAll('a.result-title')
    for (const link of links) {
      const href = link.getAttribute('href')
      if (href) {
        // Convert relative URLs to absolute
        const fullUrl = href.startsWith('http') 
          ? href 
          : `https://${new URL(search_url).hostname}${href}`
        listingUrls.push(fullUrl)
      }
    }

    console.log(`Found ${listingUrls.length} listings`)

    // Limit to max_listings
    const urlsToProcess = listingUrls.slice(0, max_listings)
    
    const results = {
      queued: 0,
      skipped: 0,
      errors: 0
    }

    // Add all listings to import_queue (standardized approach)
    for (const listingUrl of urlsToProcess) {
      try {
        // Check if already in queue
        const { data: existing } = await supabase
          .from('import_queue')
          .select('id')
          .eq('listing_url', listingUrl)
          .maybeSingle();

        if (existing) {
          results.skipped++;
          continue;
        }

        // Check if vehicle already exists
        const { data: existingVehicle } = await supabase
          .from('vehicles')
          .select('id')
          .eq('discovery_url', listingUrl)
          .maybeSingle();

        if (existingVehicle) {
          results.skipped++;
          continue;
        }

        // Add to import_queue
        const { error: queueError } = await supabase
          .from('import_queue')
          .insert({
            source_id: sourceId,
            listing_url: listingUrl,
            raw_data: {
              source: 'CRAIGSLIST',
              search_url: search_url
            },
            status: 'pending',
            priority: 0
          });

        if (queueError) {
          console.error(`Failed to queue listing ${listingUrl}:`, queueError.message);
          results.errors++;
        } else {
          results.queued++;
        }

      } catch (error) {
        console.error(`Error queuing listing ${listingUrl}:`, error);
        results.errors++;
      }
    }

    // Update source health tracking
    if (sourceId) {
      await supabase
        .from('scrape_sources')
        .update({
          last_scraped_at: new Date().toISOString(),
          last_successful_scrape: new Date().toISOString(),
          total_listings_found: urlsToProcess.length,
          updated_at: new Date().toISOString()
        })
        .eq('id', sourceId);
    }

    return new Response(
      JSON.stringify({
        success: true,
        search_url,
        total_listings_found: listingUrls.length,
        queued: results.queued,
        skipped: results.skipped,
        errors: results.errors,
        source_id: sourceId
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error: any) {
    console.error('Error in scrape-craigslist-search:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

