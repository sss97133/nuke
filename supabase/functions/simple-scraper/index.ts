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

      // Extract images - comprehensive multi-pattern extraction
      let images: string[] = []
      const seen = new Set<string>()
      
      // Helper to add image URL with deduplication and validation
      const addImage = (imgUrl: string) => {
        if (!imgUrl || typeof imgUrl !== 'string') return
        
        // Clean the URL
        let cleanUrl = imgUrl
          .replace(/&#038;/g, '&')
          .replace(/&amp;/g, '&')
          .replace(/\\/g, '')
          .trim()
        
        // Skip invalid URLs
        if (!cleanUrl.startsWith('http')) return
        if (cleanUrl.includes('data:')) return
        
        // Skip icons/logos/small images
        const lower = cleanUrl.toLowerCase()
        if (lower.includes('logo') || lower.includes('icon') || lower.includes('avatar')) return
        if (lower.includes('themes/') || lower.includes('assets/') || lower.includes('.svg')) return
        if (lower.includes('placeholder') || lower.includes('spinner') || lower.includes('loading')) return
        if (lower.includes('150x150') || lower.includes('50x50') || lower.includes('32x32')) return
        if (lower.includes('youtube.com') || lower.includes('vimeo.com')) return
        
        // Remove resize parameters for full-size images
        cleanUrl = cleanUrl
          .replace(/[?&]w=\d+/g, '')
          .replace(/[?&]h=\d+/g, '')
          .replace(/[?&]resize=[^&]*/g, '')
          .replace(/[?&]fit=[^&]*/g, '')
          .replace(/[?&]quality=[^&]*/g, '')
          .replace(/[?&]$/, '')
          .replace(/-scaled\./g, '.')
          .replace(/-\d+x\d+\./, '.')  // Remove WordPress thumbnail suffix
        
        if (!seen.has(cleanUrl)) {
          seen.add(cleanUrl)
          images.push(cleanUrl)
        }
      }
      
      // PATTERN 1: Standard <img> tags - most common
      const imgTagRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi
      let match
      while ((match = imgTagRegex.exec(html)) !== null) {
        addImage(match[1])
      }
      
      // PATTERN 2: Data attributes for lazy-loaded images
      const dataAttrPatterns = [
        /<[^>]+data-src=["']([^"']+)["'][^>]*>/gi,
        /<[^>]+data-lazy-src=["']([^"']+)["'][^>]*>/gi,
        /<[^>]+data-original=["']([^"']+)["'][^>]*>/gi,
        /<[^>]+data-image=["']([^"']+)["'][^>]*>/gi,
        /<[^>]+data-srcset=["']([^"'\s]+)/gi,
      ]
      for (const pattern of dataAttrPatterns) {
        while ((match = pattern.exec(html)) !== null) {
          addImage(match[1])
        }
      }
      
      // PATTERN 3: Background images in style attributes
      const bgImageRegex = /background(?:-image)?:\s*url\(["']?([^"')]+)["']?\)/gi
      while ((match = bgImageRegex.exec(html)) !== null) {
        addImage(match[1])
      }
      
      // PATTERN 4: JSON data in scripts (galleries, React/Vue data)
      const jsonPatterns = [
        /"(?:image|img|src|url|imageUrl|image_url|photo|thumbnail)":\s*"([^"]+\.(?:jpg|jpeg|png|webp))"/gi,
        /"(?:full|large|original|highres)":\s*"([^"]+\.(?:jpg|jpeg|png|webp))"/gi,
      ]
      for (const pattern of jsonPatterns) {
        while ((match = pattern.exec(html)) !== null) {
          addImage(match[1])
        }
      }
      
      // PATTERN 5: BaT-specific - gallery images and wp-content
      if (url.includes('bringatrailer.com')) {
        // Gallery carousel images
        const batGalleryRegex = /https?:\/\/(?:bringatrailer\.com|cdn\.bringatrailer\.com)\/wp-content\/uploads\/[^"'\s<>\\]+\.(?:jpg|jpeg|png|webp)/gi
        while ((match = batGalleryRegex.exec(html)) !== null) {
          addImage(match[0])
        }
        
        // BaT image CDN patterns
        const batCdnRegex = /https?:\/\/(?:i\.)?bringatrailer\.com\/[^"'\s<>\\]+\.(?:jpg|jpeg|png|webp)/gi
        while ((match = batCdnRegex.exec(html)) !== null) {
          addImage(match[0])
        }
      }
      
      // PATTERN 6: Craigslist-specific - high-res images
      if (url.includes('craigslist.org')) {
        const clImageRegex = /https?:\/\/images\.craigslist\.org\/[^"'\s<>\\]+/gi
        while ((match = clImageRegex.exec(html)) !== null) {
          let imgUrl = match[0]
          // Upgrade to high-res if thumbnail
          imgUrl = imgUrl.replace('_600x450.jpg', '_1200x900.jpg')
          imgUrl = imgUrl.replace('_300x300.jpg', '_1200x900.jpg')
          addImage(imgUrl)
        }
      }
      
      // PATTERN 7: KSL Cars specific
      if (url.includes('ksl.com')) {
        const kslImageRegex = /https?:\/\/(?:img|images)\.ksl\.com\/[^"'\s<>\\]+\.(?:jpg|jpeg|png|webp)/gi
        while ((match = kslImageRegex.exec(html)) !== null) {
          addImage(match[0])
        }
      }
      
      // PATTERN 8: Facebook Marketplace specific
      if (url.includes('facebook.com')) {
        const fbImageRegex = /https?:\/\/(?:scontent|external)[^"'\s<>\\]+\.(?:jpg|jpeg|png|webp)[^"'\s<>\\]*/gi
        while ((match = fbImageRegex.exec(html)) !== null) {
          addImage(match[0])
        }
      }
      
      // PATTERN 9: Generic CDN patterns
      const cdnPatterns = [
        /https?:\/\/[^"'\s<>]+\.cloudfront\.net\/[^"'\s<>]+\.(?:jpg|jpeg|png|webp)/gi,
        /https?:\/\/[^"'\s<>]+\.amazonaws\.com\/[^"'\s<>]+\.(?:jpg|jpeg|png|webp)/gi,
        /https?:\/\/cdn\.[^"'\s<>]+\/[^"'\s<>]+\.(?:jpg|jpeg|png|webp)/gi,
      ]
      for (const pattern of cdnPatterns) {
        while ((match = pattern.exec(html)) !== null) {
          addImage(match[0])
        }
      }
      
      // Filter to keep only likely vehicle images (prioritize larger images)
      images = images.filter(img => {
        const lower = img.toLowerCase()
        // Remove tiny thumbnails
        if (lower.match(/\/thumb\/|_thumb\.|_t\.|\/s\/|\/xs\/|\/xxs\//)) return false
        // Remove common non-vehicle images
        if (lower.includes('profile') && lower.includes('user')) return false
        if (lower.includes('banner') || lower.includes('header')) return false
        return true
      })

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

      // Log image extraction results
      console.log(`[simple-scraper] Extracted ${images.length} images from ${url.substring(0, 60)}...`)
      if (images.length > 0) {
        console.log(`[simple-scraper] First image: ${images[0].substring(0, 80)}...`)
      } else {
        console.log(`[simple-scraper] WARNING: No images found! HTML length: ${html.length}`)
      }

      // Determine source
      let source = 'Unknown'
      if (url.includes('bringatrailer.com')) source = 'Bring a Trailer'
      else if (url.includes('craigslist.org')) source = 'Craigslist'
      else if (url.includes('ksl.com')) source = 'KSL Cars'
      else if (url.includes('facebook.com')) source = 'Facebook Marketplace'
      else if (url.includes('cargurus.com')) source = 'CarGurus'
      else if (url.includes('autotrader.com')) source = 'AutoTrader'
      else if (url.includes('cars.com')) source = 'Cars.com'
      else if (url.includes('classiccars.com')) source = 'ClassicCars.com'

      return {
        title,
        price,
        year,
        make,
        model: model || 'Unknown',  // Database requires non-empty string
        images,
        image_count: images.length, // Explicit count for debugging
        source,
        listing_url: url,
        html: html.substring(0, 50000), // Store first 50k chars for further processing
        text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 10000), // Plain text for AI extraction
        raw_html_length: html.length
      }
    }

    const extractedData = extractBasicData(html, url)
    
    // Log final result summary
    console.log(`[simple-scraper] Result: ${extractedData.year || '?'} ${extractedData.make || '?'} ${extractedData.model || '?'} - ${extractedData.images?.length || 0} images`)

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