/**
 * Parts Lookup API
 *
 * Unified API for finding parts related to vehicle issues:
 * - Looks up issue-to-part mappings
 * - Fetches pricing from multiple sources
 * - Returns sponsored placements
 * - Provides labor estimates
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface PartsLookupRequest {
  issue_pattern: string
  vehicle_id?: string
  make?: string
  model?: string
  year?: number
}

interface PartResult {
  id: string
  name: string
  category: string
  oemPartNumber?: string
  laborEstimate: {
    hoursMin: number
    hoursMax: number
    difficulty: string
    diyPossible: boolean
  }
  pricing: {
    minPrice: number | null
    maxPrice: number | null
    avgPrice: number | null
    newAvg: number | null
    usedAvg: number | null
    remanAvg: number | null
    sourceCount: number
  }
  sources: PartSource[]
  urgency: string
  failureRisk: string
}

interface PartSource {
  name: string
  price: number | null
  condition: string
  url: string
  affiliateUrl: string
  inStock: boolean
  shippingCost: number | null
  freeShipping: boolean
}

interface SponsoredPlacement {
  id: string
  sponsorName: string
  sponsorLogoUrl: string | null
  headline: string
  description: string | null
  ctaText: string
  destinationUrl: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload: PartsLookupRequest = await req.json()
    const { issue_pattern, vehicle_id, make, model, year } = payload

    if (!issue_pattern) {
      return new Response(JSON.stringify({ error: 'issue_pattern is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log(`Parts lookup for issue: "${issue_pattern}"`, { vehicle_id, make, model, year })

    // Get vehicle details if vehicle_id provided
    let vehicleMake = make
    let vehicleModel = model
    let vehicleYear = year

    if (vehicle_id && (!make || !model || !year)) {
      const { data: vehicle } = await supabase
        .from('vehicles')
        .select('make, model, year')
        .eq('id', vehicle_id)
        .single()

      if (vehicle) {
        vehicleMake = vehicleMake || vehicle.make
        vehicleModel = vehicleModel || vehicle.model
        vehicleYear = vehicleYear || vehicle.year
      }
    }

    // Parallel fetch: issue mappings, sponsored placements, affiliate programs
    const [mappingsResult, sponsoredResult, affiliateResult] = await Promise.all([
      getIssueMappings(issue_pattern, vehicleMake, vehicleModel, vehicleYear),
      getSponsoredPlacements(issue_pattern, vehicleMake, vehicleModel, vehicleYear),
      getAffiliatePrograms()
    ])

    const mappings = mappingsResult
    const sponsored = sponsoredResult
    const affiliatePrograms = affiliateResult

    if (mappings.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        parts: [],
        sponsored: [],
        message: 'No parts found for this issue'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Fetch pricing for each part in parallel
    const partsWithPricing = await Promise.all(
      mappings.map(async (mapping) => {
        const [priceStats, ebayListings] = await Promise.all([
          getPartPriceStats(mapping.part_catalog_id),
          fetchEbayPrices(mapping.part_name, vehicleMake, vehicleModel, vehicleYear)
        ])

        // Build sources list
        const sources = buildSourcesList(ebayListings, affiliatePrograms, mapping)

        return {
          id: mapping.id,
          name: mapping.part_name,
          category: mapping.part_category || 'General',
          oemPartNumber: mapping.part_catalog?.oem_part_number,
          laborEstimate: {
            hoursMin: mapping.labor_hours_min || 1,
            hoursMax: mapping.labor_hours_max || 2,
            difficulty: mapping.labor_difficulty || 'moderate',
            diyPossible: mapping.diy_possible ?? true
          },
          pricing: {
            minPrice: priceStats?.min_price_cents ? priceStats.min_price_cents / 100 : ebayListings.minPrice,
            maxPrice: priceStats?.max_price_cents ? priceStats.max_price_cents / 100 : ebayListings.maxPrice,
            avgPrice: priceStats?.avg_price_cents ? priceStats.avg_price_cents / 100 : ebayListings.avgPrice,
            newAvg: priceStats?.new_avg_cents ? priceStats.new_avg_cents / 100 : null,
            usedAvg: priceStats?.used_avg_cents ? priceStats.used_avg_cents / 100 : null,
            remanAvg: priceStats?.reman_avg_cents ? priceStats.reman_avg_cents / 100 : null,
            sourceCount: (priceStats?.source_count || 0) + sources.length
          },
          sources,
          urgency: mapping.urgency || 'medium',
          failureRisk: mapping.failure_risk || 'Unknown risk'
        } as PartResult
      })
    )

    // Track sponsored impressions
    if (sponsored.length > 0) {
      await trackSponsoredImpressions(sponsored.map(s => s.id))
    }

    // Calculate labor cost estimate (assuming $100/hr shop rate)
    const laborEstimate = calculateLaborEstimate(partsWithPricing)

    return new Response(JSON.stringify({
      success: true,
      parts: partsWithPricing,
      sponsored: sponsored.map(s => ({
        id: s.id,
        sponsorName: s.sponsor_name,
        sponsorLogoUrl: s.sponsor_logo_url,
        headline: s.headline,
        description: s.description,
        ctaText: s.cta_text,
        destinationUrl: s.destination_url
      })),
      laborEstimate,
      vehicle: vehicleMake && vehicleModel ? {
        make: vehicleMake,
        model: vehicleModel,
        year: vehicleYear
      } : null
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Parts lookup error:', error)
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

/**
 * Get issue-to-part mappings that match the issue pattern
 */
async function getIssueMappings(pattern: string, make?: string, model?: string, year?: number) {
  // Search by pattern and keywords
  const searchTerms = pattern.toLowerCase().split(/\s+/)

  let query = supabase
    .from('issue_part_mapping')
    .select(`
      *,
      part_catalog:part_catalog_id (
        id,
        part_name,
        oem_part_number,
        category,
        subcategory,
        fits_makes,
        fits_models,
        fits_years
      )
    `)
    .eq('is_active', true)

  // Build OR conditions for pattern matching
  const { data, error } = await query

  if (error) {
    console.error('Error fetching issue mappings:', error)
    return []
  }

  // Filter results by pattern match and fitment
  return (data || []).filter(mapping => {
    // Check pattern match
    const patternMatch = mapping.issue_pattern.toLowerCase().includes(pattern.toLowerCase()) ||
      searchTerms.some(term =>
        mapping.issue_pattern.toLowerCase().includes(term) ||
        (mapping.issue_keywords || []).some((kw: string) => kw.toLowerCase().includes(term))
      )

    if (!patternMatch) return false

    // Check fitment if make/model/year provided
    if (make && mapping.makes?.length > 0) {
      if (!mapping.makes.some((m: string) => m.toLowerCase() === make.toLowerCase())) {
        return false
      }
    }

    if (model && mapping.models?.length > 0) {
      if (!mapping.models.some((m: string) => m.toLowerCase() === model.toLowerCase())) {
        return false
      }
    }

    if (year) {
      if (mapping.year_min && year < mapping.year_min) return false
      if (mapping.year_max && year > mapping.year_max) return false
    }

    return true
  })
}

/**
 * Get sponsored placements matching the issue
 */
async function getSponsoredPlacements(pattern: string, make?: string, model?: string, year?: number) {
  const { data, error } = await supabase
    .from('sponsored_placements')
    .select('*')
    .eq('is_active', true)
    .or(`start_date.is.null,start_date.lte.${new Date().toISOString().split('T')[0]}`)
    .or(`end_date.is.null,end_date.gte.${new Date().toISOString().split('T')[0]}`)
    .order('bid_amount_cents', { ascending: false })
    .limit(3)

  if (error) {
    console.error('Error fetching sponsored placements:', error)
    return []
  }

  // Filter by pattern match and targeting
  return (data || []).filter(placement => {
    // Check if any issue pattern matches
    const patternMatch = placement.issue_patterns.some((p: string) =>
      pattern.toLowerCase().includes(p.toLowerCase()) ||
      p.toLowerCase().includes(pattern.toLowerCase())
    )

    if (!patternMatch) return false

    // Check make targeting
    if (make && placement.makes?.length > 0) {
      if (!placement.makes.some((m: string) => m.toLowerCase() === make.toLowerCase())) {
        return false
      }
    }

    // Check model targeting
    if (model && placement.models?.length > 0) {
      if (!placement.models.some((m: string) => m.toLowerCase() === model.toLowerCase())) {
        return false
      }
    }

    // Check year targeting
    if (year) {
      if (placement.year_min && year < placement.year_min) return false
      if (placement.year_max && year > placement.year_max) return false
    }

    return true
  })
}

/**
 * Get all active affiliate programs
 */
async function getAffiliatePrograms() {
  const { data, error } = await supabase
    .from('affiliate_programs')
    .select('*')
    .eq('is_active', true)

  if (error) {
    console.error('Error fetching affiliate programs:', error)
    return []
  }

  return data || []
}

/**
 * Get price statistics for a part
 */
async function getPartPriceStats(partCatalogId?: string) {
  if (!partCatalogId) return null

  const { data, error } = await supabase
    .from('part_price_stats')
    .select('*')
    .eq('part_catalog_id', partCatalogId)
    .single()

  if (error) return null
  return data
}

/**
 * Fetch eBay prices via our edge function
 */
async function fetchEbayPrices(partName: string, make?: string, model?: string, year?: number) {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/fetch-ebay-parts-prices`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: partName,
        make,
        model,
        year,
        limit: 10
      })
    })

    if (!response.ok) {
      console.warn('eBay fetch failed:', response.status)
      return { listings: [], minPrice: null, maxPrice: null, avgPrice: null }
    }

    const data = await response.json()
    const listings = data.listings || []

    if (listings.length === 0) {
      return { listings: [], minPrice: null, maxPrice: null, avgPrice: null }
    }

    const prices = listings.map((l: any) => l.price).filter((p: number) => p > 0)

    return {
      listings,
      minPrice: prices.length > 0 ? Math.min(...prices) : null,
      maxPrice: prices.length > 0 ? Math.max(...prices) : null,
      avgPrice: prices.length > 0 ? prices.reduce((a: number, b: number) => a + b, 0) / prices.length : null
    }

  } catch (error) {
    console.error('Error fetching eBay prices:', error)
    return { listings: [], minPrice: null, maxPrice: null, avgPrice: null }
  }
}

/**
 * Build sources list from eBay listings and other sources
 */
function buildSourcesList(ebayData: any, affiliatePrograms: any[], mapping: any): PartSource[] {
  const sources: PartSource[] = []

  // Add eBay listings
  const ebayProgram = affiliatePrograms.find(p => p.source_name === 'eBay')
  for (const listing of (ebayData.listings || []).slice(0, 3)) {
    sources.push({
      name: 'eBay',
      price: listing.price,
      condition: listing.condition,
      url: listing.itemWebUrl,
      affiliateUrl: listing.affiliateUrl || listing.itemWebUrl,
      inStock: true,
      shippingCost: listing.shippingCost,
      freeShipping: listing.freeShipping
    })
  }

  // Add placeholder links for other affiliate sources
  const otherSources = ['FCP Euro', 'Pelican Parts', 'RockAuto', 'Amazon']
  for (const sourceName of otherSources) {
    const program = affiliatePrograms.find(p => p.source_name === sourceName)
    if (program) {
      const searchUrl = buildSearchUrl(sourceName, mapping.part_name)
      sources.push({
        name: sourceName,
        price: null, // Would need to scrape or have API access
        condition: 'new',
        url: searchUrl,
        affiliateUrl: buildAffiliateUrl(searchUrl, program),
        inStock: true, // Unknown
        shippingCost: null,
        freeShipping: false
      })
    }
  }

  return sources
}

/**
 * Build search URL for each source
 */
function buildSearchUrl(source: string, partName: string): string {
  const encoded = encodeURIComponent(partName)

  switch (source) {
    case 'FCP Euro':
      return `https://www.fcpeuro.com/search?query=${encoded}`
    case 'Pelican Parts':
      return `https://www.pelicanparts.com/catalog/search.php?search=${encoded}`
    case 'RockAuto':
      return `https://www.rockauto.com/en/partsearch/?partnum=${encoded}`
    case 'Amazon':
      return `https://www.amazon.com/s?k=${encoded}+auto+parts`
    default:
      return `https://www.google.com/search?q=${encoded}+buy`
  }
}

/**
 * Build affiliate URL from template
 */
function buildAffiliateUrl(url: string, program: any): string {
  if (!program?.url_template) return url

  let affiliateUrl = program.url_template
    .replace('{url}', url)
    .replace('{encoded_url}', encodeURIComponent(url))
    .replace('{affiliate_id}', program.affiliate_id || '')
    .replace('{campaign_id}', program.campaign_id || '')

  return affiliateUrl
}

/**
 * Track sponsored placement impressions
 */
async function trackSponsoredImpressions(placementIds: string[]) {
  for (const id of placementIds) {
    await supabase.rpc('increment_sponsored_impressions', { placement_id: id })
      .catch(err => {
        // Fall back to direct update if RPC doesn't exist
        supabase
          .from('sponsored_placements')
          .update({ impressions: supabase.rpc('raw', { sql: 'impressions + 1' }) })
          .eq('id', id)
      })
  }
}

/**
 * Calculate total labor estimate
 */
function calculateLaborEstimate(parts: PartResult[]) {
  if (parts.length === 0) return null

  // Use the highest labor estimate (parts often replaced together)
  let maxHoursMin = 0
  let maxHoursMax = 0
  let hardestDifficulty = 'easy'
  const difficultyOrder = ['easy', 'moderate', 'hard', 'expert']

  for (const part of parts) {
    if (part.laborEstimate.hoursMin > maxHoursMin) {
      maxHoursMin = part.laborEstimate.hoursMin
    }
    if (part.laborEstimate.hoursMax > maxHoursMax) {
      maxHoursMax = part.laborEstimate.hoursMax
    }
    if (difficultyOrder.indexOf(part.laborEstimate.difficulty) > difficultyOrder.indexOf(hardestDifficulty)) {
      hardestDifficulty = part.laborEstimate.difficulty
    }
  }

  const shopRate = 100 // $100/hr default shop rate

  return {
    hoursMin: maxHoursMin,
    hoursMax: maxHoursMax,
    difficulty: hardestDifficulty,
    costMin: maxHoursMin * shopRate,
    costMax: maxHoursMax * shopRate,
    shopRate
  }
}
