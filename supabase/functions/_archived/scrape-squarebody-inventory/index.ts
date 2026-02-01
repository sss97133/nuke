import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface SquarebodySearchResult {
  source: string
  url: string
  title: string
  year?: number
  make?: string
  model?: string
  price?: number
  location?: string
  images?: string[]
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { max_results = 100, user_id } = await req.json()
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    console.log('🔍 Starting squarebody truck search across all sources...')

    const allResults: SquarebodySearchResult[] = []
    
    // Squarebody search terms
    const searchTerms = [
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
      '1973 gmc truck',
      '1974 gmc truck',
      '1975 gmc truck',
      '1976 gmc truck',
      '1977 gmc truck',
      '1978 gmc truck',
      '1979 gmc truck',
      '1980 gmc truck',
      '1981 gmc truck',
      '1982 gmc truck',
      '1983 gmc truck',
      '1984 gmc truck',
      '1985 gmc truck',
      '1986 gmc truck',
      '1987 gmc truck'
    ]

    // Search sources
    const sources = [
      { name: 'ClassicCars.com', search: searchClassicCars },
      { name: 'Affordable Classics', search: searchAffordableClassics },
      { name: 'Classic.com', search: searchClassicCom },
      { name: 'Craigslist', search: searchCraigslist },
      { name: 'KSL Cars', search: searchKSL },
    ]

    // Search each source
    for (const source of sources) {
      try {
        console.log(`Searching ${source.name}...`)
        const results = await source.search(searchTerms, max_results)
        allResults.push(...results)
        console.log(`Found ${results.length} listings on ${source.name}`)
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000))
      } catch (error) {
        console.error(`Error searching ${source.name}:`, error)
      }
    }

    // Deduplicate by URL
    const uniqueResults = Array.from(
      new Map(allResults.map(r => [r.url, r])).values()
    ).slice(0, max_results)

    console.log(`📊 Total unique squarebody listings found: ${uniqueResults.length}`)

    // Process each listing - create vehicle profiles
    let created = 0
    let updated = 0
    let errors = 0

    for (const result of uniqueResults) {
      try {
        // Parse the listing URL
        const { data: parsed, error: parseError } = await supabase.functions.invoke('scrape-vehicle', {
          body: { url: result.url }
        })

        if (parseError || !parsed?.data) {
          console.warn(`Failed to parse ${result.url}:`, parseError)
          errors++
          continue
        }

        const listingData = parsed.data

        // Check if this is actually a squarebody (1973-1987 Chevy/GMC C/K)
        const isSquarebody = (
          listingData.year >= 1973 && listingData.year <= 1987 &&
          (listingData.make?.toLowerCase().includes('chevrolet') || 
           listingData.make?.toLowerCase().includes('chevy') ||
           listingData.make?.toLowerCase().includes('gmc')) &&
          (listingData.model?.toUpperCase().match(/^[CK]\d{2}$/) ||
           listingData.model?.toLowerCase().includes('c10') ||
           listingData.model?.toLowerCase().includes('c20') ||
           listingData.model?.toLowerCase().includes('k10') ||
           listingData.model?.toLowerCase().includes('k20') ||
           listingData.title?.toLowerCase().includes('squarebody') ||
           listingData.title?.toLowerCase().includes('square body'))
        )

        if (!isSquarebody) {
          console.log(`Skipping ${result.url} - not a squarebody`)
          continue
        }

        // Find or create vehicle
        const vehicleData = {
          vin: listingData.vin,
          year: listingData.year,
          make: listingData.make || 'Chevrolet',
          model: listingData.model,
          trim: listingData.trim,
          mileage: listingData.mileage,
          price: listingData.asking_price || listingData.price,
          color: listingData.color || listingData.exterior_color,
          transmission: listingData.transmission,
          drivetrain: listingData.drivetrain,
          engine: listingData.engine,
          body_type: listingData.body_style || 'Pickup Truck',
          description: listingData.description,
          images: listingData.images || []
        }

        // Use dataRouter to find or create
        const { data: routerData, error: routerError } = await supabase.functions.invoke('data-router', {
          body: {
            vehicleData,
            userId: user_id || null
          }
        })

        if (routerError) {
          console.error(`Router error for ${result.url}:`, routerError)
          errors++
          continue
        }

        if (routerData?.isNew) {
          created++
        } else {
          updated++
        }

        // Store in provider_listings if provider exists
        const provider = await findOrCreateProvider(result.source, supabase)
        if (provider) {
          await supabase
            .from('provider_listings')
            .upsert({
              provider_id: provider.id,
              listing_url: result.url,
              title: listingData.title || result.title,
              status: 'active',
              raw_data: listingData,
              extracted_vehicle_data: vehicleData,
              vehicle_id: routerData?.vehicleId,
              is_processed: true,
              processed_at: new Date().toISOString()
            }, {
              onConflict: 'provider_id,listing_url'
            })
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000))

      } catch (error) {
        console.error(`Error processing ${result.url}:`, error)
        errors++
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        total_found: uniqueResults.length,
        vehicles_created: created,
        vehicles_updated: updated,
        errors,
        results: uniqueResults.slice(0, 20) // Return first 20 for preview
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('Error in scrape-squarebody-inventory:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// Search functions for each source
async function searchClassicCars(terms: string[], maxResults: number): Promise<SquarebodySearchResult[]> {
  const results: SquarebodySearchResult[] = []
  
  // ClassicCars.com search URL pattern
  for (const term of terms.slice(0, 5)) { // Limit to first 5 terms
    try {
      const searchUrl = `https://www.classiccars.com/search?q=${encodeURIComponent(term)}`
      const response = await fetch(searchUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NukeBot/1.0)' }
      })
      
      if (!response.ok) continue
      
      const html = await response.text()
      // Extract listing URLs from search results
      const urlMatches = html.matchAll(/href="(\/view\/\d+\/[^"]+)"/g)
      
      for (const match of urlMatches) {
        const url = `https://www.classiccars.com${match[1]}`
        results.push({
          source: 'ClassicCars.com',
          url,
          title: term
        })
        
        if (results.length >= maxResults) break
      }
    } catch (error) {
      console.error(`Error searching ClassicCars for ${term}:`, error)
    }
  }
  
  return results
}

async function searchAffordableClassics(terms: string[], maxResults: number): Promise<SquarebodySearchResult[]> {
  const results: SquarebodySearchResult[] = []
  
  // Affordable Classics inventory page
  try {
    const inventoryUrl = 'https://www.affordableclassicsinc.com/inventory'
    const response = await fetch(inventoryUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NukeBot/1.0)' }
    })
    
    if (response.ok) {
      const html = await response.text()
      // Extract vehicle URLs
      const urlMatches = html.matchAll(/href="(\/vehicle\/\d+\/[^"]+)"/g)
      
      for (const match of urlMatches) {
        const url = `https://www.affordableclassicsinc.com${match[1]}`
        // Check if it's a squarebody from URL pattern
        if (match[1].match(/197[3-9]|198[0-7]/)) {
          results.push({
            source: 'Affordable Classics Inc',
            url,
            title: 'Squarebody Truck'
          })
        }
        
        if (results.length >= maxResults) break
      }
    }
  } catch (error) {
    console.error('Error searching Affordable Classics:', error)
  }
  
  return results
}

async function searchClassicCom(terms: string[], maxResults: number): Promise<SquarebodySearchResult[]> {
  const results: SquarebodySearchResult[] = []
  
  // Classic.com search
  for (const term of terms.slice(0, 3)) {
    try {
      const searchUrl = `https://www.classic.com/search/?q=${encodeURIComponent(term)}`
      const response = await fetch(searchUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NukeBot/1.0)' }
      })
      
      if (!response.ok) continue
      
      const html = await response.text()
      // Extract vehicle profile URLs
      const urlMatches = html.matchAll(/href="(\/veh\/[^"]+)"/g)
      
      for (const match of urlMatches) {
        const url = `https://www.classic.com${match[1]}`
        // Check if it's 1973-1987
        if (match[1].match(/197[3-9]|198[0-7]/)) {
          results.push({
            source: 'Classic.com',
            url,
            title: term
          })
        }
        
        if (results.length >= maxResults) break
      }
    } catch (error) {
      console.error(`Error searching Classic.com for ${term}:`, error)
    }
  }
  
  return results
}

async function searchCraigslist(terms: string[], maxResults: number): Promise<SquarebodySearchResult[]> {
  const results: SquarebodySearchResult[] = []
  
  // Craigslist search (would need to search multiple cities)
  // For now, return empty - would need city-specific searches
  return results
}

async function searchKSL(terms: string[], maxResults: number): Promise<SquarebodySearchResult[]> {
  const results: SquarebodySearchResult[] = []
  
  // KSL Cars search
  for (const term of terms.slice(0, 3)) {
    try {
      const searchUrl = `https://cars.ksl.com/search?keyword=${encodeURIComponent(term)}`
      const response = await fetch(searchUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NukeBot/1.0)' }
      })
      
      if (!response.ok) continue
      
      const html = await response.text()
      // Extract listing URLs
      const urlMatches = html.matchAll(/href="(\/listing\/\d+[^"]*)"/g)
      
      for (const match of urlMatches) {
        const url = `https://cars.ksl.com${match[1]}`
        results.push({
          source: 'KSL Cars',
          url,
          title: term
        })
        
        if (results.length >= maxResults) break
      }
    } catch (error) {
      console.error(`Error searching KSL for ${term}:`, error)
    }
  }
  
  return results
}

// Helper to find or create provider
async function findOrCreateProvider(providerName: string, supabase: any) {
  // Map provider names to website URLs
  const providerMap: Record<string, string> = {
    'ClassicCars.com': 'https://www.classiccars.com',
    'Affordable Classics Inc': 'https://www.affordableclassicsinc.com',
    'Classic.com': 'https://www.classic.com',
    'KSL Cars': 'https://cars.ksl.com',
    'Craigslist': 'https://www.craigslist.org'
  }

  const websiteUrl = providerMap[providerName]
  if (!websiteUrl) return null

  // Check if exists
  const { data: existing } = await supabase
    .from('listing_providers')
    .select('id')
    .eq('website_url', websiteUrl)
    .maybeSingle()

  if (existing) return existing

  // Create new
  const providerType = providerName.includes('Auction') || providerName.includes('Classic.com') 
    ? 'marketplace' 
    : 'dealer'

  const { data: newProvider } = await supabase
    .from('listing_providers')
    .insert({
      name: providerName,
      provider_type: providerType,
      website_url: websiteUrl,
      scraper_type: 'generic',
      is_active: true
    })
    .select()
    .single()

  return newProvider
}

