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
      processed: 0,
      created: 0,
      updated: 0,
      errors: 0,
      listings: [] as any[]
    }

    // Process each listing through scrape-vehicle
    for (const listingUrl of urlsToProcess) {
      try {
        console.log(`Processing: ${listingUrl}`)
        
        // Call scrape-vehicle function
        const scrapeResponse = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/scrape-vehicle`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
            },
            body: JSON.stringify({ url: listingUrl })
          }
        )

        if (scrapeResponse.ok) {
          const scrapeData = await scrapeResponse.json()
          
          if (scrapeData.success && scrapeData.data) {
            // Use dataRouter to find/create vehicle
            const routerResponse = await supabase.functions.invoke('data-router', {
              body: {
                vehicleData: scrapeData.data,
                userId: user_id || null
              }
            })

            if (routerResponse.data?.isNew) {
              results.created++
            } else if (routerResponse.data?.vehicleId) {
              results.updated++
            }

            results.listings.push({
              url: listingUrl,
              vehicleData: scrapeData.data,
              vehicleId: routerResponse.data?.vehicleId
            })
          }
        } else {
          console.error(`Failed to scrape ${listingUrl}:`, await scrapeResponse.text())
          results.errors++
        }

        results.processed++

        // Rate limiting - wait 1 second between requests
        await new Promise(resolve => setTimeout(resolve, 1000))

      } catch (error) {
        console.error(`Error processing ${listingUrl}:`, error)
        results.errors++
        results.processed++
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        search_url,
        total_listings_found: listingUrls.length,
        processed: results.processed,
        created: results.created,
        updated: results.updated,
        errors: results.errors,
        listings: results.listings
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

