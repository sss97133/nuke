/**
 * AI-Powered Universal Vehicle Data Extractor
 * 
 * Extracts structured vehicle data from ANY HTML source using OpenAI.
 * Works on unknown sources without custom parsers.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ExtractionLogger, validateVin } from '../_shared/extractionHealth.ts'
import { getLLMConfig, callLLM, type LLMProvider } from '../_shared/llmProvider.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ExtractionRequest {
  url: string
  html?: string
  textContent?: string
  source?: string
  save_to_db?: boolean
  max_vehicles?: number
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { url, html, textContent, source, save_to_db }: ExtractionRequest = await req.json()

    if (!url) {
      return new Response(
        JSON.stringify({ error: 'URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Route to dedicated extractor if one exists for this domain
    const dedicatedExtractor = getDedicatedExtractor(url)
    if (dedicatedExtractor && !html && !textContent) {
      console.log(`[extract-vehicle-data-ai] Routing to dedicated extractor: ${dedicatedExtractor}`)
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        const proxyRes = await fetch(`${supabaseUrl}/functions/v1/${dedicatedExtractor}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ url, source }),
        })
        if (proxyRes.ok) {
          const proxyData = await proxyRes.json()
          // Different extractors use different response shapes
          const rawResult = proxyData.data || proxyData.extracted || proxyData.vehicle || proxyData
          // Only accept if the extractor returned meaningful data (at least year or make)
          if (rawResult && (rawResult.year || rawResult.make || rawResult.vin)) {
            return new Response(JSON.stringify({
              success: true,
              data: normalizeExtractedData(rawResult, url),
              confidence: proxyData.confidence || 0.9,
              source: source || dedicatedExtractor,
              extractionMethod: 'dedicated_extractor',
              vehicle_id: proxyData.vehicle_id || null,
            }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
          }
          console.log(`[extract-vehicle-data-ai] Dedicated extractor returned empty data, falling through`)
        }
        console.log(`[extract-vehicle-data-ai] Dedicated extractor failed, falling through to generic`)
      } catch (proxyErr: any) {
        console.log(`[extract-vehicle-data-ai] Dedicated extractor error: ${proxyErr.message}`)
      }
    }

    // Prepare text content for AI analysis
    // If no html/textContent provided, fetch the URL directly
    let rawHtml = html || ''
    let rawText = textContent || ''

    if (!rawText && !rawHtml) {
      console.log(`[extract-vehicle-data-ai] No content provided, fetching URL: ${url}`)
      try {
        const fetchRes = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(15000),
        })
        if (fetchRes.ok) {
          rawHtml = await fetchRes.text()
          console.log(`[extract-vehicle-data-ai] Fetched ${rawHtml.length} chars from URL`)
        } else {
          console.log(`[extract-vehicle-data-ai] URL fetch failed: ${fetchRes.status}`)
        }
      } catch (fetchErr: any) {
        console.log(`[extract-vehicle-data-ai] URL fetch error: ${fetchErr.message}`)
      }
    }

    // If basic fetch returned very little content, try Firecrawl (handles JS rendering)
    // Skip Firecrawl for domains with dedicated extractors - they should handle their own fetching
    const hasDedicatedExtractor = getDedicatedExtractor(url) !== null
    if (!rawText && rawHtml.length < 2000 && !hasDedicatedExtractor) {
      const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY')
      if (firecrawlKey) {
        console.log(`[extract-vehicle-data-ai] Content too short (${rawHtml.length}), trying Firecrawl for JS rendering`)
        try {
          const fcRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${firecrawlKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ url, formats: ['markdown'], waitFor: 3000 }),
            signal: AbortSignal.timeout(30000),
          })
          if (fcRes.ok) {
            const fcData = await fcRes.json()
            if (fcData.success && fcData.data?.markdown) {
              rawText = fcData.data.markdown
              console.log(`[extract-vehicle-data-ai] Firecrawl got ${rawText.length} chars of markdown`)
            }
          } else {
            console.log(`[extract-vehicle-data-ai] Firecrawl failed: ${fcRes.status}`)
          }
        } catch (fcErr: any) {
          console.log(`[extract-vehicle-data-ai] Firecrawl error: ${fcErr.message}`)
        }
      }
    }

    // If content is still empty, try to extract from URL structure directly
    if (!rawText && rawHtml.length < 500) {
      const urlData = extractVehicleFromUrl(url)
      if (urlData) {
        console.log(`[extract-vehicle-data-ai] URL-only extraction: ${JSON.stringify(urlData)}`)
        return new Response(JSON.stringify({
          success: true,
          data: normalizeExtractedData(urlData, url),
          confidence: 0.5,
          source: source || 'url_structure',
          extractionMethod: 'url_parsing',
          note: 'Extracted from URL only — page content was unavailable. Data may be incomplete.',
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
    }

    const contentToAnalyze = rawText || extractTextFromHTML(rawHtml)
    const contentPreview = contentToAnalyze.substring(0, 30000) // Limit to 30k chars

    // Build AI prompt for extraction
    const prompt = buildExtractionPrompt(url, contentPreview, source)

    // Initialize Supabase for LLM config
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Get LLM config with automatic fallback (Anthropic → Google → OpenAI)
    // Anthropic first since OpenAI quota is exhausted
    let llmConfig;
    let llmResponse;
    const providers: LLMProvider[] = ['anthropic', 'google', 'openai'];
    let lastError: Error | null = null;

    for (const provider of providers) {
      try {
        llmConfig = await getLLMConfig(supabase, null, provider, undefined, 'tier2');
        console.log(`[extract-vehicle-data-ai] Trying provider: ${llmConfig.provider}/${llmConfig.model}`);

        llmResponse = await callLLM(llmConfig, [
          {
            role: 'system',
            content: `You are an expert vehicle data extraction specialist. Extract structured vehicle information from listing pages with maximum accuracy. Always return valid JSON.`
          },
          {
            role: 'user',
            content: prompt
          }
        ], {
          temperature: 0.1,
          maxTokens: 2000
        });

        // Success - break out of retry loop
        console.log(`[extract-vehicle-data-ai] ✅ Success with ${llmConfig.provider}`);
        break;
      } catch (error: any) {
        lastError = error;
        console.log(`[extract-vehicle-data-ai] ❌ ${provider} failed: ${error.message}`);

        // If it's a quota error, try next provider
        if (error.message?.includes('quota') ||
            error.message?.includes('insufficient') ||
            error.message?.includes('rate_limit') ||
            error.message?.includes('429')) {
          continue;
        }

        // For other errors, still try next provider
        continue;
      }
    }

    if (!llmResponse) {
      throw lastError || new Error('All LLM providers failed');
    }

    // Parse response - handle both JSON and text responses
    let extractedJson;
    try {
      extractedJson = JSON.parse(llmResponse.content);
    } catch {
      // Try to extract JSON from response text
      const jsonMatch = llmResponse.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          extractedJson = JSON.parse(jsonMatch[0]);
        } catch {
          throw new Error('Failed to parse extracted JSON from LLM response');
        }
      } else {
        throw new Error('Failed to parse LLM response as JSON');
      }
    }

    // Check if LLM explicitly said no vehicle data found
    if (extractedJson.no_vehicle_data === true) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No vehicle data found on this page.',
          url,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate and normalize extracted data
    const normalized = normalizeExtractedData(extractedJson, url)

    // === HALLUCINATION GUARD ===
    // Check if the content actually contains vehicle-related keywords.
    // If the page has no vehicle content but the LLM returned data, it hallucinated.
    const contentLower = contentPreview.toLowerCase()
    const vehicleKeywords = ['vehicle', 'car', 'truck', 'suv', 'sedan', 'coupe', 'convertible',
      'mileage', 'odometer', 'vin', 'engine', 'transmission', 'horsepower', 'torque',
      'mpg', 'drivetrain', 'auction', 'listing', 'for sale', 'sold for', 'bid',
      'cylinder', 'turbo', 'supercharged', 'exhaust', 'suspension', 'brakes',
      'interior', 'exterior', 'paint', 'wheels', 'tires', 'carfax', 'autocheck']
    const makeKeywords = ['ford', 'chevrolet', 'chevy', 'toyota', 'honda', 'bmw', 'mercedes',
      'porsche', 'audi', 'volkswagen', 'nissan', 'mazda', 'subaru', 'dodge', 'jeep',
      'ram', 'gmc', 'cadillac', 'lincoln', 'buick', 'lexus', 'acura', 'infiniti',
      'ferrari', 'lamborghini', 'maserati', 'alfa romeo', 'fiat', 'volvo', 'saab',
      'jaguar', 'land rover', 'mini', 'rolls-royce', 'bentley', 'aston martin',
      'mclaren', 'lotus', 'triumph', 'mg', 'austin-healey', 'datsun']
    const allKeywords = [...vehicleKeywords, ...makeKeywords]
    const keywordHits = allKeywords.filter(kw => contentLower.includes(kw)).length

    // If fewer than 2 vehicle-related keywords found in the content, likely hallucination
    if (keywordHits < 2 && contentPreview.length > 100) {
      console.log(`[extract-vehicle-data-ai] Hallucination guard: only ${keywordHits} vehicle keywords in content. Rejecting.`)
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No vehicle data found on this page. The URL does not appear to contain a vehicle listing.',
          url,
          keywordsFound: keywordHits,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Also reject if the LLM returned the exact example data from the prompt
    if (normalized.year === 1974 && normalized.make === 'Chevrolet' && normalized.mileage === 123456) {
      console.log(`[extract-vehicle-data-ai] Hallucination guard: LLM parroted example data. Rejecting.`)
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Extraction failed — the AI could not find real vehicle data on this page.',
          url,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Price hallucination guard: null out suspiciously round prices that aren't in the content
    const suspiciousRoundPrices = [25000, 50000, 100000, 10000, 75000, 150000, 200000]
    for (const field of ['price', 'sold_price', 'asking_price'] as const) {
      if (normalized[field] && suspiciousRoundPrices.includes(normalized[field])) {
        // Check if this exact price string appears in the actual content
        const priceStr = String(normalized[field])
        const priceFormatted = new Intl.NumberFormat('en-US').format(normalized[field])
        const priceInContent = contentPreview.includes(`$${priceStr}`) ||
          contentPreview.includes(`$${priceFormatted}`) ||
          contentPreview.includes(priceFormatted) ||
          contentPreview.includes(`${priceStr}`)
        if (!priceInContent) {
          console.log(`[extract-vehicle-data-ai] Price hallucination guard: ${field}=${normalized[field]} not found in content. Nulling.`)
          normalized[field] = null
        }
      }
    }

    // === FIELD-LEVEL EXTRACTION HEALTH LOGGING ===
    const overallConfidence = extractedJson.confidence || 0.8
    const healthLogger = new ExtractionLogger(supabase, {
      source: source || 'unknown',
      extractorName: 'extract-vehicle-data-ai',
      extractorVersion: '1.0',
      sourceUrl: url,
      lowConfidenceThreshold: 0.6,
    })

    // Log each field with AI's confidence (scaled by per-field presence)
    healthLogger.logField('vin', normalized.vin, normalized.vin ? overallConfidence : 0)
    if (normalized.vin) {
      const vinValidation = validateVin(normalized.vin)
      if (!vinValidation.valid) {
        healthLogger.logValidationFail('vin', normalized.vin, vinValidation.errorCode || 'unknown', vinValidation.errorDetails)
      }
    }
    healthLogger.logField('year', normalized.year, normalized.year ? overallConfidence : 0)
    healthLogger.logField('make', normalized.make, normalized.make ? overallConfidence * 0.95 : 0)
    healthLogger.logField('model', normalized.model, normalized.model ? overallConfidence * 0.90 : 0)
    healthLogger.logField('series', normalized.series, normalized.series ? overallConfidence * 0.85 : 0)
    healthLogger.logField('trim', normalized.trim, normalized.trim ? overallConfidence * 0.80 : 0)
    healthLogger.logField('mileage', normalized.mileage, normalized.mileage ? overallConfidence * 0.85 : 0)
    healthLogger.logField('price', normalized.price, normalized.price ? overallConfidence * 0.90 : 0)
    healthLogger.logField('sold_price', normalized.sold_price, normalized.sold_price ? overallConfidence * 0.95 : 0)
    healthLogger.logField('exterior_color', normalized.exterior_color, normalized.exterior_color ? overallConfidence * 0.80 : 0)
    healthLogger.logField('interior_color', normalized.interior_color, normalized.interior_color ? overallConfidence * 0.75 : 0)
    healthLogger.logField('transmission', normalized.transmission, normalized.transmission ? overallConfidence * 0.85 : 0)
    healthLogger.logField('drivetrain', normalized.drivetrain, normalized.drivetrain ? overallConfidence * 0.80 : 0)
    healthLogger.logField('engine', normalized.engine, normalized.engine ? overallConfidence * 0.80 : 0)
    healthLogger.logField('body_style', normalized.body_style, normalized.body_style ? overallConfidence * 0.80 : 0)
    healthLogger.logField('description', normalized.description, normalized.description ? overallConfidence * 0.95 : 0)
    healthLogger.logField('images', normalized.image_urls?.length > 0 ? normalized.image_urls.length : null,
                          normalized.image_urls?.length > 0 ? overallConfidence * 0.90 : 0)
    healthLogger.logField('location', normalized.location, normalized.location ? overallConfidence * 0.85 : 0)
    healthLogger.logField('seller', normalized.seller, normalized.seller ? overallConfidence * 0.80 : 0)

    // Flush logs in background
    healthLogger.flush().catch(err => console.error('Health log flush error:', err))

    // === PERSIST TO DATABASE when save_to_db is true ===
    let vehicleId: string | null = null
    let imagesInserted = 0

    // Detect non-vehicle items (Mecum road art, memorabilia, etc.)
    const nonVehiclePatterns = /\b(porcelain|neon sign|gas pump|oil can|jukebox|globe|thermometer|clock|letters|pedal car|framed|coin-operated|slot machine|pinball|quilt|coffee grinder|lot of \d|barber|lamp|phonograph|vending|gumball|scale model|diecast|poster|banner|flag|license plate display|tin sign)\b/i
    const titleOrModel = `${normalized.title || ''} ${normalized.model || ''}`
    const looksLikeNonVehicle = nonVehiclePatterns.test(titleOrModel) && !normalized.vin

    if (looksLikeNonVehicle) {
      console.log(`[extract-vehicle-data-ai] Skipping non-vehicle item: ${titleOrModel.slice(0, 80)}`)
    }

    if (save_to_db && normalized.year && normalized.make && !looksLikeNonVehicle) {
      try {
        // Check for existing vehicle by URL or VIN
        let existing = null
        if (normalized.vin && normalized.vin.length >= 11) {
          const { data } = await supabase
            .from('vehicles')
            .select('id')
            .eq('vin', normalized.vin)
            .limit(1)
            .maybeSingle()
          existing = data
        }
        if (!existing && url) {
          const { data } = await supabase
            .from('vehicles')
            .select('id')
            .eq('discovery_url', url)
            .limit(1)
            .maybeSingle()
          existing = data
        }

        // Derive domain slug for discovery_source (e.g. "barrett-jackson" from "www.barrett-jackson.com")
        let domainSlug = 'ai_extraction'
        try { domainSlug = new URL(url).hostname.replace(/^www\./, '').replace(/\.com$|\.org$|\.net$|\.co\.uk$/,''); } catch {}

        const vehiclePayload: Record<string, any> = {
          year: normalized.year,
          make: normalized.make,
          model: normalized.model || null,
          series: normalized.series || null,
          trim: normalized.trim || null,
          vin: normalized.vin || null,
          mileage: normalized.mileage || null,
          color: normalized.exterior_color || normalized.color || null,
          interior_color: normalized.interior_color || null,
          transmission: normalized.transmission || null,
          drivetrain: normalized.drivetrain || null,
          engine_type: normalized.engine || null,
          body_style: normalized.body_style || null,
          sale_price: normalized.sold_price || normalized.price || null,
          asking_price: normalized.price || null,
          description: normalized.description?.slice(0, 5000) || null,
          discovery_url: url,
          discovery_source: source || domainSlug,
          profile_origin: source || 'ai_extraction',
          extractor_version: 'extract-vehicle-data-ai:1.0',
          status: 'active',
        }

        if (existing) {
          vehicleId = existing.id
          // Update with new data (don't overwrite existing non-null fields)
          const updates: Record<string, any> = {}
          for (const [key, val] of Object.entries(vehiclePayload)) {
            if (val !== null && key !== 'discovery_url' && key !== 'status') {
              updates[key] = val
            }
          }
          if (Object.keys(updates).length > 0) {
            await supabase.from('vehicles').update(updates).eq('id', vehicleId)
          }
          console.log(`[extract-vehicle-data-ai] Updated existing vehicle: ${vehicleId}`)
        } else {
          const { data: inserted, error: insertErr } = await supabase
            .from('vehicles')
            .insert(vehiclePayload)
            .select('id')
            .maybeSingle()
          if (insertErr) {
            console.error(`[extract-vehicle-data-ai] Vehicle insert failed: ${insertErr.message}`)
          } else if (inserted?.id) {
            vehicleId = inserted.id
            console.log(`[extract-vehicle-data-ai] Created vehicle: ${vehicleId}`)
          }
        }

        // Save images to vehicle_images
        if (vehicleId && normalized.image_urls && normalized.image_urls.length > 0) {
          const imageRows = normalized.image_urls.slice(0, 50).map((imgUrl: string, idx: number) => ({
            vehicle_id: vehicleId,
            image_url: imgUrl,
            source: 'external_import',
            source_url: imgUrl,
            is_external: true,
            approval_status: 'auto_approved',
            is_approved: true,
            redaction_level: 'none',
            position: idx,
            display_order: idx,
            is_primary: idx === 0,
            exif_data: {
              source_url: url,
              discovery_url: url,
              imported_from: source || 'ai_extraction',
            },
          }))

          // Delete existing external_import images to avoid duplicates
          await supabase
            .from('vehicle_images')
            .delete()
            .eq('vehicle_id', vehicleId)
            .eq('source', 'external_import')

          const { data: insertedImgs, error: imgErr } = await supabase
            .from('vehicle_images')
            .insert(imageRows)
            .select('id')

          if (imgErr) {
            console.error(`[extract-vehicle-data-ai] Image insert failed: ${imgErr.message}`)
          } else {
            imagesInserted = insertedImgs?.length || imageRows.length
            console.log(`[extract-vehicle-data-ai] Saved ${imagesInserted} images`)
          }
        }
      } catch (dbErr: any) {
        console.error(`[extract-vehicle-data-ai] DB save error: ${dbErr.message}`)
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: normalized,
        vehicle_id: vehicleId,
        images_saved: imagesInserted,
        confidence: extractedJson.confidence || 0.8,
        source: source || 'unknown',
        extractionMethod: 'ai'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('Extraction error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        data: {}
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

/**
 * Build extraction prompt for OpenAI
 */
function buildExtractionPrompt(url: string, content: string, source?: string): string {
  return `Extract all vehicle data from this listing page.

URL: ${url}
Source: ${source || 'unknown'}

Page Content (first 30k chars):
${content}

Extract the following fields as JSON:
{
  "vin": "17-character VIN if found, null if not present",
  "year": null,
  "make": "Full manufacturer name (e.g. 'Chevrolet' not 'Chevy', 'Mercedes-Benz' not 'Mercedes')",
  "model": "Specific model name (e.g. 'Camaro', '911', 'Mustang', 'F-150', 'Corvette', 'GT350'). Use the ACTUAL model name, not generic terms like 'Truck' or 'Car'.",
  "series": "Series/generation if applicable (e.g. 'C10', 'E30', '997', 'W124')",
  "trim": "Trim level if found (e.g. 'SS', 'GT', 'Limited', 'Sport')",
  "engine": "Engine description (e.g. '5.0L V8', '2.5L Flat-4', '6.2L Supercharged V8')",
  "engine_size": "Displacement if found (e.g. '5.7L', '3.0L')",
  "mileage": null,
  "price": null,
  "asking_price": null,
  "sold_price": null,
  "sold_date": null,
  "color": null,
  "exterior_color": null,
  "interior_color": null,
  "transmission": "Manual or Automatic or specific (e.g. '6-Speed Manual', '4L60E Automatic')",
  "drivetrain": "RWD, FWD, AWD, or 4WD",
  "body_style": "Coupe, Sedan, Convertible, Pickup, SUV, Wagon, Hatchback, etc.",
  "title_status": "Clean, Salvage, Rebuilt, etc. if mentioned",
  "description": "Full description text from the listing",
  "images": ["url1", "url2"],
  "image_urls": ["url1", "url2"],
  "location": "City, State",
  "seller": "Seller name",
  "listing_title": "Full listing title",
  "confidence": 0.0
}

CRITICAL RULES:
- If the page content does NOT contain vehicle listing data, return: {"no_vehicle_data": true, "confidence": 0}
- Do NOT fabricate or invent ANY data. Only extract what is ACTUALLY PRESENT in the content.
- NEVER guess or estimate prices. If no price/sale amount is explicitly stated, set price/asking_price/sold_price to null.
- NEVER use round numbers like 50000, 25000, 100000 as prices unless the page EXPLICITLY states that exact amount.
- For auction results: look for "sold for $X", "hammer price", "winning bid", "high bid" for sold_price.
- Use the SPECIFIC model name from the listing. "F-150" not "Truck". "911 Carrera" not "Car". "Camaro" not "Coupe".
- NORMALIZE make names: "Chevy" → "Chevrolet", "Merc"/"MB" → "Mercedes-Benz", "VW" → "Volkswagen"
- Extract VIN if present (17 characters, no I/O/Q)
- Extract year from title, heading, or description
- Extract mileage: handle "56k miles", "56,000 miles", "56000" formats
- Extract all image URLs found on the page
- Return null for missing fields, not empty strings or guessed values
- Set confidence (0-1) based on data quality: 0.9+ = clear listing with all key fields, 0.5-0.9 = partial data, <0.5 = minimal data
- Only include fields that are actually found in the content

Return ONLY valid JSON, no other text.`
}

/**
 * Extract text content from HTML
 */
function extractTextFromHTML(html: string): string {
  // Remove "Pending Organization Assignments" HTML blocks first
  html = html.replace(/<div[^>]*style="[^"]*padding:\s*12px[^"]*background:\s*rgb\(254,\s*243,\s*199\)[^"]*"[^>]*>[\s\S]*?REJECT<\/div>/gi, '');
  
  // Remove scripts and styles
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
  
  // Extract from common content elements
  const patterns = [
    /<h1[^>]*>([^<]+)<\/h1>/gi,
    /<h2[^>]*>([^<]+)<\/h2>/gi,
    /<h3[^>]*>([^<]+)<\/h3>/gi,
    /<p[^>]*>([^<]+)<\/p>/gi,
    /<div[^>]*>([^<]+)<\/div>/gi,
    /<span[^>]*>([^<]+)<\/span>/gi,
    /<li[^>]*>([^<]+)<\/li>/gi
  ]

  let extracted = ''
  for (const pattern of patterns) {
    const matches = html.matchAll(pattern)
    for (const match of matches) {
      extracted += match[1] + ' '
    }
  }

  // Fallback: strip all HTML
  if (extracted.length < 500) {
    extracted = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  }

  return extracted.trim()
}

/**
 * Map known domains to their dedicated extractor edge functions
 */
function getDedicatedExtractor(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.replace('www.', '')
    const extractorMap: Record<string, string> = {
      'bringatrailer.com': 'extract-bat-core',
      'carsandbids.com': 'extract-cars-and-bids-core',
      'hagerty.com': 'extract-hagerty-listing',
      'pcarmarket.com': 'import-pcarmarket-listing',
      'ebay.com': 'extract-ebay-motors',
      'craigslist.org': 'extract-craigslist',
      'bonhams.com': 'extract-bonhams',
      'goodingco.com': 'extract-gooding',
      'collectingcars.com': 'extract-collecting-cars-simple',
      'gaaclassiccars.com': 'extract-gaa-classics',
      'facebook.com': 'extract-facebook-marketplace',
    }
    // Also match subdomains (e.g., *.craigslist.org)
    for (const [domain, extractor] of Object.entries(extractorMap)) {
      if (hostname === domain || hostname.endsWith('.' + domain)) {
        return extractor
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Extract structured vehicle data from URL structure when page content is unavailable
 * e.g. "https://carsandbids.com/auctions/xxx/2004-porsche-911-gt3" → {year: 2004, make: "Porsche", model: "911", trim: "GT3"}
 */
function extractVehicleFromUrl(url: string): Record<string, any> | null {
  try {
    const parsed = new URL(url)
    const pathname = parsed.pathname

    // Try to find year-make-model-trim pattern in URL
    // Pattern: /.../ year - make - model - trim /
    const slugMatch = pathname.match(/(\d{4})-([\w]+-[\w+][\w-]*)\/?$/i)
      || pathname.match(/(\d{4})[-/]([\w]+[-/][\w-]+)/i)
    if (!slugMatch) return null

    const year = parseInt(slugMatch[1])
    if (year < 1900 || year > 2030) return null

    // Split the rest into parts: "porsche-911-gt3" → ["porsche", "911", "gt3"]
    const parts = slugMatch[2].split(/[-/]/).filter(p => p.length > 0)
    if (parts.length < 1) return null

    // Capitalize first letter of each part
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()

    const make = cap(parts[0])
    const model = parts.length > 1 ? parts.slice(1, 3).map(cap).join(' ') : null
    const trim = parts.length > 3 ? parts.slice(3).map(cap).join(' ') : null

    return {
      year,
      make,
      model,
      trim,
      listing_url: url,
    }
  } catch {
    return null
  }
}

/**
 * Normalize extracted data to standard format
 */
function normalizeExtractedData(data: any, url: string): any {
  return {
    vin: data.vin || null,
    year: data.year ? parseInt(data.year) : null,
    make: data.make || data.manufacturer || null,
    model: data.model || null,
    series: data.series || null,
    trim: data.trim || null,
    mileage: data.mileage ? parseInt(String(data.mileage).replace(/[^0-9]/g, '')) : null,
    price: data.price || data.asking_price ? parseInt(String(data.price || data.asking_price).replace(/[^0-9]/g, '')) : null,
    sold_price: data.sold_price ? parseInt(String(data.sold_price).replace(/[^0-9]/g, '')) : null,
    sold_date: data.sold_date || null,
    color: data.color || data.exterior_color || null,
    exterior_color: data.exterior_color || data.color || null,
    interior_color: data.interior_color || null,
    transmission: data.transmission || null,
    drivetrain: data.drivetrain || null,
    engine: data.engine || data.engine_type || null,
    engine_size: data.engine_size || data.displacement || null,
    body_style: data.body_style || data.body_type || null,
    body_type: data.body_type || data.body_style || null,
    title_status: data.title_status || null,
    description: data.description || null,
    images: data.images || data.image_urls || [],
    image_urls: data.image_urls || data.images || [],
    location: data.location || null,
    seller: data.seller || null,
    seller_phone: data.seller_phone || null,
    seller_email: data.seller_email || null,
    listing_title: data.listing_title || data.title || null,
    listing_url: url,
    confidence: data.confidence || 0.8
  }
}

