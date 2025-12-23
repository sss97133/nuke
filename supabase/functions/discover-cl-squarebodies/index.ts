import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// All major Craigslist regions
const CRAIGSLIST_REGIONS = [
  'sfbay', 'newyork', 'losangeles', 'chicago', 'atlanta', 'dallas', 'denver', 
  'seattle', 'portland', 'phoenix', 'boston', 'minneapolis', 'detroit', 
  'philadelphia', 'houston', 'miami', 'sacramento', 'sandiego', 'orangecounty',
  'raleigh', 'tampa', 'baltimore', 'stlouis', 'pittsburgh', 'cleveland',
  'cincinnati', 'milwaukee', 'kansascity', 'indianapolis', 'columbus', 'austin',
  'nashville', 'oklahomacity', 'memphis', 'louisville', 'buffalo', 'providence',
  'richmond', 'norfolk', 'greensboro', 'wichita', 'tucson', 'fresno', 'bakersfield',
  'stockton', 'modesto', 'santabarbara', 'santacruz', 'monterey', 'slo',
  'ventura', 'inlandempire', 'westslope', 'boulder', 'fortcollins', 'pueblo',
  'grandjunction', 'durango', 'eastco', 'rockies', 'wyoming', 'montana', 'idaho',
  'utah', 'nevada', 'newmexico', 'arizona', 'texas', 'oklahoma', 'kansas', 'missouri',
  'arkansas', 'louisiana', 'mississippi', 'alabama', 'tennessee', 'kentucky',
  'westvirginia', 'virginia', 'northcarolina', 'southcarolina', 'georgia', 'florida',
  'maine', 'newhampshire', 'vermont', 'massachusetts', 'rhodeisland', 'connecticut',
  'newjersey', 'delaware', 'maryland', 'pennsylvania', 'ohio', 'michigan',
  'indiana', 'illinois', 'wisconsin', 'minnesota', 'iowa', 'nebraska',
  'southdakota', 'northdakota', 'washington', 'oregon', 'california'
]

// Squarebody search terms (1973-1991)
const SQUAREBODY_SEARCH_TERMS = [
  'squarebody',
  'square body',
  'C10',
  'C20',
  'C30',
  'K10',
  'K20',
  'K30',
  '1973 chevrolet truck',
  '1974 chevrolet truck',
  '1975 chevrolet truck',
  '1976 chevrolet truck',
  '1977 chevrolet truck',
  '1978 chevrolet truck',
  '1979 chevrolet truck',
  '1980 chevrolet truck',
  '1981 chevrolet truck',
  '1982 chevrolet truck',
  '1983 chevrolet truck',
  '1984 chevrolet truck',
  '1985 chevrolet truck',
  '1986 chevrolet truck',
  '1987 chevrolet truck',
  '1988 chevrolet truck',
  '1989 chevrolet truck',
  '1990 chevrolet truck',
  '1991 chevrolet truck',
  '1973 GMC truck',
  '1974 GMC truck',
  '1975 GMC truck',
  '1976 GMC truck',
  '1977 GMC truck',
  '1978 GMC truck',
  '1979 GMC truck',
  '1980 GMC truck',
  '1981 GMC truck',
  '1982 GMC truck',
  '1983 GMC truck',
  '1984 GMC truck',
  '1985 GMC truck',
  '1986 GMC truck',
  '1987 GMC truck',
  '1988 GMC truck',
  '1989 GMC truck',
  '1990 GMC truck',
  '1991 GMC truck',
  'chevy square',
  'GMC square',
  '73-87 chevy',
  '73-91 chevy',
  '73-87 GMC',
  '73-91 GMC'
]

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { 
      max_regions = null, // null = all regions
      max_searches_per_region = 10, // Increased for paid plan (400s timeout)
      regions = null, // Optional: specific regions to search
      chain_depth = 0, // Function chaining: number of remaining self-invocations (0 = no chaining)
      regions_processed = [], // Track which regions have been processed (for chaining)
      skip_regions = [] // Regions to skip (already processed)
    } = await req.json()

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || `https://qkgaybvrernstplzjaam.supabase.co`
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || ''
    
    const supabase = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      }
    )

    console.log('🔍 Starting Craigslist squarebody discovery...')
    
    const regionsToSearch = regions || (max_regions ? CRAIGSLIST_REGIONS.slice(0, max_regions) : CRAIGSLIST_REGIONS)
    const allListingUrls = new Set<string>()
    const stats = {
      regions_searched: 0,
      searches_performed: 0,
      listings_found: 0,
      listings_added_to_queue: 0,
      listings_already_in_queue: 0,
      errors: 0
    }

    // Limit search terms per region to avoid timeout
    const searchTermsToUse = SQUAREBODY_SEARCH_TERMS.slice(0, max_searches_per_region)

    // Search each region
    for (const region of regionsToSearch) {
      try {
        console.log(`\n📍 Searching ${region}...`)
        stats.regions_searched++

        for (const searchTerm of searchTermsToUse) {
          try {
            const searchUrl = `https://${region}.craigslist.org/search/cta?query=${encodeURIComponent(searchTerm)}&sort=date&max_auto_year=1991&min_auto_year=1973`
            
            console.log(`  Searching: ${searchTerm}`)
            stats.searches_performed++

            // Fetch search results with timeout
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout (increased for paid plan)

            try {
              const response = await fetch(searchUrl, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                signal: controller.signal
              })

              clearTimeout(timeoutId)

              if (!response.ok) {
                console.warn(`    ⚠️ Failed to fetch ${searchUrl}: ${response.status}`)
                continue
              }

              const html = await response.text()
              const doc = new DOMParser().parseFromString(html, 'text/html')

              if (!doc) continue

              // Extract listing URLs - try multiple selectors
              let foundInThisSearch = 0
              
              const selectors = [
                'a.result-title',
                'a[class*="result-title"]',
                '.result-row a',
                'a[href*="/cto/d/"]',
                'a[href*="/cta/d/"]',
                'li.result-row a',
                '.cl-search-result a'
              ]
              
              for (const selector of selectors) {
                const links = doc.querySelectorAll(selector)
                for (const link of links) {
                  const href = link.getAttribute('href')
                  if (href) {
                    const fullUrl = href.startsWith('http') 
                      ? href 
                      : `https://${region}.craigslist.org${href}`
                    
                    if (fullUrl.includes('/cto/d/') || fullUrl.includes('/cta/d/')) {
                      allListingUrls.add(fullUrl)
                      foundInThisSearch++
                    }
                  }
                }
                if (foundInThisSearch > 0) break
              }
              
              // Fallback: extract from HTML directly
              if (foundInThisSearch === 0) {
                const urlPattern = /https?:\/\/[^"'\s]+\/ct[ao]\/d\/[^"'\s]+/g
                const matches = html.match(urlPattern)
                if (matches) {
                  for (const match of matches) {
                    allListingUrls.add(match)
                    foundInThisSearch++
                  }
                }
              }

              console.log(`    ✅ Found ${foundInThisSearch} listings`)
              stats.listings_found += foundInThisSearch

            } catch (fetchError: any) {
              clearTimeout(timeoutId)
              if (fetchError.name === 'AbortError') {
                console.warn(`    ⏱️ Timeout fetching ${searchTerm}`)
              } else {
                console.warn(`    ⚠️ Error fetching ${searchTerm}:`, fetchError.message)
              }
              stats.errors++
            }

            // Rate limiting
            await new Promise(resolve => setTimeout(resolve, 800)) // Slightly increased delay

          } catch (error) {
            console.error(`    ❌ Error searching ${searchTerm} in ${region}:`, error)
            stats.errors++
          }
        }

        // Rate limiting between regions
        await new Promise(resolve => setTimeout(resolve, 800)) // Slightly increased delay

      } catch (error) {
        console.error(`❌ Error processing region ${region}:`, error)
        stats.errors++
      }
    }

    console.log(`\n📊 Total unique listings found: ${allListingUrls.size}`)
    
    // Add listings to queue (batch insert)
    const listingsToAdd = Array.from(allListingUrls).map(url => ({
      listing_url: url,
      status: 'pending',
      region: url.match(/https?:\/\/([^.]+)\.craigslist\.org/)?.[1] || null
    }))

    if (listingsToAdd.length > 0) {
      console.log(`📥 Adding ${listingsToAdd.length} listings to queue...`)
      
      // Insert in batches of 100 to avoid payload size limits
      const batchSize = 100
      for (let i = 0; i < listingsToAdd.length; i += batchSize) {
        const batch = listingsToAdd.slice(i, i + batchSize)
        
        const { data, error } = await supabase
          .from('craigslist_listing_queue')
          .upsert(batch, {
            onConflict: 'listing_url',
            ignoreDuplicates: true
          })
          .select('id')

        if (error) {
          console.error(`  ❌ Error inserting batch ${i / batchSize + 1}:`, error.message)
          stats.errors++
        } else {
          const added = data?.length || 0
          stats.listings_added_to_queue += added
          stats.listings_already_in_queue += (batch.length - added)
          console.log(`  ✅ Batch ${i / batchSize + 1}: Added ${added} new, ${batch.length - added} already existed`)
        }
      }
    }

    // Get queue stats
    const { count: pendingCount } = await supabase
      .from('craigslist_listing_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending')

    // Function chaining: self-invoke to continue processing if more regions remain
    // Determine which regions were processed and which remain
    const allRegions = regions || CRAIGSLIST_REGIONS
    const processedRegions = [...(regions_processed || []), ...regionsToSearch]
    const skippedRegions = skip_regions || []
    const remainingRegions = allRegions.filter(r => 
      !processedRegions.includes(r) && !skippedRegions.includes(r)
    )
    const hasMoreRegions = remainingRegions.length > 0 && (max_regions === null || processedRegions.length < max_regions)
    
    if (hasMoreRegions && chain_depth > 0) {
      const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || ''
      const invokeHeaders = authHeader 
        ? { Authorization: authHeader, 'Content-Type': 'application/json' }
        : { Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' }
      
      const fnBase = `${supabaseUrl.replace(/\/$/, '')}/functions/v1`
      const nextBody = {
        max_regions,
        max_searches_per_region,
        regions: remainingRegions.slice(0, max_regions || remainingRegions.length),
        chain_depth: chain_depth - 1,
        regions_processed: processedRegions,
        skip_regions: skippedRegions
      }
      
      // Fire-and-forget self-invocation (don't block response)
      fetch(`${fnBase}/discover-cl-squarebodies`, {
        method: 'POST',
        headers: invokeHeaders,
        body: JSON.stringify(nextBody)
      }).catch((err) => {
        console.warn('Self-invocation failed (non-blocking):', err.message)
      })
      
      console.log(`🔄 Self-invoking to continue discovery (chain_depth: ${chain_depth - 1}, remaining: ${remainingRegions.length} regions)`)
    }

    return new Response(
      JSON.stringify({
        success: true,
        stats: {
          ...stats,
          unique_listings_found: allListingUrls.size,
          pending_in_queue: pendingCount || 0
        },
        message: `Discovered ${allListingUrls.size} unique listings, added ${stats.listings_added_to_queue} to queue. ${stats.listings_already_in_queue} were already in queue.`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error: any) {
    console.error('Error in discover-cl-squarebodies:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

