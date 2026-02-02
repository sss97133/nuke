/**
 * LOCAL Ollama-Based Vehicle Data Extractor
 *
 * Fallback extractor for when OpenAI quota is exhausted.
 * Runs LOCALLY on user's machine using Ollama (llama3.1:8b or llava for vision).
 *
 * Usage:
 *   - Run `supabase functions serve` locally
 *   - Ensure Ollama is running: `ollama serve`
 *   - For Docker/edge functions, Ollama is at http://host.docker.internal:11434
 *
 * No API costs - uses local GPU/CPU. Slower but always available.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Ollama endpoint - use host.docker.internal for Docker/Deno edge functions
const OLLAMA_URL = Deno.env.get('OLLAMA_URL') || 'http://host.docker.internal:11434'
const DEFAULT_MODEL = 'llama3.1:8b'
const VISION_MODEL = 'llava'

interface ExtractionRequest {
  url: string
  html?: string
  textContent?: string
  source?: string
  model?: string
  save_to_db?: boolean
}

interface ExtractedVehicle {
  url: string
  title: string | null
  year: number | null
  make: string | null
  model: string | null
  series: string | null
  trim: string | null
  vin: string | null
  mileage: number | null
  price: number | null
  asking_price: number | null
  sold_price: number | null
  exterior_color: string | null
  interior_color: string | null
  transmission: string | null
  drivetrain: string | null
  engine: string | null
  body_style: string | null
  description: string | null
  location: string | null
  seller: string | null
  image_urls: string[]
  confidence: number
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const startTime = Date.now()

  try {
    const body: ExtractionRequest = await req.json()
    const { url, html, textContent, source, model, save_to_db } = body

    if (!url && !html && !textContent) {
      return new Response(
        JSON.stringify({ error: 'URL, html, or textContent is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Step 1: Get content to analyze
    let contentToAnalyze = textContent || ''
    let rawHtml = html || ''

    if (!contentToAnalyze && !rawHtml && url) {
      // Fetch the URL directly
      console.log(`[Ollama] Fetching URL: ${url}`)
      const fetchResponse = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      })

      if (!fetchResponse.ok) {
        throw new Error(`Failed to fetch URL: ${fetchResponse.status}`)
      }

      rawHtml = await fetchResponse.text()
    }

    if (!contentToAnalyze && rawHtml) {
      contentToAnalyze = extractTextFromHTML(rawHtml)
    }

    // Limit content to 20k chars for local model efficiency
    const contentPreview = contentToAnalyze.substring(0, 20000)

    // Step 2: Check if Ollama is running
    const ollamaModel = model || DEFAULT_MODEL
    console.log(`[Ollama] Using model: ${ollamaModel} at ${OLLAMA_URL}`)

    try {
      const healthCheck = await fetch(`${OLLAMA_URL}/api/tags`, { method: 'GET' })
      if (!healthCheck.ok) {
        throw new Error('Ollama not responding')
      }
    } catch (err) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Ollama not available at ${OLLAMA_URL}. Make sure Ollama is running locally.`,
          hint: 'Run: ollama serve'
        }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Step 3: Build extraction prompt
    const prompt = buildExtractionPrompt(url || 'unknown', contentPreview, source)

    // Step 4: Call Ollama
    console.log(`[Ollama] Calling model ${ollamaModel}...`)
    const ollamaResponse = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.1, // Low temperature for consistent extraction
          num_predict: 2000,
        },
      }),
    })

    if (!ollamaResponse.ok) {
      const errorText = await ollamaResponse.text()
      throw new Error(`Ollama API error: ${errorText}`)
    }

    const ollamaData = await ollamaResponse.json()
    const rawResponse = ollamaData.response || ''

    // Step 5: Parse JSON from response
    const extractedJson = parseJsonFromResponse(rawResponse)

    if (!extractedJson) {
      console.error('[Ollama] Failed to parse JSON from response:', rawResponse.substring(0, 500))
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Failed to parse extraction result',
          raw_response: rawResponse.substring(0, 1000),
          extraction_method: 'ollama_local'
        }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Step 6: Normalize extracted data
    const normalized = normalizeExtractedData(extractedJson, url || 'unknown')

    const duration = Date.now() - startTime
    console.log(`[Ollama] Extraction complete in ${duration}ms`)

    // Step 7: Optionally save to database
    if (save_to_db && url) {
      try {
        const supabase = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        )

        // Insert or update import_queue with extracted data
        await supabase.from('import_queue').upsert({
          listing_url: url,
          status: 'complete',
          processed_at: new Date().toISOString(),
          listing_title: normalized.title,
          listing_year: normalized.year,
          listing_make: normalized.make,
          listing_model: normalized.model,
          listing_price: normalized.price || normalized.asking_price,
          raw_data: {
            ...normalized,
            extraction_method: 'ollama_local',
            ollama_model: ollamaModel,
            extraction_duration_ms: duration,
          },
        }, { onConflict: 'listing_url' })

        console.log(`[Ollama] Saved to import_queue: ${url}`)
      } catch (dbErr: any) {
        console.error('[Ollama] Database save error:', dbErr.message)
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: normalized,
        extracted: normalized,
        confidence: normalized.confidence,
        source: source || 'unknown',
        extraction_method: 'ollama_local',
        ollama_model: ollamaModel,
        duration_ms: duration,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('[Ollama] Extraction error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        extraction_method: 'ollama_local',
        duration_ms: Date.now() - startTime,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

/**
 * Build extraction prompt for Ollama
 */
function buildExtractionPrompt(url: string, content: string, source?: string): string {
  return `You are a vehicle data extraction specialist. Extract structured vehicle information from this listing page.

URL: ${url}
Source: ${source || 'unknown'}

Page Content:
${content}

Extract the following fields as JSON. Return ONLY valid JSON, no other text:
{
  "vin": "17-character VIN if found, null otherwise",
  "year": 1974,
  "make": "Chevrolet",
  "model": "C10",
  "series": "C10 or K10 or similar series designation",
  "trim": "Cheyenne or Silverado or similar trim level",
  "engine": "350 V8 or similar engine description",
  "mileage": 123456,
  "price": 25000,
  "asking_price": 25000,
  "sold_price": null,
  "exterior_color": "Red",
  "interior_color": "Black",
  "transmission": "Automatic or Manual",
  "drivetrain": "RWD or 4WD",
  "body_style": "Pickup or Sedan or Coupe etc",
  "description": "Brief description of the vehicle",
  "location": "City, State",
  "seller": "Seller name if available",
  "image_urls": ["url1", "url2"],
  "title": "Full listing title",
  "confidence": 0.85
}

RULES:
1. Return ONLY valid JSON, no explanations or markdown
2. Use null for missing fields, not empty strings
3. Normalize make names: "Chevy" -> "Chevrolet"
4. Extract year as a number
5. Extract price as a number (remove $ and commas)
6. Extract mileage as a number (handle "56k miles" as 56000)
7. Set confidence 0-1 based on how complete the data is
8. VIN must be exactly 17 characters if present

JSON:`
}

/**
 * Extract text content from HTML
 */
function extractTextFromHTML(html: string): string {
  // Remove scripts and styles
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
  text = text.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')

  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, ' ')

  // Decode HTML entities
  text = text.replace(/&nbsp;/g, ' ')
  text = text.replace(/&amp;/g, '&')
  text = text.replace(/&lt;/g, '<')
  text = text.replace(/&gt;/g, '>')
  text = text.replace(/&quot;/g, '"')
  text = text.replace(/&#(\d+);/g, (_m, code) => {
    try { return String.fromCharCode(parseInt(code, 10)) } catch { return _m }
  })

  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim()

  return text
}

/**
 * Parse JSON from model response (may include markdown or extra text)
 */
function parseJsonFromResponse(response: string): any {
  // Try direct parse first
  try {
    return JSON.parse(response.trim())
  } catch {
    // Continue to extraction methods
  }

  // Try to extract JSON from markdown code block
  const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim())
    } catch {
      // Continue
    }
  }

  // Try to find JSON object in response
  const jsonMatch = response.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0])
    } catch {
      // Try fixing common issues
      let jsonStr = jsonMatch[0]
      // Remove trailing commas
      jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1')
      try {
        return JSON.parse(jsonStr)
      } catch {
        // Continue
      }
    }
  }

  return null
}

/**
 * Normalize extracted data
 */
function normalizeExtractedData(data: any, url: string): ExtractedVehicle {
  const parseNumber = (val: any): number | null => {
    if (val === null || val === undefined) return null
    if (typeof val === 'number') return val
    const str = String(val).replace(/[$,]/g, '').trim()
    // Handle "56k" format
    const kMatch = str.match(/^(\d+(?:\.\d+)?)\s*k$/i)
    if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000)
    const num = parseFloat(str)
    return isNaN(num) ? null : num
  }

  const normalizeYear = (val: any): number | null => {
    const num = parseNumber(val)
    if (!num || num < 1885 || num > new Date().getFullYear() + 2) return null
    return Math.round(num)
  }

  const normalizeVin = (val: any): string | null => {
    if (!val) return null
    const vin = String(val).toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '')
    return vin.length === 17 ? vin : null
  }

  const normalizeMake = (make: string | null): string | null => {
    if (!make) return null
    const normalized: Record<string, string> = {
      'chevy': 'Chevrolet',
      'chev': 'Chevrolet',
      'mercedes': 'Mercedes-Benz',
      'merc': 'Mercedes-Benz',
      'vw': 'Volkswagen',
      'alfa': 'Alfa Romeo',
    }
    const lowerMake = make.toLowerCase().trim()
    return normalized[lowerMake] || make.trim()
  }

  const images = data.image_urls || data.images || []

  return {
    url,
    title: data.title || data.listing_title || null,
    year: normalizeYear(data.year),
    make: normalizeMake(data.make),
    model: data.model?.trim() || null,
    series: data.series?.trim() || null,
    trim: data.trim?.trim() || null,
    vin: normalizeVin(data.vin),
    mileage: parseNumber(data.mileage),
    price: parseNumber(data.price),
    asking_price: parseNumber(data.asking_price || data.price),
    sold_price: parseNumber(data.sold_price),
    exterior_color: data.exterior_color || data.color || null,
    interior_color: data.interior_color || null,
    transmission: data.transmission || null,
    drivetrain: data.drivetrain || null,
    engine: data.engine || null,
    body_style: data.body_style || data.body_type || null,
    description: data.description || null,
    location: data.location || null,
    seller: data.seller || null,
    image_urls: Array.isArray(images) ? images.filter((u: any) => typeof u === 'string' && u.startsWith('http')) : [],
    confidence: typeof data.confidence === 'number' ? Math.min(1, Math.max(0, data.confidence)) : 0.7,
  }
}
