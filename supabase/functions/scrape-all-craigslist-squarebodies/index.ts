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
      max_regions = 50, 
      max_listings_per_search = 100,
      user_id,
      regions = null // Optional: specific regions to search
    } = await req.json()

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

    // For automated imports, we need a user_id for RLS policies
    // Option 1: Use provided user_id (if someone triggered this manually)
    // Option 2: Use a system user for automated imports
    let importUserId = user_id
    
    if (!importUserId) {
      // Try to find a system user (admin or service account)
      // First try: Look for specific system emails
      const { data: systemUser } = await supabase
        .from('profiles')
        .select('id')
        .or('email.eq.system@n-zero.dev,email.eq.admin@n-zero.dev')
        .limit(1)
        .maybeSingle()
      
      if (systemUser) {
        importUserId = systemUser.id
        console.log(`✅ Using system user for imports: ${importUserId}`)
      } else {
        // Second try: Look for any admin user
        const { data: adminUser } = await supabase
          .from('profiles')
          .select('id')
          .eq('is_admin', true)
          .limit(1)
          .maybeSingle()
        
        if (adminUser) {
          importUserId = adminUser.id
          console.log(`✅ Using admin user for imports: ${importUserId}`)
        } else {
          // Third try: Just get the first user (fallback for automated systems)
          const { data: firstUser } = await supabase
            .from('profiles')
            .select('id')
            .limit(1)
            .maybeSingle()
          
          if (firstUser) {
            importUserId = firstUser.id
            console.log(`⚠️ Using first available user for imports: ${importUserId}`)
            console.log(`⚠️ Consider creating a dedicated system user for automated imports`)
          } else {
            console.error('❌ No users found in database - cannot proceed with imports')
            return new Response(
              JSON.stringify({ 
                success: false, 
                error: 'No user_id provided and no users found in database. Please provide user_id or ensure users exist.' 
              }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
            )
          }
        }
      }
    }

    // TEST: Try a direct insert to verify database connection works
    // Note: user_id is a generated column, so we only set uploaded_by
    console.log('🧪 Testing direct database insert...')
    const { data: testInsert, error: testError } = await supabase
      .from('vehicles')
      .insert({
        make: 'Chevrolet',
        model: 'K10',
        year: 1985,
        discovery_source: 'craigslist_scrape_test',
        is_public: true,
        uploaded_by: importUserId
      })
      .select('id')
      .single()
    
    if (testError) {
      console.error('❌ TEST INSERT FAILED:', JSON.stringify(testError, null, 2))
      return new Response(
        JSON.stringify({ success: false, error: `Database insert test failed: ${testError.message}`, details: testError }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      )
    } else {
      console.log('✅ TEST INSERT SUCCESS:', testInsert?.id)
      // Delete test vehicle
      await supabase.from('vehicles').delete().eq('id', testInsert.id)
    }

    console.log('🚀 Starting comprehensive Craigslist squarebody scrape...')
    console.log(`Regions: ${regions ? regions.length : max_regions}, Search terms: ${SQUAREBODY_SEARCH_TERMS.length}`)
    console.log(`Using user_id: ${importUserId} for all imports`)

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
    ].slice(0, 10) // Limit to 10 most effective terms to avoid timeout

    // Search each region with prioritized search terms
    for (const region of regionsToSearch) {
      try {
        console.log(`\n📍 Searching ${region}...`)
        stats.regions_searched++

        for (const searchTerm of prioritizedSearchTerms) {
          try {
            const searchUrl = `https://${region}.craigslist.org/search/cta?query=${encodeURIComponent(searchTerm)}&sort=date&max_auto_year=1991&min_auto_year=1973`
            
            console.log(`  Searching: ${searchTerm}`)
            stats.searches_performed++

            // Fetch search results with timeout
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout per request

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
              
              // Try different selectors for Craigslist search results
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

            // Reduced rate limiting - wait 1 second between searches
            await new Promise(resolve => setTimeout(resolve, 1000))

          } catch (error) {
            console.error(`    ❌ Error searching ${searchTerm} in ${region}:`, error)
            stats.errors++
          }
        }

        // Reduced rate limiting - wait 1 second between regions
        await new Promise(resolve => setTimeout(resolve, 1000))

      } catch (error) {
        console.error(`❌ Error processing region ${region}:`, error)
        stats.errors++
      }
    }

    console.log(`\n📊 Total unique listings found: ${allListingUrls.size}`)
    
    // Limit processing to avoid timeout - process max 20 listings per run
    const maxProcessPerRun = 20
    const listingArray = Array.from(allListingUrls).slice(0, maxProcessPerRun)
    
    console.log(`🔄 Processing ${listingArray.length} listings (limited to avoid timeout)...\n`)
    
    for (const listingUrl of listingArray) {
      try {
        console.log(`  🔍 Processing: ${listingUrl}`)
        
        // Scrape Craigslist listing directly (no function-to-function call)
        let scrapeData: any
        try {
          console.log(`  📡 Fetching: ${listingUrl}`)
          const response = await fetch(listingUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
          })
          
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
            
            // If model is missing, use "Unknown" so we can still create the vehicle
            if (!finalModel || finalModel.trim() === '') {
              console.warn(`  ⚠️ Model missing for "${scrapeData.data.title}", using "Unknown"`)
              finalModel = 'Unknown'
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

                // First: Try to find by VIN
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

                // Second: Try to find by year/make/model if no VIN match
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

                // Third: Create new vehicle if not found - EXACT COPY OF WORKING IMPLEMENTATION
                if (!vehicleId) {
                  
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
                    discovery_source: 'craigslist_scrape',
                    discovery_url: listingUrl,
                    profile_origin: 'craigslist_scrape',
                    origin_metadata: {
                      listing_url: listingUrl,
                      asking_price: scrapeData.data.asking_price || scrapeData.data.price,
                      imported_at: new Date().toISOString(),
                      image_urls: scrapeData.data.images || [] // Store image URLs for future backfill
                    },
                    notes: scrapeData.data.description || null,
                    is_public: true,
                    status: 'active' // Set to 'active' so vehicles show up in homepage feed
                  }
                  
                  // user_id is a generated column, so we only set uploaded_by
                  // This satisfies RLS policies that check uploaded_by
                  vehicleInsert.uploaded_by = importUserId
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
                            user_id: importUserId,
                            event_type: 'discovery', // Use 'discovery' which is always allowed
                            source: 'craigslist',
                            title: `Listed on Craigslist`,
                            event_date: eventDate,
                            description: `Vehicle listed for sale on Craigslist${scrapeData.data.asking_price ? ` for $${scrapeData.data.asking_price.toLocaleString()}` : ''}`,
                            metadata: {
                              listing_url: listingUrl,
                              asking_price: scrapeData.data.asking_price || scrapeData.data.price,
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
                            signal: AbortSignal.timeout(10000) // 10 second timeout
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
                          const storagePath = `${vehicleId}/${fileName}`
                          
                          // Upload to Supabase Storage
                          const { data: uploadData, error: uploadError } = await supabase.storage
                            .from('vehicle-images')
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
                            .from('vehicle-images')
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
                  const { error: updateError } = await supabase
                    .from('vehicles')
                    .update({
                      asking_price: scrapeData.data.asking_price || scrapeData.data.price || null,
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
    
    const yearMatch = data.title.match(/\b(19|20)\d{2}\b/)
    if (yearMatch) data.year = yearMatch[0]
    
    // Improved parsing: "1978 GMC High Sierra" or "1985 Chevy K10 4x4"
    // Match: year + make + model (everything until dash, dollar, or paren)
    const vehicleMatch = data.title.match(/\b(19|20)\d{2}\s+([A-Za-z]+)\s+(.+?)(?:\s*-\s*\$|\s*\$|\(|$)/i)
    if (vehicleMatch && vehicleMatch[3]) {
      data.make = vehicleMatch[2]
      let modelText = vehicleMatch[3].trim()
      // Remove trailing location in parens if present
      modelText = modelText.replace(/\s*\([^)]+\)\s*$/, '')
      // Remove common suffixes that aren't part of model
      modelText = modelText.replace(/\s+(4x4|4wd|2wd|diesel|gas|automatic|manual)\s*$/i, '').trim()
      if (modelText) {
        data.model = modelText
      }
    }
    
    // Fallback: if model still empty, try to extract from full title
    if (!data.model && data.make) {
      // Remove year and make, what's left is likely the model
      const afterMake = data.title.replace(new RegExp(`\\b(19|20)\\d{2}\\s+${data.make}\\s+`, 'i'), '')
      const modelPart = afterMake.split(/\s*-\s*\$|\s*\$|\(/)[0].trim()
      if (modelPart && modelPart.length > 0) {
        data.model = modelPart
      }
    }
    
    const priceMatch = data.title.match(/\$\s*([\d,]+)/)
    if (priceMatch) data.asking_price = parseInt(priceMatch[1].replace(/,/g, ''))
    
    const locationMatch = data.title.match(/\(([^)]+)\)\s*$/i)
    if (locationMatch) data.location = locationMatch[1].trim()
  }

  const fullText = doc.body?.textContent || ''
  
  // Extract attributes
  const attrGroups = doc.querySelectorAll('.attrgroup')
  attrGroups.forEach((group: any) => {
    const spans = group.querySelectorAll('span')
    spans.forEach((span: any) => {
      const text = span.textContent.trim()
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
    })
  })
  
  // Fallback regex parsing
  if (!data.condition) {
    const condMatch = fullText.match(/condition:\s*(\w+)/i)
    if (condMatch) data.condition = condMatch[1]
  }
  if (!data.mileage) {
    const odoMatch = fullText.match(/odometer:\s*([\d,]+)/i)
    if (odoMatch) data.mileage = parseInt(odoMatch[1].replace(/,/g, ''))
  }
  if (!data.transmission) {
    const transMatch = fullText.match(/transmission:\s*(\w+)/i)
    if (transMatch) data.transmission = transMatch[1]
  }
  if (!data.drivetrain) {
    const driveMatch = fullText.match(/drive:\s*([\w\d]+)/i)
    if (driveMatch) data.drivetrain = driveMatch[1]
  }

  // Extract description
  const descElement = doc.querySelector('#postingbody')
  if (descElement) {
    data.description = descElement.textContent.trim().substring(0, 5000)
  }

  // Extract images
  const images: string[] = []
  const thumbLinks = doc.querySelectorAll('a.thumb')
  thumbLinks.forEach((link: any) => {
    const href = link.getAttribute('href')
    if (href && href.startsWith('http')) {
      images.push(href.replace(/\/\d+x\d+\//, '/1200x900/'))
    }
  })
  if (images.length > 0) {
    data.images = Array.from(new Set(images)).slice(0, 50)
  }

  return data
}

