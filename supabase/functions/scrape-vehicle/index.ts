import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { url } = await req.json()

    if (!url) {
      return new Response(
        JSON.stringify({ error: 'URL is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    console.log('🔍 Scraping URL:', url)

    // Simple fetch to get the page
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const html = await response.text()
    const doc = new DOMParser().parseFromString(html, 'text/html')

    // Basic data extraction
    const data: any = {
      success: true,
      source: 'Unknown',
      listing_url: url,
      discovery_url: url,
      title: doc.querySelector('title')?.textContent || '',
      description: '', // Initialize with empty string to prevent undefined
      images: extractImageURLs(html),
      timestamp: new Date().toISOString(),
      year: null,
      make: null,
      model: null,
      asking_price: null,
      location: null,
      _function_version: '2.0'  // Debug version identifier
    }

    // Extract VIN from HTML - works for multiple sites
    const vinPatterns = [
      // Pattern 1: Dealer listings with <span class="valu">VIN</span> (Jordan Motorsports pattern)
      /<span[^>]*class="[^"]*valu[^"]*"[^>]*>([A-HJ-NPR-Z0-9]{17})<\/span>/i,
      // Pattern 2: Worldwide Vintage Autos format: <div class="spec-line vin">VIN 1Z8749S420546</div>
      /<div[^>]*class="[^"]*spec-line[^"]*vin[^"]*"[^>]*>VIN\s+([A-HJ-NPR-Z0-9]{17})/i,
      // Pattern 3: General VIN pattern with class containing "vin"
      /<[^>]*class="[^"]*vin[^"]*"[^>]*>[\s\S]*?VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i,
      // Pattern 4: Simple VIN: pattern
      /VIN[:\s]+([A-HJ-NPR-Z0-9]{17})/i,
      // Pattern 5: Any 17-char alphanumeric near "VIN" text
      /VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i,
    ]

    for (const pattern of vinPatterns) {
      const match = html.match(pattern)
      if (match && match[1] && match[1].length === 17 && !/[IOQ]/.test(match[1])) {
        data.vin = match[1].toUpperCase()
        console.log(`✅ VIN extracted: ${data.vin}`)
        break
      }
    }

    // Simple Craigslist detection and parsing
    if (url.includes('craigslist.org')) {
      data.source = 'Craigslist'

      // Extract title
      const titleElement = doc.querySelector('h1 .postingtitletext')
      if (titleElement) {
        data.title = titleElement.textContent?.trim()
      }

      // Extract price
      const priceElement = doc.querySelector('.price')
      if (priceElement) {
        const priceText = priceElement.textContent?.trim()
        const priceMatch = priceText?.match(/\$?([\d,]+)/)
        if (priceMatch) {
          data.asking_price = parseInt(priceMatch[1].replace(/,/g, ''))
        }
      }

      // Extract location
      const locationElement = doc.querySelector('.postingtitle .postingtitletext small')
      if (locationElement) {
        data.location = locationElement.textContent?.trim().replace(/[()]/g, '')
      }

      // Extract description
      const bodyElement = doc.querySelector('#postingbody')
      if (bodyElement) {
        data.description = bodyElement.textContent?.trim() || ''
      }

      // Extract dealer information from listing (for multi-city dealers like Jordan Motorsports)
      const dealerInfo = extractDealerInfo(html, data.description || '', data.title || '')
      if (dealerInfo.name) {
        data.dealer_name = dealerInfo.name
      }
      if (dealerInfo.website) {
        data.dealer_website = dealerInfo.website
      }
      if (dealerInfo.phone) {
        data.dealer_phone = dealerInfo.phone
      }

      // Extract basic vehicle info from title
      if (data.title) {
        const yearMatch = data.title.match(/\b(19|20)\d{2}\b/)
        if (yearMatch) {
          data.year = parseInt(yearMatch[0])
        }

        // Simple make/model extraction
        const parts = data.title.split(' ')
        if (parts.length >= 3) {
          // Skip year if it's the first part
          let startIndex = 0
          if (parts[0] && parts[0].match(/\b(19|20)\d{2}\b/)) {
            startIndex = 1
          }
          if (parts[startIndex]) data.make = parts[startIndex]
          if (parts[startIndex + 1]) data.model = parts[startIndex + 1]
        }
      }

      console.log('🔍 Craigslist extraction results:', {
        title: data.title,
        year: data.year,
        make: data.make,
        model: data.model,
        price: data.asking_price,
        location: data.location
      })
    }

    // Worldwide Vintage Autos detection and parsing
    if (url.includes('worldwidevintageautos.com')) {
      data.source = 'Worldwide Vintage Autos'

      // Extract title
      const titleElement = doc.querySelector('h1') || doc.querySelector('title')
      if (titleElement) {
        data.title = titleElement.textContent?.trim()
      }

      // Extract price
      const priceElement = doc.querySelector('.price') || doc.querySelector('[class*="price"]')
      if (priceElement) {
        const priceText = priceElement.textContent?.trim()
        const priceMatch = priceText?.match(/\$?([\d,]+)/)
        if (priceMatch) {
          data.asking_price = parseInt(priceMatch[1].replace(/,/g, ''))
        }
      }

      // Extract description - look for description divs or meta descriptions
      const descriptionElement = doc.querySelector('[class*="description"]') || 
                                 doc.querySelector('[id*="description"]') ||
                                 doc.querySelector('meta[name="description"]')
      if (descriptionElement) {
        if (descriptionElement.tagName === 'META') {
          data.description = descriptionElement.getAttribute('content')?.trim() || ''
        } else {
          data.description = descriptionElement.textContent?.trim() || ''
        }
      }

      // Also try to extract from spec lines (common format on dealer sites)
      const specLines = doc.querySelectorAll('[class*="spec"]')
      let descriptionParts: string[] = []
      specLines.forEach(spec => {
        const text = spec.textContent?.trim()
        if (text && text.length > 0 && !text.includes('VIN') && !text.includes('Price')) {
          descriptionParts.push(text)
        }
      })
      if (descriptionParts.length > 0 && !data.description) {
        data.description = descriptionParts.join(' ')
      }

      // Extract year, make, model from title
      if (data.title) {
        const yearMatch = data.title.match(/\b(19|20)\d{2}\b/)
        if (yearMatch) {
          data.year = parseInt(yearMatch[0])
        }

        const parts = data.title.split(' ')
        if (parts.length >= 3) {
          let startIndex = 0
          if (parts[0] && parts[0].match(/\b(19|20)\d{2}\b/)) {
            startIndex = 1
          }
          if (parts[startIndex]) data.make = parts[startIndex]
          if (parts[startIndex + 1]) data.model = parts.slice(startIndex + 1).join(' ')
        }
      }

      // Try to extract engine/transmission from description
      if (data.description) {
        // Engine patterns: "L82 350 V8", "350 V8", "5.7L V8", etc.
        const engineMatch = data.description.match(/([A-Z0-9]+\s*\d+\.?\d*\s*[LV]?\s*V?\d+)/i)
        if (engineMatch) {
          data.engine_type = engineMatch[1].trim()
        }

        // Transmission patterns: "AUTO", "AUTOMATIC", "MANUAL", "4-SPEED", etc.
        const transMatch = data.description.match(/\b(AUTO|AUTOMATIC|MANUAL|\d+-SPEED)\b/i)
        if (transMatch) {
          data.transmission = transMatch[1].toUpperCase()
          if (data.transmission === 'AUTO') {
            data.transmission = 'AUTOMATIC'
          }
        }
      }

      console.log('🔍 Worldwide Vintage Autos extraction results:', {
        title: data.title,
        year: data.year,
        make: data.make,
        model: data.model,
        vin: data.vin,
        price: data.asking_price,
        description: data.description?.substring(0, 100),
        engine_type: data.engine_type,
        transmission: data.transmission,
        imageCount: data.images?.length || 0
      })
    }

    console.log(`✅ Final data structure being returned:`, data)

    return new Response(
      JSON.stringify(data),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error: any) {
    console.error('Error in scrape-vehicle:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || String(error)
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

// Helper function to extract image URLs
function extractImageURLs(html: string): string[] {
  const images: string[] = []
  const seen = new Set<string>()
  
  // Pattern 1: Standard img tags
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi
  let match

  while ((match = imgRegex.exec(html)) !== null) {
    const src = match[1]
    if (src && !src.startsWith('data:') && !src.includes('icon') && !src.includes('logo')) {
      // Convert relative URLs to absolute
      let fullUrl = src
      if (src.startsWith('//')) {
        fullUrl = 'https:' + src
      } else if (src.startsWith('/')) {
        continue // Skip relative URLs without base
      } else if (src.startsWith('http')) {
        fullUrl = src
      } else {
        continue
      }
      
      if (!seen.has(fullUrl)) {
        images.push(fullUrl)
        seen.add(fullUrl)
      }
    }
  }

  // Pattern 2: Data attributes (for galleries) - data-src, data-lazy-src, etc.
  const dataSrcPatterns = [
    /<[^>]+data-src=["']([^"']+)["'][^>]*>/gi,
    /<[^>]+data-lazy-src=["']([^"']+)["'][^>]*>/gi,
    /<[^>]+data-original=["']([^"']+)["'][^>]*>/gi,
    /<[^>]+data-image=["']([^"']+)["'][^>]*>/gi,
  ]
  
  for (const pattern of dataSrcPatterns) {
    while ((match = pattern.exec(html)) !== null) {
      const src = match[1]
      if (src && src.startsWith('http') && !seen.has(src)) {
        images.push(src)
        seen.add(src)
      }
    }
  }

  // Pattern 3: Background images in style attributes
  const bgImageRegex = /background-image:\s*url\(["']?([^"')]+)["']?\)/gi
  while ((match = bgImageRegex.exec(html)) !== null) {
    const src = match[1]
    if (src && src.startsWith('http') && !seen.has(src)) {
      images.push(src)
      seen.add(src)
    }
  }

  // Pattern 4: JSON data in script tags (for gallery systems)
  const jsonImagePatterns = [
    /"image":\s*"([^"]+)"/gi,
    /"url":\s*"([^"]+\.(jpg|jpeg|png|webp))"/gi,
    /"src":\s*"([^"]+\.(jpg|jpeg|png|webp))"/gi,
    /images:\s*\[([^\]]+)\]/gi,
  ]
  
  for (const pattern of jsonImagePatterns) {
    while ((match = pattern.exec(html)) !== null) {
      const src = match[1]
      if (src && src.startsWith('http') && !seen.has(src)) {
        images.push(src)
        seen.add(src)
      }
    }
  }

  // Pattern 5: Worldwide Vintage Autos specific - dealeraccelerate CDN patterns
  // They use patterns like: cdn.dealeraccelerate.com/worldwide/1/9741/606782/1920x1440/w/1979-chevrolet-corvette
  const dealerAcceleratePattern = /https?:\/\/cdn\.dealeraccelerate\.com\/[^"'\s<>]+\.(jpg|jpeg|png|webp)/gi
  while ((match = dealerAcceleratePattern.exec(html)) !== null) {
    const src = match[0]
    if (src && !seen.has(src)) {
      images.push(src)
      seen.add(src)
    }
  }

  // Filter out junk images (thumbnails, icons, etc.) but keep larger sizes
  const filtered = images.filter(img => {
    const lower = img.toLowerCase()
    // Keep full-size images, filter out small thumbnails
    const isThumbnail = lower.includes('94x63') || 
                       lower.includes('thumbnail') || 
                       lower.includes('thumb/') ||
                       lower.match(/\/\d+x\d+[xp]\//) // Small size patterns like /94x63xp/
    
    return !isThumbnail &&
           !lower.includes('icon') && 
           !lower.includes('logo') &&
           !lower.includes('placeholder') &&
           !lower.includes('youtube.com') // YouTube thumbnails
  })

  // Sort by size (prefer larger images first)
  return filtered.sort((a, b) => {
    const aSize = extractImageSize(a)
    const bSize = extractImageSize(b)
    return (bSize || 0) - (aSize || 0)
  })
}

// Helper to extract image size from URL for sorting
function extractImageSize(url: string): number | null {
  const sizeMatch = url.match(/(\d+)x(\d+)/)
  if (sizeMatch) {
    return parseInt(sizeMatch[1]) * parseInt(sizeMatch[2])
  }
  return null
}

/**
 * Extract dealer information from Craigslist listing
 * Detects dealers who post across multiple cities (like Jordan Motorsports)
 */
function extractDealerInfo(html: string, description: string, title: string): {
  name: string | null
  website: string | null
  phone: string | null
} {
  const combinedText = `${title} ${description}`.toLowerCase()
  const result: { name: string | null; website: string | null; phone: string | null } = {
    name: null,
    website: null,
    phone: null
  }

  // Extract website URLs from HTML (dealers often include their site)
  const websitePatterns = [
    // Full URLs: https://www.jordanmotorsport.com
    /https?:\/\/(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+\.(?:com|net|org|us|io|co))/gi,
    // Without protocol: www.jordanmotorsport.com or jordanmotorsport.com
    /(?:^|\s)(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+\.(?:com|net|org|us|io|co))(?:\s|$|[^\w.])/gi
  ]

  for (const pattern of websitePatterns) {
    const matches = html.match(pattern) || combinedText.match(pattern)
    if (matches) {
      // Filter out common non-dealer domains
      const excludeDomains = ['craigslist', 'facebook', 'google', 'youtube', 'instagram', 'twitter']
      for (const match of matches) {
        const cleanUrl = match.replace(/^https?:\/\//, '').replace(/^www\./, '').toLowerCase()
        const domain = cleanUrl.split('/')[0]
        if (!excludeDomains.some(ex => domain.includes(ex))) {
          result.website = `https://${cleanUrl}`
          break
        }
      }
      if (result.website) break
    }
  }

  // Extract dealer name from common patterns
  // Pattern 1: Business name followed by phone or website
  const namePatterns = [
    // "Jordan Motorsports" or "JORDAN MOTORSPORTS"
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:MOTORSPORTS?|MOTORS?|AUTO|CLASSICS?|COLLECTION|PERFORMANCE)/i,
    // Dealer name before phone: "Name (555) 123-4567"
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*\(?\s*(\d{3})\s*\)?\s*(\d{3})[-\s]?(\d{4})/,
    // Name with website: "Name www.domain.com"
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+(?:www\.)?[a-z0-9-]+\.[a-z]+/i,
    // Uppercase dealer names: "JORDAN MOTORSPORTS" or "DESERT PERFORMANCE"
    /\b([A-Z]{2,}(?:\s+[A-Z]{2,})+)\s+(?:MOTORSPORTS?|MOTORS?|AUTO|CLASSICS?|PERFORMANCE)/,
  ]

  for (const pattern of namePatterns) {
    const match = combinedText.match(pattern) || html.match(pattern)
    if (match && match[1]) {
      const name = match[1].trim()
      // Filter out common false positives
      if (name.length > 3 && 
          !['View', 'Click', 'Call', 'Visit', 'Contact', 'Location', 'Mileage'].includes(name)) {
        result.name = name
        // Extract phone if present in same match
        if (match[2] && match[3] && match[4]) {
          result.phone = `(${match[2]}) ${match[3]}-${match[4]}`
        }
        break
      }
    }
  }

  // Extract phone number (if not already extracted)
  if (!result.phone) {
    const phonePattern = /\(?\s*(\d{3})\s*\)?\s*[-.\s]?\s*(\d{3})\s*[-.\s]?\s*(\d{4})/
    const phoneMatch = combinedText.match(phonePattern)
    if (phoneMatch) {
      result.phone = `(${phoneMatch[1]}) ${phoneMatch[2]}-${phoneMatch[3]}`
    }
  }

  // If we found a website but no name, try to extract name from domain
  if (result.website && !result.name) {
    const domainMatch = result.website.match(/https?:\/\/(?:www\.)?([^.]+)/)
    if (domainMatch) {
      const domainName = domainMatch[1].replace(/-/g, ' ')
      // Convert "jordanmotorsport" -> "Jordan Motorsport"
      result.name = domainName
        .split(/(?=[A-Z])/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ')
    }
  }

  return result
}