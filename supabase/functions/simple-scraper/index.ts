import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

    console.log('Fetching URL:', url)

    // Fetch the URL with proper headers to avoid blocking
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; VehicleBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const html = await response.text()

    // Basic data extraction for Craigslist
    const extractBasicData = (html: string, url: string) => {
      // Extract title
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
      const title = titleMatch ? titleMatch[1].trim() : ''

      // Extract price and convert to numeric
      const priceMatch = html.match(/\$[\d,]+/g)
      const priceString = priceMatch ? priceMatch[0] : ''
      const price = priceString ? parseFloat(priceString.replace(/[\$,]/g, '')) : null

      // Extract images - ensure we always return an array
      const imageMatches = html.match(/https:\/\/images\.craigslist\.org\/[^"'\s>]+/g)
      const images = imageMatches ? [...new Set(imageMatches)].filter((url: string) => url && typeof url === 'string' && url.trim().length > 0) : []

      // Extract basic vehicle info from title
      let year, make, model
      const yearMatch = title.match(/\b(19|20)\d{2}\b/)
      if (yearMatch) {
        year = parseInt(yearMatch[0])
      }

      // Common make patterns
      const makePatterns = [
        'ford', 'chevrolet', 'chevy', 'toyota', 'honda', 'nissan', 'bmw',
        'mercedes', 'audi', 'volkswagen', 'vw', 'dodge', 'jeep', 'gmc',
        'cadillac', 'buick', 'pontiac', 'oldsmobile', 'lincoln', 'chrysler',
        'lexus', 'acura', 'infiniti', 'mazda', 'subaru', 'mitsubishi',
        'hyundai', 'kia', 'volvo', 'porsche', 'jaguar', 'land rover',
        'range rover', 'tesla', 'genesis', 'alfa romeo', 'fiat', 'mini'
      ]

      const titleLower = title.toLowerCase()
      for (const makeName of makePatterns) {
        if (titleLower.includes(makeName)) {
          make = makeName === 'chevy' ? 'Chevrolet' : makeName === 'vw' ? 'Volkswagen' :
                makeName.charAt(0).toUpperCase() + makeName.slice(1)
          break
        }
      }

      // Extract model (after finding make)
      if (make) {
        // First try common model patterns
        const modelPatterns = [
          'nova', 'camaro', 'corvette', 'chevelle', 'impala', 'malibu', 'silverado',
          'f150', 'f-150', 'mustang', 'explorer', 'escape', 'focus',
          'civic', 'accord', 'pilot', 'cr-v', 'crv',
          'wrangler', 'grand cherokee', 'cherokee',
          'ram', 'charger', 'challenger', 'dart'
        ]

        for (const modelName of modelPatterns) {
          if (titleLower.includes(modelName)) {
            model = modelName.split(' ').map(word =>
              word.charAt(0).toUpperCase() + word.slice(1)
            ).join(' ')
            break
          }
        }
        
        // If no model found in patterns, try to extract from title structure
        // Pattern: year make model (e.g., "1990 Lexus es250")
        if (!model) {
          const yearMatch = title.match(/\b(19|20)\d{2}\b/)
          if (yearMatch) {
            const afterYear = title.substring(title.indexOf(yearMatch[0]) + 4).trim()
            const makeIndex = afterYear.toLowerCase().indexOf(make.toLowerCase())
            if (makeIndex !== -1) {
              const afterMake = afterYear.substring(makeIndex + make.length).trim()
              // Take first word or two as model, stop at common delimiters
              const modelMatch = afterMake.match(/^([a-z0-9]+(?:\s+[a-z0-9]+)?)/i)
              if (modelMatch && modelMatch[1]) {
                model = modelMatch[1].split(/\s+/).map(word =>
                  word.charAt(0).toUpperCase() + word.slice(1)
                ).join(' ')
              }
            }
          }
        }
      }

      return {
        title,
        price,
        year,
        make,
        model: model || 'Unknown',  // Database requires non-empty string
        images,
        source: 'Craigslist',
        listing_url: url,
        raw_html_length: html.length
      }
    }

    const extractedData = extractBasicData(html, url)

    return new Response(
      JSON.stringify({
        success: true,
        data: extractedData,
        timestamp: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('Error in simple-scraper:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || String(error)
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})