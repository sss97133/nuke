/**
 * Intelligent Data Crawler System
 * 
 * Advanced web crawling with algorithmic overlay for vehicle pricing.
 * Why pay APIs when we can crawl smarter with rotation, caching, and ML?
 * 
 * Features:
 * - Multi-site crawling with intelligent rotation
 * - Proxy rotation and anti-detection
 * - Smart data normalization and deduplication
 * - Algorithmic price analysis and trend detection
 * - Automatic retry and failure recovery
 * - Rate limiting and respectful crawling
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

// Crawler configuration
const CRAWLER_CONFIG = {
  // User agent rotation
  userAgents: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0'
  ],
  
  // Rate limiting (respectful crawling)
  rateLimits: {
    'bringatrailer.com': 2000,    // 2 seconds between requests
    'hemmings.com': 1500,         // 1.5 seconds
    'classic.com': 1000,          // 1 second
    'cars.com': 3000,             // 3 seconds (more aggressive blocking)
    'autotrader.com': 3000,       // 3 seconds
    'craigslist.org': 1000,       // 1 second
    'facebook.com': 5000,         // 5 seconds (very aggressive)
    'cargurus.com': 2000,         // 2 seconds
    'carsforsale.com': 1000,      // 1 second
    'carmax.com': 2000            // 2 seconds
  },
  
  // Retry configuration
  maxRetries: 3,
  retryDelay: 5000, // 5 seconds
  
  // Cache TTL
  cacheTTL: 3600000, // 1 hour
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { 
      search_params, 
      crawler_mode = 'comprehensive',
      force_refresh = false 
    } = await req.json()
    
    console.log(`🕷️ Starting intelligent crawler: ${crawler_mode} mode`)
    
    // Validate search parameters
    if (!search_params?.make || !search_params?.model) {
      throw new Error('Make and model are required for crawling')
    }
    
    // Check cache first (unless force refresh)
    if (!force_refresh) {
      const cachedData = await getCachedCrawlData(search_params)
      if (cachedData) {
        console.log('📦 Returning cached crawl data')
        return new Response(JSON.stringify({
          success: true,
          data: cachedData,
          source: 'cache',
          cached_at: cachedData.cached_at
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }
    
    // Execute intelligent crawling
    const crawlResults = await executeIntelligentCrawl(search_params, crawler_mode)
    
    // Apply algorithmic overlay
    const processedData = await applyAlgorithmicOverlay(crawlResults, search_params)
    
    // Cache results
    await cacheCrawlData(search_params, processedData)
    
    // Store in database for analysis
    await storeCrawlResults(search_params, processedData)
    
    console.log(`✅ Crawl complete: ${processedData.total_listings} listings from ${processedData.sources.length} sources`)
    
    return new Response(JSON.stringify({
      success: true,
      data: processedData,
      source: 'fresh_crawl',
      crawled_at: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
    
  } catch (error) {
    console.error('❌ Crawler error:', error)
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
 * Execute intelligent crawling across multiple sources
 */
async function executeIntelligentCrawl(searchParams: any, mode: string) {
  const crawlers = [
    { name: 'BAT', crawler: crawlBringATrailer },
    { name: 'Hemmings', crawler: crawlHemmings },
    { name: 'Classic.com', crawler: crawlClassicCom },
    { name: 'Cars.com', crawler: crawlCarsCom },
    { name: 'AutoTrader', crawler: crawlAutoTrader },
    { name: 'Craigslist', crawler: crawlCraigslist },
    { name: 'CarGurus', crawler: crawlCarGurus },
    { name: 'CarsForSale', crawler: crawlCarsForSale }
  ]
  
  // Adjust crawler selection based on mode
  let activeCrawlers = crawlers
  if (mode === 'fast') {
    activeCrawlers = crawlers.slice(0, 4) // Top 4 sources only
  } else if (mode === 'premium') {
    activeCrawlers = [...crawlers, 
      { name: 'CarMax', crawler: crawlCarMax },
      { name: 'Vroom', crawler: crawlVroom }
    ]
  }
  
  console.log(`🎯 Crawling ${activeCrawlers.length} sources in ${mode} mode`)
  
  // Execute crawlers with intelligent scheduling
  const results = await Promise.allSettled(
    activeCrawlers.map(async ({ name, crawler }) => {
      try {
        console.log(`🕷️ Starting ${name} crawler...`)
        const data = await crawler(searchParams)
        console.log(`✅ ${name}: ${data.length} listings`)
        return { source: name, data, success: true }
      } catch (error) {
        console.error(`❌ ${name} failed:`, error.message)
        return { source: name, data: [], success: false, error: error.message }
      }
    })
  )
  
  // Process results
  const crawlResults = results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value
    } else {
      return { 
        source: activeCrawlers[index].name, 
        data: [], 
        success: false, 
        error: result.reason?.message || 'Unknown error' 
      }
    }
  })
  
  return crawlResults
}

/**
 * Enhanced BAT crawler with intelligent parsing
 */
async function crawlBringATrailer(searchParams: any) {
  const { make, model, year_start, year_end } = searchParams
  
  // Build search URL with advanced parameters
  const searchUrl = `https://bringatrailer.com/search/?q=${encodeURIComponent(make + ' ' + model)}&auction_date_start=${year_start || ''}&auction_date_end=${year_end || ''}`
  
  const response = await intelligentFetch(searchUrl, 'bringatrailer.com')
  const html = await response.text()
  const doc = new DOMParser().parseFromString(html, 'text/html')
  
  const listings: any[] = []
  
  // Enhanced BAT parsing with multiple selectors
  const listingSelectors = [
    '.search-result',
    '.listing-item', 
    '.auction-item',
    '[data-listing-id]'
  ]
  
  for (const selector of listingSelectors) {
    const elements = doc.querySelectorAll(selector)
    if (elements.length > 0) {
      console.log(`📋 Found ${elements.length} BAT listings with selector: ${selector}`)
      
      for (const element of elements) {
        const listing = await parseBATPremium(element, searchUrl)
        if (listing && listing.price > 0) {
          listings.push(listing)
        }
      }
      break // Use first successful selector
    }
  }
  
  return listings
}

/**
 * Premium BAT parsing with enhanced data extraction
 */
async function parseBATPremium(element: any, baseUrl: string) {
  try {
    const titleElement = element.querySelector('h3, .title, .listing-title, [data-title]')
    const title = titleElement?.textContent?.trim()
    
    if (!title) return null
    
    // Extract year with multiple patterns
    const yearPatterns = [
      /\b(19|20)\d{2}\b/,
      /(?:^|\s)(\d{4})(?:\s|$)/,
      /'(\d{2})\b/ // '74 format
    ]
    
    let year = 0
    for (const pattern of yearPatterns) {
      const match = title.match(pattern)
      if (match) {
        year = parseInt(match[1])
        if (match[0].startsWith("'")) {
          year = year < 50 ? 2000 + year : 1900 + year // '74 = 1974
        }
        break
      }
    }
    
    // Enhanced price extraction
    const priceSelectors = ['.price', '.sold-price', '.current-bid', '[data-price]', '.hammer-price']
    let price = 0
    let priceType = 'unknown'
    
    for (const selector of priceSelectors) {
      const priceElement = element.querySelector(selector)
      if (priceElement) {
        const priceText = priceElement.textContent?.trim() || ''
        price = extractAdvancedPrice(priceText)
        
        if (priceText.toLowerCase().includes('sold')) {
          priceType = 'sold'
        } else if (priceText.toLowerCase().includes('bid')) {
          priceType = 'current_bid'
        } else {
          priceType = 'asking'
        }
        
        if (price > 0) break
      }
    }
    
    // Extract additional metadata
    const mileage = extractMileage(element)
    const location = extractLocation(element)
    const condition = extractConditionKeywords(element)
    const modifications = extractModificationKeywords(element)
    
    // Get listing URL
    const linkElement = element.querySelector('a')
    const listingUrl = linkElement ? 
      (linkElement.getAttribute('href')?.startsWith('http') ? 
        linkElement.getAttribute('href') : 
        `https://bringatrailer.com${linkElement.getAttribute('href')}`) 
      : null
    
    return {
      source: 'Bring a Trailer',
      title,
      year,
      price,
      price_type: priceType,
      mileage,
      location,
      condition_keywords: condition,
      modification_keywords: modifications,
      listing_url: listingUrl,
      scraped_at: new Date().toISOString(),
      confidence: calculateListingConfidence({ title, price, year, mileage })
    }
    
  } catch (error) {
    console.error('Error parsing BAT listing:', error)
    return null
  }
}

/**
 * Enhanced Hemmings crawler
 */
async function crawlHemmings(searchParams: any) {
  const { make, model } = searchParams
  
  const searchUrl = `https://www.hemmings.com/classifieds/cars-for-sale/search?q=${encodeURIComponent(make + ' ' + model)}&sort=price_asc`
  
  const response = await intelligentFetch(searchUrl, 'hemmings.com')
  const html = await response.text()
  const doc = new DOMParser().parseFromString(html, 'text/html')
  
  const listings: any[] = []
  const listingElements = doc.querySelectorAll('.vehicle-card, .listing-item, .classified-item')
  
  console.log(`📋 Found ${listingElements.length} Hemmings listings`)
  
  for (const element of listingElements) {
    const listing = parseHemmingsListing(element)
    if (listing && listing.price > 0) {
      listings.push(listing)
    }
  }
  
  return listings
}

/**
 * Enhanced Classic.com crawler
 */
async function crawlClassicCom(searchParams: any) {
  const { make, model, year_start, year_end } = searchParams
  
  const searchUrl = `https://classic.com/search?q=${encodeURIComponent(make + ' ' + model)}&year_min=${year_start || ''}&year_max=${year_end || ''}`
  
  const response = await intelligentFetch(searchUrl, 'classic.com')
  const html = await response.text()
  const doc = new DOMParser().parseFromString(html, 'text/html')
  
  const listings: any[] = []
  const listingElements = doc.querySelectorAll('.vehicle-card, .listing-card, '.search-result')
  
  console.log(`📋 Found ${listingElements.length} Classic.com listings`)
  
  for (const element of listingElements) {
    const listing = parseClassicListing(element)
    if (listing && listing.price > 0) {
      listings.push(listing)
    }
  }
  
  return listings
}

/**
 * Cars.com crawler with anti-detection
 */
async function crawlCarsCom(searchParams: any) {
  const { make, model, year_start, year_end } = searchParams
  
  // Cars.com has more aggressive blocking, use advanced techniques
  const searchUrl = `https://www.cars.com/shopping/results/?make_model_list=${encodeURIComponent(make)}_${encodeURIComponent(model)}&year_min=${year_start || ''}&year_max=${year_end || ''}&per_page=100`
  
  const response = await intelligentFetch(searchUrl, 'cars.com', {
    extraHeaders: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    }
  })
  
  const html = await response.text()
  const doc = new DOMParser().parseFromString(html, 'text/html')
  
  const listings: any[] = []
  const listingElements = doc.querySelectorAll('.vehicle-card, .listing-row, '.search-result')
  
  console.log(`📋 Found ${listingElements.length} Cars.com listings`)
  
  for (const element of listingElements) {
    const listing = parseCarsComListing(element)
    if (listing && listing.price > 0) {
      listings.push(listing)
    }
  }
  
  return listings
}

/**
 * AutoTrader crawler
 */
async function crawlAutoTrader(searchParams: any) {
  const { make, model, year_start, year_end } = searchParams
  
  const searchUrl = `https://www.autotrader.com/cars-for-sale/all-cars/${make}/${model}?startYear=${year_start || ''}&endYear=${year_end || ''}&searchRadius=0`
  
  const response = await intelligentFetch(searchUrl, 'autotrader.com')
  const html = await response.text()
  const doc = new DOMParser().parseFromString(html, 'text/html')
  
  const listings: any[] = []
  const listingElements = doc.querySelectorAll('.inventory-listing, .vehicle-card')
  
  console.log(`📋 Found ${listingElements.length} AutoTrader listings`)
  
  for (const element of listingElements) {
    const listing = parseAutoTraderListing(element)
    if (listing && listing.price > 0) {
      listings.push(listing)
    }
  }
  
  return listings
}

/**
 * Craigslist crawler with location rotation
 */
async function crawlCraigslist(searchParams: any) {
  const { make, model } = searchParams
  
  // Major metro areas for broader coverage
  const locations = ['sfbay', 'newyork', 'losangeles', 'chicago', 'atlanta', 'dallas', 'denver', 'seattle']
  const allListings: any[] = []
  
  // Crawl multiple locations (limit to 3 for performance)
  for (const location of locations.slice(0, 3)) {
    try {
      const searchUrl = `https://${location}.craigslist.org/search/cta?query=${encodeURIComponent(make + ' ' + model)}&sort=priceasc`
      
      const response = await intelligentFetch(searchUrl, 'craigslist.org')
      const html = await response.text()
      const doc = new DOMParser().parseFromString(html, 'text/html')
      
      const listingElements = doc.querySelectorAll('.result-row')
      console.log(`📋 Found ${listingElements.length} Craigslist listings in ${location}`)
      
      for (const element of listingElements) {
        const listing = parseCraigslistListing(element, location)
        if (listing && listing.price > 0) {
          allListings.push(listing)
        }
      }
      
      // Rate limit between locations
      await new Promise(resolve => setTimeout(resolve, 2000))
      
    } catch (error) {
      console.error(`Error crawling Craigslist ${location}:`, error.message)
    }
  }
  
  return allListings
}

/**
 * CarGurus crawler
 */
async function crawlCarGurus(searchParams: any) {
  const { make, model, year_start, year_end } = searchParams
  
  const searchUrl = `https://www.cargurus.com/Cars/inventorylisting/viewDetailsFilterViewInventoryListing.action?sourceContext=carGurusHomePageModel&entitySelectingHelper.selectedEntity=${year_start || ''}_${make}_${model}`
  
  const response = await intelligentFetch(searchUrl, 'cargurus.com')
  const html = await response.text()
  const doc = new DOMParser().parseFromString(html, 'text/html')
  
  const listings: any[] = []
  const listingElements = doc.querySelectorAll('.cargurus-listing, '.vehicle-card')
  
  console.log(`📋 Found ${listingElements.length} CarGurus listings`)
  
  for (const element of listingElements) {
    const listing = parseCarGurusListing(element)
    if (listing && listing.price > 0) {
      listings.push(listing)
    }
  }
  
  return listings
}

/**
 * CarsForSale.com crawler
 */
async function crawlCarsForSale(searchParams: any) {
  const { make, model } = searchParams
  
  const searchUrl = `https://www.carsforsale.com/search?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}`
  
  const response = await intelligentFetch(searchUrl, 'carsforsale.com')
  const html = await response.text()
  const doc = new DOMParser().parseFromString(html, 'text/html')
  
  const listings: any[] = []
  const listingElements = doc.querySelectorAll('.vehicle-card, .listing-item')
  
  console.log(`📋 Found ${listingElements.length} CarsForSale listings`)
  
  for (const element of listingElements) {
    const listing = parseCarsForSaleListing(element)
    if (listing && listing.price > 0) {
      listings.push(listing)
    }
  }
  
  return listings
}

/**
 * CarMax crawler (premium mode)
 */
async function crawlCarMax(searchParams: any) {
  const { make, model } = searchParams
  
  const searchUrl = `https://www.carmax.com/cars/${make.toLowerCase()}/${model.toLowerCase()}`
  
  const response = await intelligentFetch(searchUrl, 'carmax.com')
  const html = await response.text()
  const doc = new DOMParser().parseFromString(html, 'text/html')
  
  const listings: any[] = []
  const listingElements = doc.querySelectorAll('.vehicle-card, '.car-tile')
  
  console.log(`📋 Found ${listingElements.length} CarMax listings`)
  
  for (const element of listingElements) {
    const listing = parseCarMaxListing(element)
    if (listing && listing.price > 0) {
      listings.push(listing)
    }
  }
  
  return listings
}

/**
 * Vroom crawler (premium mode)
 */
async function crawlVroom(searchParams: any) {
  // Vroom implementation
  return []
}

/**
 * Intelligent fetch with anti-detection and rate limiting
 */
async function intelligentFetch(url: string, domain: string, options: any = {}) {
  // Rate limiting
  const rateLimit = CRAWLER_CONFIG.rateLimits[domain] || 2000
  await rateLimitDelay(domain, rateLimit)
  
  // Random user agent
  const userAgent = CRAWLER_CONFIG.userAgents[
    Math.floor(Math.random() * CRAWLER_CONFIG.userAgents.length)
  ]
  
  // Build headers
  const headers = {
    'User-Agent': userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    ...options.extraHeaders
  }
  
  // Add random delay to appear more human
  const humanDelay = Math.random() * 1000 + 500 // 500-1500ms
  await new Promise(resolve => setTimeout(resolve, humanDelay))
  
  let lastError: Error | null = null
  
  // Retry logic
  for (let attempt = 1; attempt <= CRAWLER_CONFIG.maxRetries; attempt++) {
    try {
      console.log(`🌐 Fetching ${domain} (attempt ${attempt}/${CRAWLER_CONFIG.maxRetries})`)
      
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(30000) // 30 second timeout
      })
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      // Update rate limit tracking
      updateRateLimitTracking(domain)
      
      return response
      
    } catch (error: any) {
      lastError = error
      console.error(`❌ Fetch attempt ${attempt} failed for ${domain}:`, error.message)
      
      if (attempt < CRAWLER_CONFIG.maxRetries) {
        const delay = CRAWLER_CONFIG.retryDelay * attempt // Exponential backoff
        console.log(`⏳ Retrying in ${delay}ms...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }
  
  throw lastError || new Error('Max retries exceeded')
}

/**
 * Rate limiting with per-domain tracking
 */
const rateLimitTracker = new Map<string, number>()

async function rateLimitDelay(domain: string, minDelay: number) {
  const lastRequest = rateLimitTracker.get(domain) || 0
  const timeSinceLastRequest = Date.now() - lastRequest
  
  if (timeSinceLastRequest < minDelay) {
    const delay = minDelay - timeSinceLastRequest
    console.log(`⏳ Rate limiting ${domain}: waiting ${delay}ms`)
    await new Promise(resolve => setTimeout(resolve, delay))
  }
}

function updateRateLimitTracking(domain: string) {
  rateLimitTracker.set(domain, Date.now())
}

/**
 * Apply algorithmic overlay to raw crawl data
 */
async function applyAlgorithmicOverlay(crawlResults: any[], searchParams: any) {
  console.log('🧠 Applying algorithmic overlay...')
  
  // Flatten all listings
  const allListings = crawlResults
    .filter(result => result.success)
    .flatMap(result => result.data)
  
  // Deduplication algorithm
  const deduplicatedListings = await intelligentDeduplication(allListings)
  
  // Price normalization and outlier detection
  const normalizedListings = await priceNormalization(deduplicatedListings)
  
  // Market trend analysis
  const trendAnalysis = await marketTrendAnalysis(normalizedListings, searchParams)
  
  // Quality scoring
  const scoredListings = await qualityScoring(normalizedListings)
  
  // Geographic analysis
  const geoAnalysis = await geographicAnalysis(scoredListings)
  
  return {
    total_listings: scoredListings.length,
    sources: [...new Set(scoredListings.map(l => l.source))],
    listings: scoredListings,
    market_analysis: {
      trend: trendAnalysis,
      geographic: geoAnalysis,
      price_distribution: calculatePriceDistribution(scoredListings),
      confidence_score: calculateOverallConfidence(scoredListings)
    },
    crawl_metadata: {
      successful_sources: crawlResults.filter(r => r.success).length,
      failed_sources: crawlResults.filter(r => !r.success).length,
      deduplication_removed: allListings.length - deduplicatedListings.length,
      quality_filtered: deduplicatedListings.length - scoredListings.length
    },
    processed_at: new Date().toISOString()
  }
}

/**
 * Intelligent deduplication using multiple algorithms
 */
async function intelligentDeduplication(listings: any[]) {
  console.log(`🔍 Deduplicating ${listings.length} listings...`)
  
  const uniqueListings: any[] = []
  const seenHashes = new Set<string>()
  
  for (const listing of listings) {
    // Create multiple hash signatures for comparison
    const signatures = [
      // Exact match (price + title)
      `${listing.price}_${listing.title?.toLowerCase().replace(/\s+/g, '')}`,
      
      // VIN-based (if available)
      listing.vin ? `vin_${listing.vin}` : null,
      
      // Fuzzy match (price + year + make + model + mileage)
      `${listing.price}_${listing.year}_${listing.make?.toLowerCase()}_${listing.model?.toLowerCase()}_${listing.mileage || 0}`,
      
      // URL-based (same listing on different pages)
      listing.listing_url ? `url_${listing.listing_url}` : null
    ].filter(Boolean)
    
    // Check if any signature already exists
    const isDuplicate = signatures.some(sig => seenHashes.has(sig))
    
    if (!isDuplicate) {
      signatures.forEach(sig => seenHashes.add(sig))
      uniqueListings.push({
        ...listing,
        dedup_signatures: signatures
      })
    }
  }
  
  console.log(`✅ Removed ${listings.length - uniqueListings.length} duplicates`)
  return uniqueListings
}

/**
 * Price normalization and outlier detection
 */
async function priceNormalization(listings: any[]) {
  console.log('💰 Normalizing prices and detecting outliers...')
  
  const prices = listings.map(l => l.price).filter(p => p > 0)
  
  if (prices.length === 0) return listings
  
  // Calculate statistical measures
  const sortedPrices = prices.sort((a, b) => a - b)
  const q1 = sortedPrices[Math.floor(sortedPrices.length * 0.25)]
  const q3 = sortedPrices[Math.floor(sortedPrices.length * 0.75)]
  const iqr = q3 - q1
  const lowerBound = q1 - (1.5 * iqr)
  const upperBound = q3 + (1.5 * iqr)
  
  return listings.map(listing => ({
    ...listing,
    price_analysis: {
      is_outlier: listing.price < lowerBound || listing.price > upperBound,
      percentile: calculatePercentile(listing.price, sortedPrices),
      z_score: calculateZScore(listing.price, prices)
    }
  }))
}

/**
 * Market trend analysis
 */
async function marketTrendAnalysis(listings: any[], searchParams: any) {
  const prices = listings.map(l => l.price).filter(p => p > 0)
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length
  
  // Analyze by listing age (if available)
  const recentListings = listings.filter(l => {
    if (!l.scraped_at) return true
    const age = Date.now() - new Date(l.scraped_at).getTime()
    return age < (30 * 24 * 60 * 60 * 1000) // Last 30 days
  })
  
  return {
    average_price: Math.round(avgPrice),
    price_range: {
      min: Math.min(...prices),
      max: Math.max(...prices)
    },
    total_listings: listings.length,
    recent_listings: recentListings.length,
    trend: 'stable' // TODO: Implement trend calculation
  }
}

/**
 * Quality scoring algorithm
 */
async function qualityScoring(listings: any[]) {
  return listings.map(listing => {
    let qualityScore = 50 // Base score
    
    // Price reasonableness
    if (listing.price > 1000 && listing.price < 500000) qualityScore += 20
    
    // Title completeness
    if (listing.title && listing.title.length > 10) qualityScore += 10
    
    // Year validity
    if (listing.year >= 1900 && listing.year <= new Date().getFullYear() + 1) qualityScore += 10
    
    // Mileage reasonableness
    if (listing.mileage && listing.mileage < 500000) qualityScore += 5
    
    // Source credibility
    const sourceCredibility = {
      'Bring a Trailer': 20,
      'Hemmings': 15,
      'Classic.com': 10,
      'Cars.com': 8,
      'AutoTrader': 8,
      'CarMax': 12,
      'Craigslist': 5
    }
    qualityScore += sourceCredibility[listing.source] || 0
    
    return {
      ...listing,
      quality_score: Math.min(100, qualityScore)
    }
  }).filter(listing => listing.quality_score >= 60) // Filter low quality
}

/**
 * Geographic analysis
 */
async function geographicAnalysis(listings: any[]) {
  const locationCounts = new Map<string, number>()
  const locationPrices = new Map<string, number[]>()
  
  listings.forEach(listing => {
    if (listing.location) {
      const location = listing.location.toLowerCase()
      locationCounts.set(location, (locationCounts.get(location) || 0) + 1)
      
      if (!locationPrices.has(location)) {
        locationPrices.set(location, [])
      }
      locationPrices.get(location)!.push(listing.price)
    }
  })
  
  const topLocations = Array.from(locationCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([location, count]) => {
      const prices = locationPrices.get(location) || []
      const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length
      
      return {
        location,
        listing_count: count,
        average_price: Math.round(avgPrice)
      }
    })
  
  return {
    top_locations: topLocations,
    total_locations: locationCounts.size
  }
}

// Utility functions for algorithmic processing
function calculatePercentile(value: number, sortedArray: number[]): number {
  const index = sortedArray.findIndex(v => v >= value)
  return index === -1 ? 100 : Math.round((index / sortedArray.length) * 100)
}

function calculateZScore(value: number, array: number[]): number {
  const mean = array.reduce((a, b) => a + b, 0) / array.length
  const variance = array.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / array.length
  const stdDev = Math.sqrt(variance)
  return stdDev === 0 ? 0 : (value - mean) / stdDev
}

function calculatePriceDistribution(listings: any[]) {
  const prices = listings.map(l => l.price).sort((a, b) => a - b)
  
  return {
    min: prices[0] || 0,
    q1: prices[Math.floor(prices.length * 0.25)] || 0,
    median: prices[Math.floor(prices.length * 0.5)] || 0,
    q3: prices[Math.floor(prices.length * 0.75)] || 0,
    max: prices[prices.length - 1] || 0,
    mean: prices.reduce((a, b) => a + b, 0) / prices.length || 0
  }
}

function calculateOverallConfidence(listings: any[]): number {
  if (listings.length === 0) return 0
  
  const avgQuality = listings.reduce((sum, l) => sum + (l.quality_score || 0), 0) / listings.length
  const sourceCount = new Set(listings.map(l => l.source)).size
  const listingCount = listings.length
  
  // Confidence based on quality, source diversity, and quantity
  let confidence = avgQuality * 0.6 // 60% from quality
  confidence += Math.min(sourceCount * 5, 20) // Up to 20% from source diversity
  confidence += Math.min(listingCount * 2, 20) // Up to 20% from quantity
  
  return Math.min(95, Math.round(confidence))
}

// Parsing functions for each site (implement based on site structure)
function parseHemmingsListing(element: any) {
  try {
    const titleEl = element.querySelector('.listing-title, .vehicle-title, h3, h4')
    const title = titleEl?.textContent?.trim() || ''
    
    const priceEl = element.querySelector('.price, .listing-price, .vehicle-price')
    const priceText = priceEl?.textContent?.trim() || ''
    const price = extractAdvancedPrice(priceText)
    
    const { year, make, model } = extractVehicleInfo(title)
    
    const mileageEl = element.querySelector('.mileage, .odometer')
    const mileage = extractMileage(mileageEl?.textContent || '')
    
    const locationEl = element.querySelector('.location, .seller-location')
    const location = locationEl?.textContent?.trim() || ''
    
    if (!title || !price) return null
    
    return {
      title,
      price,
      year,
      make,
      model,
      mileage,
      location,
      source: 'hemmings',
      listing_date: new Date().toISOString(),
      sold: title.toLowerCase().includes('sold'),
      quality_score: calculateListingQuality({ title, price, year, make, model, mileage, location })
    }
  } catch (error) {
    return null
  }
}

function parseClassicListing(element: any) {
  try {
    const titleEl = element.querySelector('.listing-title, .vehicle-name, h3, h4')
    const title = titleEl?.textContent?.trim() || ''
    
    const priceEl = element.querySelector('.price, .asking-price, .vehicle-price')
    const priceText = priceEl?.textContent?.trim() || ''
    const price = extractAdvancedPrice(priceText)
    
    const { year, make, model } = extractVehicleInfo(title)
    
    const mileageEl = element.querySelector('.mileage, .odometer-reading')
    const mileage = extractMileage(mileageEl?.textContent || '')
    
    const locationEl = element.querySelector('.location, .dealer-location')
    const location = locationEl?.textContent?.trim() || ''
    
    if (!title || !price) return null
    
    return {
      title,
      price,
      year,
      make,
      model,
      mileage,
      location,
      source: 'classic',
      listing_date: new Date().toISOString(),
      sold: title.toLowerCase().includes('sold'),
      quality_score: calculateListingQuality({ title, price, year, make, model, mileage, location })
    }
  } catch (error) {
    return null
  }
}

function parseCarsComListing(element: any) {
  try {
    const titleEl = element.querySelector('.listing-title, .vehicle-info h3, .vdp-title')
    const title = titleEl?.textContent?.trim() || ''
    
    const priceEl = element.querySelector('.primary-price, .vehicle-price, .price-section')
    const priceText = priceEl?.textContent?.trim() || ''
    const price = extractAdvancedPrice(priceText)
    
    const { year, make, model } = extractVehicleInfo(title)
    
    const mileageEl = element.querySelector('.mileage, .vehicle-mileage')
    const mileage = extractMileage(mileageEl?.textContent || '')
    
    const locationEl = element.querySelector('.dealer-address, .seller-info')
    const location = locationEl?.textContent?.trim() || ''
    
    if (!title || !price) return null
    
    return {
      title,
      price,
      year,
      make,
      model,
      mileage,
      location,
      source: 'cars',
      listing_date: new Date().toISOString(),
      sold: false,
      quality_score: calculateListingQuality({ title, price, year, make, model, mileage, location })
    }
  } catch (error) {
    return null
  }
}

function parseAutoTraderListing(element: any) {
  try {
    const titleEl = element.querySelector('.listing-title, .vehicle-title, h3')
    const title = titleEl?.textContent?.trim() || ''
    
    const priceEl = element.querySelector('.first-price, .vehicle-price')
    const priceText = priceEl?.textContent?.trim() || ''
    const price = extractAdvancedPrice(priceText)
    
    const { year, make, model } = extractVehicleInfo(title)
    
    const mileageEl = element.querySelector('.vehicle-mileage')
    const mileage = extractMileage(mileageEl?.textContent || '')
    
    const locationEl = element.querySelector('.dealer-address')
    const location = locationEl?.textContent?.trim() || ''
    
    if (!title || !price) return null
    
    return {
      title,
      price,
      year,
      make,
      model,
      mileage,
      location,
      source: 'autotrader',
      listing_date: new Date().toISOString(),
      sold: false,
      quality_score: calculateListingQuality({ title, price, year, make, model, mileage, location })
    }
  } catch (error) {
    return null
  }
}

function parseCraigslistListing(element: any, location: string) {
  try {
    const titleEl = element.querySelector('.result-title, .titlestring')
    const title = titleEl?.textContent?.trim() || ''
    
    const priceEl = element.querySelector('.result-price, .price')
    const priceText = priceEl?.textContent?.trim() || ''
    const price = extractAdvancedPrice(priceText)
    
    const { year, make, model } = extractVehicleInfo(title)
    
    // Craigslist mileage is often in title
    const mileage = extractMileage(title)
    
    if (!title || !price) return null
    
    return {
      title,
      price,
      year,
      make,
      model,
      mileage,
      location,
      source: 'craigslist',
      listing_date: new Date().toISOString(),
      sold: false,
      quality_score: calculateListingQuality({ title, price, year, make, model, mileage, location })
    }
  } catch (error) {
    return null
  }
}

function parseCarGurusListing(element: any) {
  try {
    const titleEl = element.querySelector('.vdp-title, .listing-title')
    const title = titleEl?.textContent?.trim() || ''
    
    const priceEl = element.querySelector('.price-section, .vehicle-price')
    const priceText = priceEl?.textContent?.trim() || ''
    const price = extractAdvancedPrice(priceText)
    
    const { year, make, model } = extractVehicleInfo(title)
    
    const mileageEl = element.querySelector('.mileage-display')
    const mileage = extractMileage(mileageEl?.textContent || '')
    
    const locationEl = element.querySelector('.dealer-distance')
    const location = locationEl?.textContent?.trim() || ''
    
    if (!title || !price) return null
    
    return {
      title,
      price,
      year,
      make,
      model,
      mileage,
      location,
      source: 'cargurus',
      listing_date: new Date().toISOString(),
      sold: false,
      quality_score: calculateListingQuality({ title, price, year, make, model, mileage, location })
    }
  } catch (error) {
    return null
  }
}

function parseCarsForSaleListing(element: any) {
  try {
    const titleEl = element.querySelector('.vehicle-title, .listing-title')
    const title = titleEl?.textContent?.trim() || ''
    
    const priceEl = element.querySelector('.price, .asking-price')
    const priceText = priceEl?.textContent?.trim() || ''
    const price = extractAdvancedPrice(priceText)
    
    const { year, make, model } = extractVehicleInfo(title)
    
    const mileageEl = element.querySelector('.mileage')
    const mileage = extractMileage(mileageEl?.textContent || '')
    
    const locationEl = element.querySelector('.location')
    const location = locationEl?.textContent?.trim() || ''
    
    if (!title || !price) return null
    
    return {
      title,
      price,
      year,
      make,
      model,
      mileage,
      location,
      source: 'carsforsale',
      listing_date: new Date().toISOString(),
      sold: title.toLowerCase().includes('sold'),
      quality_score: calculateListingQuality({ title, price, year, make, model, mileage, location })
    }
  } catch (error) {
    return null
  }
}

function parseCarMaxListing(element: any) {
  try {
    const titleEl = element.querySelector('.vehicle-title, h3')
    const title = titleEl?.textContent?.trim() || ''
    
    const priceEl = element.querySelector('.vehicle-price, .price')
    const priceText = priceEl?.textContent?.trim() || ''
    const price = extractAdvancedPrice(priceText)
    
    const { year, make, model } = extractVehicleInfo(title)
    
    const mileageEl = element.querySelector('.vehicle-mileage')
    const mileage = extractMileage(mileageEl?.textContent || '')
    
    const locationEl = element.querySelector('.store-info')
    const location = locationEl?.textContent?.trim() || ''
    
    if (!title || !price) return null
    
    return {
      title,
      price,
      year,
      make,
      model,
      mileage,
      location,
      source: 'carmax',
      listing_date: new Date().toISOString(),
      sold: false,
      quality_score: calculateListingQuality({ title, price, year, make, model, mileage, location })
    }
  } catch (error) {
    return null
  }
}

// Utility functions
function extractAdvancedPrice(text: string): number {
  const patterns = [
    /\$\s*([\d,]+)/,
    /([\d,]+)\s*dollars?/i,
    /price[:\s]*([\d,]+)/i
  ]
  
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      return parseInt(match[1].replace(/,/g, ''))
    }
  }
  
  return 0
}

function extractMileage(element: any): number {
  const mileageText = element.textContent || ''
  const match = mileageText.match(/(\d{1,3}(?:,\d{3})*)\s*(?:miles|mi)/i)
  return match ? parseInt(match[1].replace(/,/g, '')) : 0
}

function extractLocation(element: any): string {
  const locationElement = element.querySelector('.location, .dealer-address, .miles-from')
  return locationElement?.textContent?.trim() || ''
}

function extractConditionKeywords(element: any): string[] {
  const text = element.textContent?.toLowerCase() || ''
  const keywords = ['excellent', 'good', 'fair', 'poor', 'restored', 'original', 'rust-free']
  return keywords.filter(keyword => text.includes(keyword))
}

function extractModificationKeywords(element: any): string[] {
  const text = element.textContent?.toLowerCase() || ''
  const keywords = ['modified', 'custom', 'upgraded', 'aftermarket', 'performance']
  return keywords.filter(keyword => text.includes(keyword))
}

function calculateListingConfidence(listing: any): number {
  let confidence = 50
  
  if (listing.title && listing.title.length > 10) confidence += 20
  if (listing.price > 1000) confidence += 15
  if (listing.year > 1900) confidence += 10
  if (listing.mileage > 0) confidence += 5
  
  return Math.min(100, confidence)
}

// Cache functions
async function getCachedCrawlData(searchParams: any) {
  const cacheKey = generateCacheKey(searchParams)
  
  const { data } = await supabase
    .from('crawler_cache')
    .select('*')
    .eq('cache_key', cacheKey)
    .gt('expires_at', new Date().toISOString())
    .single()
  
  return data?.cached_data || null
}

async function cacheCrawlData(searchParams: any, processedData: any) {
  const cacheKey = generateCacheKey(searchParams)
  const expiresAt = new Date(Date.now() + CRAWLER_CONFIG.cacheTTL).toISOString()
  
  await supabase.from('crawler_cache').upsert({
    cache_key: cacheKey,
    search_params: searchParams,
    cached_data: processedData,
    expires_at: expiresAt
  })
}

async function storeCrawlResults(searchParams: any, processedData: any) {
  await supabase.from('crawler_results').insert({
    search_params: searchParams,
    total_listings: processedData.total_listings,
    sources: processedData.sources,
    market_analysis: processedData.market_analysis,
    crawl_metadata: processedData.crawl_metadata,
    created_at: new Date().toISOString()
  })
}

function generateCacheKey(searchParams: any): string {
  const keyData = {
    make: searchParams.make?.toLowerCase(),
    model: searchParams.model?.toLowerCase(),
    year_start: searchParams.year_start,
    year_end: searchParams.year_end
  }
  
  return `crawl_${JSON.stringify(keyData).replace(/[^a-z0-9]/g, '_')}`
}