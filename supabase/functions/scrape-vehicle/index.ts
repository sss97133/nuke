import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts'
import { S3Client, PutObjectCommand } from 'npm:@aws-sdk/client-s3@3.577.0'
import { RekognitionClient, DetectLabelsCommand, DetectTextCommand } from 'npm:@aws-sdk/client-rekognition@3.577.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Initialize AWS clients
const s3Client = new S3Client({
  region: Deno.env.get('AWS_REGION') || 'us-east-1',
  credentials: {
    accessKeyId: Deno.env.get('AWS_ACCESS_KEY_ID') || '',
    secretAccessKey: Deno.env.get('AWS_SECRET_ACCESS_KEY') || '',
  },
})

const rekognitionClient = new RekognitionClient({
  region: Deno.env.get('AWS_REGION') || 'us-east-1',
  credentials: {
    accessKeyId: Deno.env.get('AWS_ACCESS_KEY_ID') || '',
    secretAccessKey: Deno.env.get('AWS_SECRET_ACCESS_KEY') || '',
  },
})

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

    // Detect platform
    const isCraigslist = url.includes('craigslist.org')
    const isBringATrailer = url.includes('bringatrailer.com')

    // Fetch HTML directly (server-side, no CORS issues)
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NukeBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`)
    }

    const html = await response.text()
    const doc = new DOMParser().parseFromString(html, 'text/html')
    
    if (!doc) {
      throw new Error('Failed to parse HTML')
    }

    // Route to appropriate scraper
    let data: any
    if (isCraigslist) {
      data = scrapeCraigslist(doc, url)
    } else if (isBringATrailer) {
      data = scrapeBringATrailer(doc, url)
    } else {
      // Generic scraper
      data = {
        source: 'Unknown',
        listing_url: url
      }
    }

    // Return data immediately without image processing to avoid timeouts
    // Image URLs are returned, frontend can handle downloading
    console.log(`Found ${data.images?.length || 0} image URLs`)
    
    return new Response(
      JSON.stringify({ success: true, data }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    console.error('Error in scrape-vehicle:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

async function downloadAndAnalyzeImages(imageUrls: string[], source: string): Promise<any[]> {
  const results = []
  const maxImages = 5 // Limit to first 5 images to avoid timeouts
  
  for (let i = 0; i < Math.min(imageUrls.length, maxImages); i++) {
    const imageUrl = imageUrls[i]
    try {
      console.log(`Downloading image ${i + 1}/${Math.min(imageUrls.length, maxImages)}: ${imageUrl}`)
      
      // Download image
      const imageResponse = await fetch(imageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; NukeBot/1.0)',
          'Accept': 'image/*',
        },
        signal: AbortSignal.timeout(15000), // 15 second timeout
      })

      if (!imageResponse.ok) {
        console.warn(`Failed to download image ${imageUrl}: ${imageResponse.status}`)
        continue
      }

      const imageBuffer = await imageResponse.arrayBuffer()
      const imageBytes = new Uint8Array(imageBuffer)
      
      // Check size (max 10MB for Rekognition)
      if (imageBytes.length > 10 * 1024 * 1024) {
        console.warn(`Image too large: ${imageUrl}`)
        continue
      }

      // Analyze with Rekognition
      const labels = await analyzeImageWithRekognition(imageBytes)
      
      // Upload to S3
      const s3Key = await uploadToS3(imageBytes, source, i, imageUrl)
      
      results.push({
        original_url: imageUrl,
        s3_key: s3Key,
        s3_url: `https://${Deno.env.get('AWS_S3_BUCKET')}.s3.amazonaws.com/${s3Key}`,
        analysis: labels,
        index: i,
      })
      
    } catch (error) {
      console.error(`Error processing image ${imageUrl}:`, error.message)
      // Continue with next image
    }
  }
  
  return results
}

async function analyzeImageWithRekognition(imageBytes: Uint8Array): Promise<any> {
  try {
    const [labelsResult, textResult] = await Promise.all([
      // Detect labels (objects, scenes, actions)
      rekognitionClient.send(new DetectLabelsCommand({
        Image: { Bytes: imageBytes },
        MaxLabels: 20,
        MinConfidence: 70,
      })),
      // Detect text (for VIN, plate numbers, etc.)
      rekognitionClient.send(new DetectTextCommand({
        Image: { Bytes: imageBytes },
      })),
    ])

    return {
      labels: labelsResult.Labels?.map(l => ({
        name: l.Name,
        confidence: l.Confidence,
        categories: l.Categories?.map(c => c.Name),
      })) || [],
      text: textResult.TextDetections?.filter(t => t.Type === 'LINE').map(t => ({
        text: t.DetectedText,
        confidence: t.Confidence,
      })) || [],
    }
  } catch (error) {
    console.error('Rekognition analysis failed:', error.message)
    return { labels: [], text: [], error: error.message }
  }
}

async function uploadToS3(imageBytes: Uint8Array, source: string, index: number, originalUrl: string): Promise<string> {
  const bucket = Deno.env.get('AWS_S3_BUCKET') || 'nuke-vehicle-images'
  const timestamp = Date.now()
  const extension = originalUrl.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i)?.[1] || 'jpg'
  const key = `scraped/${source.toLowerCase().replace(/\s+/g, '_')}/${timestamp}_${index}.${extension}`
  
  await s3Client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: imageBytes,
    ContentType: `image/${extension}`,
    CacheControl: 'max-age=31536000',
  }))
  
  return key
}

function upgradeCraigslistImageUrl(url: string): string {
  if (!url) return url;

  try {
    const sizePattern = /_(\d+x\d+)([a-z]*)\.(jpg|jpeg|png|webp)$/i;
    if (sizePattern.test(url)) {
      return url.replace(sizePattern, '_1200x900.$3');
    }
  } catch (error) {
    console.warn('Failed to normalize Craigslist image URL, using original:', error);
  }

  return url;
}

function scrapeCraigslist(doc: any, url: string): any {
  const data: any = {
    source: 'Craigslist',
    listing_url: url
  }

  // Extract title (e.g. "1972 GMC Suburban - $5,500 (El Centro)")
  const titleElement = doc.querySelector('h1, .postingtitletext #titletextonly')
  if (titleElement) {
    data.title = titleElement.textContent.trim()
    
    // Parse year/make/model from title
    const yearMatch = data.title.match(/\b(19|20)\d{2}\b/)
    if (yearMatch) {
      data.year = yearMatch[0]
    }
    
    // Extract make/model (e.g., "1972 GMC Suburban")
    const vehicleMatch = data.title.match(/\b(19|20)\d{2}\s+([A-Za-z]+)\s+([A-Za-z0-9\s]+?)(?:\s+-|\()/i)
    if (vehicleMatch) {
      data.make = vehicleMatch[2]
      data.model = vehicleMatch[3].trim()
    }
    
    // Extract price from title (supports "- $5,500" or "$5,500")
    const priceMatch = data.title.match(/\$\s*([\d,]+)/)
    if (priceMatch) {
      data.asking_price = parseInt(priceMatch[1].replace(/,/g, ''))
    }
    
    // Extract location from title (e.g., "(El Centro)")
    const locationMatch = data.title.match(/\(([^)]+)\)\s*$/i)
    if (locationMatch) {
      data.location = locationMatch[1].trim()
    }
  }

  // Extract ALL text from page for comprehensive parsing
  const fullText = doc.body?.textContent || ''
  
  // Extract attributes using multiple methods
  // Method 1: Structured attrgroup parsing
  const attrGroups = doc.querySelectorAll('.attrgroup')
  attrGroups.forEach((group: any) => {
    const spans = group.querySelectorAll('span')
    spans.forEach((span: any) => {
      const text = span.textContent.trim()
      
      // Parse specific attributes
      if (text.includes('condition:')) {
        data.condition = text.replace('condition:', '').trim()
      } else if (text.includes('cylinders:')) {
        const cylMatch = text.match(/(\d+)\s+cylinders/)
        if (cylMatch) data.cylinders = parseInt(cylMatch[1])
      } else if (text.includes('drive:')) {
        data.drivetrain = text.replace('drive:', '').trim()
      } else if (text.includes('fuel:')) {
        data.fuel_type = text.replace('fuel:', '').trim()
      } else if (text.includes('odometer:')) {
        const odoMatch = text.match(/odometer:\s*([\d,]+)/)
        if (odoMatch) data.mileage = parseInt(odoMatch[1].replace(/,/g, ''))
      } else if (text.includes('paint color:')) {
        data.color = text.replace('paint color:', '').trim()
      } else if (text.includes('title status:')) {
        data.title_status = text.replace('title status:', '').trim()
      } else if (text.includes('transmission:')) {
        data.transmission = text.replace('transmission:', '').trim()
      } else if (text.includes('type:')) {
        data.body_style = text.replace('type:', '').trim()
      }
    })
  })
  
  // Method 2: Regex parsing from full text (fallback if attrgroup parsing fails)
  if (!data.condition) {
    const condMatch = fullText.match(/condition:\s*(\w+)/i)
    if (condMatch) data.condition = condMatch[1]
  }
  
  if (!data.cylinders) {
    const cylMatch = fullText.match(/cylinders:\s*(\d+)\s+cylinders/i)
    if (cylMatch) data.cylinders = parseInt(cylMatch[1])
  }
  
  if (!data.drivetrain) {
    const driveMatch = fullText.match(/drive:\s*([\w\d]+)/i)
    if (driveMatch) data.drivetrain = driveMatch[1]
  }
  
  if (!data.fuel_type) {
    const fuelMatch = fullText.match(/fuel:\s*(\w+)/i)
    if (fuelMatch) data.fuel_type = fuelMatch[1]
  }
  
  if (!data.mileage) {
    const odoMatch = fullText.match(/odometer:\s*([\d,]+)/i)
    if (odoMatch) data.mileage = parseInt(odoMatch[1].replace(/,/g, ''))
  }
  
  if (!data.color) {
    const colorMatch = fullText.match(/paint color:\s*(\w+)/i)
    if (colorMatch) data.color = colorMatch[1]
  }
  
  if (!data.title_status) {
    const titleMatch = fullText.match(/title status:\s*(\w+)/i)
    if (titleMatch) data.title_status = titleMatch[1]
  }
  
  if (!data.transmission) {
    const transMatch = fullText.match(/transmission:\s*(\w+)/i)
    if (transMatch) data.transmission = transMatch[1]
  }
  
  if (!data.body_style) {
    const typeMatch = fullText.match(/type:\s*(\w+)/i)
    if (typeMatch) data.body_style = typeMatch[1]
  }
  
  // Store full extracted text for AI analysis
  data.full_text = fullText.substring(0, 10000) // First 10k chars

  // Extract description
  const descElement = doc.querySelector('#postingbody')
  if (descElement) {
    data.description = descElement.textContent.trim().substring(0, 5000)
    
    // Parse additional details from description
    const descText = data.description.toUpperCase();
    
    // Extract trim/series (K1500, K20, C10, etc.)
    const trimMatch = descText.match(/\b(K1500|K10|K20|K30|C1500|C10|C20|C30|K5)\b/);
    if (trimMatch) data.trim = trimMatch[1];
    
    // Extract displacement from engine code (350 = 5.7L, 454 = 7.4L, etc.)
    const engineMap: Record<string, number> = {
      '250': 4.1, '283': 4.6, '305': 5.0, '307': 5.0,
      '327': 5.4, '350': 5.7, '396': 6.5, '400': 6.6,
      '427': 7.0, '454': 7.4, '460': 7.5, '302': 5.0
    };
    
    const engineCodeMatch = descText.match(/\b(250|283|305|307|327|350|396|400|427|454|460|302)\b/);
    if (engineCodeMatch) {
      const code = engineCodeMatch[1];
      data.displacement = engineMap[code];
      if (!data.engine_size) {
        data.engine_size = `${engineMap[code]}L V${data.cylinders || 8}`;
      }
    }
    
    // Check for A/C
    if (descText.includes('NO A/C') || descText.includes('NOT AN A/C')) {
      data.has_ac = false;
    } else if (descText.includes('A/C') || descText.includes('AIR CONDITIONING')) {
      data.has_ac = true;
    }
    
    // Extract speed from transmission description
    const speedMatch = descText.match(/(\d)\s*SPEED/);
    if (speedMatch && !data.transmission_subtype) {
      const speed = speedMatch[1];
      data.transmission_subtype = `${speed}-Speed Manual`;
    }
    
    // Detect known issues
    const knownIssues: string[] = [];
    if (descText.includes('RUST')) knownIssues.push('rust_present');
    if (descText.includes('ODOMETER ROLLED')) knownIssues.push('odometer_rolled_over');
    if (descText.includes('NEEDS WORK') || descText.includes('NOT PERFECT')) knownIssues.push('needs_work');
    if (descText.includes('SALVAGE')) knownIssues.push('salvage_title');
    if (knownIssues.length > 0) data.known_issues = knownIssues;
    
    // Extract paint history
    if (descText.includes('PAINTED') || descText.includes('REPAINT')) {
      data.paint_history = 'repainted';
      const paintYearsMatch = descText.match(/PAINTED\s+(\d+)\s+YEARS?\s+(?:AGO|BACK)/);
      if (paintYearsMatch) {
        data.paint_age_years = parseInt(paintYearsMatch[1]);
      }
    }
    
    // Detect seller motivation
    if (descText.includes('MOTIVATED') || descText.includes('MUST SELL')) {
      data.seller_motivated = true;
    }
    if (descText.includes('NO LOWBALLERS') || descText.includes('PRICE IS FIRM')) {
      data.price_firm = true;
    } else if (descText.includes('LOW BALLERS WELCOME') || descText.includes('OBO')) {
      data.negotiable = true;
    }
    
    // Extract trade interests
    const tradeMatch = descText.match(/TRADE[S]?\s+FOR\s+([A-Z\s,]+?)(?:\.|$|BUT)/);
    if (tradeMatch) {
      data.trade_interests = tradeMatch[1].trim();
    }
  }

  // Extract posting dates
  const postedMatch = fullText.match(/posted:\s*([\d-]+\s+[\d:]+)/i);
  if (postedMatch) data.posted_date = postedMatch[1];
  
  const updatedMatch = fullText.match(/updated:\s*([\d-]+\s+[\d:]+)/i);
  if (updatedMatch) data.updated_date = updatedMatch[1];

  // Extract images - Craigslist uses thumbnail links
  const images: string[] = []
  
  // Method 1: Look for thumbnail links
  const thumbLinks = doc.querySelectorAll('a.thumb')
  thumbLinks.forEach((link: any) => {
    const href = link.getAttribute('href')
    if (href && href.startsWith('http')) {
      images.push(upgradeCraigslistImageUrl(href))
    }
  })
  
  // Method 2: Look for image tags in slideshow
  if (images.length === 0) {
    const slideshowImgs = doc.querySelectorAll('.slide img, .gallery img, #thumbs img')
    slideshowImgs.forEach((img: any) => {
      const src = img.getAttribute('src')
      if (src) {
        // Convert thumbnail URLs to full-size
        const normalizedSrc = src.replace(/_thumb_/i, '_')
        const upgraded = upgradeCraigslistImageUrl(normalizedSrc)
        if (!images.includes(upgraded)) {
          images.push(upgraded)
        }
      }
    })
  }

  // Method 3: Parse from data attributes or inline JSON
  if (images.length === 0) {
    try {
      const scriptTags = doc.querySelectorAll('script')
      for (const script of scriptTags) {
        const content = script.textContent || ''
        // Look for image array patterns in JS
        const imgMatch = content.match(/"images"\s*:\s*\[(.*?)\]/s)
        if (imgMatch) {
          const urls = imgMatch[1].match(/https?:\/\/[^"'\s]+/g)
          if (urls) {
            urls.forEach((candidate) => {
              images.push(upgradeCraigslistImageUrl(candidate))
            })
            break
          }
        }
      }
    } catch (e) {
      console.error('Error parsing scripts for images:', e)
    }
  }

  if (images.length > 0) {
    // Ensure we only keep unique hi-res URLs
    const uniqueImages = Array.from(new Set(images.map(upgradeCraigslistImageUrl)))
    data.images = uniqueImages.slice(0, 50)
  }

  return data
}

function scrapeBringATrailer(doc: any, url: string): any {
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
        // Return as number for consistent type
        data.mileage = parseInt(mileage, 10)
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

    // Extract sale price - multiple patterns to catch different formats
    const pricePatterns = [
      /Sold\s+for\s+(?:USD\s+)?\$?([\d,]+)/i,
      /sold\s+for\s+\$?([\d,]+)\s+on/i,  // "sold for $11,000 on April 15"
      /for\s+\$?([\d,]+)\s+on\s+[A-Za-z]+\s+\d+/i  // "for $11,000 on April 15"
    ]
    for (const pattern of pricePatterns) {
      const priceMatch = bodyText.match(pattern)
      if (priceMatch) {
        data.sale_price = parseInt(priceMatch[1].replace(/,/g, ''), 10)
        break
      }
    }

    // Extract sale date - look for "sold for $X on [Month] [Day], [Year]"
    const saleDatePatterns = [
      /sold\s+for[^0-9]*on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i,
      /([A-Za-z]+\s+\d{1,2},\s+\d{4})\s*\(Lot/i,
      /Sold\s+on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i
    ]
    for (const pattern of saleDatePatterns) {
      const dateMatch = bodyText.match(pattern)
      if (dateMatch) {
        try {
          const date = new Date(dateMatch[1])
          if (!isNaN(date.getTime())) {
            data.sale_date = date.toISOString().split('T')[0]
            data.auction_end_date = data.sale_date
          }
        } catch {}
        break
      }
    }

    // Extract lot number
    const lotMatch = bodyText.match(/Lot\s+#?(\d{1,3}(?:,\d{3})*)/i)
    if (lotMatch) {
      data.lot_number = lotMatch[1].replace(/,/g, '')
    }

    // Extract seller - look for "Sold by [seller]" or "by [seller] on"
    const sellerPatterns = [
      /Sold\s+by\s+([A-Za-z0-9\s&]+?)(?:\s+on|\s+for|$)/i,
      /by\s+([A-Za-z0-9\s&]+?)\s+on\s+Bring\s+a\s+Trailer/i,
      /Consignor[:\s]+([A-Za-z0-9\s&]+)/i,
      /Seller[:\s]+([A-Za-z0-9\s&]+)/i
    ]
    for (const pattern of sellerPatterns) {
      const match = bodyText.match(pattern)
      if (match && match[1]) {
        data.seller = match[1].trim()
        break
      }
    }

    // Extract buyer - look for "Sold to [buyer] for" or "won by [buyer]"
    const buyerPatterns = [
      /Sold\s+to\s+([A-Za-z0-9\s&]+?)\s+for/i,
      /won\s+by\s+([A-Za-z0-9\s&]+?)(?:\s+for|$)/i,
      /Buyer[:\s]+([A-Za-z0-9\s&]+)/i,
      /Purchased\s+by\s+([A-Za-z0-9\s&]+)/i
    ]
    for (const pattern of buyerPatterns) {
      const match = bodyText.match(pattern)
      if (match && match[1]) {
        data.buyer = match[1].trim()
        break
      }
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

  return data
}
