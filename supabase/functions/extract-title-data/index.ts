import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const EXTRACTION_PROMPT = `You are an OCR and data extraction system specialized in US vehicle title documents (Certificate of Title).

Analyze this document image and extract ALL structured fields. Be thorough — titles contain critical legal data.

Extract these fields (use null if not found or unreadable):

1. **vin** - 17-character Vehicle Identification Number. Pre-1981 vehicles may have shorter chassis IDs.
2. **year** - Model year (4-digit number)
3. **make** - Manufacturer (e.g. Ford, Chevrolet, Toyota)
4. **model** - Model name (e.g. F-150, Camaro, Corolla)
5. **title_number** - The title document number/certificate number
6. **state** - Issuing state (2-letter abbreviation preferred)
7. **issue_date** - Date title was issued, format YYYY-MM-DD
8. **owner_names** - Array of ALL owner names listed (current and previous if shown)
9. **owner_address** - Owner address if visible
10. **odometer** - Odometer reading as a number (no commas)
11. **odometer_status** - One of: "Actual", "Exempt", "Not Actual", "Exceeds Mechanical Limits", or null
12. **raw_text** - A short snippet (100-200 chars) of the most important raw text on the document
13. **confidences** - Per-field confidence scores 0-100

Return ONLY valid JSON:
{
  "vin": "string or null",
  "year": number or null,
  "make": "string or null",
  "model": "string or null",
  "title_number": "string or null",
  "state": "string or null",
  "issue_date": "YYYY-MM-DD or null",
  "owner_names": ["name1", "name2"] or [],
  "owner_address": "string or null",
  "odometer": number or null,
  "odometer_status": "Actual|Exempt|Not Actual|Exceeds Mechanical Limits" or null,
  "raw_text": "short snippet of key text",
  "confidences": {
    "vin": 0-100,
    "year": 0-100,
    "make": 0-100,
    "model": 0-100,
    "title_number": 0-100,
    "state": 0-100,
    "issue_date": 0-100,
    "owner_names": 0-100,
    "odometer": 0-100
  }
}

Be precise. If a field is partially visible or you're unsure, extract your best reading and reflect the uncertainty in the confidence score.`

interface ExtractionResult {
  vin?: string | null
  year?: number | null
  make?: string | null
  model?: string | null
  title_number?: string | null
  state?: string | null
  issue_date?: string | null
  owner_names?: string[]
  owner_address?: string | null
  odometer?: number | null
  odometer_status?: string | null
  raw_text?: string | null
  confidences?: Record<string, number>
}

async function extractWithOpenAI(imageUrl: string): Promise<ExtractionResult> {
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured')

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30000)

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: EXTRACTION_PROMPT },
            { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } }
          ]
        }],
        max_tokens: 1500,
        temperature: 0.1,
        response_format: { type: 'json_object' }
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content
    if (!content) throw new Error('Empty response from OpenAI')

    try {
      return JSON.parse(content)
    } catch {
      throw new Error(`OpenAI returned invalid JSON: ${content.slice(0, 200)}`)
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

async function extractWithAnthropic(imageUrl: string): Promise<ExtractionResult> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  // Fetch image and convert to base64
  const imageResponse = await fetch(imageUrl)
  if (!imageResponse.ok) throw new Error(`Failed to fetch image: ${imageResponse.status}`)

  const imageBuffer = await imageResponse.arrayBuffer()
  const base64Image = btoa(
    new Uint8Array(imageBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
  )
  const contentType = imageResponse.headers.get('content-type') || 'image/jpeg'
  const mediaType = contentType.includes('png') ? 'image/png' :
                    contentType.includes('webp') ? 'image/webp' : 'image/jpeg'

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30000)

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64Image }
            },
            { type: 'text', text: EXTRACTION_PROMPT + '\n\nRespond with ONLY the JSON object, no markdown fences.' }
          ]
        }]
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Anthropic API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    const content = data.content?.[0]?.text
    if (!content) throw new Error('Empty response from Anthropic')

    // Extract JSON from response (Claude sometimes wraps in markdown)
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    try {
      return jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content)
    } catch {
      throw new Error(`Anthropic returned invalid JSON: ${content.slice(0, 200)}`)
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { image_url } = await req.json()

    if (!image_url) {
      return new Response(
        JSON.stringify({ error: 'Missing image_url' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Extracting title data from:', image_url)

    // Try OpenAI first, fall back to Anthropic
    let extracted: ExtractionResult
    let provider = 'openai'

    try {
      console.log('Trying OpenAI...')
      extracted = await extractWithOpenAI(image_url)
      console.log('OpenAI succeeded')
    } catch (openaiError) {
      console.warn('OpenAI failed:', (openaiError as Error).message)
      try {
        console.log('Trying Anthropic fallback...')
        extracted = await extractWithAnthropic(image_url)
        provider = 'anthropic'
        console.log('Anthropic succeeded')
      } catch (anthropicError) {
        console.error('Both providers failed')
        console.error('OpenAI:', (openaiError as Error).message)
        console.error('Anthropic:', (anthropicError as Error).message)
        return new Response(
          JSON.stringify({
            error: 'Both AI providers failed',
            details: {
              openai: (openaiError as Error).message,
              anthropic: (anthropicError as Error).message
            }
          }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    console.log(`Extracted via ${provider}:`, JSON.stringify(extracted).substring(0, 200))

    return new Response(
      JSON.stringify({ ...extracted, _provider: provider }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Title extraction error:', error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
        details: String(error)
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
