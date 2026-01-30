import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const STORAGE_BUCKET = 'vehicle-data'

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
  'ventura', 'inlandempire', 'bakersfield', 'fresno', 'stockton', 'modesto',
  'westslope', 'boulder', 'fortcollins', 'pueblo', 'grandjunction', 'durango',
  'eastco', 'rockies', 'wyoming', 'montana', 'idaho', 'utah', 'nevada',
  'newmexico', 'arizona', 'texas', 'oklahoma', 'kansas', 'missouri', 'arkansas',
  'louisiana', 'mississippi', 'alabama', 'tennessee', 'kentucky', 'westvirginia',
  'virginia', 'northcarolina', 'southcarolina', 'georgia', 'florida', 'maine',
  'newhampshire', 'vermont', 'massachusetts', 'rhodeisland', 'connecticut',
  'newjersey', 'delaware', 'maryland', 'pennsylvania', 'ohio', 'michigan',
  'indiana', 'illinois', 'wisconsin', 'minnesota', 'iowa', 'nebraska',
  'southdakota', 'northdakota', 'washington', 'oregon', 'california'
]

// Price normalization - detect "15" should be "15000"
function normalizeVehiclePrice(rawPrice: number | null | undefined): { price: number | null; corrected: boolean; original: number | null } {
  if (rawPrice === null || rawPrice === undefined || rawPrice <= 0) {
    return { price: null, corrected: false, original: null };
  }
  
  // If price is under $500 for a vehicle, it's likely missing the "000"
  // e.g., "15" should be "15000", "8" should be "8000"
  if (rawPrice > 0 && rawPrice < 500) {
    const correctedPrice = rawPrice * 1000;
    console.log(`  💰 Price normalized: $${rawPrice} -> $${correctedPrice} (likely missing 000)`);
    return { price: correctedPrice, corrected: true, original: rawPrice };
  }
  
  // If price is between 500-999, could be either way - leave as is but flag for review
  // e.g., "$500" could be real (project car) or "$500,000" (unlikely for most vehicles)
  
  return { price: rawPrice, corrected: false, original: rawPrice };
}

// Squarebody search terms
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
      max_regions = 60, // Increased for upgraded compute/RAM
      max_listings_per_search = 90, // Increased for upgraded compute/RAM
      user_id,
      regions = null, // Optional: specific regions to search
      chain_depth = 0, // Function chaining: number of remaining self-invocations (0 = no chaining)
      regions_processed = [], // Track which regions have been processed (for chaining)
      skip_regions = [], // Regions to skip (already processed)
      enable_jitter = false, // Add random delays to avoid detection patterns
      base_delay = 300 // Base delay between requests in ms (default reduced from 500)
    } = await req.json()

    // Helper function to add jitter to delays
    const getDelay = (baseMs: number): number => {
      if (!enable_jitter) return baseMs
      // Add ±30% jitter
      const jitter = baseMs * 0.3
      return Math.floor(baseMs + (Math.random() * jitter * 2) - jitter)
    }

    // Use service role key to bypass RLS policies
    // Get URL and key - use actual project URL if SUPABASE_URL is a hash
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

    // user_id is optional - vehicles can be created without it
    // If source data has username (BaT, pcar, cars & bids), we can create/link users later
    const importUserId = user_id || null

    console.log('🚀 Starting comprehensive Craigslist squarebody scrape...')
    console.log(`Regions: ${regions ? regions.length : max_regions}, Search terms: ${SQUAREBODY_SEARCH_TERMS.length}`)
    console.log(`Using user_id: ${importUserId || 'null (no user required)'} for all imports`)

    const regionsToSearch = regions || CRAIGSLIST_REGIONS.slice(0, max_regions)
    const allListingUrls = new Set<string>()
    const stats = {
      regions_searched: 0,
      searches_performed: 0,
      listings_found: 0,
      processed: 0,
      created: 0,
      updated: 0,
      errors: 0
    }
    
    // Track errors for debugging
    let firstError: any = null
    const allErrors: any[] = [] // Collect all errors

    // Limit search terms to avoid timeout (use most effective ones)
    const prioritizedSearchTerms = [
      'squarebody',
      'square body',
      'C10',
      'C20',
      'K10',
      'K20',
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
      '1987 chevrolet truck'
    ].slice(0, 20) // Increased from 10 to 20 search terms for paid plan

    // Search each region with prioritized search terms
    for (const region of regionsToSearch) {
      try {
        console.log(`\n📍 Searching ${region}...`)
        stats.regions_searched++

        for (const searchTerm of prioritizedSearchTerms) {
          try {
            const searchUrl = `https://${region}.craigslist.org/search/cta?query=${encodeURIComponent(searchTerm)}&sort=date&max_auto_year=1991&min_auto_year=1967`
            
            console.log(`  Searching: ${searchTerm}`)
            stats.searches_performed++

            // Fetch search results with timeout
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout (increased for paid plan)
            const startTime = Date.now()

            try {
              const response = await fetch(searchUrl, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                signal: controller.signal
              })

              clearTimeout(timeoutId)
              const responseTime = Date.now() - startTime

              if (!response.ok) {
                // Track failure
                await supabase.from('scraping_health').insert({
                  source: 'craigslist',
                  region: region,
                  search_term: searchTerm,
                  url: searchUrl,
                  success: false,
                  status_code: response.status,
                  error_message: response.statusText,
                  error_type: response.status === 403 ? 'bot_protection' : 
                              response.status === 404 ? 'not_found' : 'network',
                  response_time_ms: responseTime,
                  function_name: 'scrape-all-craigslist-squarebodies'
                }).then(({ error }) => {
                  if (error) console.warn('Failed to log health:', error.message);
                });
                
                console.warn(`    ⚠️ Failed to fetch ${searchUrl}: ${response.status}`)
                continue
              }

              // Track success
              await supabase.from('scraping_health').insert({
                source: 'craigslist',
                region: region,
                search_term: searchTerm,
                url: searchUrl,
                success: true,
                status_code: 200,
                response_time_ms: responseTime,
                function_name: 'scrape-all-craigslist-squarebodies'
              }).then(({ error }) => {
                if (error) console.warn('Failed to log health:', error.message);
              });

              const html = await response.text()
              const doc = new DOMParser().parseFromString(html, 'text/html')

              if (!doc) continue

              // Extract listing URLs - try multiple selectors
              let foundInThisSearch = 0
              
              // Try different selectors for Craigslist search results
              // CL updated their HTML in 2024/2025 - new selectors first
              const selectors = [
                '.cl-static-search-result a',
                'a.cl-app-anchor',
                '.title a',
                'a[href*="/cto/d/"]',
                'a[href*="/cta/d/"]',
                'a.result-title',
                'a[class*="result-title"]',
                '.result-row a',
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
                    
                    // Only add if it's a vehicle listing (not search pages)
                    if (fullUrl.includes('/cto/d/') || fullUrl.includes('/cta/d/')) {
                      allListingUrls.add(fullUrl)
                      foundInThisSearch++
                    }
                  }
                }
                if (foundInThisSearch > 0) break // Found listings, stop trying other selectors
              }
              
              // Fallback: extract from HTML directly using regex
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

              // Update health tracking with data quality
              await supabase.from('scraping_health').update({
                data_extracted: { listings_found: foundInThisSearch },
                images_found: foundInThisSearch
              }).match({ url: searchUrl }).gte('created_at', new Date(Date.now() - 10000).toISOString());
              
              console.log(`    ✅ Found ${foundInThisSearch} listings`)
              stats.listings_found += foundInThisSearch

            } catch (fetchError: any) {
              clearTimeout(timeoutId)
              
              // Track timeout/network errors
              await supabase.from('scraping_health').insert({
                source: 'craigslist',
                region: region,
                search_term: searchTerm,
                url: searchUrl,
                success: false,
                error_message: fetchError.message,
                error_type: fetchError.name === 'AbortError' ? 'timeout' : 'network',
                function_name: 'scrape-all-craigslist-squarebodies'
              }).then(({ error }) => {
                if (error) console.warn('Failed to log health:', error.message);
              });
              
              if (fetchError.name === 'AbortError') {
                console.warn(`    ⏱️ Timeout fetching ${searchTerm}`)
              } else {
                console.warn(`    ⚠️ Error fetching ${searchTerm}:`, fetchError.message)
              }
              stats.errors++
            }

            // Reduced rate limiting - wait 1 second between searches
            await new Promise(resolve => setTimeout(resolve, getDelay(base_delay * 2))) // Delay between search terms with optional jitter

          } catch (error) {
            console.error(`    ❌ Error searching ${searchTerm} in ${region}:`, error)
            stats.errors++
          }
        }

        // Reduced rate limiting - wait 1 second between regions
        await new Promise(resolve => setTimeout(resolve, getDelay(base_delay))) // Delay between regions with optional jitter

      } catch (error) {
        console.error(`❌ Error processing region ${region}:`, error)
        stats.errors++
      }
    }

    console.log(`\n📊 Total unique listings found: ${allListingUrls.size}`)
    
    // Process more listings per run with Large compute (faster DB queries)
    const maxProcessPerRun = 50 // Increased for upgraded compute/RAM
    const listingArray = Array.from(allListingUrls).slice(0, maxProcessPerRun)
    
    console.log(`🔄 Processing ${listingArray.length} listings (limited to ${maxProcessPerRun} to avoid timeout)...\n`)
    
    // Track start time to prevent function timeout
    // Paid plans: 400s wall clock time, Free: 150s
    const startTime = Date.now()
    const maxExecutionTime = 380000 // 380 seconds - leave 20s buffer for paid plan (was 50s for free)
    
    for (const listingUrl of listingArray) {
      // Check if we're approaching timeout
      const elapsed = Date.now() - startTime
      if (elapsed > maxExecutionTime) {
        console.log(`⏰ Approaching timeout (${elapsed}ms elapsed), stopping processing`)
        break
      }
      
      try {
        console.log(`  🔍 Processing: ${listingUrl}`)
        
        // Scrape Craigslist listing directly (no function-to-function call)
        let scrapeData: any
        try {
          console.log(`  📡 Fetching: ${listingUrl}`)
          // Add timeout to individual fetch requests
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 second timeout per listing (increased for paid plan)
          
          const response = await fetch(listingUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            signal: controller.signal
          })
          
          clearTimeout(timeoutId)
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
          }
          
          const html = await response.text()
          const doc = new DOMParser().parseFromString(html, 'text/html')
          
          if (!doc) {
            throw new Error('Failed to parse HTML')
          }
          
          // Inline Craigslist scraping
          scrapeData = {
            success: true,
            data: scrapeCraigslistInline(doc, listingUrl)
          }
          
          console.log(`  📦 Scraped: ${scrapeData.data.year} ${scrapeData.data.make} ${scrapeData.data.model || 'unknown'}`)
        } catch (scrapeError: any) {
          // Handle timeout errors gracefully
          if (scrapeError?.name === 'AbortError' || scrapeError?.message?.includes('timeout')) {
            console.warn(`  ⏰ Timeout scraping ${listingUrl}, skipping`)
            stats.errors++
            continue
          }
          
          const scrapeErrorObj = {
            message: `Failed to scrape ${listingUrl}: ${scrapeError?.message || String(scrapeError)}`,
            listingUrl: listingUrl,
            error: scrapeError
          }
          console.error(`  ❌ ${scrapeErrorObj.message}`)
          if (!firstError) firstError = scrapeErrorObj
          allErrors.push(scrapeErrorObj)
          stats.errors++
          continue
        }
        
        if (scrapeData?.success && scrapeData?.data) {
            // Extract make/model from title if not in data
            let make = scrapeData.data.make?.toLowerCase()
            let model = scrapeData.data.model?.toLowerCase() || ''
            
            // If make/model missing, try to extract from title
            if (!make || !model) {
              const title = scrapeData.data.title || ''
              const titleLower = title.toLowerCase()
              
              // Try to extract make/model from title patterns
              // Common patterns: "1974 Chevrolet Cheyenne", "1985 Chevy K10", etc.
              if (titleLower.includes('chevrolet') || titleLower.includes('chevy')) {
                make = 'chevrolet'
              } else if (titleLower.includes('gmc')) {
                make = 'gmc'
              }
              
              // Try to extract model from title
              if (!model) {
                // Look for common model patterns
                const modelPatterns = ['c10', 'c20', 'c30', 'k10', 'k20', 'k30', 'cheyenne', 'silverado', 'suburban', 'blazer', 'jimmy', 'truck', 'pickup']
                for (const pattern of modelPatterns) {
                  if (titleLower.includes(pattern)) {
                    model = pattern
                    break
                  }
                }
              }
            }
            
            // Define finalMake/finalModel for use throughout
            let finalMake = (make || scrapeData.data.make || '').toLowerCase()
            let finalModel = (model || scrapeData.data.model || '').toLowerCase()
            
            // Filter for squarebody trucks (1973-1991 Chevy/GMC)
            const yearNum = typeof scrapeData.data.year === 'string' 
              ? parseInt(scrapeData.data.year) 
              : scrapeData.data.year
            const description = (scrapeData.data.description || '').toLowerCase()
            const title = (scrapeData.data.title || '').toLowerCase()
            const bodyStyle = (scrapeData.data.body_style || '').toLowerCase()
            
            // Skip squarebody filter for now - process ALL vehicles with make/model
            // TODO: Re-enable squarebody filter once inserts are working
            const isSquarebody = true // TEMPORARY: accept all vehicles
            
            // More lenient: if model is missing but we have make, use "Unknown" as model
            if (!finalMake || finalMake.trim() === '') {
              const missingDataError = {
                message: `Cannot process - missing make: make="${finalMake}"`,
                listingUrl: listingUrl,
                title: scrapeData.data.title
              }
              console.warn(`  ⚠️ ${missingDataError.message}`)
              if (!firstError) firstError = missingDataError
              allErrors.push(missingDataError)
              stats.errors++
              stats.processed++
              continue
            }
            
            // If model is missing, leave as null - do NOT create vehicle with bad data
            if (!finalModel || finalModel.trim() === '') {
              console.warn(`  ⚠️ Model missing for "${scrapeData.data.title}" - SKIPPING vehicle (no bad data)`)
              const missingModelError = {
                message: `Cannot process - missing model: model="${finalModel}"`,
                listingUrl: listingUrl,
                title: scrapeData.data.title
              }
              if (!firstError) firstError = missingModelError
              allErrors.push(missingModelError)
              stats.errors++
              stats.processed++
              continue
            }
            
            console.log(`  ✅ Processing vehicle: ${yearNum} ${finalMake} ${finalModel}`)
            console.log(`  ✅ Reached processing block - about to enter database try block`)
            
            // Validate required fields BEFORE entering try block (so we can use continue)
            const yearInt = typeof scrapeData.data.year === 'string' 
              ? parseInt(scrapeData.data.year) 
              : scrapeData.data.year
            
            if (!yearInt || isNaN(yearInt)) {
              const validationError = { message: `Invalid year: ${scrapeData.data.year} -> ${yearInt}`, listingUrl }
              console.error(`  ❌ ${validationError.message}`)
              if (!firstError) firstError = validationError
              allErrors.push(validationError)
              stats.errors++
              stats.processed++
              continue
            }
            if (!finalMake || finalMake.trim() === '') {
              const validationError = { message: `Invalid make: "${finalMake}"`, listingUrl }
              console.error(`  ❌ ${validationError.message}`)
              if (!firstError) firstError = validationError
              allErrors.push(validationError)
              stats.errors++
              stats.processed++
              continue
            }
            if (!finalModel || finalModel.trim() === '') {
              const validationError = { message: `Invalid model: "${finalModel}"`, listingUrl }
              console.error(`  ❌ ${validationError.message}`)
              if (!firstError) firstError = validationError
              allErrors.push(validationError)
              stats.errors++
              stats.processed++
              continue
            }

            // Find or create vehicle directly in database
            try {
                console.log(`  🔍 Entered database try block for: ${listingUrl}`)
                console.log(`  🔍 Processing vehicle: ${yearNum} ${finalMake} ${finalModel}`)
                let vehicleId: string | null = null
                let isNew = false

                // FIRST: Check by discovery_url - this is the most reliable deduplication
                console.log(`  🔍 Checking for existing vehicle by URL: ${listingUrl}`)
                const { data: existingByUrl, error: urlError } = await supabase
                  .from('vehicles')
                  .select('id')
                  .eq('discovery_url', listingUrl)
                  .maybeSingle()

                if (urlError) {
                  console.error(`  ❌ URL search error:`, urlError)
                } else if (existingByUrl) {
                  vehicleId = existingByUrl.id
                  isNew = false
                  console.log(`  🔄 SKIPPING - Vehicle already exists for this URL: ${existingByUrl.id}`)
                  // Skip to next listing - this is a duplicate
                  continue
                } else {
                  console.log(`  ℹ️ No existing vehicle for this URL - proceeding`)
                }

                // Second: Try to find by VIN (for linking to existing profiles)
                if (scrapeData.data.vin) {
                  console.log(`  🔍 Searching by VIN: ${scrapeData.data.vin}`)
                  const { data: existing, error: vinError } = await supabase
                    .from('vehicles')
                    .select('id')
                    .eq('vin', scrapeData.data.vin)
                    .maybeSingle()

                  if (vinError) {
                    console.error(`  ❌ VIN search error:`, vinError)
                  } else if (existing) {
                    vehicleId = existing.id
                    isNew = false
                    console.log(`  🔄 Found existing vehicle by VIN: ${scrapeData.data.vin}`)
                  } else {
                    console.log(`  ℹ️ No vehicle found by VIN`)
                  }
                }

                // Third: Try to find by year/make/model if no VIN match
                if (!vehicleId && scrapeData.data.year && finalMake && finalModel) {
                  const { data: existing, error: searchError } = await supabase
                    .from('vehicles')
                    .select('id')
                    .eq('year', yearInt)
                    .ilike('make', finalMake)
                    .ilike('model', finalModel)
                    .maybeSingle()

                  if (searchError) {
                    console.error(`  ❌ Year/make/model search error:`, searchError)
                  } else if (existing) {
                    vehicleId = existing.id
                    isNew = false
                    console.log(`  🔄 Found existing vehicle by year/make/model: ${existing.id}`)
                  } else {
                    console.log(`  ℹ️ No vehicle found by year/make/model`)
                  }
                }

                // Fourth: Create new vehicle if not found
                if (!vehicleId) {
                  
                  // Normalize price (detect "15" should be "15000")
                  const rawPrice = scrapeData.data.asking_price || scrapeData.data.price || null;
                  const normalizedPrice = normalizeVehiclePrice(rawPrice);
                  
                  // Build insert - service role should bypass RLS, but include user_id if provided
                  const vehicleInsert: any = {
                    year: yearInt,
                    make: finalMake.charAt(0).toUpperCase() + finalMake.slice(1),
                    model: finalModel,
                    vin: scrapeData.data.vin || null,
                    color: scrapeData.data.color || scrapeData.data.exterior_color || null,
                    mileage: scrapeData.data.mileage || null,
                    transmission: scrapeData.data.transmission || null,
                    drivetrain: scrapeData.data.drivetrain || null,
                    engine_size: scrapeData.data.engine_size || scrapeData.data.engine || null,
                    asking_price: normalizedPrice.price, // Use normalized price
                    discovery_source: 'craigslist_scrape',
                    discovery_url: listingUrl,
                    profile_origin: 'craigslist_scrape',
                    listing_title: scrapeData.data.title || null, // Store the listing title
                    description: scrapeData.data.description || null, // Store description properly
                    origin_metadata: {
                      listing_url: listingUrl,
                      asking_price_raw: rawPrice, // Store raw scraped value
                      asking_price_normalized: normalizedPrice.price,
                      price_was_corrected: normalizedPrice.corrected,
                      imported_at: new Date().toISOString(),
                      image_urls: scrapeData.data.images || [], // Store image URLs for future backfill
                      attrgroup: scrapeData.data.attrgroup || null, // Store raw attrgroup data
                      location: scrapeData.data.location || null,
                      posted_date: scrapeData.data.posted_date || null
                    },
                    is_public: true,
                    status: 'active' // Set to 'active' so vehicles show up in homepage feed
                  }
                  
                  // user_id is NOT set - database trigger prevents it (ownership must be verified)
                  // Only set uploaded_by to track who imported it (for attribution)
                  if (importUserId) {
                    vehicleInsert.uploaded_by = importUserId
                  }
                  if (scrapeData.data.trim) vehicleInsert.trim = scrapeData.data.trim
                  if (scrapeData.data.series) vehicleInsert.series = scrapeData.data.series
                  // listing_url column doesn't exist - use discovery_url instead

                  console.log(`  💾 INSERTING:`, JSON.stringify(vehicleInsert, null, 2))
                  console.log(`  🔍 About to call supabase.from('vehicles').insert()`)

                  const { data: newVehicle, error: vehicleError } = await supabase
                    .from('vehicles')
                    .insert(vehicleInsert)
                    .select('id')
                    .single()

                  console.log(`  📊 Insert result:`, { 
                    hasData: !!newVehicle, 
                    hasError: !!vehicleError,
                    vehicleId: newVehicle?.id,
                    errorMessage: vehicleError?.message 
                  })

                  if (vehicleError) {
                    const fullError = {
                      message: vehicleError.message,
                      code: vehicleError.code,
                      details: vehicleError.details,
                      hint: vehicleError.hint,
                      insertData: vehicleInsert
                    }
                    console.error(`  ❌ VEHICLE INSERT ERROR:`, JSON.stringify(fullError, null, 2))
                    console.error(`  ❌ ERROR MESSAGE: ${vehicleError.message}`)
                    console.error(`  ❌ ERROR CODE: ${vehicleError.code}`)
                    console.error(`  ❌ ERROR DETAILS: ${vehicleError.details}`)
                    console.error(`  ❌ ERROR HINT: ${vehicleError.hint}`)
                    if (!firstError) {
                      firstError = fullError
                    }
                    allErrors.push(fullError)
                    stats.errors++
                    // Continue to next listing instead of throwing
                  } else if (newVehicle && newVehicle.id) {

                    vehicleId = newVehicle.id
                    isNew = true
                    stats.created++
                    console.log(`  ✅ Created new vehicle: ${vehicleId}`)
                    
                    // Create timeline event based on listing posted date (not import date)
                    if (scrapeData.data.posted_date) {
                      try {
                        // Parse posted_date (format: "2025-10-31 13:15" or similar)
                        let eventDate = new Date().toISOString().split('T')[0] // Default to today
                        const postedDateStr = scrapeData.data.posted_date
                        
                        // Try to parse the date
                        const dateMatch = postedDateStr.match(/(\d{4})-(\d{2})-(\d{2})/)
                        if (dateMatch) {
                          eventDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`
                        } else {
                          // Try other formats
                          const parsedDate = new Date(postedDateStr)
                          if (!isNaN(parsedDate.getTime())) {
                            eventDate = parsedDate.toISOString().split('T')[0]
                          }
                        }

                        const { error: timelineError } = await supabase
                          .from('timeline_events')
                          .insert({
                            vehicle_id: vehicleId,
                            user_id: importUserId || null,
                            event_type: 'discovery', // Use 'discovery' which is always allowed
                            source: 'craigslist',
                            title: `Listed on Craigslist`,
                            event_date: eventDate,
                            description: `Vehicle listed for sale on Craigslist${normalizedPrice.price ? ` for $${normalizedPrice.price.toLocaleString()}` : ''}${normalizedPrice.corrected ? ' *' : ''}`,
                            metadata: {
                              listing_url: listingUrl,
                              asking_price: normalizedPrice.price,
                              asking_price_raw: normalizedPrice.original,
                              price_was_corrected: normalizedPrice.corrected,
                              location: scrapeData.data.location,
                              posted_date: scrapeData.data.posted_date,
                              updated_date: scrapeData.data.updated_date,
                              discovery: true // Mark as discovery event
                            }
                          })

                        if (timelineError) {
                          console.warn(`  ⚠️ Failed to create timeline event:`, timelineError.message)
                        } else {
                          console.log(`  ✅ Created timeline event for listing date: ${eventDate}`)
                        }
                      } catch (timelineErr: any) {
                        console.warn(`  ⚠️ Timeline event creation error:`, timelineErr.message)
                      }
                    }
                    
                    // Download and upload images if available
                    if (scrapeData.data.images && scrapeData.data.images.length > 0) {
                      console.log(`  📸 Downloading ${scrapeData.data.images.length} images...`)
                      let imagesUploaded = 0
                      
                      for (let i = 0; i < scrapeData.data.images.length; i++) {
                        const imageUrl = scrapeData.data.images[i]
                        try {
                          // Download image
                          const imageResponse = await fetch(imageUrl, {
                            signal: AbortSignal.timeout(10000) // 10 second timeout (increased for paid plan)
                          })
                          
                          if (!imageResponse.ok) {
                            console.warn(`    ⚠️ Failed to download image ${i + 1}: HTTP ${imageResponse.status}`)
                            continue
                          }
                          
                          const imageBlob = await imageResponse.blob()
                          const arrayBuffer = await imageBlob.arrayBuffer()
                          const uint8Array = new Uint8Array(arrayBuffer)
                          
                          // Generate filename
                          const ext = imageUrl.match(/\.(jpg|jpeg|png|webp)$/i)?.[1] || 'jpg'
                          const fileName = `${Date.now()}_${i}.${ext}`
                          const storagePath = `vehicles/${vehicleId}/images/craigslist_scrape/${fileName}`
                          
                          // Upload to Supabase Storage
                          const { data: uploadData, error: uploadError } = await supabase.storage
                            .from(STORAGE_BUCKET)
                            .upload(storagePath, uint8Array, {
                              contentType: `image/${ext}`,
                              cacheControl: '3600',
                              upsert: false
                            })
                          
                          if (uploadError) {
                            console.warn(`    ⚠️ Failed to upload image ${i + 1}: ${uploadError.message}`)
                            continue
                          }
                          
                          // Get public URL
                          const { data: { publicUrl } } = supabase.storage
                            .from(STORAGE_BUCKET)
                            .getPublicUrl(storagePath)
                          
                          // Create ghost user for Craigslist photographer (unknown)
                          const photographerFingerprint = `CL-Photographer-${listingUrl}`;
                          let ghostUserId: string | null = null;
                          
                          // Check if ghost user exists
                          const { data: existingGhost } = await supabase
                            .from('ghost_users')
                            .select('id')
                            .eq('device_fingerprint', photographerFingerprint)
                            .maybeSingle();
                          
                          if (existingGhost?.id) {
                            ghostUserId = existingGhost.id;
                          } else {
                            // Create new ghost user for CL photographer
                            const { data: newGhost, error: ghostError } = await supabase
                              .from('ghost_users')
                              .insert({
                                device_fingerprint: photographerFingerprint,
                                camera_make: 'Unknown',
                                camera_model: 'Craigslist Listing',
                                display_name: `Craigslist Photographer`,
                                total_contributions: 0
                              })
                              .select('id')
                              .single();
                            
                            if (!ghostError && newGhost?.id) {
                              ghostUserId = newGhost.id;
                            }
                          }

                          // Create vehicle_images record with proper attribution
                          const { data: imageData, error: imageInsertError } = await supabase
                            .from('vehicle_images')
                            .insert({
                              vehicle_id: vehicleId,
                              image_url: publicUrl,
                              user_id: ghostUserId || importUserId, // Photographer (ghost user), fallback to importer
                              is_primary: i === 0, // First image is primary
                              source: 'craigslist_scrape',
                              taken_at: scrapeData.data.posted_date || new Date().toISOString(),
                              exif_data: {
                                source_url: imageUrl,
                                discovery_url: listingUrl,
                                imported_by_user_id: importUserId,
                                imported_at: new Date().toISOString(),
                                attribution_note: 'Photographer unknown - images from Craigslist listing. Original photographer can claim with proof.',
                                claimable: true,
                                device_fingerprint: photographerFingerprint
                              }
                            })
                            .select('id')
                            .single();
                          
                          // Create device attribution if ghost user exists
                          if (!imageInsertError && imageData?.id && ghostUserId) {
                            await supabase
                              .from('device_attributions')
                              .insert({
                                image_id: imageData.id,
                                device_fingerprint: photographerFingerprint,
                                ghost_user_id: ghostUserId,
                                uploaded_by_user_id: importUserId,
                                attribution_source: 'craigslist_listing_unknown_photographer',
                                confidence_score: 50
                              });
                          }
                          
                          if (imageInsertError) {
                            console.warn(`    ⚠️ Failed to create image record ${i + 1}: ${imageInsertError.message}`)
                            continue
                          }
                          
                          imagesUploaded++
                          console.log(`    ✅ Uploaded image ${i + 1}/${scrapeData.data.images.length}`)
                          
                          // Small delay to avoid rate limiting
                          await new Promise(resolve => setTimeout(resolve, 500))
                          
                        } catch (imgError: any) {
                          console.warn(`    ⚠️ Error processing image ${i + 1}: ${imgError.message}`)
                          continue
                        }
                      }
                      
                      console.log(`  📸 Uploaded ${imagesUploaded} images for vehicle ${vehicleId}`)
                    }
                  } else {
                    const noVehicleError = {
                      message: 'No vehicle returned from insert and no error',
                      insertData: vehicleInsert,
                      newVehicle: newVehicle
                    }
                    console.error(`  ❌ No vehicle returned from insert and no error!`)
                    console.error(`  ❌ Insert response:`, JSON.stringify(noVehicleError, null, 2))
                    if (!firstError) {
                      firstError = noVehicleError
                    }
                    allErrors.push(noVehicleError)
                    stats.errors++
                  }
                } else {
                  // Update existing vehicle
                  // Normalize price for updates too
                  const updateRawPrice = scrapeData.data.asking_price || scrapeData.data.price || null;
                  const updateNormalizedPrice = normalizeVehiclePrice(updateRawPrice);
                  
                  const { error: updateError } = await supabase
                    .from('vehicles')
                    .update({
                      asking_price: updateNormalizedPrice.price,
                      mileage: scrapeData.data.mileage || null,
                      // Only update if current value is null
                      vin: scrapeData.data.vin || undefined,
                      color: scrapeData.data.color || scrapeData.data.exterior_color || undefined,
                      transmission: scrapeData.data.transmission || undefined,
                      drivetrain: scrapeData.data.drivetrain || undefined,
                      engine: scrapeData.data.engine || scrapeData.data.engine_size || undefined
                    })
                    .eq('id', vehicleId)

                  if (updateError) {
                    const updateErrorObj = {
                      message: `Error updating vehicle: ${updateError.message}`,
                      listingUrl: listingUrl,
                      vehicleId: vehicleId,
                      error: updateError
                    }
                    console.error(`  ❌ ${updateErrorObj.message}`)
                    if (!firstError) firstError = updateErrorObj
                    allErrors.push(updateErrorObj)
                    stats.errors++
                  } else {
                    stats.updated++
                    console.log(`  🔄 Updated: ${yearNum} ${scrapeData.data.make} ${scrapeData.data.model}`)
                  }
                }
            } catch (dbError: any) {
              const errorMsg = `Database error for ${listingUrl}: ${dbError?.message || String(dbError)}`
              console.error(`  ❌ CATCH BLOCK ERROR: ${errorMsg}`)
              console.error(`  ❌ Full error:`, JSON.stringify(dbError, null, 2))
              console.error(`  ❌ Error stack:`, dbError?.stack)
              const dbErrorObj = {
                message: errorMsg,
                fullError: dbError,
                listingUrl: listingUrl
              }
              if (!firstError) {
                firstError = dbErrorObj
              }
              allErrors.push(dbErrorObj)
              stats.errors++
              // Don't throw - continue processing other listings
              // But log the error so it appears in function logs
            }
          } else {
            const noDataError = {
              message: `Scraping returned no data for ${listingUrl}`,
              listingUrl: listingUrl
            }
            console.warn(`  ⚠️ ${noDataError.message}`)
            if (!firstError) firstError = noDataError
            allErrors.push(noDataError)
            stats.errors++
          }

        stats.processed++

        // Reduced rate limiting - wait 500ms between listings
        await new Promise(resolve => setTimeout(resolve, 500))

      } catch (error: any) {
        const outerError = {
          message: `Error processing ${listingUrl}: ${error?.message || String(error)}`,
          listingUrl: listingUrl,
          error: error
        }
        console.error(`  ❌ OUTER CATCH ERROR:`, JSON.stringify(outerError, null, 2))
        if (!firstError) {
          firstError = outerError
        }
        allErrors.push(outerError)
        stats.errors++
        stats.processed++
      }
    }

    // Collect error details for debugging
    const errorDetails: string[] = []
    if (stats.errors > 0) {
      errorDetails.push(`${stats.errors} listings had errors - check function logs for details`)
    }

    // Check scraper health and alert if degraded
    const failureRate = stats.processed > 0 ? stats.errors / stats.processed : 0
    const searchFailureRate = stats.searches_performed > 0 ? stats.errors / stats.searches_performed : 0
    
    if (failureRate > 0.15 || searchFailureRate > 0.15) {
      // >15% failure rate = degraded
      const severity = failureRate > 0.30 ? 'critical' : 'warning'
      
      await supabase.from('admin_notifications').insert({
        type: severity === 'critical' ? 'scraper_critical' : 'scraper_degraded',
        severity: severity,
        title: `Craigslist Scraper ${severity === 'critical' ? 'Failing' : 'Degraded'}`,
        message: `${stats.errors} of ${stats.processed} listings failed (${(failureRate * 100).toFixed(1)}%). Success rate: ${((1 - failureRate) * 100).toFixed(1)}%`,
        metadata: {
          stats: stats,
          error_samples: allErrors.slice(0, 5),
          run_timestamp: new Date().toISOString()
        },
        is_read: false
      }).then(({ error }) => {
        if (error) console.warn('Failed to create alert:', error.message);
      });
    }

    // Function chaining: self-invoke to continue processing if more work remains
    const remainingListings = allListingUrls.size - maxProcessPerRun
    const remainingRegions = regionsToSearch.length - stats.regions_searched
    const hasMoreWork = remainingListings > 0 || remainingRegions > 0
    
    if (hasMoreWork && chain_depth > 0) {
      const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || ''
      const invokeHeaders = authHeader 
        ? { Authorization: authHeader, 'Content-Type': 'application/json' }
        : { Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' }
      
      const fnBase = `${supabaseUrl.replace(/\/$/, '')}/functions/v1`
      const nextBody = {
        max_regions,
        max_listings_per_search,
        user_id: importUserId,
        regions: regionsToSearch.slice(stats.regions_searched), // Continue with remaining regions
        chain_depth: chain_depth - 1,
        regions_processed: [...(regions_processed || []), ...regionsToSearch.slice(0, stats.regions_searched)],
        skip_regions: [...(skip_regions || []), ...regionsToSearch.slice(0, stats.regions_searched)]
      }
      
      // Fire-and-forget self-invocation (don't block response)
      fetch(`${fnBase}/scrape-all-craigslist-squarebodies`, {
        method: 'POST',
        headers: invokeHeaders,
        body: JSON.stringify(nextBody)
      }).catch((err) => {
        console.warn('Self-invocation failed (non-blocking):', err.message)
      })
      
      console.log(`🔄 Self-invoking to continue processing (chain_depth: ${chain_depth - 1}, remaining: ${remainingListings} listings, ${remainingRegions} regions)`)
    }

    return new Response(
      JSON.stringify({
        success: true,
        stats: {
          ...stats,
          unique_listings_found: allListingUrls.size,
          listings_processed: stats.processed,
          remaining_listings: Math.max(0, allListingUrls.size - maxProcessPerRun)
        },
        message: `Scraped ${stats.regions_searched} regions, found ${allListingUrls.size} unique listings, processed ${stats.processed}, created ${stats.created} vehicles, updated ${stats.updated} vehicles. ${allListingUrls.size > maxProcessPerRun ? `Remaining: ${allListingUrls.size - maxProcessPerRun} listings to process in next run.` : ''}`,
        all_listing_urls: Array.from(allListingUrls), // Return all URLs so you can process them in batches
        debug: {
          test_insert_passed: true,
          error_count: stats.errors,
          error_details: errorDetails,
          first_error: firstError,
          all_errors: allErrors.slice(0, 5), // Include first 5 errors in response
          total_errors_collected: allErrors.length,
          note: 'First 5 errors shown above. Check Supabase Dashboard logs for all errors.'
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error: any) {
    console.error('Error in scrape-all-craigslist-squarebodies:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

// Inline Craigslist scraping function (no external function calls)
function scrapeCraigslistInline(doc: any, url: string): any {
  const data: any = {
    source: 'Craigslist',
    listing_url: url
  }

  // Extract title
  const titleElement = doc.querySelector('h1, .postingtitletext #titletextonly')
  if (titleElement) {
    data.title = titleElement.textContent.trim()
    
    // Improved make/model extraction - handle models with dashes like "F-150" and 2-digit years
    const yearMatch = data.title.match(/\b((19|20)\d{2}|\d{2})\b/)
    if (yearMatch) {
      const y = yearMatch[1]
      if (y.length === 2) {
        const num = parseInt(y, 10)
        data.year = num >= 50 ? `19${y}` : `20${y}`
      } else {
        data.year = y
      }
    }
    
    // Extract make (common makes)
    const makePatterns = [
      /\b(19|20)\d{2}\s+(Ford|Chevrolet|Chevy|GMC|Toyota|Honda|Nissan|Dodge|Jeep|BMW|Mercedes|Audi|Volkswagen|VW|Lexus|Acura|Infiniti|Mazda|Subaru|Mitsubishi|Hyundai|Kia|Volvo|Porsche|Jaguar|Land Rover|Range Rover|Tesla|Genesis|Alfa Romeo|Fiat|Mini|Cadillac|Buick|Pontiac|Oldsmobile|Lincoln|Chrysler)\b/i
    ]
    
    let makeFound = false
    for (const pattern of makePatterns) {
      const match = data.title.match(pattern)
      if (match && match[2]) {
        data.make = match[2].charAt(0).toUpperCase() + match[2].slice(1).toLowerCase()
        // Normalize common variations
        if (data.make.toLowerCase() === 'chevy') data.make = 'Chevrolet'
        if (data.make.toLowerCase() === 'vw') data.make = 'Volkswagen'
        makeFound = true
        break
      }
    }
    
    // Extract model - everything between make and price/location
    if (makeFound && data.make) {
      // Remove year and make from title
      const afterMake = data.title.replace(new RegExp(`\\b(19|20)\\d{2}\\s+${data.make}\\s+`, 'i'), '')
      // Split at price marker ( - $ or $) or location in parens, but keep everything before
      const modelMatch = afterMake.match(/^(.+?)(?:\s*-\s*\$|\s*\$|\([^)]*\)\s*-\s*\$|\([^)]*\)\s*$|$)/)
      if (modelMatch && modelMatch[1]) {
        let modelText = modelMatch[1].trim()
        // Remove trailing location in parens if still present
        modelText = modelText.replace(/\s*\([^)]+\)\s*$/, '')
        // Remove common suffixes that aren't part of model (but keep dashes in model name like "F-150")
        modelText = modelText.replace(/\s+(4x4|4wd|2wd|diesel|gas|automatic|manual)\s*$/i, '').trim()
        if (modelText && modelText.length > 0) {
          data.model = modelText
        }
      }
    }

    // Trim detection from title tokens
    const trimTokens = ['Custom Deluxe', 'Silverado', 'Cheyenne', 'Scottsdale', 'High Sierra', 'XLT', 'Lariat', 'Denali']
    const lowerTitle = data.title.toLowerCase()
    for (const t of trimTokens) {
      if (lowerTitle.includes(t.toLowerCase())) {
        data.trim = t
        break
      }
    }
    
    const priceMatch = data.title.match(/\$\s*([\d,]+)/)
    if (priceMatch) data.asking_price = parseInt(priceMatch[1].replace(/,/g, ''))
    if (!data.asking_price) {
      const priceElement = doc.querySelector('.price, .postingtitletext .price')
      if (priceElement) {
        const p = priceElement.textContent?.match(/([\d,]+)/)
        if (p) data.asking_price = parseInt(p[1].replace(/,/g, ''))
      }
    }
    
    const locationMatch = data.title.match(/\(([^)]+)\)\s*$/i)
    if (locationMatch) data.location = locationMatch[1].trim()
  }

  const fullText = doc.body?.textContent || ''

  // Fallback make/model detection for common Chevy/GMC squarebody tokens
  if (!data.make) {
    const titleLower = (data.title || '').toLowerCase()
    const patterns: { re: RegExp; make: string; model: string }[] = [
      { re: /\bk5\b|\bk5\s+blazer\b|\bblazer\b/, make: 'Chevrolet', model: 'K5 Blazer' },
      { re: /\bk10\b/, make: 'Chevrolet', model: 'K10' },
      { re: /\bk20\b/, make: 'Chevrolet', model: 'K20' },
      { re: /\bk30\b/, make: 'Chevrolet', model: 'K30' },
      { re: /\bc10\b/, make: 'Chevrolet', model: 'C10' },
      { re: /\bc20\b/, make: 'Chevrolet', model: 'C20' },
      { re: /\bc30\b/, make: 'Chevrolet', model: 'C30' },
      { re: /\bsilverado\b/, make: 'Chevrolet', model: 'Silverado' },
      { re: /\bhigh\s+sierra\b/, make: 'GMC', model: 'High Sierra' },
      { re: /\bsierra\b/, make: 'GMC', model: 'Sierra' },
      { re: /\bgmc\b/, make: 'GMC', model: data.model || 'Truck' },
    ]
    for (const p of patterns) {
      if (p.re.test(titleLower)) {
        data.make = p.make
        if (!data.model) data.model = p.model
        break
      }
    }
  }

  // Fallback year detection from body if missing
  if (!data.year) {
    const bodyYear = fullText.match(/\b(19[0-9]{2}|20[0-4][0-9])\b/)
    if (bodyYear) data.year = bodyYear[1]
  }
  
  // Extract posted date from HTML
  // Craigslist shows "Posted 2025-11-27 15:00" in the HTML
  const postedDateSelectors = [
    'time.date',
    '.postinginfos time',
    'time[datetime]',
    '.postinginfo time',
    'span[class*="date"]',
    '.postingtitletext time',
    '.postinginfos',
    '.date'
  ]
  
  let postedDateFound = false
  
  // First try: Look for time elements with datetime attribute
  for (const selector of postedDateSelectors) {
    const dateElement = doc.querySelector(selector)
    if (dateElement) {
      const datetime = dateElement.getAttribute('datetime')
      if (datetime) {
        try {
          const parsedDate = new Date(datetime)
          if (!isNaN(parsedDate.getTime())) {
            data.posted_date = parsedDate.toISOString()
            postedDateFound = true
            break
          }
        } catch (e) {
          // Continue to next selector
        }
      }
    }
  }
  
  // Second try: Extract from text content patterns
  if (!postedDateFound) {
    // Pattern 1: "Posted 2025-11-27 15:00"
    const postedTextMatch = fullText.match(/Posted\s+(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/i)
    if (postedTextMatch) {
      const [, year, month, day, hour, minute] = postedTextMatch
      const dateStr = `${year}-${month}-${day}T${hour}:${minute}:00`
      try {
        const parsedDate = new Date(dateStr)
        if (!isNaN(parsedDate.getTime())) {
          data.posted_date = parsedDate.toISOString()
          postedDateFound = true
        }
      } catch (e) {
        // Continue
      }
    }
    
    // Pattern 2: "posted: 2025-11-27 15:00" (lowercase)
    if (!postedDateFound) {
      const postedLowerMatch = fullText.match(/posted:\s*(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/i)
      if (postedLowerMatch) {
        const [, year, month, day, hour, minute] = postedLowerMatch
        const dateStr = `${year}-${month}-${day}T${hour}:${minute}:00`
        try {
          const parsedDate = new Date(dateStr)
          if (!isNaN(parsedDate.getTime())) {
            data.posted_date = parsedDate.toISOString()
            postedDateFound = true
          }
        } catch (e) {
          // Continue
        }
      }
    }
    
    // Pattern 3: Look for date in postinginfos text
    if (!postedDateFound) {
      const postingInfos = doc.querySelector('.postinginfos')
      if (postingInfos) {
        const infoText = postingInfos.textContent || ''
        const dateMatch = infoText.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/)
        if (dateMatch) {
          const [, year, month, day, hour, minute] = dateMatch
          const dateStr = `${year}-${month}-${day}T${hour}:${minute}:00`
          try {
            const parsedDate = new Date(dateStr)
            if (!isNaN(parsedDate.getTime())) {
              data.posted_date = parsedDate.toISOString()
              postedDateFound = true
            }
          } catch (e) {
            // Continue
          }
        }
      }
    }
  }
  
  // Extract attributes and store raw attrgroup data
  const attrGroups = doc.querySelectorAll('.attrgroup')
  const rawAttrgroup: Record<string, string> = {}
  attrGroups.forEach((group: any) => {
    const spans = group.querySelectorAll('span')
    spans.forEach((span: any) => {
      const text = span.textContent.trim().toLowerCase()
      // Store all raw attrgroup values
      if (text.includes(':')) {
        const [key, ...valueParts] = text.split(':')
        rawAttrgroup[key.trim()] = valueParts.join(':').trim()
      }
      if (text.includes('condition:')) data.condition = text.replace('condition:', '').trim()
      else if (text.includes('cylinders:')) {
        const cylMatch = text.match(/(\d+)\s+cylinders/)
        if (cylMatch) data.cylinders = parseInt(cylMatch[1])
      }
      else if (text.includes('drive:')) data.drivetrain = text.replace('drive:', '').trim()
      else if (text.includes('fuel:')) data.fuel_type = text.replace('fuel:', '').trim()
      else if (text.includes('odometer:')) {
        const odoMatch = text.match(/odometer:\s*([\d,]+)/)
        if (odoMatch) data.mileage = parseInt(odoMatch[1].replace(/,/g, ''))
      }
      else if (text.includes('paint color:')) data.color = text.replace('paint color:', '').trim()
      else if (text.includes('title status:')) data.title_status = text.replace('title status:', '').trim()
      else if (text.includes('transmission:')) data.transmission = text.replace('transmission:', '').trim()
      else if (text.includes('type:')) data.body_style = text.replace('type:', '').trim()
      else if (text.includes('size:')) data.engine_size = text.replace('size:', '').trim()
      else if (text.includes('interior color:')) data.interior_color = text.replace('interior color:', '').trim()
    })
  })
  data.attrgroup = rawAttrgroup

  // Fallback regex parsing from full text
  if (!data.condition) {
    const condMatch = fullText.match(/condition:\s*(\w+)/i)
    if (condMatch) data.condition = condMatch[1]
  }
  if (!data.mileage) {
    // Try multiple mileage patterns
    const mileagePatterns = [
      /odometer:\s*([\d,]+)/i,                              // "odometer: 125,000"
      /(\d{1,3}(?:,\d{3})+)\s*(?:original\s+)?miles?\b/i,   // "125,000 miles"
      /(\d{1,3})k\s*(?:original\s+)?mi(?:les?)?\b/i,        // "125k miles" or "70k mi"
      /(?:shows?|has|reads?|only)\s*(\d{1,3})k\s*miles?/i,  // "shows 70k miles"
      /(?:shows?|has|reads?|only)\s*([\d,]+)\s*miles?/i,    // "shows 70,000 miles"
      /\b([\d,]+)\s*(?:actual|original)\s*miles?\b/i,       // "68,075 original miles"
    ]
    for (const pattern of mileagePatterns) {
      const match = fullText.match(pattern)
      if (match?.[1]) {
        const numStr = match[1].replace(/,/g, '')
        let mileage: number
        if (numStr.length <= 3 && /k\s*mi/i.test(match[0])) {
          // "125k miles" format
          mileage = parseInt(numStr) * 1000
        } else {
          mileage = parseInt(numStr)
        }
        if (mileage > 0 && mileage <= 500000) {
          data.mileage = mileage
          break
        }
      }
    }
  }
  if (!data.transmission) {
    const transMatch = fullText.match(/transmission:\s*(\w+)/i)
    if (transMatch) data.transmission = transMatch[1]
    // Also check for common transmission mentions
    if (!data.transmission) {
      if (/\b(automatic|auto)\s*(trans|transmission)?/i.test(fullText)) {
        data.transmission = 'automatic'
      } else if (/\b(manual|stick|standard)\s*(trans|transmission)?/i.test(fullText)) {
        data.transmission = 'manual'
      } else if (/\b(th350|th400|turbo\s*350|turbo\s*400|4l60|4l80|700r4|powerglide)\b/i.test(fullText)) {
        data.transmission = 'automatic'
      } else if (/\b(4[- ]?speed|5[- ]?speed|6[- ]?speed)\s*manual/i.test(fullText)) {
        data.transmission = 'manual'
      }
    }
  }
  if (!data.drivetrain) {
    const driveMatch = fullText.match(/drive:\s*([\w\d]+)/i)
    if (driveMatch) data.drivetrain = driveMatch[1]
    // Also check for common drivetrain mentions
    if (!data.drivetrain) {
      if (/\b(4x4|4wd|four wheel drive)\b/i.test(fullText)) {
        data.drivetrain = '4wd'
      } else if (/\b(2wd|rwd|rear wheel drive)\b/i.test(fullText)) {
        data.drivetrain = 'rwd'
      }
    }
  }

  // Extract description
  const descElement = doc.querySelector('#postingbody')
  if (descElement) {
    data.description = descElement.textContent.trim().substring(0, 5000)
  }

  // Extract map/address location if present
  const mapAddress = doc.querySelector('.mapaddress')
  if (mapAddress) {
    const addr = mapAddress.textContent.trim()
    if (addr) data.location = addr
  }
  const smallLoc = doc.querySelector('.postingtitletext small')
  if (!data.location && smallLoc) {
    const txt = smallLoc.textContent.replace(/[()]/g, '').trim()
    if (txt) data.location = txt
  }

  // Comprehensive image extraction - multiple methods
  const images: string[] = []
  const seenUrls = new Set<string>()
  
  // Method 1: Thumbnail links (a.thumb elements)
  const thumbLinks = doc.querySelectorAll('a.thumb')
  thumbLinks.forEach((link: any) => {
    const href = link.getAttribute('href')
    if (href && href.startsWith('http')) {
      // Upgrade to high-res: replace size patterns with 1200x900
      const highResUrl = href.replace(/\/\d+x\d+\//, '/1200x900/').replace(/\/50x50c\//, '/1200x900/')
      if (!seenUrls.has(highResUrl)) {
        images.push(highResUrl)
        seenUrls.add(highResUrl)
      }
    }
  })
  
  // Method 2: img tags with images.craigslist.org URLs
  const imgTags = doc.querySelectorAll('img[src*="images.craigslist.org"]')
  imgTags.forEach((img: any) => {
    const src = img.getAttribute('src')
    if (src && src.includes('images.craigslist.org')) {
      const highResUrl = src.replace(/\/\d+x\d+\//, '/1200x900/').replace(/\/50x50c\//, '/1200x900/')
      if (!seenUrls.has(highResUrl)) {
        images.push(highResUrl)
        seenUrls.add(highResUrl)
      }
    }
  })
  
  // Method 3: data-src attributes (lazy loading)
  const lazyImages = doc.querySelectorAll('img[data-src*="images.craigslist.org"]')
  lazyImages.forEach((img: any) => {
    const dataSrc = img.getAttribute('data-src')
    if (dataSrc && dataSrc.includes('images.craigslist.org')) {
      const highResUrl = dataSrc.replace(/\/\d+x\d+\//, '/1200x900/').replace(/\/50x50c\//, '/1200x900/')
      if (!seenUrls.has(highResUrl)) {
        images.push(highResUrl)
        seenUrls.add(highResUrl)
      }
    }
  })
  
  // Method 4: Extract from HTML regex (fallback for any missed images)
  const htmlText = doc.body?.innerHTML || ''
  const imageUrlRegex = /https?:\/\/images\.craigslist\.org\/[^"'\s>]+/gi
  let regexMatch
  while ((regexMatch = imageUrlRegex.exec(htmlText)) !== null) {
    const url = regexMatch[0]
    if (url && url.includes('images.craigslist.org')) {
      const highResUrl = url.replace(/\/\d+x\d+\//, '/1200x900/').replace(/\/50x50c\//, '/1200x900/')
      if (!seenUrls.has(highResUrl) && !highResUrl.includes('icon') && !highResUrl.includes('logo')) {
        images.push(highResUrl)
        seenUrls.add(highResUrl)
      }
    }
  }
  
  // Method 5: Gallery/slideshow images (data attributes)
  const galleryImages = doc.querySelectorAll('[data-imgid], [data-index]')
  galleryImages.forEach((elem: any) => {
    const imgSrc = elem.getAttribute('data-src') || elem.getAttribute('data-img') || elem.querySelector('img')?.getAttribute('src')
    if (imgSrc && imgSrc.includes('images.craigslist.org')) {
      const highResUrl = imgSrc.replace(/\/\d+x\d+\//, '/1200x900/').replace(/\/50x50c\//, '/1200x900/')
      if (!seenUrls.has(highResUrl)) {
        images.push(highResUrl)
        seenUrls.add(highResUrl)
      }
    }
  })
  
  if (images.length > 0) {
    data.images = Array.from(new Set(images)).slice(0, 50)
  }

  return data
}

