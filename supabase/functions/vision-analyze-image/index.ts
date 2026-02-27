import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { callOpenAiChatCompletions } from "../_shared/openaiChat.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Build the analysis prompt, injecting vehicle context when known
function buildPrompt(context: string): string {
  const isGeneral = !context || context === 'general'
  const vehicleBlock = isGeneral
    ? ''
    : `\nKNOWN VEHICLE IDENTITY:\n${context}\n\nUse this identity to anchor your analysis. Do not try to identify the vehicle — it is already known. Focus on: which specific panel/zone is shown, condition of that area, any damage, whether visible parts/colors/modifications are consistent with the known spec, and anything that deviates from factory or documented state.\n`

  return `You are analyzing a vehicle photograph for a professional appraisal system.${vehicleBlock}`
    + VISION_PROMPT_BODY
}

// Core prompt body (coordinate system, taxonomy, output schema)
const VISION_PROMPT_BODY = `

COORDINATE SYSTEM:
The vehicle's center (0,0,0) is at the geometric center of the vehicle based on its length, width, and height.
- X-axis: Positive = passenger side, Negative = driver side
- Y-axis: Positive = front of vehicle, Negative = rear of vehicle
- Z-axis: Positive = up, Negative = down (0 = ground level, vehicle center ~700mm)

CAMERA POSITION:
Estimate the camera's position relative to the vehicle's center (0,0,0).
Use spherical coordinates:
- azimuth_deg: 0° = directly in front, 90° = driver side, 180° = directly behind, 270° = passenger side
- elevation_deg: 0° = level with vehicle center, positive = camera above, negative = camera below
- distance_mm: distance from vehicle center to camera in millimeters
If discernible from perspective, also estimate:
- lens_angle_of_view_deg: horizontal FOV in degrees (e.g. wide ~70-90, normal ~50, telephoto ~20-35), or null
- focal_length_mm: equivalent 35mm focal length in mm (e.g. 24, 50, 85), or null

SUBJECT TAXONOMY (use these exact keys):
- vehicle (full exterior shot)
- exterior.panel.fender.front.driver / .front.passenger / .rear.driver / .rear.passenger
- exterior.panel.door.front.driver / .front.passenger / .rear.driver / .rear.passenger
- exterior.panel.quarter.driver / .passenger
- exterior.panel.hood / .trunk / .tailgate / .roof
- exterior.panel.rocker.driver / .passenger
- exterior.bumper.front / .rear
- exterior.wheel.front.driver / .front.passenger / .rear.driver / .rear.passenger
- exterior.trim.grille / .molding / .chrome
- exterior.light.headlight.driver / .headlight.passenger / .taillight.driver / .taillight.passenger
- exterior.glass.windshield / .rear / .side.driver / .side.passenger
- exterior.mirror.driver / .passenger
- exterior.badge / .emblem
- interior.dashboard / .dashboard.gauges / .dashboard.center_stack / .dashboard.glove_box
- interior.seat.front.driver / .front.passenger / .rear
- interior.door.panel.front.driver / .front.passenger / .rear.driver / .rear.passenger
- interior.console.center / .shifter
- interior.steering.wheel / .column
- interior.headliner / .carpet.front / .carpet.rear / .trunk
- engine.bay / .block / .intake / .exhaust / .alternator / .carburetor / .air_cleaner
- undercarriage.frame.front / .frame.center / .frame.rear
- undercarriage.suspension.front / .suspension.rear
- undercarriage.exhaust / .exhaust.muffler
- undercarriage.floor.front / .floor.rear / .fuel_tank / .driveshaft / .differential
- damage.dent / .scratch / .rust / .crack / .tear / .stain / .fade
- document.vin_tag / .spid_sheet / .title / .window_sticker

IMPORTANT: For close-up detail shots (measuring tape, specific damage, small areas), the subject should be the specific part being photographed, NOT "vehicle".

Return ONLY valid JSON with this exact structure:
{
  "category": "exterior|interior|engine|undercarriage|document|damage",
  "subject": "the.primary.subject.key.from.taxonomy",
  "secondary_subjects": ["other", "visible", "subjects"],
  "description": "One detailed sentence describing what is shown in the photograph",
  "camera_position": {
    "azimuth_deg": number,
    "elevation_deg": number,
    "distance_mm": number,
    "confidence": number,
    "lens_angle_of_view_deg": number|null,
    "focal_length_mm": number|null
  },
  "subject_position": {
    "x_mm": number,
    "y_mm": number,
    "z_mm": number
  },
  "is_close_up": boolean,
  "visible_damage": boolean,
  "condition_notes": "any observations about condition",
  "visible_components": ["component1", "component2"]
}`

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { image_url, context } = await req.json()
    if (!image_url) throw new Error('Missing image_url')

    const effectiveContext = context || 'general'
    console.log('[vision-analyze-image] Starting analysis, context:', effectiveContext)

    // Try Gemini Flash first ($0.0001/image vs $0.004/image for GPT)
    console.log('[vision-analyze-image] Attempting Gemini Flash...')
    let result = await runGemini(image_url, effectiveContext)
    let modelUsed = 'gemini-2.0-flash'

    let geminiDebug: any = null
    if (!result || result.category === 'error' || result._gemini_error) {
      geminiDebug = { error: result?._gemini_error || 'unknown', message: result?._error_message || null }
      console.log('[vision-analyze-image] Gemini failed:', geminiDebug.error, geminiDebug.message, '- falling back to GPT-4o-mini...')
      result = await runGPT(image_url, effectiveContext)
      modelUsed = 'gpt-4o-mini'
    }

    if (!result || result.category === 'error') {
      return new Response(
        JSON.stringify({
          success: false,
          error: result?.description || 'Vision analysis failed',
          gemini_error: geminiDebug?.error || null,
          gemini_error_message: geminiDebug?.message || null,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Strip internal fields before returning
    const usage = result._usage || null
    const costUsd = result._cost_usd ?? null
    const model = result._model || modelUsed
    delete result._usage
    delete result._cost_usd
    delete result._model
    delete result._debug
    delete result._gemini_error
    delete result._error_message

    return new Response(
      JSON.stringify({
        success: true,
        analysis: result,
        model,
        cost_usd: costUsd,
        usage,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('[vision-analyze-image] Error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// ============================================================================
// GEMINI FLASH - 40x cheaper than GPT-4o-mini ($0.0001 vs $0.004 per image)
// ============================================================================
async function runGemini(imageUrl: string, context: string): Promise<any> {
  const freeApiKey = Deno.env.get('free_api_key')
  const geminiApiKey = Deno.env.get('GEMINI_API_KEY')
  const geminiKey = freeApiKey || geminiApiKey
  if (!geminiKey) {
    console.error('[vision-analyze-image:gemini] No Gemini API key found')
    return { _gemini_error: 'no_api_key' }
  }

  const prompt = buildPrompt(context)

  try {
    // Download image and convert to base64
    const imageResponse = await fetch(imageUrl, { signal: AbortSignal.timeout(30000) })
    if (!imageResponse.ok) {
      return { _gemini_error: 'image_download_failed', _error_message: `Status ${imageResponse.status}` }
    }

    const imageBuffer = await imageResponse.arrayBuffer()
    const uint8Array = new Uint8Array(imageBuffer)
    let binary = ''
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i])
    }
    const base64Image = btoa(binary)
    const mimeType = imageResponse.headers.get('content-type') || 'image/jpeg'

    const startTime = Date.now()
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: base64Image } }
            ]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 600,
          }
        }),
        signal: AbortSignal.timeout(60000),
      }
    )

    const duration = Date.now() - startTime
    if (!response.ok) {
      const errorText = await response.text()
      return { _gemini_error: 'api_error', _error_message: `Status ${response.status}: ${errorText.substring(0, 200)}` }
    }

    const result = await response.json()
    const content = result.candidates?.[0]?.content?.parts?.[0]?.text
    if (!content) {
      return { _gemini_error: 'no_content', _error_message: JSON.stringify(result).substring(0, 200) }
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return { _gemini_error: 'no_json_in_response', _error_message: content.substring(0, 200) }
    }

    const parsed = JSON.parse(jsonMatch[0])
    const inputTokens = Math.ceil((prompt.length + base64Image.length * 0.75) / 4)
    const outputTokens = Math.ceil(content.length / 4)

    console.log('[vision-analyze-image:gemini] SUCCESS:', {
      category: parsed.category,
      subject: parsed.subject,
      duration_ms: duration,
    })

    return {
      ...parsed,
      _usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
      _cost_usd: 0.0001,
      _model: 'gemini-2.0-flash',
    }
  } catch (error) {
    console.error('[vision-analyze-image:gemini] Exception:', error)
    return { _gemini_error: 'exception', _error_message: String(error) }
  }
}

// ============================================================================
// GPT-4o-mini FALLBACK
// ============================================================================
async function runGPT(imageUrl: string, context: string): Promise<any> {
  let openAiKey = Deno.env.get('OPENAI_API_KEY') || Deno.env.get('OPEN_AI_API_KEY')
  if (!openAiKey) {
    try {
      const envObj = Deno.env.toObject()
      openAiKey = envObj['OPENAI_API_KEY'] || envObj['OPEN_AI_API_KEY']
    } catch (_) { /* ignore */ }
  }
  if (!openAiKey) {
    return { category: 'error', subject: 'api_key_missing', description: 'No OpenAI API key available' }
  }

  const prompt = buildPrompt(context)

  try {
    const res = await callOpenAiChatCompletions({
      apiKey: openAiKey,
      body: {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrl } }
            ]
          }
        ],
        max_tokens: 800,
        response_format: { type: 'json_object' },
      },
      timeoutMs: 25000,
    })

    if (!res || !res.ok) {
      return { category: 'error', subject: 'openai_failed', description: `OpenAI returned status ${res?.status}` }
    }

    const content = res.content_text
    const jsonMatch = (content || '').match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : (content || '{}'))

    console.log('[vision-analyze-image:gpt] SUCCESS:', {
      category: parsed.category,
      subject: parsed.subject,
      tokens: res.usage?.total_tokens,
    })

    return {
      ...parsed,
      _usage: res.usage || null,
      _cost_usd: res.cost_usd ?? null,
      _model: res.model || 'gpt-4o-mini',
    }
  } catch (error) {
    console.error('[vision-analyze-image:gpt] Exception:', error)
    return { category: 'error', subject: 'openai_exception', description: String(error) }
  }
}
