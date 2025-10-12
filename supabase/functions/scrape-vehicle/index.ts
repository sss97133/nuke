import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    // Use CORS proxy to fetch BAT content (avoids authentication issues)
    const corsProxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`
    const response = await fetch(corsProxyUrl)

    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`)
    }

    const html = await response.text()
    const doc = new DOMParser().parseFromString(html, 'text/html')
    
    if (!doc) {
      throw new Error('Failed to parse HTML')
    }

    const data: any = {
      source: 'Bring a Trailer',
      listing_url: url
    }

    // Extract title
    const titleElement = doc.querySelector('h1')
    if (titleElement) {
      data.title = titleElement.textContent.trim()
      
      // Parse year/make/model from title
      const yearMatch = data.title.match(/\b(19|20)\d{2}\b/)
      if (yearMatch) {
        data.year = yearMatch[0]
      }
      
      const cleanTitle = data.title.replace(/^(No Reserve:|Modified|Restored):\s*/i, '')
      const parts = cleanTitle.split(/\s+/)
      let startIndex = 0
      if (parts[0]?.match(/\b(19|20)\d{2}\b/)) {
        startIndex = 1
      }
      if (parts.length > startIndex) {
        data.make = parts[startIndex]
        data.model = parts.slice(startIndex + 1).join(' ')
      }
    }

    // Get body text for extraction
    const bodyText = doc.body?.textContent || ''
    
    // Extract mileage - multiple patterns
    const mileagePatterns = [
      /(\d{1,3})k\s+Miles?\s+Shown/i,
      /(\d{1,3}(?:,\d{3})*)\s+Miles?\s+Shown/i,
      /(\d{1,3}(?:,\d{3})*)\s+miles?/i,
      /Mileage[:\s]*(\d{1,3}(?:,\d{3})*)/i
    ]
    
    for (const pattern of mileagePatterns) {
      const match = bodyText.match(pattern)
      if (match) {
        let mileage = match[1].replace(/,/g, '')
        if (pattern.source.includes('k\\s')) {
          mileage = mileage + '000'
        }
        data.mileage = mileage
        break
      }
    }

    // Extract VIN (support 17-char and legacy shorter chassis numbers)
    let vinMatch = bodyText.match(/(?:VIN|Chassis|Chassis Number|Serial)[:\s]*([A-HJ-NPR-Z0-9]{17})/i)
    if (!vinMatch) {
      // Fallback: match 8-13 char alphanumeric chassis-like tokens following VIN/Chassis labels
      vinMatch = bodyText.match(/(?:VIN|Chassis|Chassis Number|Serial)[:\s]*([A-HJ-NPR-Z0-9]{8,13})/i)
    }
    if (vinMatch) {
      data.vin = vinMatch[1]
    }

    // Extract engine
    const enginePatterns = [
      /(\d+\.?\d*)[-\s]*Liter\s+V(\d+)/i,
      /(\d+\.?\d*)L\s+V(\d+)/i,
      /(\d+)\s+(?:cubic[-\s]inch|ci)\s+V(\d+)/i
    ]
    
    for (const pattern of enginePatterns) {
      const match = bodyText.match(pattern)
      if (match) {
        data.engine_size = match[1]
        data.engine_type = `V${match[2]}`
        if (pattern.source.includes('Liter')) {
          data.engine_liters = parseFloat(match[1])
        }
        break
      }
    }

    // Extract transmission
    const transPatterns = [
      /(\d+)[-\s]*Speed\s+(Automatic|Manual|Auto)/i,
      /(Automatic|Manual|CVT)\s+Transmission/i
    ]
    
    for (const pattern of transPatterns) {
      const match = bodyText.match(pattern)
      if (match) {
        if (match[1] && match[2]) {
          data.transmission = match[2].toLowerCase().includes('auto') ? 'automatic' : 'manual'
          data.transmission_speed_count = parseInt(match[1])
          data.transmission_subtype = `${match[1]}-Speed ${match[2]}`
        } else {
          data.transmission = match[1].toLowerCase()
        }
        break
      }
    }

    // Extract color
    const colorMatch = bodyText.match(/([A-Za-z]+(?:\s+&\s+[A-Za-z]+)?)\s+Paint/i)
    if (colorMatch) {
      data.color = colorMatch[1]
    }

    // Extract sale price
    const priceMatch = bodyText.match(/Sold\s+for\s+(?:USD\s+)?\$?([\d,]+)/i)
    if (priceMatch) {
      data.sale_price = parseInt(priceMatch[1].replace(/,/g, ''))
    }

    // Extract images from data-gallery-items JSON if present
    const images: string[] = []
    const galleryEl = doc.querySelector('[data-gallery-items]') as any
    if (galleryEl) {
      try {
        const raw = galleryEl.getAttribute('data-gallery-items')
        if (raw) {
          const items = JSON.parse(raw)
          if (Array.isArray(items)) {
            for (const it of items) {
              const url = it?.large?.url || it?.small?.url
              if (url && !images.includes(url)) images.push(url)
            }
          }
        }
      } catch {}
    }

    // Fallback: scrape img tags
    if (images.length === 0) {
      const imgElements = doc.querySelectorAll('img')
      imgElements.forEach((img: any) => {
        const src = img.getAttribute('src')
        if (src && src.includes('uploads') && !images.includes(src)) {
          images.push(src)
        }
      })
    }
    
    if (images.length > 0) {
      // Normalize BAT scaled URLs to original if possible
      const normalized = images.map((u) => {
        try {
          const [base, query] = u.split('?')
          return base || u
        } catch { return u }
      })
      data.images = Array.from(new Set(normalized)).slice(0, 50)
    }

    // Extract description
    const descElement = doc.querySelector('.post-content, .listing-description, article')
    if (descElement) {
      data.description = descElement.textContent.trim().substring(0, 5000)
    }

    return new Response(
      JSON.stringify({ success: true, data }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
