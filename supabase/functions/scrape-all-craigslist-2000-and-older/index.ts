import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// All major Craigslist regions (comprehensive list)
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
  'grandjunction', 'durango', 'eastco', 'rockies', 'lasvegas', 'reno',
  'boise', 'saltlakecity', 'albuquerque', 'elpaso', 'sanantonio', 'fortworth',
  'tulsa', 'wichita', 'springfieldmo', 'fayar', 'littlerock', 'neworleans',
  'batonrouge', 'shreveport', 'jackson', 'birmingham', 'montgomery', 'chattanooga',
  'knoxville', 'lexington', 'charlestonwv', 'virginia', 'norfolk', 'richmond',
  'charlotte', 'columbia', 'savannah', 'jacksonville', 'orlando', 'tallahassee',
  'gainesville', 'maine', 'nh', 'vermont', 'worcester', 'cape', 'southcoast',
  'providence', 'newlondon', 'newjersey', 'delaware', 'annapolis', 'york',
  'allentown', 'harrisburg', 'erie', 'youngstown', 'akron', 'toledo', 'dayton',
  'grandrapids', 'lansing', 'southbend', 'fortwayne', 'madison', 'eastnc',
  'fargo', 'siouxfalls', 'omaha', 'lincoln', 'desmoines', 'columbiamo',
  'spokane', 'bellingham', 'eugene', 'bend', 'redding', 'chico', 'humboldt',
  'mendocino', 'santamaria', 'slo', 'sanluisobispo', 'bakersfield', 'fresno',
  'stockton', 'modesto', 'santabarbara', 'santacruz', 'monterey', 'ventura',
  'inlandempire', 'orangecounty', 'sandiego', 'losangeles', 'sfbay', 'sacramento'
]

// Price normalization - detect "15" should be "15000"
function normalizeVehiclePrice(rawPrice: number | null | undefined): { price: number | null; corrected: boolean; original: number | null } {
  if (rawPrice === null || rawPrice === undefined || rawPrice <= 0) {
    return { price: null, corrected: false, original: null };
  }
  
  // If price is under $500 for a vehicle, it's likely missing the "000"
  if (rawPrice > 0 && rawPrice < 500) {
    const correctedPrice = rawPrice * 1000;
    return { price: correctedPrice, corrected: true, original: rawPrice };
  }
  
  return { price: rawPrice, corrected: false, original: rawPrice };
}

// Search terms for vehicles 2000 and older
// Efficient strategies to catch everything without overwhelming the system
const SEARCH_STRATEGIES = [
  // Generic vintage/classic terms (broad coverage - catches most listings)
  { term: 'classic car', yearFilter: 'max_auto_year=2000' },
  { term: 'vintage car', yearFilter: 'max_auto_year=2000' },
  { term: 'antique car', yearFilter: 'max_auto_year=2000' },
  { term: 'collector car', yearFilter: 'max_auto_year=2000' },
  { term: 'muscle car', yearFilter: 'max_auto_year=2000' },
  { term: 'project car', yearFilter: 'max_auto_year=2000' },
  { term: 'restored', yearFilter: 'max_auto_year=2000' },
  { term: 'barn find', yearFilter: 'max_auto_year=2000' },
  
  // Search by decade (efficient way to catch everything)
  { term: '1950', yearFilter: 'max_auto_year=2000' },
  { term: '1960', yearFilter: 'max_auto_year=2000' },
  { term: '1970', yearFilter: 'max_auto_year=2000' },
  { term: '1980', yearFilter: 'max_auto_year=2000' },
  { term: '1990', yearFilter: 'max_auto_year=2000' },
  { term: '2000', yearFilter: 'max_auto_year=2000' },
  
  // Year range search (catch-all - should get everything in the range)
  { term: '', yearFilter: 'min_auto_year=1900&max_auto_year=2000' },
]

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { 
      max_regions = null, // null = all regions
      max_listings_per_search = 120, // CL shows up to 120 per page
      user_id,
      regions = null, // Optional: specific regions to search
      search_strategy = 'all' // 'all', 'decades', 'generic', 'ranges'
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

    // Get user_id for imports
    let importUserId = user_id
    
    if (!importUserId) {
      const { data: systemUser } = await supabase
        .from('profiles')
        .select('id')
        .or('email.eq.system@n-zero.dev,email.eq.admin@n-zero.dev')
        .limit(1)
        .maybeSingle()
      
      if (systemUser) {
        importUserId = systemUser.id
      } else {
        const { data: adminUser } = await supabase
          .from('profiles')
          .select('id')
          .eq('is_admin', true)
          .limit(1)
          .maybeSingle()
        
        if (adminUser) {
          importUserId = adminUser.id
        } else {
          const { data: firstUser } = await supabase
            .from('profiles')
            .select('id')
            .limit(1)
            .maybeSingle()
          
          if (firstUser) {
            importUserId = firstUser.id
          }
        }
      }
    }

    if (!importUserId) {
      return new Response(
        JSON.stringify({ success: false, error: 'No user_id found. Please provide user_id or ensure users exist.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    console.log('🚀 Starting comprehensive Craigslist import for vehicles 2000 and older')
    console.log(`Using user_id: ${importUserId}`)

    // Filter search strategies based on strategy param
    let strategiesToUse = SEARCH_STRATEGIES
    if (search_strategy === 'decades') {
      strategiesToUse = SEARCH_STRATEGIES.filter(s => s.term.match(/^\d{4}$/))
    } else if (search_strategy === 'generic') {
      strategiesToUse = SEARCH_STRATEGIES.filter(s => !s.term.match(/^\d{4}$/) && s.term !== '')
    } else if (search_strategy === 'ranges') {
      strategiesToUse = SEARCH_STRATEGIES.filter(s => s.term === '')
    }

    // Determine regions to search
    const regionsToSearch = regions || (max_regions ? CRAIGSLIST_REGIONS.slice(0, max_regions) : CRAIGSLIST_REGIONS)
    
    console.log(`📍 Searching ${regionsToSearch.length} regions`)
    console.log(`🔍 Using ${strategiesToUse.length} search strategies`)

    const stats = {
      regions_searched: 0,
      searches_performed: 0,
      listings_found: 0,
      listings_queued: 0,
      listings_skipped: 0,
      errors: 0,
      start_time: new Date().toISOString()
    }

    // Get or create import queue source
    const { data: queueSource } = await supabase
      .from('import_sources')
      .select('id')
      .eq('name', 'Craigslist - All Vehicles 2000 and Older')
      .maybeSingle()

    let sourceId = queueSource?.id
    if (!sourceId) {
      const { data: newSource, error: sourceError } = await supabase
        .from('import_sources')
        .insert({
          name: 'Craigslist - All Vehicles 2000 and Older',
          type: 'classifieds',
          base_url: 'https://craigslist.org',
          is_active: true
        })
        .select('id')
        .single()

      if (sourceError) {
        console.error('Error creating source:', sourceError)
      } else {
        sourceId = newSource.id
      }
    }

    // Process each region
    for (const region of regionsToSearch) {
      try {
        console.log(`\n📍 Searching ${region}...`)
        stats.regions_searched++

        for (const strategy of strategiesToUse) {
          try {
            // Build search URL with year filter
            const queryParam = strategy.term ? `query=${encodeURIComponent(strategy.term)}&` : ''
            const searchUrl = `https://${region}.craigslist.org/search/cta?${queryParam}sort=date&${strategy.yearFilter}`
            
            console.log(`  🔍 ${strategy.term || 'All vehicles 1900-2000'}`)
            stats.searches_performed++

            // Fetch search results with timeout
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 8000) // 8 second timeout
            const startTime = Date.now()

            try {
              const response = await fetch(searchUrl, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                signal: controller.signal
              })

              clearTimeout(timeoutId)
              const responseTime = Date.now() - startTime

              if (!response.ok) {
                console.error(`    ❌ HTTP ${response.status} (${responseTime}ms)`)
                stats.errors++
                continue
              }

              const html = await response.text()
              const doc = new DOMParser().parseFromString(html, 'text/html')

              if (!doc) {
                console.error(`    ❌ Failed to parse HTML`)
                stats.errors++
                continue
              }

              // Extract listing URLs from search results
              const listingUrls: string[] = []
              const links = doc.querySelectorAll('a.result-title')
              
              for (const link of links) {
                const href = link.getAttribute('href')
                if (href) {
                  // Convert relative URLs to absolute
                  const fullUrl = href.startsWith('http') 
                    ? href 
                    : `https://${region}.craigslist.org${href}`
                  listingUrls.push(fullUrl)
                }
              }

              console.log(`    ✅ Found ${listingUrls.length} listings (${responseTime}ms)`)

              // Add each listing to the import queue
              for (const listingUrl of listingUrls) {
                stats.listings_found++

                // Check if already in queue or already imported
                const { data: existingQueue } = await supabase
                  .from('import_queue')
                  .select('id, status')
                  .eq('listing_url', listingUrl)
                  .maybeSingle()

                if (existingQueue) {
                  stats.listings_skipped++
                  continue
                }

                // Check if vehicle already exists
                const { data: existingVehicle } = await supabase
                  .from('vehicles')
                  .select('id')
                  .eq('discovery_url', listingUrl)
                  .maybeSingle()

                if (existingVehicle) {
                  stats.listings_skipped++
                  continue
                }

                // Add to import queue
                const { error: queueError } = await supabase
                  .from('import_queue')
                  .insert({
                    listing_url: listingUrl,
                    source_id: sourceId,
                    status: 'pending',
                    priority: 0,
                    raw_data: {
                      region,
                      search_term: strategy.term || 'all-vehicles-1900-2000',
                      scraped_at: new Date().toISOString()
                    }
                  })

                if (queueError) {
                  console.error(`    ⚠️  Failed to queue ${listingUrl}:`, queueError.message)
                  stats.errors++
                } else {
                  stats.listings_queued++
                }
              }

              // Rate limit between searches
              await new Promise(resolve => setTimeout(resolve, 1000))

            } catch (fetchError: any) {
              clearTimeout(timeoutId)
              if (fetchError.name === 'AbortError') {
                console.error(`    ⏱️  Request timeout`)
              } else {
                console.error(`    ❌ Fetch error:`, fetchError.message)
              }
              stats.errors++
            }

          } catch (searchError: any) {
            console.error(`  ❌ Error searching ${strategy.term}:`, searchError.message)
            stats.errors++
          }
        }

        // Rate limit between regions
        await new Promise(resolve => setTimeout(resolve, 2000))

      } catch (regionError: any) {
        console.error(`❌ Error processing region ${region}:`, regionError.message)
        stats.errors++
      }
    }

    stats.end_time = new Date().toISOString()

    const summary = {
      success: true,
      stats,
      message: `Scraped ${stats.regions_searched} regions, found ${stats.listings_found} listings, queued ${stats.listings_queued} new listings`
    }

    console.log('\n✅ Import complete!')
    console.log(`📊 ${summary.message}`)

    return new Response(
      JSON.stringify(summary),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error: any) {
    console.error('❌ Fatal error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

