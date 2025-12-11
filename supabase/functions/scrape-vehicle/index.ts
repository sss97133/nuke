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
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi
  let match

  while ((match = imgRegex.exec(html)) !== null) {
    const src = match[1]
    if (src && !src.startsWith('data:') && !src.includes('icon') && !src.includes('logo')) {
      // Convert relative URLs to absolute
      if (src.startsWith('//')) {
        images.push('https:' + src)
      } else if (src.startsWith('/')) {
        // Would need base URL for this, skip for now
        continue
      } else if (src.startsWith('http')) {
        images.push(src)
      }
    }
  }

  return images
}