// Supabase Edge Function to scrape SBX Cars (sbxcars.com) listings
// SBX Cars is an auction platform for high-end and rare automobiles

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface SBXCarsListing {
  url: string
  title: string
  year: number | null
  make: string | null
  model: string | null
  vin: string | null // VIN/chassis number (17 chars)
  mileage: number | null // Odometer reading
  amg_nomenclature: string | null // AMG, AMG Line, etc. (high signal field)
  transmission: string | null // 4matic+, etc.
  price: number | null
  current_bid: number | null
  current_bid_username: string | null
  reserve_price: number | null
  currency_code: string | null
  auction_end_date: string | null
  auction_status: 'upcoming' | 'live' | 'ended' | 'sold'
  images: string[]
  description: string | null
  highlights: string[] // Merged with description
  lot_number: string | null
  location: string | null
  seller_name: string | null
  seller_website: string | null
  specialist_name: string | null
  specialist_username: string | null
  buyer_premium_percent: number | null
  // Detailed sections
  overview: any
  specs: any
  options: any
  exterior: any
  interior: any
  tech: any
  mechanical: any
  service: any
  condition: any
  carfax_url: string | null
  inspection_date: string | null
  inspection_notes: string | null
  // Live auction usernames
  bidder_usernames: string[]
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const {
      max_listings = 50,
      scrape_all = false,
      listing_url = null, // Optional: scrape single listing
      use_firecrawl = true,
    } = await req.json()

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || ''

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing Supabase configuration' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      )
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })

    // Get or create scrape source
    const { data: source, error: sourceError } = await supabase
      .from('scrape_sources')
      .select('id')
      .ilike('url', '%sbxcars.com%')
      .maybeSingle()

    let sourceId = source?.id

    if (!sourceId) {
      const { data: newSource, error: createError } = await supabase
        .from('scrape_sources')
        .insert({
          url: 'https://sbxcars.com',
          name: 'SBX Cars',
          source_type: 'auction',
          is_active: true,
        })
        .select('id')
        .single()

      if (createError) {
        console.error('Error creating source:', createError)
      } else {
        sourceId = newSource?.id
      }
    }

    const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY')

    // If single listing URL provided, scrape just that one
    if (listing_url) {
      console.log(`🔍 Scraping single listing: ${listing_url}`)
      const listing = await scrapeSBXCarsListing(listing_url, FIRECRAWL_API_KEY, use_firecrawl, supabase)
      
      if (listing) {
        await addListingToQueue(listing, sourceId, supabase)
        return new Response(
          JSON.stringify({
            success: true,
            listing,
            message: 'Listing scraped and queued',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      } else {
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to scrape listing' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        )
      }
    }

    // Discover all listings from browse/search pages
    console.log('🚀 Starting SBX Cars full ingestion...')
    const listings = await discoverSBXCarsListings(max_listings, FIRECRAWL_API_KEY, use_firecrawl, supabase)
    
    console.log(`📋 Found ${listings.length} listings`)

    const stats = {
      discovered: listings.length,
      queued: 0,
      skipped: 0,
      errors: 0,
    }

    // Add each listing to import queue
    for (const listing of listings) {
      try {
        const result = await addListingToQueue(listing, sourceId, supabase)
        if (result.success) {
          stats.queued++
        } else if (result.skipped) {
          stats.skipped++
        } else {
          stats.errors++
        }
      } catch (error: any) {
        console.error(`Error processing listing ${listing.url}:`, error.message)
        stats.errors++
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        stats,
        message: `Discovered ${listings.length} listings, queued ${stats.queued}`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: any) {
    console.error('Error in scrape-sbxcars:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || String(error),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

/**
 * Discover all listings from SBX Cars browse/search pages
 */
async function discoverSBXCarsListings(
  maxListings: number,
  firecrawlKey: string | undefined,
  useFirecrawl: boolean,
  supabase: any
): Promise<SBXCarsListing[]> {
  const listings: SBXCarsListing[] = []
  const seenUrls = new Set<string>()

  // Manual discovery with pagination and multiple browse pages
  const browseUrls = [
    'https://sbxcars.com/auctions',
    'https://sbxcars.com/upcoming',
    'https://sbxcars.com/ended',
  ]

  for (const browseUrl of browseUrls) {
    if (listings.length >= maxListings) break

    try {
      console.log(`🔍 Discovering listings from: ${browseUrl}`)
      
      // Try multiple pagination patterns
      const paginationPatterns = [
        (p: number) => p === 1 ? browseUrl : `${browseUrl}?page=${p}`,
        (p: number) => p === 1 ? browseUrl : `${browseUrl}/page/${p}`,
        (p: number) => p === 1 ? browseUrl : `${browseUrl}?p=${p}`,
      ]

      // First pass: collect all listing URLs from first 10 pages
      const allListingUrls: string[] = []
      let page = 1
      const maxPages = 10 // Limit to 10 pages per section to avoid timeouts
      let foundNewUrls = true

      while (foundNewUrls && page <= maxPages && allListingUrls.length < maxListings * 2) {
        foundNewUrls = false
        
        // Try first pagination pattern
        const pageUrl = page === 1 ? browseUrl : `${browseUrl}?page=${page}`
        const listingUrls = await extractListingUrlsFromBrowsePage(pageUrl, firecrawlKey, useFirecrawl)
        
        if (listingUrls.length > 0) {
          foundNewUrls = true
          for (const url of listingUrls) {
            if (!allListingUrls.includes(url) && url.includes('/listing/')) {
              allListingUrls.push(url)
            }
          }
        }
        
        page++
        await new Promise((resolve) => setTimeout(resolve, 500))
      }

      console.log(`  📋 Found ${allListingUrls.length} listing URLs from ${browseUrl}`)

      // Second pass: scrape listings (limit to maxListings)
      for (const url of allListingUrls) {
        if (seenUrls.has(url) || listings.length >= maxListings) continue
        seenUrls.add(url)

        const listing = await scrapeSBXCarsListing(url, firecrawlKey, useFirecrawl, supabase)
        if (listing) {
          listings.push(listing)
          console.log(`  ✅ Scraped: ${listing.title || url}`)
        }

        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
      
      console.log(`  📊 Found ${listings.length} listings from ${browseUrl}`)
    } catch (error: any) {
      console.error(`Error discovering from ${browseUrl}:`, error.message)
    }
  }

  return listings
}

/**
 * Extract listing URLs from a browse/search page
 */
async function extractListingUrlsFromBrowsePage(
  url: string,
  firecrawlKey: string | undefined,
  useFirecrawl: boolean
): Promise<string[]> {
  const urls: string[] = []

  try {
    let html = ''

    if (useFirecrawl && firecrawlKey) {
      // Use Firecrawl for better JS rendering
      const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${firecrawlKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url,
          formats: ['html'],
          waitFor: 3000,
          onlyMainContent: false,
        }),
      })

      if (firecrawlResponse.ok) {
        const data = await firecrawlResponse.json()
        html = data.data?.html || ''
      }
    }

    // Fallback to direct fetch
    if (!html) {
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      })
      html = await response.text()
    }

    // Extract listing URLs - common patterns for auction sites
    const urlPatterns = [
      /href=["'](https?:\/\/sbxcars\.com\/[^"']+)["']/gi,
      /href=["'](\/[^"']*\/lot\/[^"']+)["']/gi,
      /href=["'](\/[^"']*\/auction\/[^"']+)["']/gi,
      /href=["'](\/[^"']*\/listing\/[^"']+)["']/gi,
      /href=["'](\/[^"']*\/vehicle\/[^"']+)["']/gi,
      /data-url=["']([^"']+)["']/gi,
    ]

    for (const pattern of urlPatterns) {
      let match
      while ((match = pattern.exec(html)) !== null) {
        let listingUrl = match[1]
        if (listingUrl.startsWith('/')) {
          listingUrl = `https://sbxcars.com${listingUrl}`
        }
        if (listingUrl.includes('sbxcars.com') && !urls.includes(listingUrl)) {
          urls.push(listingUrl)
        }
      }
    }

    // Also try to find URLs in JSON data embedded in page
    const jsonMatches = html.match(/<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)
    if (jsonMatches) {
      for (const jsonScript of jsonMatches) {
        try {
          const jsonText = jsonScript.replace(/<script[^>]*>|<\/script>/gi, '').trim()
          const data = JSON.parse(jsonText)
          const extractedUrls = extractUrlsFromJson(data)
          urls.push(...extractedUrls)
        } catch {
          // Ignore JSON parse errors
        }
      }
    }
  } catch (error: any) {
    console.error(`Error extracting URLs from ${url}:`, error.message)
  }

  return [...new Set(urls)]
}

/**
 * Recursively extract URLs from JSON data
 */
function extractUrlsFromJson(obj: any, urls: string[] = []): string[] {
  if (typeof obj === 'string') {
    if (obj.includes('sbxcars.com') && (obj.includes('/lot/') || obj.includes('/auction/') || obj.includes('/listing/'))) {
      let url = obj
      if (url.startsWith('/')) {
        url = `https://sbxcars.com${url}`
      }
      if (!urls.includes(url)) {
        urls.push(url)
      }
    }
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      extractUrlsFromJson(item, urls)
    }
  } else if (obj && typeof obj === 'object') {
    for (const value of Object.values(obj)) {
      extractUrlsFromJson(value, urls)
    }
  }
  return urls
}

function detectCurrencyCodeFromText(text: string | null | undefined): string | null {
  const raw = String(text || '');
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper.includes('AED') || raw.includes('د.إ')) return 'AED';
  if (upper.includes('EUR') || raw.includes('€')) return 'EUR';
  if (upper.includes('GBP') || raw.includes('£')) return 'GBP';
  if (upper.includes('CHF')) return 'CHF';
  if (upper.includes('JPY') || raw.includes('¥')) return 'JPY';
  if (upper.includes('CAD')) return 'CAD';
  if (upper.includes('AUD')) return 'AUD';
  if (upper.includes('USD') || raw.includes('US$') || raw.includes('$')) return 'USD';
  return null;
}

/**
 * Scrape a single SBX Cars listing page
 */
async function scrapeSBXCarsListing(
  url: string,
  firecrawlKey: string | undefined,
  useFirecrawl: boolean,
  supabase: any
): Promise<SBXCarsListing | null> {
  try {
    let html = ''
    let doc: any = null

    if (useFirecrawl && firecrawlKey) {
      // Use Firecrawl for structured extraction
      const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${firecrawlKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url,
          formats: ['html', 'extract'],
          extract: {
            schema: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                year: { type: 'number' },
                make: { type: 'string' },
                model: { type: 'string' },
                price: { type: 'number' },
                current_bid: { type: 'number' },
                reserve_price: { type: 'number' },
                auction_end_date: { type: 'string' },
                description: { type: 'string' },
                lot_number: { type: 'string' },
                location: { type: 'string' },
              },
            },
          },
          waitFor: 3000,
          onlyMainContent: false,
        }),
      })

      if (firecrawlResponse.ok) {
        const data = await firecrawlResponse.json()
        html = data.data?.html || ''
        const extract = data.data?.extract

        // Even if Firecrawl returns extract, we still need HTML for full extraction
        // Continue to HTML parsing below for enhanced extraction
      }
    }

    // Fallback to direct HTML parsing
    if (!html) {
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      })
      html = await response.text()
    }

    doc = new DOMParser().parseFromString(html, 'text/html')

    // Extract data from HTML
    const title = doc?.querySelector('h1')?.textContent?.trim() || 
                 doc?.querySelector('[class*="title"]')?.textContent?.trim() || 
                 doc?.querySelector('title')?.textContent?.trim() || ''

    // Parse make/model with special handling for Mercedes-Benz (AMG nomenclature, 4matic+ transmission)
    const parsed = parseMakeModel(title)
    const year = parsed.year
    const make = parsed.make
    const model = parsed.model
    const amg_nomenclature = parsed.amg_nomenclature
    const transmission = parsed.transmission

    // Extract all detailed sections
    const sections = extractDetailedSections(doc)

    // Extract highlights and merge with description
    const highlights = extractHighlights(doc)
    const descriptionSection = doc?.querySelector('[class*="description"]')
    let description = descriptionSection?.textContent?.trim() || null
    if (highlights.length > 0) {
      const highlightsText = highlights.join('\n\n')
      description = description ? `${description}\n\nHighlights:\n${highlightsText}` : highlightsText
    }

    // Extract Carfax
    const carfaxUrl = extractCarfax(doc)

    // Extract inspection
    const inspection = extractInspection(doc)

    // Extract current bid and username
    const bidSection = doc?.querySelector('[class*="bid"], [class*="current"]')
    const bidText = bidSection?.textContent || ''
    const bidMatch = bidText.match(/(?:latest|current)\s+bid[:\s]+(?:US\$|AED|€|£)?([\d,]+)/i)
    const currentBid = bidMatch ? parseInt(bidMatch[1].replace(/,/g, '')) : null
    const currencyCode = detectCurrencyCodeFromText(bidText)
    const currentBidUsername = extractCurrentBidUsername(doc)

    // Extract bidder usernames (for live auctions)
    const bidderUsernames = extractBidderUsernames(doc)

    // Extract seller
    const seller = extractSeller(doc)

    // Extract specialist
    const specialist = extractSpecialist(doc)

    // Extract buyer's premium
    const buyerPremium = extractBuyersPremium(doc)

    // Extract lot number from URL or page
    const lotMatch = url.match(/\/listing\/(\d+)/)
    const lotNumber = lotMatch ? lotMatch[1] : null

    // Extract location
    const locationSection = doc?.querySelector('[class*="location"]')
    const location = locationSection?.textContent?.trim() || null

    // Extract VIN - check multiple patterns common in auction sites
    let vin: string | null = null
    const vinPatterns = [
      /VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i,
      /Chassis[:\s]*([A-HJ-NPR-Z0-9]{17})/i,
      /data-vin=["']([A-HJ-NPR-Z0-9]{17})["']/i,
      /"vin"[:\s]*["']([A-HJ-NPR-Z0-9]{17})["']/i,
      /Serial[:\s#]*([A-HJ-NPR-Z0-9]{17})/i,
    ]
    for (const pattern of vinPatterns) {
      const vinMatch = html.match(pattern)
      if (vinMatch && vinMatch[1] && vinMatch[1].length === 17) {
        vin = vinMatch[1].toUpperCase()
        console.log(`✅ SBX: Found VIN: ${vin}`)
        break
      }
    }

    // Extract mileage - check multiple patterns
    let mileage: number | null = null
    const mileagePatterns = [
      /~?([\d,]+)\s*(?:Miles|mi)\b/i,
      /Mileage[:\s]*([\d,]+)/i,
      /Odometer[:\s]*([\d,]+)/i,
      /"mileage"[:\s]*([\d,]+)/i,
    ]
    for (const pattern of mileagePatterns) {
      const mileageMatch = html.match(pattern)
      if (mileageMatch && mileageMatch[1]) {
        const parsed = parseInt(mileageMatch[1].replace(/,/g, ''), 10)
        if (Number.isFinite(parsed) && parsed > 0 && parsed < 1000000) {
          mileage = parsed
          console.log(`✅ SBX: Found mileage: ${mileage}`)
          break
        }
      }
    }

    // Extract images
    const images = extractImages(doc, url)

    // Extract auction status
    const auctionStatus = determineAuctionStatus(url, null)

    const listing: SBXCarsListing = {
      url,
      title,
      year,
      make,
      model,
      vin,
      mileage,
      amg_nomenclature,
      transmission,
      price: currentBid,
      current_bid: currentBid,
      current_bid_username: currentBidUsername,
      reserve_price: null,
      currency_code: currencyCode,
      auction_end_date: null,
      auction_status: auctionStatus,
      images,
      description,
      highlights,
      lot_number: lotNumber,
      location,
      seller_name: seller.name,
      seller_website: seller.website,
      specialist_name: specialist.name,
      specialist_username: specialist.username,
      buyer_premium_percent: buyerPremium,
      overview: sections.overview,
      specs: sections.specs,
      options: sections.options,
      exterior: sections.exterior,
      interior: sections.interior,
      tech: sections.tech,
      mechanical: sections.mechanical,
      service: sections.service,
      condition: sections.condition,
      carfax_url: carfaxUrl,
      inspection_date: inspection.date,
      inspection_notes: inspection.notes,
      bidder_usernames: bidderUsernames,
    }

    // Create users and organizations
    await createUsersAndOrganizations(listing, supabase)

    return listing
  } catch (error: any) {
    console.error(`Error scraping listing ${url}:`, error.message)
    return null
  }
}

/**
 * Parse Mercedes-Benz model correctly
 * AMG is special nomenclature (high signal), 4matic+ is transmission
 */
function parseMercedesBenzModel(title: string): {
  make: string
  model: string
  amg_nomenclature: string | null
  transmission: string | null
} {
  const result = {
    make: 'Mercedes-Benz',
    model: null as string | null,
    amg_nomenclature: null as string | null,
    transmission: null as string | null,
  }

  // Extract transmission patterns (4matic+, 4MATIC, etc.)
  const transPatterns = [
    /4matic\+/i,
    /4matic/i,
    /4MATIC/i,
    /automatic/i,
    /manual/i,
    /AMT/i,
    /CVT/i,
  ]

  for (const pattern of transPatterns) {
    const match = title.match(pattern)
    if (match) {
      result.transmission = match[0]
      break
    }
  }

  // Remove transmission from title for model parsing
  let cleanTitle = title
  if (result.transmission) {
    cleanTitle = cleanTitle.replace(new RegExp(result.transmission, 'gi'), '').trim()
  }

  // Extract AMG nomenclature (AMG, AMG Line, AMG Performance, etc.)
  const amgPatterns = [
    /(AMG\s+(?:Line|Performance|Package|Sport)?)/i,
    /(AMG)/i,
  ]

  for (const pattern of amgPatterns) {
    const match = cleanTitle.match(pattern)
    if (match) {
      result.amg_nomenclature = match[1]
      cleanTitle = cleanTitle.replace(new RegExp(match[1], 'gi'), '').trim()
      break
    }
  }

  // Extract model (everything after "Mercedes-Benz" and AMG, before transmission)
  const modelMatch = cleanTitle.match(/Mercedes-Benz\s+(?:AMG\s+)?(.+?)(?:\s+4matic|\s+automatic|\s+manual|$)/i)
  if (modelMatch) {
    result.model = modelMatch[1].trim()
  } else {
    // Fallback: extract after year and make
    const parts = cleanTitle.split(/\s+/)
    const mercedesIndex = parts.findIndex(p => p.toLowerCase().includes('mercedes'))
    if (mercedesIndex >= 0 && parts[mercedesIndex + 1]) {
      const modelParts = parts.slice(mercedesIndex + 2) // Skip "Mercedes-Benz"
      result.model = modelParts.join(' ').trim()
    }
  }

  return result
}

/**
 * Parse make/model from title (handles Mercedes-Benz specially)
 */
function parseMakeModel(title: string): {
  year: number | null
  make: string | null
  model: string | null
  amg_nomenclature: string | null
  transmission: string | null
} {
  const yearMatch = title.match(/\b(19|20)\d{2}\b/)
  const year = yearMatch ? parseInt(yearMatch[0]) : null

  // Special handling for Mercedes-Benz
  if (title.toLowerCase().includes('mercedes')) {
    const mb = parseMercedesBenzModel(title)
    return {
      year,
      make: mb.make,
      model: mb.model,
      amg_nomenclature: mb.amg_nomenclature,
      transmission: mb.transmission,
    }
  }

  // Generic parsing for other makes
  const parts = title.split(/\s+/)
  let make: string | null = null
  let model: string | null = null

  if (parts.length >= 3) {
    const yearIndex = parts.findIndex((p) => /^(19|20)\d{2}$/.test(p))
    if (yearIndex >= 0 && yearIndex < parts.length - 1) {
      make = parts[yearIndex + 1] || null
      model = parts.slice(yearIndex + 2).join(' ') || null
    }
  }

  return {
    year,
    make,
    model,
    amg_nomenclature: null,
    transmission: null,
  }
}

/**
 * Extract all detailed sections from listing page
 */
function extractDetailedSections(doc: any): {
  overview: any
  specs: any
  options: any
  exterior: any
  interior: any
  tech: any
  mechanical: any
  service: any
  condition: any
} {
  const sections = {
    overview: null,
    specs: null,
    options: null,
    exterior: null,
    interior: null,
    tech: null,
    mechanical: null,
    service: null,
    condition: null,
  }

  const sectionSelectors = {
    overview: '[class*="overview"], [id*="overview"], [data-section="overview"]',
    specs: '[class*="spec"], [id*="spec"], [data-section="spec"]',
    options: '[class*="option"], [id*="option"], [data-section="option"]',
    exterior: '[class*="exterior"], [id*="exterior"], [data-section="exterior"]',
    interior: '[class*="interior"], [id*="interior"], [data-section="interior"]',
    tech: '[class*="tech"], [id*="tech"], [data-section="tech"], [class*="technology"]',
    mechanical: '[class*="mech"], [id*="mech"], [data-section="mech"], [class*="mechanical"]',
    service: '[class*="service"], [id*="service"], [data-section="service"]',
    condition: '[class*="condition"], [id*="condition"], [data-section="condition"]',
  }

  for (const [key, selector] of Object.entries(sectionSelectors)) {
    const element = doc?.querySelector(selector)
    if (element) {
      const data: any = {
        text: element.textContent?.trim() || null,
        items: [],
      }

      const listItems = element.querySelectorAll('li, [class*="item"], [class*="feature"]')
      for (const item of listItems) {
        const text = item.textContent?.trim()
        if (text) {
          data.items.push(text)
        }
      }

      const keyValuePairs: Record<string, string> = {}
      const dtElements = element.querySelectorAll('dt, [class*="label"], [class*="key"]')
      for (const dt of dtElements) {
        const key = dt.textContent?.trim()
        const dd = dt.nextElementSibling || dt.parentElement?.querySelector('dd, [class*="value"]')
        if (key && dd) {
          keyValuePairs[key] = dd.textContent?.trim() || ''
        }
      }
      if (Object.keys(keyValuePairs).length > 0) {
        data.keyValuePairs = keyValuePairs
      }

      sections[key as keyof typeof sections] = data
    }
  }

  return sections
}

/**
 * Extract Carfax URL if present
 */
function extractCarfax(doc: any): string | null {
  const carfaxLinks = doc?.querySelectorAll('a[href*="carfax"], a[href*="CARFAX"]')
  for (const link of carfaxLinks || []) {
    const href = link.getAttribute('href')
    if (href && (href.includes('carfax') || href.includes('CARFAX'))) {
      return href.startsWith('http') ? href : `https://sbxcars.com${href}`
    }
  }

  const carfaxText = doc?.textContent?.match(/carfax/i)
  if (carfaxText) {
    const carfaxElement = Array.from(doc?.querySelectorAll('*') || []).find((el: any) =>
      el.textContent?.toLowerCase().includes('carfax')
    )
    if (carfaxElement) {
      const link = carfaxElement.querySelector('a[href]')
      if (link) {
        const href = link.getAttribute('href')
        if (href) {
          return href.startsWith('http') ? href : `https://sbxcars.com${href}`
        }
      }
    }
  }

  return null
}

/**
 * Extract inspection data
 */
function extractInspection(doc: any): {
  date: string | null
  notes: string | null
} {
  const result = {
    date: null as string | null,
    notes: null as string | null,
  }

  const inspectionSection = doc?.querySelector('[class*="inspection"], [class*="report"], [id*="inspection"]')
  if (inspectionSection) {
    const text = inspectionSection.textContent || ''
    
    const dateMatch = text.match(/(?:performed|conducted|done)\s+on\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i)
    if (dateMatch) {
      try {
        const date = new Date(dateMatch[1])
        if (!isNaN(date.getTime())) {
          result.date = date.toISOString().split('T')[0]
        }
      } catch {
        const altMatch = text.match(/(\d{4}-\d{2}-\d{2})/)
        if (altMatch) {
          result.date = altMatch[1]
        }
      }
    }

    const notesMatch = text.match(/(?:noted|found|observed|reported)\s+(?:the\s+following:?|that)\s*:?\s*(.+)/is)
    if (notesMatch) {
      result.notes = notesMatch[1].trim()
    } else {
      result.notes = text.trim()
    }
  }

  return result
}

/**
 * Extract current bid username
 */
function extractCurrentBidUsername(doc: any): string | null {
  const bidSection = doc?.querySelector('[class*="bid"], [class*="current"], [class*="latest"]')
  if (bidSection) {
    const usernamePatterns = [
      /by\s+([a-z0-9_]+)/i,
      /username[:\s]+([a-z0-9_]+)/i,
      /bidder[:\s]+([a-z0-9_]+)/i,
      /@([a-z0-9_]+)/i,
    ]

    const text = bidSection.textContent || ''
    for (const pattern of usernamePatterns) {
      const match = text.match(pattern)
      if (match && match[1]) {
        return match[1].trim()
      }
    }

    const usernameAttr = bidSection.getAttribute('data-username') || 
                        bidSection.getAttribute('data-bidder') ||
                        bidSection.querySelector('[data-username]')?.getAttribute('data-username')
    if (usernameAttr) {
      return usernameAttr.trim()
    }
  }

  return null
}

/**
 * Extract all bidder usernames from live auction
 */
function extractBidderUsernames(doc: any): string[] {
  const usernames: string[] = []
  const seen = new Set<string>()

  const bidHistory = doc?.querySelector('[class*="bid-history"], [class*="bids"], [id*="bid"]')
  if (bidHistory) {
    const bidEntries = bidHistory.querySelectorAll('[class*="bid"], [class*="entry"], li')
    for (const entry of bidEntries || []) {
      const text = entry.textContent || ''
      
      const patterns = [
        /by\s+([a-z0-9_]+)/i,
        /username[:\s]+([a-z0-9_]+)/i,
        /bidder[:\s]+([a-z0-9_]+)/i,
        /@([a-z0-9_]+)/i,
      ]

      for (const pattern of patterns) {
        const match = text.match(pattern)
        if (match && match[1] && !seen.has(match[1].toLowerCase())) {
          usernames.push(match[1].trim())
          seen.add(match[1].toLowerCase())
        }
      }

      const username = entry.getAttribute('data-username') || 
                      entry.getAttribute('data-bidder')
      if (username && !seen.has(username.toLowerCase())) {
        usernames.push(username.trim())
        seen.add(username.toLowerCase())
      }
    }
  }

  return usernames
}

/**
 * Extract seller information
 */
function extractSeller(doc: any): {
  name: string | null
  website: string | null
} {
  const result = {
    name: null as string | null,
    website: null as string | null,
  }

  const sellerSection = doc?.querySelector('[class*="seller"], [class*="dealer"], [class*="consignor"]')
  if (sellerSection) {
    result.name = sellerSection.textContent?.trim() || null
    const websiteLink = sellerSection.querySelector('a[href]')
    if (websiteLink) {
      result.website = websiteLink.getAttribute('href')
    }
  }

  if (!result.name) {
    const headerSeller = doc?.querySelector('header [class*="seller"], [class*="banner"] [class*="seller"]')
    if (headerSeller) {
      result.name = headerSeller.textContent?.trim() || null
    }
  }

  return result
}

/**
 * Extract specialist information
 */
function extractSpecialist(doc: any): {
  name: string | null
  username: string | null
} {
  const result = {
    name: null as string | null,
    username: null as string | null,
  }

  const specialistSection = doc?.querySelector('[class*="specialist"], [class*="expert"], [class*="advisor"]')
  if (specialistSection) {
    result.name = specialistSection.textContent?.trim() || null
    const profileLink = specialistSection.querySelector('a[href*="profile"], a[href*="user"]')
    if (profileLink) {
      const href = profileLink.getAttribute('href')
      const usernameMatch = href?.match(/(?:profile|user)\/([^\/]+)/i)
      if (usernameMatch) {
        result.username = usernameMatch[1]
      }
    }
  }

  return result
}

/**
 * Extract buyer's premium percentage
 */
function extractBuyersPremium(doc: any): number | null {
  const premiumSection = doc?.querySelector('[class*="premium"], [class*="buyer"]')
  if (premiumSection) {
    const text = premiumSection.textContent || ''
    const match = text.match(/(?:buyer'?s?\s+)?premium[:\s]+(\d+(?:\.\d+)?)\s*%/i)
    if (match) {
      return parseFloat(match[1])
    }
  }

  return null
}

/**
 * Extract highlights and merge with description
 */
function extractHighlights(doc: any): string[] {
  const highlights: string[] = []
  const highlightsSection = doc?.querySelector('[class*="highlight"], [class*="feature"], [class*="key"]')
  if (highlightsSection) {
    const items = highlightsSection.querySelectorAll('li, [class*="item"], [class*="point"]')
    for (const item of items || []) {
      const text = item.textContent?.trim()
      if (text) {
        highlights.push(text)
      }
    }
  }

  return highlights
}

/**
 * Create users and organizations from extracted data
 */
async function createUsersAndOrganizations(listing: SBXCarsListing, supabase: any) {
  // 1. Create seller organization/user
  if (listing.seller_name) {
    await createSellerOrganization(listing.seller_name, listing.seller_website, listing.url, supabase)
  }

  // 2. Create current bid user
  if (listing.current_bid_username) {
    await createAuctionUser(listing.current_bid_username, 'sbxcars', supabase)
  }

  // 3. Create bidder users
  for (const username of listing.bidder_usernames) {
    await createAuctionUser(username, 'sbxcars', supabase)
  }

  // 4. Create specialist user and link to SBX org
  if (listing.specialist_username || listing.specialist_name) {
    await createSpecialistUser(listing.specialist_username || listing.specialist_name!, supabase)
  }
}

/**
 * Create seller organization with external data lookup
 */
async function createSellerOrganization(sellerName: string, website: string | null, sourceUrl: string, supabase: any) {
  let orgId: string | null = null

  const { data: existing } = await supabase
    .from('businesses')
    .select('id')
    .ilike('business_name', `%${sellerName}%`)
    .maybeSingle()

  if (existing) {
    orgId = existing.id
  } else {
    const orgData: any = {
      business_name: sellerName,
      business_type: 'dealership',
      website: website || null,
      is_public: true,
      metadata: {
        discovered_from: sourceUrl,
        platform: 'sbxcars',
        discovered_at: new Date().toISOString(),
      },
    }

    const { data: newOrg } = await supabase
      .from('businesses')
      .insert(orgData)
      .select('id')
      .single()

    if (newOrg) {
      orgId = newOrg.id
    }
  }

  // Trigger external data lookup if website exists
  if (orgId && website) {
    try {
      await supabase.functions.invoke('extract-organization-from-seller', {
        body: {
          seller_name: sellerName,
          seller_url: sourceUrl,
          website: website,
          platform: 'sbxcars',
        },
      })
    } catch (err) {
      console.warn('Failed to trigger external data lookup:', err)
    }
  }
}

/**
 * Create auction user (external identity)
 */
async function createAuctionUser(username: string, platform: string, supabase: any) {
  const profileUrl = `https://sbxcars.com/user/${encodeURIComponent(username)}`

  await supabase
    .from('external_identities')
    .upsert(
      {
        platform: platform,
        handle: username,
        profile_url: profileUrl,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'platform,handle' }
    )
}

/**
 * Create specialist user and link to SBX org
 */
async function createSpecialistUser(specialistIdentifier: string, supabase: any) {
  await createAuctionUser(specialistIdentifier, 'sbxcars', supabase)

  // Find SBX Cars organization
  const { data: sbxOrg } = await supabase
    .from('businesses')
    .select('id')
    .eq('website', 'https://sbxcars.com')
    .or('business_name.ilike.%SBX Cars%,business_name.ilike.%sbxcars%')
    .maybeSingle()

  if (sbxOrg) {
    console.log(`Specialist ${specialistIdentifier} should be linked to SBX org ${sbxOrg.id} as collaborator`)
    // Link will be created in process-import-queue when vehicle is created
  }
}

/**
 * Extract images from HTML document
 */
function extractImages(doc: any, baseUrl: string): string[] {
  const images: string[] = []
  const seen = new Set<string>()

  if (!doc) return images

  // Find all img tags
  const imgTags = doc.querySelectorAll('img')
  for (const img of imgTags) {
    const src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src')
    if (src && !src.startsWith('data:')) {
      let fullUrl = src
      if (src.startsWith('/')) {
        fullUrl = `https://sbxcars.com${src}`
      } else if (src.startsWith('//')) {
        fullUrl = `https:${src}`
      } else if (!src.startsWith('http')) {
        continue
      }

      if (!seen.has(fullUrl) && !fullUrl.includes('logo') && !fullUrl.includes('icon')) {
        images.push(fullUrl)
        seen.add(fullUrl)
      }
    }
  }

  // Also check for gallery images in data attributes
  const galleryItems = doc.querySelectorAll('[data-image], [data-src], [data-gallery]')
  for (const item of galleryItems) {
    const imageUrl = item.getAttribute('data-image') || item.getAttribute('data-src')
    if (imageUrl && imageUrl.startsWith('http') && !seen.has(imageUrl)) {
      images.push(imageUrl)
      seen.add(imageUrl)
    }
  }

  return images
}

/**
 * Determine auction status from URL and end date
 */
function determineAuctionStatus(url: string, endDate: string | null): 'upcoming' | 'live' | 'ended' | 'sold' {
  const urlLower = url.toLowerCase()
  if (urlLower.includes('upcoming')) return 'upcoming'
  if (urlLower.includes('live') || urlLower.includes('active')) return 'live'
  if (urlLower.includes('ended') || urlLower.includes('sold')) return 'ended'

  if (endDate) {
    const end = new Date(endDate)
    const now = new Date()
    if (end < now) return 'ended'
    if (end > now) return 'live'
  }

  return 'live' // Default
}

/**
 * Add listing to import queue
 */
async function addListingToQueue(
  listing: SBXCarsListing,
  sourceId: string | undefined,
  supabase: any
): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
  try {
    // Check if already in queue
    const { data: existing } = await supabase
      .from('import_queue')
      .select('id')
      .eq('listing_url', listing.url)
      .maybeSingle()

    if (existing) {
      return { success: false, skipped: true }
    }

    // Check if vehicle already exists
    const { data: existingVehicle } = await supabase
      .from('vehicles')
      .select('id')
      .eq('discovery_url', listing.url)
      .maybeSingle()

    if (existingVehicle) {
      return { success: false, skipped: true }
    }

    // Add to queue
    const { error } = await supabase.from('import_queue').insert({
      source_id: sourceId,
      listing_url: listing.url,
      listing_title: listing.title,
      listing_price: listing.price || listing.current_bid,
      listing_year: listing.year,
      listing_make: listing.make,
      listing_model: listing.model,
      thumbnail_url: listing.images[0] || null,
        raw_data: {
          ...listing,
          source: 'SBXCARS',
          auction_status: listing.auction_status,
        lot_number: listing.lot_number,
        amg_nomenclature: listing.amg_nomenclature,
        transmission: listing.transmission,
        current_bid_username: listing.current_bid_username,
        bidder_usernames: listing.bidder_usernames,
        seller_name: listing.seller_name,
        seller_website: listing.seller_website,
        specialist_name: listing.specialist_name,
        specialist_username: listing.specialist_username,
        buyer_premium_percent: listing.buyer_premium_percent,
        overview: listing.overview,
        specs: listing.specs,
        options: listing.options,
        exterior: listing.exterior,
        interior: listing.interior,
        tech: listing.tech,
        mechanical: listing.mechanical,
        service: listing.service,
        condition: listing.condition,
        carfax_url: listing.carfax_url,
        inspection_date: listing.inspection_date,
        inspection_notes: listing.inspection_notes,
        highlights: listing.highlights,
      },
      status: 'pending',
      priority: listing.auction_status === 'live' ? 10 : 5, // Prioritize live auctions
    })

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

