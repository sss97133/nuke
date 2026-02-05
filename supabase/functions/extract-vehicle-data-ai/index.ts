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
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { url, html, textContent, source }: ExtractionRequest = await req.json()

    if (!url) {
      return new Response(
        JSON.stringify({ error: 'URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Prepare text content for AI analysis
    const contentToAnalyze = textContent || extractTextFromHTML(html || '')
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
        extractedJson = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Failed to parse LLM response as JSON');
      }
    }

    // Validate and normalize extracted data
    const normalized = normalizeExtractedData(extractedJson, url)

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
        healthLogger.logValidationFail('vin', normalized.vin, vinValidation.errorCode!, vinValidation.errorDetails)
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

    return new Response(
      JSON.stringify({
        success: true,
        data: normalized,
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
  "vin": "17-character VIN if found",
  "year": 1974,
  "make": "Chevrolet (NORMALIZE: 'Chevy' → 'Chevrolet', 'GMC' → 'GMC')",
  "model": "Truck (NORMALIZE: 'pickup' → 'Truck', 'truck' → 'Truck', 'Blazer' → 'Blazer'. Note: C/K was the series designation, not the model name)",
  "series": "C10 (if found: C10, K10, C20, K20, K5, C5, C1500, K1500, R1500, V1500, R2500, V2500, R3500, V3500, etc.)",
  "trim": "Cheyenne Super (if found: Cheyenne, Silverado, Scottsdale, Custom Deluxe, etc.)",
  "bed_length": "SWB or LWB (if mentioned: 'shortbed'/'SWB'/'short bed' → 'SWB', 'longbed'/'LWB'/'long bed' → 'LWB')",
  "engine_status": "No Motor (if mentioned: 'no motor', 'no engine', 'missing engine', 'no motor or transmission' → 'No Motor', otherwise null)",
  "transmission_status": "No Transmission (if mentioned: 'no transmission', 'no motor or transmission' → 'No Transmission', otherwise null)",
  "engine": "350 V8 (actual engine if present, null if 'no motor')",
  "engine_size": "5.7L (actual size if present, null if 'no motor')",
  "odometer_status": "Broken (if mentioned: 'odometer broken', 'odo broken', 'speedo broken' → 'Broken', otherwise null)",
  "mileage": 123456,
  "price": 25000,
  "asking_price": 25000,
  "sold_price": null,
  "sold_date": null,
  "color": "Red",
  "exterior_color": "Red",
  "interior_color": "Black",
  "transmission": "Automatic",
  "drivetrain": "4WD",
  "body_style": "Pickup",
  "body_type": "Pickup",
  "title_status": "Clean",
  "description": "Full description text",
  "images": ["url1", "url2"],
  "image_urls": ["url1", "url2"],
  "location": "City, State",
  "seller": "Seller name",
  "seller_phone": "Phone if found",
  "seller_email": "Email if found",
  "listing_title": "Full listing title",
  "confidence": 0.95,
  "extracted_fields": ["series", "trim", "bed_length", "engine_status"],
  "source_annotations": {
    "bed_length_source": "listing_text",
    "engine_status_source": "listing_text",
    "trim_source": "title"
  }
}

CRITICAL RULES:
- NORMALIZE make: "Chevy"/"Chevrolet" → "Chevrolet", "GMC" → "GMC"
- NORMALIZE model: "pickup"/"truck" → "C/K", "Blazer" → "Blazer", "Suburban" → "Suburban"
- Extract series from title/description: Look for C10/K10/C20/K20/K5/C5, and R/V 1500/2500/3500 (1988-1991 squarebody).
- Extract trim from title/description: Look for Cheyenne, Silverado, Scottsdale, Custom Deluxe, Big 10, etc.
- Detect bed length: "shortbed"/"SWB"/"short bed" → "SWB", "longbed"/"LWB"/"long bed" → "LWB"
- Detect engine status: "no motor"/"no engine"/"missing engine"/"no motor or transmission" → "No Motor", set engine/engine_size to null
- Detect transmission status: "no transmission"/"no motor or transmission" → "No Transmission", set transmission to null
- Detect odometer status: "odometer broken"/"odo broken"/"speedo broken" → "Broken", note in description
- Extract modifications: "lowered on 24's", "lifted", "custom", etc. - note in description
- Only include fields that are actually found in the content
- Set confidence (0-1) based on data clarity: 0.9+ = high (all key fields), 0.7-0.9 = medium (most fields), <0.7 = low (missing key data)
- Extract VIN if present (17 characters, no I/O/Q)
- Extract year from title or description
- Extract price (remove $ and commas)
- Extract mileage (handle "56k miles" format)
- Extract all image URLs found
- Return null for missing fields, not empty strings
- List extracted_fields array with all fields you successfully extracted
- Add source_annotations showing where each field came from (title, description, listing_text, etc.)

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

