import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getUserApiKey } from '../_shared/getUserApiKey.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ExtractionRequest {
  input: string; // Text or image URL
  inputType: 'text' | 'image';
  userId?: string | null;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  textContext?: string; // Optional text context when inputType is 'image'
}

interface ExtractionResponse {
  success: boolean;
  vehicleData?: {
    vin?: string;
    year?: number;
    make?: string;
    model?: string;
    trim?: string;
    mileage?: number;
    price?: number;
    color?: string;
    transmission?: string;
    drivetrain?: string;
    engine?: string;
    body_type?: string;
    location?: string;
    description?: string;
  };
  receiptData?: {
    vendor?: string;
    date?: string;
    total?: number;
    items?: Array<{
      name: string;
      price?: number;
      quantity?: number;
    }>;
    vehicle_vin?: string;
  };
  confidence: number;
  provider?: string; // Which provider succeeded (openai, anthropic, google, huggingface)
  model?: string; // Which model succeeded
  errors?: string[];
}

// Provider configurations with multiple models per provider
interface ProviderConfig {
  name: string;
  models: Array<{
    name: string;
    fn: (input: string, apiKey: string, isImage: boolean, modelName: string, textContext?: string) => Promise<any>;
  }>;
  getApiKey: (supabase: any, userId: string | null) => Promise<string | null>;
  isFree?: boolean; // Free tier available
  rateLimit?: {
    requestsPerMinute: number;
    requestsPerDay: number;
  };
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const request: ExtractionRequest = await req.json()
    const { input, inputType, userId, textContext } = request

    if (!input) {
      return new Response(
        JSON.stringify({ success: false, errors: ['Input is required'] }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          persistSession: false,
          detectSessionInUrl: false
        }
      }
    )

    // Try extraction with multi-provider fallback (free options first, then paid)
    // Pass textContext for image analysis
    const result = await extractWithFallback(input, inputType === 'image', userId, supabase, textContext)

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    )
  } catch (error: any) {
    console.error('Extraction error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        errors: [error.message || 'Unknown extraction error'],
        confidence: 0
      }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    )
  }
})

/**
 * Extract with multi-provider fallback
 * Tries FREE providers first, then paid providers
 * Includes rate limit handling and exponential backoff
 */
async function extractWithFallback(
  input: string,
  isImage: boolean,
  userId: string | null,
  supabase: any,
  textContext?: string
): Promise<ExtractionResponse> {
  // Define provider configurations - FREE options FIRST, then paid
  const providers: ProviderConfig[] = [
    // FREE TIER: Google Gemini Flash (60 req/min, 1,500/day)
    {
      name: 'google',
      isFree: true,
      rateLimit: { requestsPerMinute: 60, requestsPerDay: 1500 },
      models: [
        { name: 'gemini-1.5-flash', fn: extractWithGoogleGemini },
        { name: 'gemini-1.5-pro', fn: extractWithGoogleGemini }
      ],
      getApiKey: async (supabase, userId) => {
        const result = await getUserApiKey(supabase, userId, 'google', 'GOOGLE_AI_API_KEY')
        return result.apiKey
      }
    },
    // PAID: OpenAI (with multiple models)
    {
      name: 'openai',
      isFree: false,
      models: [
        { name: 'gpt-4o-mini', fn: extractWithOpenAI }, // Cheapest paid option
        { name: 'gpt-4o', fn: extractWithOpenAI },
        { name: 'gpt-4-turbo', fn: extractWithOpenAI }
      ],
      getApiKey: async (supabase, userId) => {
        const result = await getUserApiKey(supabase, userId, 'openai', 'OPEN_AI_API_KEY')
        return result.apiKey
      }
    },
    // PAID: Anthropic (with multiple models)
    {
      name: 'anthropic',
      isFree: false,
      models: [
        { name: 'claude-3-haiku-20240307', fn: extractWithAnthropic }, // Cheapest
        { name: 'claude-3-5-sonnet-20241022', fn: extractWithAnthropic },
        { name: 'claude-3-opus-20240229', fn: extractWithAnthropic }
      ],
      getApiKey: async (supabase, userId) => {
        const result = await getUserApiKey(supabase, userId, 'anthropic', 'ANTHROPIC_API_KEY')
        return result.apiKey
      }
    }
  ]

  let lastError: Error | null = null

  // Try each provider (free first, then paid)
  for (const provider of providers) {
    const apiKey = await provider.getApiKey(supabase, userId)
    
    if (!apiKey) {
      console.log(`⏭️  Skipping ${provider.name} - no API key`)
      continue
    }

    // Check rate limits for free tier
    if (provider.isFree && provider.rateLimit) {
      const canProceed = await checkRateLimit(supabase, provider.name, provider.rateLimit, userId)
      if (!canProceed) {
        console.log(`⏭️  Skipping ${provider.name} - rate limit exceeded`)
        continue
      }
    }

    // Try each model for this provider
    for (const model of provider.models) {
      try {
        console.log(`🔄 Trying ${provider.name}/${model.name}...`)
        
        // Call with retry logic and exponential backoff
        // Pass textContext for image analysis
        const result = await retryWithBackoff(
          () => model.fn(input, apiKey, isImage, model.name, textContext),
          {
            maxRetries: 3,
            initialDelay: 1000,
            maxDelay: 10000,
            timeout: 15000
          }
        )

        console.log(`✅ ${provider.name}/${model.name} succeeded`)
        
        // Track successful request for rate limiting
        if (provider.isFree && provider.rateLimit) {
          await trackRequest(supabase, provider.name, userId)
        }

        return {
          ...result,
          provider: provider.name,
          model: model.name
        }

      } catch (error: any) {
        console.warn(`❌ ${provider.name}/${model.name} failed:`, error.message)
        lastError = error
        
        // If rate limited (429), skip remaining models for this provider
        if (error.message?.includes('429') || error.message?.includes('rate limit')) {
          console.log(`⏸️  Rate limited on ${provider.name}, skipping remaining models`)
          break // Break out of model loop, try next provider
        }
        
        continue // Try next model
      }
    }
  }

  // All providers/models failed
  console.error('❌ All providers/models failed')
  return {
    success: false,
    errors: [lastError?.message || 'All AI providers failed'],
    confidence: 0
  }
}

/**
 * Retry with exponential backoff and rate limit handling
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    timeout?: number;
  }
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    timeout = 15000
  } = options

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Timeout wrapper
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Request timeout')), timeout)
        )
      ])

      return result

    } catch (error: any) {
      lastError = error

      // Don't retry on certain errors
      if (error.message?.includes('400') || error.message?.includes('401') || error.message?.includes('403')) {
        throw error // Bad request, auth error, forbidden - don't retry
      }

      // If rate limited, check for retry-after header
      if (error.message?.includes('429') || error.message?.includes('rate limit')) {
        const retryAfter = error.retryAfter || 60 // Default 60 seconds
        console.log(`⏸️  Rate limited, waiting ${retryAfter}s before retry`)
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000))
      } else if (attempt < maxRetries) {
        // Exponential backoff for other errors
        const delay = Math.min(initialDelay * Math.pow(2, attempt), maxDelay)
        console.log(`⏳ Retry ${attempt + 1}/${maxRetries} in ${delay}ms...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError || new Error('Max retries exceeded')
}

/**
 * Check rate limits for free tier providers
 */
async function checkRateLimit(
  supabase: any,
  provider: string,
  limits: { requestsPerMinute: number; requestsPerDay: number },
  userId: string | null
): Promise<boolean> {
  try {
    const now = new Date()
    const oneMinuteAgo = new Date(now.getTime() - 60 * 1000)
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

    // Check requests in last minute
    const { count: recentCount } = await supabase
      .from('ai_request_log')
      .select('*', { count: 'exact', head: true })
      .eq('provider', provider)
      .gte('created_at', oneMinuteAgo.toISOString())

    if (recentCount && recentCount >= limits.requestsPerMinute) {
      return false
    }

    // Check requests in last day
    const { count: dailyCount } = await supabase
      .from('ai_request_log')
      .select('*', { count: 'exact', head: true })
      .eq('provider', provider)
      .gte('created_at', oneDayAgo.toISOString())

    if (dailyCount && dailyCount >= limits.requestsPerDay) {
      return false
    }

    return true
  } catch (error) {
    // If table doesn't exist, allow request (graceful degradation)
    console.warn('Rate limit check failed, allowing request:', error)
    return true
  }
}

/**
 * Track successful request for rate limiting
 */
async function trackRequest(supabase: any, provider: string, userId: string | null): Promise<void> {
  try {
    await supabase.from('ai_request_log').insert({
      provider,
      user_id: userId,
      created_at: new Date().toISOString()
    })
  } catch (error) {
    // If table doesn't exist, ignore (graceful degradation)
    console.warn('Request tracking failed:', error)
  }
}

/**
 * Extract with Google Gemini (FREE TIER)
 */
async function extractWithGoogleGemini(
  input: string,
  apiKey: string,
  isImage: boolean,
  modelName: string,
  textContext?: string
): Promise<Omit<ExtractionResponse, 'provider' | 'model'>> {
  const prompt = buildExtractionPrompt(isImage, textContext)

  const contents: any[] = [
    { text: prompt }
  ]

  if (isImage) {
    // Fetch image and convert to base64
    const imageResponse = await fetch(input)
    const imageBuffer = await imageResponse.arrayBuffer()
    const base64Image = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)))
    const mimeType = imageResponse.headers.get('content-type') || 'image/jpeg'

    contents.push({
      inlineData: {
        mimeType,
        data: base64Image
      }
    })
  } else {
    contents[0].text = prompt + '\n\nText to analyze:\n' + input
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: contents }] })
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after') || '60'
      throw Object.assign(new Error('Rate limit exceeded'), { retryAfter: parseInt(retryAfter) })
    }
    throw new Error(`Google API error: ${response.status} - ${errorText}`)
  }

  const data = await response.json()
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text

  if (!content) {
    throw new Error('No content in Google response')
  }

  // Extract JSON from response
  const jsonMatch = content.match(/\{[\s\S]*\}/)
  const extracted = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content)

  return parseExtractionResult(extracted, isImage)
}

/**
 * Extract with OpenAI
 */
async function extractWithOpenAI(
  input: string,
  apiKey: string,
  isImage: boolean,
  modelName: string,
  textContext?: string
): Promise<Omit<ExtractionResponse, 'provider' | 'model'>> {
  const prompt = buildExtractionPrompt(isImage, textContext)

  const messages: any[] = [
    {
      role: 'system',
      content: 'You are a vehicle data extraction specialist. Extract structured data and return ONLY valid JSON, no other text.'
    },
    {
      role: 'user',
      content: isImage
        ? [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: { url: input, detail: 'high' }
            }
          ]
        : [{ type: 'text', text: prompt + '\n\nText to analyze:\n' + input }]
    }
  ]

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelName,
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: isImage ? 1500 : 1000
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after') || '60'
      throw Object.assign(new Error('Rate limit exceeded'), { retryAfter: parseInt(retryAfter) })
    }
    throw new Error(`OpenAI API error: ${response.status} - ${errorText}`)
  }

  const data = await response.json()
  const content = data.choices[0]?.message?.content

  if (!content) {
    throw new Error('No content in OpenAI response')
  }

  const extracted = JSON.parse(content)
  return parseExtractionResult(extracted, isImage)
}

/**
 * Extract with Anthropic Claude
 */
async function extractWithAnthropic(
  input: string,
  apiKey: string,
  isImage: boolean,
  modelName: string,
  textContext?: string
): Promise<Omit<ExtractionResponse, 'provider' | 'model'>> {
  const prompt = buildExtractionPrompt(isImage, textContext)

  const content: any[] = [
    { type: 'text', text: isImage ? prompt : prompt + '\n\nText to analyze:\n' + input }
  ]

  if (isImage) {
    content.push({
      type: 'image',
      source: {
        type: 'url',
        url: input
      }
    })
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: modelName,
      max_tokens: isImage ? 2000 : 1500,
      temperature: 0.1,
      messages: [
        {
          role: 'user',
          content
        }
      ]
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after') || '60'
      throw Object.assign(new Error('Rate limit exceeded'), { retryAfter: parseInt(retryAfter) })
    }
    throw new Error(`Anthropic API error: ${response.status} - ${errorText}`)
  }

  const data = await response.json()
  const contentText = data.content?.[0]?.text

  if (!contentText) {
    throw new Error('No content in Anthropic response')
  }

  // Extract JSON from response (Claude may wrap in markdown)
  const jsonMatch = contentText.match(/\{[\s\S]*\}/)
  const extracted = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(contentText)

  return parseExtractionResult(extracted, isImage)
}

/**
 * Build extraction prompt
 */
function buildExtractionPrompt(isImage: boolean, textContext?: string): string {
  const baseImagePrompt = `Analyze this image and extract vehicle information. This could be:`;
  const contextNote = textContext ? `\n\nADDITIONAL CONTEXT PROVIDED BY USER: "${textContext}"\nUse this context to help identify or clarify details in the image.` : '';
  
  return isImage
    ? `${baseImagePrompt}${contextNote}
1. A VIN plate - extract the VIN and any visible vehicle details
2. A vehicle photo - identify make, model, year, and other visible features
3. A receipt/invoice - extract vendor, date, total, items, and any vehicle VIN
4. A document - extract all relevant vehicle or transaction data

Return ONLY valid JSON with this exact structure:
{
  "vin": "17-character VIN if found, otherwise null",
  "year": "4-digit year as number, or null",
  "make": "manufacturer name, or null",
  "model": "model name, or null",
  "trim": "trim level, or null",
  "mileage": "mileage as number, or null",
  "price": "price as number, or null",
  "color": "exterior color, or null",
  "transmission": "transmission type, or null",
  "drivetrain": "drivetrain type, or null",
  "engine": "engine description, or null",
  "body_type": "body style, or null",
  "location": "location/city, or null",
  "description": "brief description of what you see, or null",
  "receipt": {
    "vendor": "vendor name if receipt, or null",
    "date": "date in YYYY-MM-DD format, or null",
    "total": "total amount as number, or null",
    "items": [{"name": "item name", "price": number, "quantity": number}]
  }
}`
    : `Extract vehicle information from the following text. Return ONLY valid JSON with this exact structure:
{
  "vin": "17-character VIN if found, otherwise null",
  "year": "4-digit year as number, or null",
  "make": "manufacturer name, or null",
  "model": "model name, or null",
  "trim": "trim level, or null",
  "mileage": "mileage as number, or null",
  "price": "price as number, or null",
  "color": "exterior color, or null",
  "transmission": "transmission type, or null",
  "drivetrain": "drivetrain type, or null",
  "engine": "engine description, or null",
  "body_type": "body style, or null",
  "location": "location/city, or null",
  "description": "brief description, or null",
  "receipt": {
    "vendor": "vendor name if receipt, or null",
    "date": "date in YYYY-MM-DD format, or null",
    "total": "total amount as number, or null",
    "items": [{"name": "item name", "price": number, "quantity": number}]
  }
}`
}

/**
 * Parse extraction result into standard format
 */
function parseExtractionResult(extracted: any, isImage: boolean): Omit<ExtractionResponse, 'provider' | 'model'> {
  const vehicleData: any = {}
  if (extracted.vin) vehicleData.vin = extracted.vin
  if (extracted.year) vehicleData.year = extracted.year
  if (extracted.make) vehicleData.make = extracted.make
  if (extracted.model) vehicleData.model = extracted.model
  if (extracted.trim) vehicleData.trim = extracted.trim
  if (extracted.mileage) vehicleData.mileage = extracted.mileage
  if (extracted.price) vehicleData.price = extracted.price
  if (extracted.color) vehicleData.color = extracted.color
  if (extracted.transmission) vehicleData.transmission = extracted.transmission
  if (extracted.drivetrain) vehicleData.drivetrain = extracted.drivetrain
  if (extracted.engine) vehicleData.engine = extracted.engine
  if (extracted.body_type) vehicleData.body_type = extracted.body_type
  if (extracted.location) vehicleData.location = extracted.location
  if (extracted.description) vehicleData.description = extracted.description

  const receiptData = extracted.receipt ? {
    vendor: extracted.receipt.vendor || undefined,
    date: extracted.receipt.date || undefined,
    total: extracted.receipt.total || undefined,
    items: extracted.receipt.items || undefined,
    vehicle_vin: extracted.vin || undefined
  } : undefined

  // Calculate confidence based on extracted fields
  const fieldCount = Object.keys(vehicleData).length
  const hasVIN = !!extracted.vin
  const confidence = hasVIN ? 0.95 : Math.min(0.9, 0.5 + (fieldCount * 0.05))

  return {
    success: true,
    vehicleData: Object.keys(vehicleData).length > 0 ? vehicleData : undefined,
    receiptData,
    confidence
  }
}
