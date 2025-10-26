/**
 * Automatic Price Discovery System
 * 
 * Triggers when a vehicle is added/updated to automatically:
 * 1. Search BAT for comparable sales (body style matching)
 * 2. Search Classic.com for current listings  
 * 3. Search Hemmings for market data
 * 4. Calculate price range based on condition
 * 5. Store results for instant pricing
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { vehicle_id } = await req.json()
    
    console.log(`🔍 Starting automatic price discovery for vehicle ${vehicle_id}`)
    
    // 1. Get vehicle details
    const { data: vehicle, error } = await supabase
      .from('vehicles')
      .select('*')
      .eq('id', vehicle_id)
      .single()
    
    if (error || !vehicle) {
      throw new Error(`Vehicle not found: ${vehicle_id}`)
    }
    
    // 2. Determine search parameters (body style matching)
    const searchParams = buildSearchParameters(vehicle)
    console.log(`🎯 Search params:`, searchParams)
    
    // 3. Search multiple sources in parallel
    const [batResults, classicResults, hemmingsResults] = await Promise.all([
      searchBringATrailer(searchParams),
      searchClassicCom(searchParams), 
      searchHemmings(searchParams)
    ])
    
    // 4. Analyze and calculate price range
    const priceAnalysis = analyzePriceData({
      vehicle,
      batResults,
      classicResults, 
      hemmingsResults
    })
    
    // 5. Store results in database
    await storePriceDiscovery(vehicle_id, priceAnalysis)
    
    // 6. Update vehicle with discovered pricing
    await supabase
      .from('vehicles')
      .update({
        current_value: priceAnalysis.estimated_value,
        price_confidence: priceAnalysis.confidence,
        price_last_updated: new Date().toISOString(),
        price_sources: priceAnalysis.sources
      })
      .eq('id', vehicle_id)
    
    console.log(`✅ Price discovery complete: $${priceAnalysis.estimated_value} (${priceAnalysis.confidence}% confidence)`)
    
    return new Response(JSON.stringify({
      success: true,
      vehicle_id,
      price_analysis: priceAnalysis
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
    
  } catch (error) {
    console.error('❌ Price discovery error:', error)
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    })
  }
})

/**
 * Build search parameters with body style matching
 * Example: 1974 Bronco -> search 1966-1977 Broncos (same body style)
 */
function buildSearchParameters(vehicle: any) {
  const { year, make, model } = vehicle
  
  // Body style matching logic
  const bodyStyleRanges = {
    // Ford Bronco generations
    'ford_bronco': {
      '1966-1977': { start: 1966, end: 1977, name: 'Early Bronco' },
      '1978-1979': { start: 1978, end: 1979, name: 'Bronco II' },
      '1980-1996': { start: 1980, end: 1996, name: 'Full Size Bronco' }
    },
    // Chevy Blazer generations  
    'chevrolet_blazer': {
      '1969-1972': { start: 1969, end: 1972, name: 'Early K5' },
      '1973-1991': { start: 1973, end: 1991, name: 'Square Body K5' }
    },
    // Add more as needed
  }
  
  const vehicleKey = `${make.toLowerCase()}_${model.toLowerCase()}`
  const ranges = bodyStyleRanges[vehicleKey]
  
  let searchYearRange = { start: year - 2, end: year + 2 } // Default: +/- 2 years
  
  if (ranges) {
    // Find the matching body style range
    for (const [rangeKey, range] of Object.entries(ranges)) {
      if (year >= range.start && year <= range.end) {
        searchYearRange = { start: range.start, end: range.end }
        console.log(`📋 Using body style range: ${range.name} (${range.start}-${range.end})`)
        break
      }
    }
  }
  
  return {
    make,
    model,
    exact_year: year,
    year_start: searchYearRange.start,
    year_end: searchYearRange.end,
    search_terms: [
      `${year} ${make} ${model}`,
      `${make} ${model}`,
      model
    ]
  }
}

/**
 * Search Bring a Trailer for comparable sales
 */
async function searchBringATrailer(params: any) {
  console.log('🔍 Searching Bring a Trailer...')
  
  try {
    // BAT search URL
    const searchUrl = `https://bringatrailer.com/search/?q=${encodeURIComponent(params.make + ' ' + params.model)}`
    
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PriceBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml'
      }
    })
    
    if (!response.ok) {
      throw new Error(`BAT search failed: ${response.status}`)
    }
    
    const html = await response.text()
    const doc = new DOMParser().parseFromString(html, 'text/html')
    
    const listings = []
    const listingElements = doc.querySelectorAll('.listing-item, .auction-item')
    
    for (const listing of Array.from(listingElements).slice(0, 10)) {
      const title = listing.querySelector('h3, .title')?.textContent?.trim()
      const priceText = listing.querySelector('.price, .sold-price')?.textContent?.trim()
      const link = listing.querySelector('a')?.getAttribute('href')
      
      if (title && priceText) {
        const year = extractYear(title)
        const price = extractPrice(priceText)
        
        // Only include if within our year range and has valid price
        if (year >= params.year_start && year <= params.year_end && price > 0) {
          listings.push({
            source: 'Bring a Trailer',
            title,
            year,
            price,
            type: priceText.includes('Sold') ? 'sold' : 'active',
            url: link ? `https://bringatrailer.com${link}` : null
          })
        }
      }
    }
    
    console.log(`📊 Found ${listings.length} BAT listings`)
    return listings
    
  } catch (error) {
    console.error('BAT search error:', error)
    return []
  }
}

/**
 * Search Classic.com for current listings
 */
async function searchClassicCom(params: any) {
  console.log('🔍 Searching Classic.com...')
  
  try {
    const searchUrl = `https://classic.com/search?q=${encodeURIComponent(params.make + ' ' + params.model)}&year_min=${params.year_start}&year_max=${params.year_end}`
    
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PriceBot/1.0)',
      }
    })
    
    if (!response.ok) {
      throw new Error(`Classic.com search failed: ${response.status}`)
    }
    
    const html = await response.text()
    const doc = new DOMParser().parseFromString(html, 'text/html')
    
    const listings = []
    const listingElements = doc.querySelectorAll('.vehicle-card, .listing-card')
    
    for (const listing of Array.from(listingElements).slice(0, 10)) {
      const title = listing.querySelector('.title, h3')?.textContent?.trim()
      const priceText = listing.querySelector('.price')?.textContent?.trim()
      
      if (title && priceText) {
        const year = extractYear(title)
        const price = extractPrice(priceText)
        
        if (year >= params.year_start && year <= params.year_end && price > 0) {
          listings.push({
            source: 'Classic.com',
            title,
            year,
            price,
            type: 'active'
          })
        }
      }
    }
    
    console.log(`📊 Found ${listings.length} Classic.com listings`)
    return listings
    
  } catch (error) {
    console.error('Classic.com search error:', error)
    return []
  }
}

/**
 * Search Hemmings for market data
 */
async function searchHemmings(params: any) {
  console.log('🔍 Searching Hemmings...')
  
  try {
    const searchUrl = `https://www.hemmings.com/classifieds/cars-for-sale/search?q=${encodeURIComponent(params.make + ' ' + params.model)}`
    
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PriceBot/1.0)',
      }
    })
    
    if (!response.ok) {
      throw new Error(`Hemmings search failed: ${response.status}`)
    }
    
    const html = await response.text()
    const doc = new DOMParser().parseFromString(html, 'text/html')
    
    const listings = []
    const listingElements = doc.querySelectorAll('.listing-item, .vehicle-listing')
    
    for (const listing of Array.from(listingElements).slice(0, 10)) {
      const title = listing.querySelector('.title, h3')?.textContent?.trim()
      const priceText = listing.querySelector('.price')?.textContent?.trim()
      
      if (title && priceText) {
        const year = extractYear(title)
        const price = extractPrice(priceText)
        
        if (year >= params.year_start && year <= params.year_end && price > 0) {
          listings.push({
            source: 'Hemmings',
            title,
            year,
            price,
            type: 'active'
          })
        }
      }
    }
    
    console.log(`📊 Found ${listings.length} Hemmings listings`)
    return listings
    
  } catch (error) {
    console.error('Hemmings search error:', error)
    return []
  }
}

/**
 * Analyze price data and calculate estimated value
 */
function analyzePriceData(data: any) {
  const { vehicle, batResults, classicResults, hemmingsResults } = data
  
  const allListings = [...batResults, ...classicResults, ...hemmingsResults]
  
  if (allListings.length === 0) {
    return {
      estimated_value: null,
      confidence: 0,
      sources: [],
      message: 'No comparable vehicles found'
    }
  }
  
  // Separate sold vs asking prices (sold prices are more reliable)
  const soldPrices = allListings.filter(l => l.type === 'sold').map(l => l.price)
  const askingPrices = allListings.filter(l => l.type === 'active').map(l => l.price)
  
  let basePrice = 0
  let confidence = 50
  
  if (soldPrices.length > 0) {
    // Use sold prices (more reliable)
    basePrice = soldPrices.reduce((a, b) => a + b, 0) / soldPrices.length
    confidence = Math.min(70 + (soldPrices.length * 5), 95) // More sold comps = higher confidence
  } else if (askingPrices.length > 0) {
    // Use asking prices but discount them
    const avgAsking = askingPrices.reduce((a, b) => a + b, 0) / askingPrices.length
    basePrice = avgAsking * 0.85 // Asking prices typically 15% higher than selling prices
    confidence = Math.min(40 + (askingPrices.length * 3), 70)
  }
  
  // Condition adjustment (you'll enhance this with image analysis later)
  const conditionMultiplier = estimateConditionMultiplier(vehicle)
  const estimatedValue = Math.round(basePrice * conditionMultiplier)
  
  return {
    estimated_value: estimatedValue,
    confidence,
    base_price: Math.round(basePrice),
    condition_multiplier: conditionMultiplier,
    sources: allListings.map(l => l.source),
    comparable_count: allListings.length,
    sold_count: soldPrices.length,
    asking_count: askingPrices.length,
    price_range: {
      low: Math.min(...allListings.map(l => l.price)),
      high: Math.max(...allListings.map(l => l.price))
    },
    comparables: allListings.slice(0, 5) // Top 5 for display
  }
}

/**
 * Store price discovery results
 */
async function storePriceDiscovery(vehicleId: string, analysis: any) {
  await supabase.from('vehicle_price_discoveries').upsert({
    vehicle_id: vehicleId,
    estimated_value: analysis.estimated_value,
    confidence: analysis.confidence,
    base_price: analysis.base_price,
    condition_multiplier: analysis.condition_multiplier,
    comparable_count: analysis.comparable_count,
    sold_count: analysis.sold_count,
    asking_count: analysis.asking_count,
    price_range_low: analysis.price_range.low,
    price_range_high: analysis.price_range.high,
    sources: analysis.sources,
    comparables: analysis.comparables,
    discovered_at: new Date().toISOString()
  })
}

/**
 * Estimate condition multiplier (basic version - enhance with image analysis)
 */
function estimateConditionMultiplier(vehicle: any): number {
  // Basic condition estimation - you'll enhance this with AI image analysis
  const currentYear = new Date().getFullYear()
  const age = currentYear - vehicle.year
  
  // Default multipliers based on age and any available condition data
  if (age < 10) return 1.1      // Modern classics
  if (age < 30) return 1.0      // Baseline
  if (age < 50) return 0.95     // Older classics
  return 0.9                    // Very old (condition matters more)
}

// Utility functions
function extractYear(text: string): number {
  const match = text.match(/\b(19|20)\d{2}\b/)
  return match ? parseInt(match[0]) : 0
}

function extractPrice(text: string): number {
  const match = text.match(/\$?([\d,]+)/)
  return match ? parseInt(match[1].replace(/,/g, '')) : 0
}