import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const STORAGE_BUCKET = 'vehicle-data'

interface ImageAnalysisResult {
  make?: string
  model?: string
  year?: number
  color?: string
  angle?: string
  condition_score?: number
  rust_severity?: number
  paint_quality?: number
  environment?: string
  photo_quality?: string
  confidence?: number
  analysis?: any
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { url, userId } = await req.json()
    
    if (!url || !userId) {
      return new Response(
        JSON.stringify({ error: 'URL and userId are required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    )

    console.log(`Importing ClassicCars.com listing: ${url}`)

    // Step 1: Scrape the listing
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    
    const scrapeResponse = await fetch(`${supabaseUrl}/functions/v1/scrape-vehicle`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
        'apikey': serviceRoleKey
      },
      body: JSON.stringify({ url })
    })

    if (!scrapeResponse.ok) {
      const errorText = await scrapeResponse.text()
      throw new Error(`Failed to scrape listing: ${scrapeResponse.status} - ${errorText}`)
    }

    const scrapeResult = await scrapeResponse.json()
    if (!scrapeResult.success || !scrapeResult.data) {
      throw new Error(`Failed to scrape listing: ${scrapeResult.error || 'No data returned'}`)
    }

    let listingData = scrapeResult.data
    
    // Normalize the scraped data
    try {
      listingData = normalizeVehicleData(listingData)
    } catch (error: any) {
      console.error('Normalization error (continuing with raw data):', error.message)
      // Continue with raw data if normalization fails
    }
    
    console.log(`Scraped data (normalized):`, {
      year: listingData.year,
      make: listingData.make,
      model: listingData.model,
      series: listingData.series,
      trim: listingData.trim,
      images: listingData.images?.length || 0
    })

    // Step 2: Find or create vehicle
    let vehicleId: string | null = null

    // Try to find by VIN first
    if (listingData.vin) {
      const { data: existing } = await supabase
        .from('vehicles')
        .select('id')
        .eq('vin', listingData.vin)
        .maybeSingle()

      if (existing) {
        vehicleId = existing.id
        console.log(`Found existing vehicle by VIN: ${listingData.vin}`)
      }
    }

    // Try to find by year/make/model
    if (!vehicleId && listingData.year && listingData.make && listingData.model) {
      const { data: existing } = await supabase
        .from('vehicles')
        .select('id')
        .eq('year', listingData.year)
        .ilike('make', listingData.make)
        .ilike('model', listingData.model)
        .maybeSingle()

      if (existing) {
        vehicleId = existing.id
        console.log(`Found existing vehicle by year/make/model`)
      }
    }

    // Create new vehicle if not found
    if (!vehicleId) {
      const vehicleInsert: any = {
        user_id: userId,
        uploaded_by: userId,
        year: listingData.year,
        make: listingData.make,
        model: listingData.model,
        series: listingData.series || null,
        trim: listingData.trim || null,
        vin: listingData.vin || null,
        color: listingData.color || listingData.exterior_color || null,
        mileage: listingData.mileage || null,
        transmission: listingData.transmission || null,
        drivetrain: listingData.drivetrain || null,
        engine_size: listingData.engine_size || listingData.engine || null,
        discovery_source: 'classiccars_com',
        discovery_url: url,
        profile_origin: 'classiccars_import',
        origin_metadata: {
          listing_id: listingData.listing_id,
          seller: listingData.seller,
          seller_phone: listingData.seller_phone,
          seller_email: listingData.seller_email,
          seller_address: listingData.seller_address,
          asking_price: listingData.asking_price,
          imported_at: new Date().toISOString(),
          original_data: {
            original_make: scrapeResult.data.make,
            original_model: scrapeResult.data.model,
            original_transmission: scrapeResult.data.transmission,
            original_drivetrain: scrapeResult.data.drivetrain
          },
          normalization_applied: true
        },
        notes: listingData.description || null
      }

      const { data: newVehicle, error: vehicleError } = await supabase
        .from('vehicles')
        .insert(vehicleInsert)
        .select('id')
        .single()

      if (vehicleError) {
        throw new Error(`Failed to create vehicle: ${vehicleError.message}`)
      }

      vehicleId = newVehicle.id
      console.log(`Created new vehicle: ${vehicleId}`)
    } else {
      // Update existing vehicle with new data
      const updates: any = {}
      if (listingData.vin && !listingData.vin.includes('null')) updates.vin = listingData.vin
      if (listingData.color || listingData.exterior_color) updates.color = listingData.color || listingData.exterior_color
      if (listingData.mileage) updates.mileage = listingData.mileage
      if (listingData.transmission) updates.transmission = listingData.transmission
      if (listingData.drivetrain) updates.drivetrain = listingData.drivetrain
      if (listingData.engine) updates.engine_size = listingData.engine

      if (Object.keys(updates).length > 0) {
        await supabase
          .from('vehicles')
          .update(updates)
          .eq('id', vehicleId)
        console.log(`Updated existing vehicle with new data`)
      }
    }

    // Step 3: Download and analyze ALL images - NO LIMITS
    const images = listingData.images || []
    console.log(`🚨 CRITICAL: Processing ALL ${images.length} images with full AI analysis (no limits)...`)

    const imageResults: any[] = []
    let totalConditionScore = 0
    let analyzedCount = 0
    let extractedVIN: string | null = null
    let vinConfidence = 0

    // Process ALL images - no limits, no skipping
    const batchSize = 3
    for (let i = 0; i < images.length; i += batchSize) {
      const batch = images.slice(i, i + batchSize)
      console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(images.length / batchSize)} (images ${i + 1}-${Math.min(i + batchSize, images.length)})`)
      
      for (const imageUrl of batch) {
        try {
          console.log(`Processing image ${i + batch.indexOf(imageUrl) + 1}/${images.length}: ${imageUrl}`)

          // Download image
          const imageResponse = await fetch(imageUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; NukeBot/1.0)',
              'Accept': 'image/*',
            },
            signal: AbortSignal.timeout(30000), // 30 second timeout
          })

          if (!imageResponse.ok) {
            console.warn(`Failed to download image: ${imageResponse.status}`)
            continue
          }

          const imageBuffer = await imageResponse.arrayBuffer()
          const imageBytes = new Uint8Array(imageBuffer)

          // Check size (max 10MB)
          if (imageBytes.length > 10 * 1024 * 1024) {
            console.warn(`Image too large: ${imageUrl}`)
            continue
          }

          // Convert to base64 for OpenAI (handle large images)
          let base64Image: string
          try {
            // For smaller images, use btoa
            if (imageBytes.length < 1000000) {
              base64Image = btoa(String.fromCharCode(...imageBytes))
            } else {
              // For larger images, use Deno's built-in encoder
              base64Image = btoa(String.fromCharCode.apply(null, Array.from(imageBytes.slice(0, 1000000))))
            }
          } catch (e) {
            // Fallback: use a subset for very large images
            const chunk = imageBytes.slice(0, Math.min(imageBytes.length, 500000))
            base64Image = btoa(String.fromCharCode(...chunk))
          }

          // Analyze with OpenAI Vision - condition scoring
          const analysis = await analyzeImageWithOpenAI(base64Image, listingData)

          if (analysis) {
            totalConditionScore += analysis.condition_score || 0
            analyzedCount++
          }

          // Check for VIN tag and extract VIN if found
          if (!extractedVIN || vinConfidence < 90) {
            const vinResult = await extractVINFromImage(base64Image)
            if (vinResult && vinResult.vin && vinResult.confidence > vinConfidence) {
              extractedVIN = vinResult.vin
              vinConfidence = vinResult.confidence
              console.log(`  🔍 VIN found in image ${i + batch.indexOf(imageUrl) + 1}: ${extractedVIN} (confidence: ${vinConfidence}%)`)
            }
          }

          // Upload to Supabase storage
          const timestamp = Date.now()
          const ext = imageUrl.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i)?.[1] || 'jpg'
          const filename = `classiccars_${timestamp}_${i + batch.indexOf(imageUrl)}.${ext}`
          const storagePath = `vehicles/${vehicleId}/images/classiccars_com/${filename}`

          const { error: uploadError } = await supabase.storage
            .from(STORAGE_BUCKET)
            .upload(storagePath, imageBytes, {
              contentType: `image/${ext}`,
              cacheControl: '3600',
              upsert: false
            })

          if (uploadError) {
            console.error(`Failed to upload image: ${uploadError.message}`)
            continue
          }

          // Get public URL
          const { data: { publicUrl } } = supabase.storage
            .from(STORAGE_BUCKET)
            .getPublicUrl(storagePath)

          // Format analysis for frontend (ai_scan_metadata structure)
          let aiScanMetadata = null
          if (analysis) {
            const angleLabels: Record<string, string> = {
              'exterior_front': 'Front View',
              'exterior_rear': 'Rear View',
              'exterior_side': 'Side View',
              'exterior_three_quarter': 'Three-Quarter View',
              'interior_front_seats': 'Interior - Front Seats',
              'interior_rear_seats': 'Interior - Rear Seats',
              'interior_dashboard': 'Interior - Dashboard',
              'engine_bay': 'Engine Bay',
              'undercarriage': 'Undercarriage',
              'detail_shot': 'Detail Shot'
            }

            const descriptionParts = []
            if (analysis.angle) {
              descriptionParts.push(`Angle: ${angleLabels[analysis.angle] || analysis.angle}`)
            }
            if (analysis.condition_score) {
              descriptionParts.push(`Condition: ${analysis.condition_score}/10`)
            }
            if (analysis.rust_severity) {
              descriptionParts.push(`Rust: ${analysis.rust_severity}/10`)
            }

            const contextParts = []
            if (analysis.environment) {
              contextParts.push(`Environment: ${analysis.environment}`)
            }
            if (analysis.photo_quality) {
              contextParts.push(`Photo quality: ${analysis.photo_quality}`)
            }

            aiScanMetadata = {
              appraiser: {
                angle: analysis.angle || 'exterior',
                primary_label: angleLabels[analysis.angle || 'exterior'] || 'Exterior View',
                description: descriptionParts.join(' • ') || 'Vehicle exterior view',
                context: contextParts.join(' | ') || 'ClassicCars.com listing photo',
                model: 'gpt-4o',
                analyzed_at: new Date().toISOString(),
                condition_score: analysis.condition_score,
                rust_severity: analysis.rust_severity,
                paint_quality: analysis.paint_quality
              }
            }
          }

          // Create vehicle_images record
          const { data: imageRecord, error: imageError } = await supabase
            .from('vehicle_images')
            .insert({
              vehicle_id: vehicleId,
              image_url: publicUrl,
              user_id: userId,
              source: 'classiccars_com',
              category: 'exterior', // Will be refined by AI
              imported_by: userId,
              metadata: {
                original_url: imageUrl,
                classiccars_listing_id: listingData.listing_id,
                classiccars_listing_url: url,
                imported_at: new Date().toISOString()
              },
              ai_scan_metadata: aiScanMetadata,
              ai_processing_status: analysis ? 'completed' : 'pending'
            })
            .select('id')
            .single()

          if (imageError) {
            console.error(`Failed to create image record: ${imageError.message}`)
            continue
          }

          imageResults.push({
            id: imageRecord.id,
            url: publicUrl,
            analysis: analysis
          })

          console.log(`✅ Processed image ${i + batch.indexOf(imageUrl) + 1}`)

        } catch (error: any) {
          console.error(`Error processing image ${imageUrl}:`, error.message)
          // Continue with next image
        }
      }

      // Small delay between batches
      if (i + batchSize < images.length) {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }

    // Step 4: Update vehicle with extracted VIN if found
    if (extractedVIN && vinConfidence >= 70) {
      console.log(`✅ Updating vehicle with extracted VIN: ${extractedVIN}`)
      await supabase
        .from('vehicles')
        .update({ vin: extractedVIN })
        .eq('id', vehicleId)
    }

    // Step 5: Calculate overall score
    const averageConditionScore = analyzedCount > 0 ? totalConditionScore / analyzedCount : 0
    const overallScore = Math.round(averageConditionScore)

    // Update vehicle with score
    await supabase
      .from('vehicles')
      .update({
        condition_rating: overallScore,
        notes: listingData.description || null
      })
      .eq('id', vehicleId)

    // Create timeline event
    await supabase
      .from('vehicle_timeline_events')
      .insert({
        vehicle_id: vehicleId,
        user_id: userId,
        event_type: 'discovery',
        title: `Imported from ClassicCars.com`,
        event_date: new Date().toISOString(),
        source: 'classiccars_com',
        metadata: {
          listing_url: url,
          listing_id: listingData.listing_id,
          asking_price: listingData.asking_price,
          seller: listingData.seller,
          images_imported: imageResults.length,
          condition_score: overallScore
        }
      })

    console.log(`✅ Import complete: Vehicle ${vehicleId}, ${imageResults.length} images, Score: ${overallScore}/10`)

    return new Response(
      JSON.stringify({
        success: true,
        vehicleId,
        imagesProcessed: imageResults.length,
        conditionScore: overallScore,
        vinExtracted: extractedVIN || null,
        vinConfidence: vinConfidence,
        vehicle: {
          year: listingData.year,
          make: listingData.make,
          model: listingData.model,
          vin: extractedVIN || listingData.vin
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error: any) {
    console.error('Error in import-classiccars-listing:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

/**
 * Normalize vehicle data from scraped listing
 * Converts sloppy listing terminology to technically correct database values
 */
function normalizeVehicleData(data: any): any {
  const normalized = { ...data }

  // Normalize Make
  if (normalized.make) {
    const makeLower = normalized.make.toLowerCase().trim()
    const makeMap: Record<string, string> = {
      'chevy': 'Chevrolet',
      'chevrolet': 'Chevrolet',
      'gmc': 'GMC',
      'ford': 'Ford',
      'dodge': 'Dodge',
      'jeep': 'Jeep',
      'toyota': 'Toyota',
      'nissan': 'Nissan'
    }
    normalized.make = makeMap[makeLower] || normalized.make.split(' ')[0].charAt(0).toUpperCase() + normalized.make.split(' ')[0].slice(1).toLowerCase()
  }

  // Normalize Model - extract actual model name, remove location/extra text
  if (normalized.model) {
    // Remove location patterns like "in Sedona , Arizona"
    normalized.model = normalized.model.replace(/\s+in\s+[^,]+(?:,\s*[A-Z]{2})?/i, '').trim()
    
    const yearNum = typeof normalized.year === 'number' ? normalized.year : Number.parseInt(String(normalized.year || ''), 10)
    const rvEra = Number.isFinite(yearNum) && yearNum >= 1988 && yearNum <= 1991
    const normalizeRvPrefix = (prefix: string) => {
      const upper = prefix.toUpperCase()
      if (upper === 'R' || upper === 'V') {
        return rvEra ? upper : (upper === 'R' ? 'C' : 'K')
      }
      return upper
    }

    // Extract series from model (K5, K10, C10, R/V 1500, etc.)
    const seriesMatch = normalized.model.match(/\b([CK]\d+|K-5|K5|Blazer|Suburban|Tahoe|Yukon|[RV]\s*-?\s*(1500|2500|3500))\b/i)
    if (seriesMatch) {
      let series = seriesMatch[1].toUpperCase().replace('-', '').replace(/\s+/g, '')
      if (series.startsWith('R') || series.startsWith('V')) {
        const prefix = normalizeRvPrefix(series.charAt(0))
        series = `${prefix}${series.slice(1)}`
      }
      normalized.series = series
      
      // If model contains series, extract base model
      if (series === 'K5' || series === 'K-5') {
        normalized.model = 'Blazer'
      } else if (series.includes('SUBURBAN')) {
        normalized.model = 'Suburban'
      } else if (series.includes('TAHOE')) {
        normalized.model = 'Tahoe'
      } else if (series.includes('YUKON')) {
        normalized.model = 'Yukon'
      } else if (series.match(/^[CKRV]\d+$/)) {
        normalized.model = 'C/K'
      }
    }
    
    // Clean up model name
    normalized.model = normalized.model
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')[0] // Take first word if multiple
  }

  // Normalize Transmission
  if (normalized.transmission) {
    const transLower = normalized.transmission.toLowerCase().trim()
    const transMap: Record<string, string> = {
      'manual': 'Manual',
      'automatic': 'Automatic',
      'auto': 'Automatic',
      'stick': 'Manual',
      '5-speed': 'Manual',
      '6-speed': 'Manual',
      '4-speed': 'Manual',
      '3-speed': 'Automatic'
    }
    normalized.transmission = transMap[transLower] || normalized.transmission.charAt(0).toUpperCase() + normalized.transmission.slice(1).toLowerCase()
  }

  // Normalize Drivetrain - remove whitespace/newlines
  if (normalized.drivetrain) {
    const cleaned = normalized.drivetrain
      .replace(/[\n\t\r]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    
    // Map common variations
    const driveMap: Record<string, string> = {
      'part-time': '4WD',
      'part-time 4wd': '4WD',
      'full-time': '4WD',
      '4wd': '4WD',
      '4x4': '4WD',
      '2wd': '2WD',
      'rwd': 'RWD',
      'fwd': 'FWD',
      'awd': 'AWD'
    }
    const driveLower = cleaned.toLowerCase()
    if (driveMap[driveLower]) {
      normalized.drivetrain = driveMap[driveLower]
    } else {
      // Take first word and capitalize
      const firstWord = cleaned.split(' ')[0]
      normalized.drivetrain = firstWord.charAt(0).toUpperCase() + firstWord.slice(1).toLowerCase()
    }
  }

  // Normalize Color
  if (normalized.color || normalized.exterior_color) {
    const color = (normalized.color || normalized.exterior_color).trim()
    normalized.color = color.charAt(0).toUpperCase() + color.slice(1).toLowerCase()
    normalized.exterior_color = normalized.color
  }

  // Normalize Interior Color
  if (normalized.interior_color) {
    normalized.interior_color = normalized.interior_color.trim().charAt(0).toUpperCase() + normalized.interior_color.slice(1).toLowerCase()
  }

  // Normalize Engine - extract key info
  if (normalized.engine) {
    // Remove "Rebuilt" and extract actual engine info
    const engineLower = normalized.engine.toLowerCase()
    if (engineLower.includes('ls') || engineLower.includes('5.3')) {
      normalized.engine_size = '5.3L V8'
    } else if (engineLower.includes('350') || engineLower.includes('5.7')) {
      normalized.engine_size = '5.7L V8'
    } else if (engineLower.includes('454') || engineLower.includes('7.4')) {
      normalized.engine_size = '7.4L V8'
    } else if (engineLower.includes('305') || engineLower.includes('5.0')) {
      normalized.engine_size = '5.0L V8'
    } else {
      normalized.engine_size = normalized.engine.trim()
    }
  }

  // Normalize Mileage - ensure it's a number
  if (normalized.mileage) {
    const mileage = typeof normalized.mileage === 'string' 
      ? parseInt(normalized.mileage.replace(/,/g, ''), 10)
      : normalized.mileage
    normalized.mileage = isNaN(mileage) ? null : mileage
  }

  // Normalize Price
  if (normalized.asking_price) {
    const price = typeof normalized.asking_price === 'string'
      ? parseFloat(normalized.asking_price.replace(/[$,]/g, ''))
      : normalized.asking_price
    normalized.asking_price = isNaN(price) ? null : price
  }

  // Extract Trim from description if available
  if (normalized.description && !normalized.trim) {
    const descUpper = normalized.description.toUpperCase()
    const trimPatterns = [
      /(?:SILVERADO|CHEYENNE|SCOTTSDALE|CUSTOM DELUXE|BIG 10|BIG10|HIGH COUNTRY|Z71|ZR2|RUBICON|SAHARA|SPORT|LARAMIE|LONGHORN)/i
    ]
    for (const pattern of trimPatterns) {
      const match = normalized.description.match(pattern)
      if (match) {
        normalized.trim = match[1] || match[0]
        break
      }
    }
  }

  return normalized
}

/**
 * Extract VIN from image using AI
 * Looks for VIN tags/plates in the image
 */
async function extractVINFromImage(base64Image: string): Promise<{ vin: string | null; confidence: number } | null> {
  try {
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiApiKey) {
      return null
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Analyze this vehicle image for a VIN (Vehicle Identification Number) tag or plate.

VIN tags are typically found on:
- Driver's side dashboard (visible through windshield)
- Driver's side door jamb
- Firewall/engine bay
- Frame/chassis

A VIN is EXACTLY 17 characters, alphanumeric (no I, O, or Q).

If you see a VIN tag/plate in this image, extract the complete 17-character VIN.

Return JSON:
{
  "has_vin_tag": boolean,
  "vin": "17-character VIN or null",
  "confidence": 0-100,
  "location": "dashboard|door_jamb|firewall|frame|unknown",
  "readability": "clear|partial|difficult|illegible"
}`
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${base64Image}`
                }
              }
            ]
          }
        ],
        max_tokens: 300,
        temperature: 0.1,
        response_format: { type: 'json_object' }
      })
    })

    if (!response.ok) {
      return null
    }

    const data = await response.json()
    const content = data.choices[0]?.message?.content

    if (!content) {
      return null
    }

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0])
      if (result.has_vin_tag && result.vin && result.vin.length === 17) {
        // Validate VIN format (no I, O, Q)
        if (!/[IOQ]/.test(result.vin.toUpperCase())) {
          return {
            vin: result.vin.toUpperCase(),
            confidence: result.confidence || 0
          }
        }
      }
    }

    return null

  } catch (error: any) {
    console.error('Error extracting VIN from image:', error.message)
    return null
  }
}

/**
 * Analyze image with multi-provider fallback
 * Tries: Gemini (free) → OpenAI → Claude
 */
async function analyzeImageWithOpenAI(base64Image: string, vehicleContext: any): Promise<ImageAnalysisResult | null> {
  const context = vehicleContext.year && vehicleContext.make && vehicleContext.model
    ? `This is a ${vehicleContext.year} ${vehicleContext.make} ${vehicleContext.model}.`
    : ''

  const prompt = `Analyze this vehicle image. Determine:
1. View angle (exterior_front, exterior_rear, exterior_side, exterior_three_quarter, interior_dashboard, engine_bay, etc.)
2. Condition score (1-10)
3. Rust severity (0-10)
4. Paint quality (1-10)
5. Environment (garage, outdoor, showroom, etc.)
6. Photo quality (professional, amateur, etc.)

${context}

Return ONLY valid JSON:
{
  "angle": "exterior_side",
  "condition_score": 6,
  "rust_severity": 4,
  "paint_quality": 5,
  "environment": "garage",
  "photo_quality": "amateur"
}`

  // Try providers in order: Gemini (free) → OpenAI → Claude
  const providers = [
    { name: 'gemini', fn: () => analyzeWithGemini(base64Image, prompt) },
    { name: 'openai', fn: () => analyzeWithOpenAIOnly(base64Image, prompt) },
    { name: 'claude', fn: () => analyzeWithClaude(base64Image, prompt) }
  ]

  let lastError: Error | null = null

  for (const provider of providers) {
    try {
      console.log(`  🔄 Trying ${provider.name}...`)
      const result = await Promise.race([
        provider.fn(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Provider timeout')), 15000)
        )
      ])
      console.log(`  ✅ ${provider.name} succeeded`)
      return result
    } catch (error: any) {
      console.warn(`  ⚠️  ${provider.name} failed: ${error.message}`)
      lastError = error
      continue
    }
  }

  console.error(`  ❌ All providers failed`)
  return null
}

/**
 * Analyze with Google Gemini (FREE)
 */
async function analyzeWithGemini(base64Image: string, prompt: string): Promise<ImageAnalysisResult | null> {
  const geminiApiKey = Deno.env.get('GOOGLE_AI_API_KEY')
  if (!geminiApiKey) {
    throw new Error('GOOGLE_AI_API_KEY not configured')
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: base64Image
              }
            }
          ]
        }],
        generationConfig: {
          responseMimeType: 'application/json'
        }
      })
    }
  )

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`)
  }

  const data = await response.json()
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text

  if (!content) {
    throw new Error('No content in Gemini response')
  }

  const analysis = JSON.parse(content)
  return {
    angle: analysis.angle || 'exterior',
    condition_score: analysis.condition_score || 5,
    rust_severity: analysis.rust_severity || 0,
    paint_quality: analysis.paint_quality || 5,
    environment: analysis.environment || 'unknown',
    photo_quality: analysis.photo_quality || 'amateur'
  }
}

/**
 * Analyze with OpenAI
 */
async function analyzeWithOpenAIOnly(base64Image: string, prompt: string): Promise<ImageAnalysisResult | null> {
  const openaiApiKey = Deno.env.get('OPENAI_API_KEY')
  if (!openaiApiKey) {
    throw new Error('OPENAI_API_KEY not configured')
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${base64Image}` }
          }
        ]
      }],
      max_tokens: 300,
      temperature: 0.1,
      response_format: { type: 'json_object' }
    })
  })

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`)
  }

  const data = await response.json()
  const content = data.choices[0]?.message?.content

  if (!content) {
    throw new Error('No content in OpenAI response')
  }

  const analysis = JSON.parse(content)
  return {
    angle: analysis.angle || 'exterior',
    condition_score: analysis.condition_score || 5,
    rust_severity: analysis.rust_severity || 0,
    paint_quality: analysis.paint_quality || 5,
    environment: analysis.environment || 'unknown',
    photo_quality: analysis.photo_quality || 'amateur'
  }
}

/**
 * Analyze with Anthropic Claude
 */
async function analyzeWithClaude(base64Image: string, prompt: string): Promise<ImageAnalysisResult | null> {
  const claudeApiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!claudeApiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured')
  }

  // Convert base64 to bytes for Claude
  const imageBytes = Uint8Array.from(atob(base64Image), c => c.charCodeAt(0))

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': claudeApiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: base64Image
            }
          }
        ]
      }]
    })
  })

  if (!response.ok) {
    throw new Error(`Claude API error: ${response.status}`)
  }

  const data = await response.json()
  const content = data.content?.[0]?.text

  if (!content) {
    throw new Error('No content in Claude response')
  }

  const jsonMatch = content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('No JSON found in Claude response')
  }

  const analysis = JSON.parse(jsonMatch[0])
  return {
    angle: analysis.angle || 'exterior',
    condition_score: analysis.condition_score || 5,
    rust_severity: analysis.rust_severity || 0,
    paint_quality: analysis.paint_quality || 5,
    environment: analysis.environment || 'unknown',
    photo_quality: analysis.photo_quality || 'amateur'
  }
}

