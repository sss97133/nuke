/**
 * TIER 2: SPECIFIC PART IDENTIFICATION (Moderate Cost)
 * 
 * Model: GPT-4o-mini with context
 * Cost: ~$0.005 per image
 * 
 * Purpose: Detailed part identification and analysis
 * - Specific parts (alternator, carburetor, etc.)
 * - Sheet metal vs structural
 * - Damage assessment
 * - Modification detection
 * - Part numbers/brands
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, detectSessionInUrl: false } }
    )

    const { image_url, image_id, vehicle_id, tier1_analysis } = await req.json()
    if (!image_url || !tier1_analysis) throw new Error('Missing required parameters')

    console.log(`Tier 2 analysis: ${image_id}`)

    // Load minimal vehicle context
    const context = await loadMinimalContext(supabase, vehicle_id)
    
    // Detailed analysis with gpt-4o-mini
    const analysis = await runTier2Analysis(image_url, tier1_analysis, context)
    
    // Save to database
    if (image_id) {
      const { data: currentImage } = await supabase
        .from('vehicle_images')
        .select('ai_scan_metadata')
        .eq('id', image_id)
        .single()
      
      const metadata = currentImage?.ai_scan_metadata || {}
      
      await supabase
        .from('vehicle_images')
        .update({
          ai_scan_metadata: {
            ...metadata,
            tier_2_analysis: analysis,
            processing_tier_reached: 2
          }
        })
        .eq('id', image_id)
    }
    
    // Insert identified parts as tags
    if (analysis.parts_identified) {
      await insertPartTags(supabase, analysis.parts_identified, image_url, vehicle_id)
    }

    return new Response(
      JSON.stringify({
        success: true,
        tier: 2,
        ...analysis
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function loadMinimalContext(supabase: any, vehicleId: string) {
  if (!vehicleId) return null
  
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('year, make, model, trim, engine')
    .eq('id', vehicleId)
    .single()
  
  return vehicle
}

async function runTier2Analysis(imageUrl: string, tier1: any, context: any) {
  const openAiKey = Deno.env.get('OPENAI_API_KEY')
  if (!openAiKey) throw new Error('OpenAI API key not configured')

  const vehicleInfo = context ? `${context.year} ${context.make} ${context.model}` : 'Unknown vehicle'
  const category = tier1.category || 'unknown'

  const prompt = `You are analyzing a ${vehicleInfo}.

Image type: ${category}
Components visible (from Tier 1): ${tier1.components_visible?.join(', ') || 'unknown'}

Identify specific parts and assess condition. Return ONLY valid JSON:

{
  "parts_identified": [
    {
      "name": "specific part name",
      "type": "body_panel|structural|mechanical|trim|electrical",
      "material": "steel|aluminum|plastic|fiberglass|unknown",
      "condition": "excellent|good|fair|poor|damaged",
      "brand": "brand if visible",
      "part_number": "if visible",
      "is_aftermarket": true|false,
      "notes": "brief observation"
    }
  ],
  "damage_assessment": {
    "has_damage": true|false,
    "damage_items": [
      {
        "type": "dent|rust|scratch|crack|missing",
        "severity": "minor|moderate|severe",
        "location": "specific part",
        "description": "details"
      }
    ]
  },
  "modifications": {
    "detected": true|false,
    "items": ["list of aftermarket/modified parts"]
  },
  "sheet_metal_assessment": {
    "panels_analyzed": ["list"],
    "straightness": "excellent|good|fair|poor",
    "gaps": "factory|acceptable|uneven",
    "signs_of_bodywork": true|false
  }
}

Be specific and accurate.`

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openAiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageUrl, detail: "high" } }
          ]
        }
      ],
      max_tokens: 1000,
      response_format: { type: "json_object" }
    })
  })

  if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`)

  const data = await response.json()
  return JSON.parse(data.choices[0].message.content)
}

async function insertPartTags(supabase: any, parts: any[], imageUrl: string, vehicleId: string) {
  if (!parts || parts.length === 0) return
  
  const tags = parts.map(part => ({
    image_url: imageUrl,
    vehicle_id: vehicleId,
    tag_name: part.name,
    tag_type: part.is_aftermarket ? 'modification' : 'part',
    confidence: 85,
    verified: false,
    ai_detection_data: {
      source: 'tier2_analysis',
      part_details: part
    },
    created_by: '00000000-0000-0000-0000-000000000000'
  }))
  
  await supabase
    .from('image_tags')
    .upsert(tags, {
      onConflict: 'image_url,tag_name',
      ignoreDuplicates: true
    })
}

