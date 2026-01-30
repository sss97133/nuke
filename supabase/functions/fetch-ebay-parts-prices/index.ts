/**
 * Fetch eBay Parts Prices
 *
 * Uses eBay Browse API to search for auto parts with:
 * - OAuth 2.0 client credentials flow
 * - Category filtering (Auto Parts: 6028)
 * - Condition and price filtering
 * - Response caching (1hr TTL)
 * - Affiliate URL generation
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// eBay API configuration
const EBAY_CLIENT_ID = Deno.env.get('EBAY_CLIENT_ID') ?? ''
const EBAY_CLIENT_SECRET = Deno.env.get('EBAY_CLIENT_SECRET') ?? ''
const EBAY_CAMPAIGN_ID = Deno.env.get('EBAY_CAMPAIGN_ID') ?? ''
const EBAY_API_URL = 'https://api.ebay.com'
const EBAY_AUTH_URL = 'https://api.ebay.com/identity/v1/oauth2/token'

// Auto Parts category ID
const AUTO_PARTS_CATEGORY = '6028'

// Cache for OAuth token (in-memory for function instance)
let cachedToken: { token: string; expires: number } | null = null

interface EbaySearchRequest {
  query: string
  partNumber?: string
  make?: string
  model?: string
  year?: number
  condition?: 'new' | 'used' | 'remanufactured' | 'any'
  minPrice?: number
  maxPrice?: number
  limit?: number
}

interface EbayListing {
  itemId: string
  title: string
  price: number
  currency: string
  condition: string
  seller: {
    username: string
    feedbackScore: number
    feedbackPercentage: number
  }
  imageUrl: string
  itemWebUrl: string
  affiliateUrl: string
  shippingCost: number | null
  freeShipping: boolean
  location: string
  listingType: string
  watchCount: number | null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload: EbaySearchRequest = await req.json()
    const { query, partNumber, make, model, year, condition = 'any', minPrice, maxPrice, limit = 20 } = payload

    if (!query && !partNumber) {
      return new Response(JSON.stringify({ error: 'Query or part number required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Build cache key
    const cacheKey = buildCacheKey(payload)

    // Check cache first
    const cachedResult = await getCachedResponse(cacheKey)
    if (cachedResult) {
      console.log(`Cache hit for: ${cacheKey}`)
      return new Response(JSON.stringify({
        success: true,
        cached: true,
        listings: cachedResult.listings,
        totalResults: cachedResult.totalResults,
        cacheAge: Math.floor((Date.now() - new Date(cachedResult.cachedAt).getTime()) / 1000)
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log(`Cache miss for: ${cacheKey}`)

    // Get OAuth token
    const accessToken = await getEbayAccessToken()
    if (!accessToken) {
      throw new Error('Failed to obtain eBay access token')
    }

    // Build search query
    const searchQuery = buildSearchQuery(query, partNumber, make, model, year)

    // Build filter string
    const filters = buildFilters(condition, minPrice, maxPrice)

    // Call eBay Browse API
    const searchUrl = new URL(`${EBAY_API_URL}/buy/browse/v1/item_summary/search`)
    searchUrl.searchParams.set('q', searchQuery)
    searchUrl.searchParams.set('category_ids', AUTO_PARTS_CATEGORY)
    searchUrl.searchParams.set('limit', String(Math.min(limit, 50)))

    if (filters) {
      searchUrl.searchParams.set('filter', filters)
    }

    console.log(`eBay API request: ${searchUrl.toString()}`)

    const response = await fetch(searchUrl.toString(), {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'X-EBAY-C-ENDUSERCTX': 'affiliateCampaignId=' + EBAY_CAMPAIGN_ID,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`eBay API error: ${response.status} - ${errorText}`)
      throw new Error(`eBay API error: ${response.status}`)
    }

    const data = await response.json()

    // Normalize listings
    const listings: EbayListing[] = (data.itemSummaries || []).map((item: any) => normalizeEbayItem(item))

    // Cache the response
    await cacheResponse(cacheKey, searchQuery, {
      listings,
      totalResults: data.total || 0,
      cachedAt: new Date().toISOString()
    })

    return new Response(JSON.stringify({
      success: true,
      cached: false,
      listings,
      totalResults: data.total || 0
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error fetching eBay parts:', error)
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
 * Get eBay OAuth 2.0 access token using client credentials flow
 */
async function getEbayAccessToken(): Promise<string | null> {
  // Check cached token
  if (cachedToken && cachedToken.expires > Date.now()) {
    return cachedToken.token
  }

  if (!EBAY_CLIENT_ID || !EBAY_CLIENT_SECRET) {
    console.error('eBay API credentials not configured')
    return null
  }

  try {
    const credentials = btoa(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`)

    const response = await fetch(EBAY_AUTH_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope'
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`eBay auth error: ${response.status} - ${errorText}`)
      return null
    }

    const data = await response.json()

    // Cache token (expires_in is in seconds, subtract 60 for safety margin)
    cachedToken = {
      token: data.access_token,
      expires: Date.now() + ((data.expires_in - 60) * 1000)
    }

    console.log('eBay OAuth token obtained successfully')
    return data.access_token

  } catch (error) {
    console.error('Error obtaining eBay access token:', error)
    return null
  }
}

/**
 * Build search query from components
 */
function buildSearchQuery(query?: string, partNumber?: string, make?: string, model?: string, year?: number): string {
  const parts: string[] = []

  if (partNumber) {
    parts.push(partNumber)
  }

  if (query) {
    parts.push(query)
  }

  if (year && make && model) {
    parts.push(`${year} ${make} ${model}`)
  } else if (make && model) {
    parts.push(`${make} ${model}`)
  } else if (make) {
    parts.push(make)
  }

  return parts.join(' ')
}

/**
 * Build eBay filter string
 */
function buildFilters(condition?: string, minPrice?: number, maxPrice?: number): string {
  const filters: string[] = []

  // Condition filter
  if (condition && condition !== 'any') {
    const conditionMap: Record<string, string> = {
      'new': 'NEW',
      'used': 'USED',
      'remanufactured': 'SELLER_REFURBISHED'
    }
    if (conditionMap[condition]) {
      filters.push(`conditionIds:{${conditionMap[condition]}}`)
    }
  }

  // Price filter
  if (minPrice || maxPrice) {
    const priceFilter: string[] = []
    if (minPrice) priceFilter.push(`[${minPrice}`)
    else priceFilter.push('[')
    priceFilter.push('..')
    if (maxPrice) priceFilter.push(`${maxPrice}]`)
    else priceFilter.push(']')
    filters.push(`price:${priceFilter.join('')}`)
  }

  // Only show items with Buy It Now
  filters.push('buyingOptions:{FIXED_PRICE|BEST_OFFER}')

  return filters.join(',')
}

/**
 * Normalize eBay item to our format
 */
function normalizeEbayItem(item: any): EbayListing {
  const price = item.price ? parseFloat(item.price.value) : 0
  const shippingCost = item.shippingOptions?.[0]?.shippingCost?.value
    ? parseFloat(item.shippingOptions[0].shippingCost.value)
    : null

  // Build affiliate URL
  const affiliateUrl = buildAffiliateUrl(item.itemWebUrl)

  return {
    itemId: item.itemId,
    title: item.title,
    price,
    currency: item.price?.currency || 'USD',
    condition: normalizeCondition(item.condition),
    seller: {
      username: item.seller?.username || 'Unknown',
      feedbackScore: item.seller?.feedbackScore || 0,
      feedbackPercentage: item.seller?.feedbackPercentage ? parseFloat(item.seller.feedbackPercentage) : 0
    },
    imageUrl: item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || '',
    itemWebUrl: item.itemWebUrl,
    affiliateUrl,
    shippingCost,
    freeShipping: shippingCost === 0 || item.shippingOptions?.[0]?.shippingCostType === 'FREE',
    location: item.itemLocation?.country || 'Unknown',
    listingType: item.buyingOptions?.includes('AUCTION') ? 'auction' : 'fixed_price',
    watchCount: item.watchCount || null
  }
}

/**
 * Normalize condition string
 */
function normalizeCondition(condition: string): string {
  if (!condition) return 'unknown'

  const conditionLower = condition.toLowerCase()
  if (conditionLower.includes('new')) return 'new'
  if (conditionLower.includes('refurbished') || conditionLower.includes('remanufactured')) return 'remanufactured'
  if (conditionLower.includes('used') || conditionLower.includes('pre-owned')) return 'used'
  return 'unknown'
}

/**
 * Build affiliate URL for eBay Partner Network
 */
function buildAffiliateUrl(itemUrl: string): string {
  if (!EBAY_CAMPAIGN_ID || !itemUrl) return itemUrl

  const url = new URL(itemUrl)
  url.searchParams.set('mkcid', '1')
  url.searchParams.set('mkrid', '711-53200-19255-0')
  url.searchParams.set('siteid', '0')
  url.searchParams.set('campid', EBAY_CAMPAIGN_ID)
  url.searchParams.set('toolid', '10001')

  return url.toString()
}

/**
 * Build cache key from request parameters
 */
function buildCacheKey(request: EbaySearchRequest): string {
  const parts = [
    request.query || '',
    request.partNumber || '',
    request.make || '',
    request.model || '',
    String(request.year || ''),
    request.condition || 'any',
    String(request.minPrice || ''),
    String(request.maxPrice || '')
  ]
  return parts.join('|').toLowerCase()
}

/**
 * Get cached response from database
 */
async function getCachedResponse(cacheKey: string): Promise<any | null> {
  const { data, error } = await supabase
    .from('ebay_api_cache')
    .select('response_data, created_at')
    .eq('cache_key', cacheKey)
    .gt('expires_at', new Date().toISOString())
    .single()

  if (error || !data) return null

  // Update access stats
  await supabase
    .from('ebay_api_cache')
    .update({
      last_accessed_at: new Date().toISOString(),
      access_count: supabase.rpc('increment', { row_id: cacheKey }) // Will implement or use raw SQL
    })
    .eq('cache_key', cacheKey)

  return {
    ...data.response_data,
    cachedAt: data.created_at
  }
}

/**
 * Cache response in database
 */
async function cacheResponse(cacheKey: string, searchQuery: string, responseData: any): Promise<void> {
  const { error } = await supabase
    .from('ebay_api_cache')
    .upsert({
      cache_key: cacheKey,
      search_query: searchQuery,
      category_id: AUTO_PARTS_CATEGORY,
      response_data: responseData,
      item_count: responseData.listings?.length || 0,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour
      last_accessed_at: new Date().toISOString(),
      access_count: 1
    })

  if (error) {
    console.error('Error caching response:', error)
  }
}
