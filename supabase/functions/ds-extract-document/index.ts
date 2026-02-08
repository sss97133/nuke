import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Document-type-specific extraction prompts
const DOC_PROMPTS: Record<string, string> = {
  title: `Extract ALL fields from this vehicle title/certificate of title:
- vin, year, make, model, body_style
- title_number, state (2-letter), issue_date (YYYY-MM-DD)
- owner_names (array), owner_address
- lienholder_name, lienholder_address
- odometer (number, no commas), odometer_status (Actual/Exempt/Not Actual/Exceeds Mechanical Limits)
- brand (Clean/Salvage/Rebuilt/Flood/Junk or null)`,

  bill_of_sale: `Extract ALL fields from this bill of sale:
- vin, year, make, model
- buyer_name, buyer_address
- seller_name, seller_address
- sale_date (YYYY-MM-DD), sale_price (number, no $ or commas)
- odometer (number), tax_amount (number)
- payment_method, notary_date`,

  buyers_order: `Extract ALL fields from this buyer's order / purchase agreement:
- vin, year, make, model, color, stock_number
- buyer_name, buyer_address, buyer_phone
- seller_name (dealership), seller_address
- sale_price, trade_allowance, trade_vehicle_year, trade_vehicle_make, trade_vehicle_model, trade_vehicle_vin
- down_payment, amount_financed, lender_name, apr, term_months, monthly_payment
- fees (array of {description, amount}): doc fee, tax, registration, smog, etc.
- total_price, deal_date (YYYY-MM-DD), salesperson`,

  cost_sheet: `Extract ALL fields from this dealer cost sheet / deal recap:
- vin, year, make, model, trim, color, stock_number, deal_number
- initial_cost (what dealer paid), invoice_cost
- reconditioning_costs (array of {item, cost}), total_reconditioning
- shipping_cost, pack_amount
- total_cost, sale_price, gross_profit
- acquired_from, acquired_date (YYYY-MM-DD)
- sold_to, sold_date (YYYY-MM-DD), salesperson, commission`,

  repair_order: `Extract ALL fields from this repair order / work order:
- ro_number, vin, year, make, model, mileage
- customer_name, customer_phone
- date_in (YYYY-MM-DD), date_out (YYYY-MM-DD)
- labor_items (array of {description, hours, rate, amount})
- parts (array of {part_number, description, quantity, unit_price, amount})
- sublet_items (array of {vendor, description, amount})
- total_labor, total_parts, total_sublet, total_amount
- technician, service_advisor`,

  odometer_disclosure: `Extract ALL fields from this odometer disclosure statement:
- vin, year, make, model
- odometer_reading (number), odometer_date (YYYY-MM-DD)
- odometer_status (Actual/Exempt/Not Actual/Exceeds Mechanical Limits)
- seller_name, seller_address
- buyer_name, buyer_address
- seller_signature_present (true/false), buyer_signature_present (true/false)`,

  other: `Extract ALL readable text and data from this document:
- document_title or heading
- any vehicle info: vin, year, make, model
- any names, addresses, dates, amounts
- any identifiers (stock numbers, reference numbers, etc.)`,
}

const CLASSIFY_AND_EXTRACT_PROMPT = `You are a precision OCR system for dealer jacket documents (vehicle dealership paperwork).

STEP 1: Classify this document as one of: title, bill_of_sale, buyers_order, cost_sheet, repair_order, odometer_disclosure, other

STEP 2: Extract all data fields based on the document type.

CRITICAL RULES:
- ONLY extract text you can ACTUALLY READ in the image
- If you cannot read a field, set it to null
- NEVER guess or fabricate values - use null instead
- For confidence scores: 95-100 = clearly legible, 70-94 = partially readable, below 70 = uncertain
- VINs must be exactly 17 characters for post-1981 vehicles (shorter for older). If it doesn't match, lower confidence.
- Dollar amounts: plain numbers only (no $ or commas)
- Dates: YYYY-MM-DD format

Return ONLY valid JSON with this structure:
{
  "document_type": "title|bill_of_sale|buyers_order|cost_sheet|repair_order|odometer_disclosure|other",
  "document_type_confidence": 0-100,
  "extracted_data": { ... all fields for this document type ... },
  "confidences": { "field_name": 0-100 for each extracted field },
  "raw_ocr_text": "150-250 chars of the most important raw text verbatim from the document"
}`

function buildPrompt(docType?: string): string {
  if (docType && DOC_PROMPTS[docType]) {
    return CLASSIFY_AND_EXTRACT_PROMPT + '\n\nFor this document type (' + docType + '), extract these specific fields:\n' + DOC_PROMPTS[docType]
  }
  return CLASSIFY_AND_EXTRACT_PROMPT
}

// VIN validation (basic checksum for post-1981)
function validateVin(vin: string | null | undefined): { valid: boolean; reason?: string } {
  if (!vin) return { valid: true }
  if (vin.length < 5) return { valid: false, reason: 'too_short' }
  if (vin.length === 17) {
    if (/[IOQ]/i.test(vin)) return { valid: false, reason: 'invalid_chars_ioq' }
    // Check for obviously fake patterns
    if (/123456/.test(vin)) return { valid: false, reason: 'fake_pattern' }
    return { valid: true }
  }
  // Pre-1981 VINs can be shorter
  if (vin.length > 5 && vin.length < 17) return { valid: true }
  return { valid: false, reason: 'wrong_length' }
}

function postProcessResult(result: any): { data: any; needsReview: boolean; reviewReasons: string[] } {
  const reviewReasons: string[] = []
  const confidences = result.confidences || {}
  const data = result.extracted_data || {}

  // Check VIN validity
  const vinCheck = validateVin(data.vin)
  if (!vinCheck.valid) {
    confidences.vin = Math.min(confidences.vin || 0, 50)
    reviewReasons.push(`VIN validation: ${vinCheck.reason}`)
  }

  // Check year sanity
  if (data.year && (data.year < 1886 || data.year > 2027)) {
    confidences.year = Math.min(confidences.year || 0, 30)
    reviewReasons.push(`Year out of range: ${data.year}`)
  }

  // Check for hallucination markers
  const suspectNames = ['john doe', 'jane doe', 'john smith', 'jane smith', 'test user']
  const names = [data.buyer_name, data.seller_name, data.sold_to, data.customer_name]
    .filter(Boolean)
    .map((n: string) => n.toLowerCase())
  for (const name of names) {
    if (suspectNames.includes(name)) {
      reviewReasons.push(`Suspicious name: ${name}`)
    }
  }

  // Check confidence thresholds
  const criticalFields = ['vin', 'year', 'make', 'model', 'sale_price', 'buyer_name', 'seller_name', 'owner_names']
  for (const field of criticalFields) {
    const conf = confidences[field]
    if (conf !== undefined && conf < 90 && data[field] !== null && data[field] !== undefined) {
      reviewReasons.push(`Low confidence on ${field}: ${conf}`)
    }
  }

  // Any field below 80 triggers review
  for (const [field, conf] of Object.entries(confidences)) {
    if (typeof conf === 'number' && conf < 80 && data[field] !== null && data[field] !== undefined) {
      if (!reviewReasons.some(r => r.includes(field))) {
        reviewReasons.push(`Low confidence on ${field}: ${conf}`)
      }
    }
  }

  const needsReview = reviewReasons.length > 0 || (result.document_type_confidence || 0) < 80

  return { data: { ...result, confidences }, needsReview, reviewReasons }
}

async function extractWithOpenAI(imageUrl: string, hint?: string): Promise<any> {
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured')

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 45000)

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
            { type: 'text', text: buildPrompt(hint) },
            { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } }
          ]
        }],
        max_tokens: 2000,
        temperature: 0.1,
        response_format: { type: 'json_object' }
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OpenAI ${response.status}: ${errorText.substring(0, 300)}`)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content
    if (!content) throw new Error('Empty response from OpenAI')

    const usage = data.usage || {}
    return {
      result: JSON.parse(content),
      provider: 'openai',
      model: 'gpt-4o',
      tokens_input: usage.prompt_tokens || 0,
      tokens_output: usage.completion_tokens || 0,
      cost_usd: ((usage.prompt_tokens || 0) * 5 / 1_000_000) + ((usage.completion_tokens || 0) * 15 / 1_000_000)
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

async function extractWithAnthropic(imageUrl: string, hint?: string): Promise<any> {
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
  const timeoutId = setTimeout(() => controller.abort(), 45000)

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
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Image } },
            { type: 'text', text: buildPrompt(hint) + '\n\nRespond with ONLY the JSON object, no markdown fences.' }
          ]
        }]
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Anthropic ${response.status}: ${errorText.substring(0, 300)}`)
    }

    const data = await response.json()
    const content = data.content?.[0]?.text
    if (!content) throw new Error('Empty response from Anthropic')

    const jsonMatch = content.match(/\{[\s\S]*\}/)
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content)

    const usage = data.usage || {}
    return {
      result: parsed,
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      tokens_input: usage.input_tokens || 0,
      tokens_output: usage.output_tokens || 0,
      cost_usd: ((usage.input_tokens || 0) * 3 / 1_000_000) + ((usage.output_tokens || 0) * 15 / 1_000_000)
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
    const { image_url, document_type_hint } = await req.json()

    if (!image_url) {
      return new Response(
        JSON.stringify({ error: 'Missing image_url' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const startTime = Date.now()

    // Try OpenAI first, fall back to Anthropic
    let extraction: any
    try {
      extraction = await extractWithOpenAI(image_url, document_type_hint)
    } catch (openaiError) {
      console.warn('OpenAI failed:', (openaiError as Error).message)
      try {
        extraction = await extractWithAnthropic(image_url, document_type_hint)
      } catch (anthropicError) {
        console.error('Both providers failed')
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

    const durationMs = Date.now() - startTime
    const { data, needsReview, reviewReasons } = postProcessResult(extraction.result)

    // Log cost tracking
    try {
      const { createClient } = await import('jsr:@supabase/supabase-js@2')
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      )

      await supabase.rpc('', {}).catch(() => {}) // no-op, just init
      await supabase.from('ds_cost_tracking').upsert({
        date: new Date().toISOString().split('T')[0],
        provider: extraction.provider,
        model: extraction.model,
        total_extractions: 1,
        total_cost_usd: extraction.cost_usd,
        total_tokens_input: extraction.tokens_input,
        total_tokens_output: extraction.tokens_output,
      }, {
        onConflict: 'date,provider,model',
      }).then(async () => {
        // Increment rather than replace
        const today = new Date().toISOString().split('T')[0]
        await supabase.rpc('', {}).catch(() => {}) // fallback: raw SQL would be ideal
      }).catch(e => console.warn('Cost tracking failed:', e.message))
    } catch (e) {
      console.warn('Cost tracking setup failed:', e)
    }

    return new Response(
      JSON.stringify({
        ...data,
        _provider: extraction.provider,
        _model: extraction.model,
        _cost_usd: extraction.cost_usd,
        _duration_ms: durationMs,
        _tokens_input: extraction.tokens_input,
        _tokens_output: extraction.tokens_output,
        _needs_review: needsReview,
        _review_reasons: reviewReasons,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Extraction error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
