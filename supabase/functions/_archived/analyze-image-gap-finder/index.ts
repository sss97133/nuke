/**
 * GAP FINDER - Expensive Model Identifies Missing Context
 * 
 * Model: GPT-4o (expensive)
 * Cost: ~$0.02 per image
 * 
 * Purpose: When context is poor, identify what documentation/information
 * would enable cheap models to complete analysis accurately.
 * 
 * This is the REAL use of expensive models: meta-analysis of gaps,
 * not trying to guess answers without context.
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

    const { image_url, image_id, vehicle_id, context_score } = await req.json()
    if (!image_url) throw new Error('Missing image_url')

    console.log(`Gap Finder analyzing: ${image_id} (context score: ${context_score})`)

    // Load current context to show what we DO have
    const currentContext = await loadCurrentContext(supabase, vehicle_id)
    
    // Run gap identification with GPT-4o
    const gapAnalysis = await identifyMissingContext(image_url, currentContext)
    
    // Save gap report
    await supabase
      .from('missing_context_reports')
      .insert({
        vehicle_id,
        image_id,
        missing_items: gapAnalysis.missing_items,
        current_completeness: gapAnalysis.current_completeness,
        potential_completeness: gapAnalysis.potential_completeness,
        estimated_cost_savings: gapAnalysis.estimated_cost_savings,
        identified_by_model: 'gpt-4o'
      })
    
    // Also save as answer with provenance
    for (const question of gapAnalysis.attempted_questions) {
      await supabase
        .from('image_question_answers')
        .insert({
          image_id,
          vehicle_id,
          question_key: question.key,
          question_difficulty: 'expert',
          answer: question.partial_answer,
          confidence: question.confidence,
          model_used: 'gpt-4o',
          model_cost: 0.02 / gapAnalysis.attempted_questions.length, // Split cost
          context_score: context_score,
          context_items_used: currentContext,
          should_reprocess: true  // Reprocess when context improves
        })
    }

    return new Response(
      JSON.stringify({
        success: true,
        gap_analysis: gapAnalysis,
        action_required: 'user_should_add_context',
        estimated_savings: gapAnalysis.estimated_cost_savings
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

async function loadCurrentContext(supabase: any, vehicleId: string) {
  if (!vehicleId) return {}
  
  const [vehicle, timeline, receipts, spid] = await Promise.all([
    supabase.from('vehicles').select('year, make, model').eq('id', vehicleId).single(),
    supabase.from('timeline_events').select('id').eq('vehicle_id', vehicleId),
    supabase.from('receipts').select('id').eq('vehicle_id', vehicleId),
    supabase.from('vehicle_spid_data').select('id').eq('vehicle_id', vehicleId).maybeSingle()
  ])
  
  return {
    has_vehicle_info: !!vehicle.data,
    vehicle: vehicle.data,
    timeline_events_count: timeline.data?.length || 0,
    receipts_count: receipts.data?.length || 0,
    has_spid: !!spid.data
  }
}

async function identifyMissingContext(imageUrl: string, currentContext: any) {
  const openAiKey = Deno.env.get('OPENAI_API_KEY')
  if (!openAiKey) throw new Error('OpenAI API key not configured')

  const vehicleInfo = currentContext.vehicle 
    ? `${currentContext.vehicle.year} ${currentContext.vehicle.make} ${currentContext.vehicle.model}`
    : 'Unknown vehicle'

  const prompt = `You are an expert automotive analyst. Analyze this image of a ${vehicleInfo}.

CURRENT CONTEXT AVAILABLE:
- Vehicle info: ${currentContext.has_vehicle_info ? 'Yes' : 'No'}
- SPID data: ${currentContext.has_spid ? 'Yes' : 'No'}
- Timeline events: ${currentContext.timeline_events_count}
- Receipts: ${currentContext.receipts_count}

YOUR TASK: Identify what additional context/documentation would enable accurate analysis.

For each item you can see but cannot fully identify, specify:
1. What you CAN determine (partial info)
2. What documentation would complete the identification
3. How much confidence would improve

Return JSON:
{
  "visible_items": [
    {
      "item": "part/component name",
      "current_identification": "what you can determine now",
      "confidence_now": 0-100,
      "missing_context_type": "receipt|user_tag|timeline_event|manual_reference|user_photo_closeup",
      "missing_context_description": "specific documentation needed",
      "confidence_with_context": 0-100,
      "cost_savings": "If we had this, could use $0.0001 model instead"
    }
  ],
  "recommended_actions": [
    "specific action for user to take"
  ],
  "current_completeness": 0-100,
  "potential_completeness": 0-100
}`

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openAiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are a documentation gap analyst. Your job is to identify what information is missing, not to guess answers."
        },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageUrl, detail: "high" } }
          ]
        }
      ],
      max_tokens: 1500,
      response_format: { type: "json_object" }
    })
  })

  if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`)

  const data = await response.json()
  const result = JSON.parse(data.choices[0].message.content)
  
  // Calculate cost savings
  const visibleItemsCount = result.visible_items?.length || 0
  const avgConfImprovement = result.visible_items?.reduce((sum: number, item: any) => 
    sum + (item.confidence_with_context - item.confidence_now), 0) / visibleItemsCount || 0
  
  // If we can improve confidence by 40+ points, reprocessing with cheap model saves money
  const estimatedSavings = avgConfImprovement > 40 
    ? 0.02 - 0.0001  // Cost of this analysis minus future cheap reprocessing
    : 0
  
  return {
    missing_items: result.visible_items || [],
    attempted_questions: result.visible_items?.map((item: any, idx: number) => ({
      key: `item_${idx}_${item.item.replace(/\s+/g, '_')}`,
      partial_answer: { item: item.item, current_id: item.current_identification },
      confidence: item.confidence_now
    })) || [],
    recommended_actions: result.recommended_actions || [],
    current_completeness: result.current_completeness || 0,
    potential_completeness: result.potential_completeness || 0,
    estimated_cost_savings: estimatedSavings
  }
}

