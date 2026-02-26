/**
 * suggest-bundle-label
 *
 * Takes a bundle (date + image IDs) for a vehicle and returns an AI-suggested
 * timeline event title and type based on what's visible in the photos.
 *
 * Input:  { vehicle_id, bundle_date, image_ids: string[] }
 * Output: { title, event_type, confidence, reasoning }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { callLLM, getLLMConfig } from '../_shared/llmProvider.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const VALID_EVENT_TYPES = [
  'maintenance', 'repair', 'modification', 'inspection',
  'purchase', 'service', 'other', 'work_completed'
]

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { vehicle_id, bundle_date, image_ids } = await req.json()

    if (!vehicle_id || !bundle_date || !Array.isArray(image_ids) || image_ids.length === 0) {
      return new Response(
        JSON.stringify({ error: 'vehicle_id, bundle_date, and image_ids are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

    // Get vehicle context
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('year, make, model, trim, color, engine_type')
      .eq('id', vehicle_id)
      .single()

    const vehicleLabel = vehicle
      ? [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(' ')
      : 'Unknown vehicle'

    // Fetch up to 4 representative image URLs from the bundle
    const sampleIds = image_ids.slice(0, 4)
    const { data: images } = await supabase
      .from('vehicle_images')
      .select('id, image_url, thumbnail_url, medium_url, variants, category')
      .in('id', sampleIds)

    if (!images || images.length === 0) {
      return new Response(
        JSON.stringify({
          title: `Photo session — ${bundle_date}`,
          event_type: 'documentation',
          confidence: 0.3,
          reasoning: 'No images available for analysis',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Build image content blocks for Claude Vision
    const imageBlocks: any[] = images.map(img => {
      const url = (img.variants as any)?.medium || img.medium_url || img.thumbnail_url || img.image_url
      return { type: 'image', source: { type: 'url', url } }
    })

    const prompt = `You are analyzing a group of ${image_ids.length} photos taken on ${bundle_date} of a ${vehicleLabel}.

I'm showing you ${images.length} representative samples from this photo session.

Based on what you see, determine:
1. A concise title for this photo session (e.g. "Interior restoration", "Engine bay documentation", "Pre-sale inspection", "Pickup day photos")
2. The most appropriate event type from this list: ${VALID_EVENT_TYPES.join(', ')}
3. Your confidence (0.0–1.0)
4. Brief reasoning (1 sentence)

Respond ONLY with valid JSON:
{
  "title": "...",
  "event_type": "...",
  "confidence": 0.0,
  "reasoning": "..."
}`

    const llmConfig = await getLLMConfig(supabase, null, 'anthropic', 'claude-haiku-4-5')

    const response = await callLLM(
      llmConfig,
      [{ role: 'user', content: [...imageBlocks, { type: 'text', text: prompt }] }],
      { maxTokens: 200, vision: true }
    )

    // callLLM returns { content: string, ... } — content is the text directly
    const raw = typeof response.content === 'string' ? response.content : ''
    const jsonMatch = raw.match(/\{[\s\S]*\}/)

    if (!jsonMatch) {
      return new Response(
        JSON.stringify({
          title: `Photo session — ${bundle_date}`,
          event_type: 'documentation',
          confidence: 0.2,
          reasoning: 'Could not parse AI response',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const parsed = JSON.parse(jsonMatch[0])

    // Validate event_type
    if (!VALID_EVENT_TYPES.includes(parsed.event_type)) {
      parsed.event_type = 'documentation'
    }

    return new Response(
      JSON.stringify({
        title: parsed.title || `Photo session — ${bundle_date}`,
        event_type: parsed.event_type || 'documentation',
        confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5)),
        reasoning: parsed.reasoning || '',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err: any) {
    console.error('[suggest-bundle-label]', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
