/**
 * TIER 2: EXPERT COMPONENT IDENTIFICATION (Reference-Grounded)
 * 
 * Model: GPT-4o or Claude Opus
 * Cost: ~$0.01-0.05 per image
 * 
 * Purpose: Detailed component identification with epistemic honesty
 * - Identifies specific components with citations
 * - Separates CONFIRMED (cited) vs INFERRED (reasoned) vs UNKNOWN (flagged)
 * - Logs knowledge gaps when reference data is missing
 * - Provides handoff notes for future analysis
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

    const { image_url, image_id, vehicle_id, user_id } = await req.json()
    if (!image_url || !vehicle_id) throw new Error('Missing required parameters')

    console.log(`Tier 2 analysis: ${image_id}`)

    // 1. Get vehicle context
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('year, make, model, series, vin, origin_metadata')
      .eq('id', vehicle_id)
      .single()

    if (!vehicle) throw new Error('Vehicle not found')

    // 2. Check what references are available
    const { data: availableRefs } = await supabase
      .rpc('get_vehicle_references', { p_vehicle_id: vehicle_id })

    // 3. Check reference coverage
    const { data: coverage } = await supabase
      .rpc('check_vehicle_reference_coverage', { p_vehicle_id: vehicle_id })

    // 4. Get component definitions for this vehicle
    const { data: componentDefs } = await supabase
      .from('component_definitions')
      .select('*')
      .eq('make', vehicle.make)
      .lte('year_range_start', vehicle.year)
      .gte('year_range_end', vehicle.year)
      .order('identification_priority', { ascending: false })

    // 5. Get Tier 1 analysis for context
    const { data: imageData } = await supabase
      .from('vehicle_images')
      .select('ai_scan_metadata')
      .eq('id', image_id)
      .single()

    const tier1 = imageData?.ai_scan_metadata?.tier_1_analysis

    // 6. Get API key
    const { getUserApiKey } = await import('../_shared/getUserApiKey.ts')
    const apiKeyResult = await getUserApiKey(supabase, user_id || null, 'openai', 'OPENAI_API_KEY')

    if (!apiKeyResult.apiKey) {
      throw new Error('No API key available')
    }

    console.log(`Using ${apiKeyResult.source} API key for analysis`)

    // 7. Build reference context for AI
    const referenceContext = buildReferenceContext(
      vehicle,
      availableRefs || [],
      coverage || [],
      componentDefs || []
    )

    // 8. Run expert analysis
    const analysis = await runTier2AnalysisGPT4(
      image_url,
      vehicle,
      tier1,
      referenceContext,
      apiKeyResult.apiKey
    )

    // 9. Create analysis record
    const { data: analysisRecord, error: recordError } = await supabase
      .from('image_analysis_records')
      .insert({
        image_id,
        vehicle_id,
        analysis_tier: 2,
        analyzed_by_model: 'gpt-4o',
        references_available: (availableRefs || []).map(r => r.document_id),
        references_used: analysis.references_cited?.map(r => r.document_id) || [],
        references_missing: analysis.references_needed || [],
        reference_coverage_snapshot: coverage,
        confirmed_findings: analysis.confirmed,
        inferred_findings: analysis.inferred,
        unknown_items: analysis.unknown,
        research_queue: analysis.research_queue,
        handoff_notes: analysis.handoff_notes,
        overall_confidence: analysis.overall_confidence,
        citation_count: analysis.confirmed?.length || 0,
        inference_count: analysis.inferred?.length || 0,
        unknown_count: analysis.unknown?.length || 0
      })
      .select()
      .single()

    if (recordError) {
      console.error('Failed to save analysis record:', recordError)
      throw recordError
    }

    // 10. Log knowledge gaps
    if (analysis.knowledge_gaps?.length > 0) {
      for (const gap of analysis.knowledge_gaps) {
        await supabase.rpc('log_knowledge_gap', {
          p_analysis_id: analysisRecord.id,
          p_vehicle_id: vehicle_id,
          p_gap_type: gap.type,
          p_description: gap.description,
          p_required_reference: gap.required_reference,
          p_affected_components: gap.affected_components || []
        })
      }
    }

    // 11. Store component identifications
    if (analysis.components?.length > 0) {
      const componentIds = []
      for (const comp of analysis.components) {
        const { data: compId } = await supabase
          .from('component_identifications')
          .insert({
            analysis_record_id: analysisRecord.id,
            image_id,
            vehicle_id,
            component_type: comp.type,
            identification: comp.identification,
            part_number: comp.part_number,
            brand: comp.brand,
            status: comp.status,
            confidence: comp.confidence,
            source_references: comp.sources,
            citation_text: comp.citation,
            inference_basis: comp.inference_basis,
            blocking_gaps: comp.blocking_gaps,
            visible_features: comp.visible_features,
            condition_notes: comp.condition
          })
          .select()
          .single()

        if (compId) componentIds.push(compId.id)
      }

      console.log(`✅ Stored ${componentIds.length} component identifications`)
    }

    return new Response(
      JSON.stringify({
        success: true,
        tier: 2,
        analysis_record_id: analysisRecord.id,
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

function buildReferenceContext(vehicle: any, availableRefs: any[], coverage: any[], componentDefs: any[]) {
  return {
    vehicle_info: {
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      series: vehicle.series,
      trim: vehicle.origin_metadata?.trim
    },
    available_references: availableRefs.map(ref => ({
      title: ref.document_title,
      type: ref.document_type,
      page_count: ref.page_count
    })),
    reference_coverage: coverage.map(c => ({
      topic: c.topic,
      status: c.coverage_status,
      percentage: c.coverage_percentage,
      missing: c.missing_references
    })),
    known_components: componentDefs.map(cd => ({
      name: cd.component_name,
      category: cd.component_category,
      features: cd.distinguishing_features,
      priority: cd.identification_priority,
      year_significance: cd.year_dating_significance,
      trim_value: cd.trim_identification_value
    })).slice(0, 50) // Top 50 components
  }
}

async function runTier2AnalysisGPT4(
  imageUrl: string,
  vehicle: any,
  tier1: any,
  referenceContext: any,
  openaiKey: string
) {
  const prompt = `You are an expert vehicle component analyst with access to reference documentation.

VEHICLE CONTEXT:
${JSON.stringify(referenceContext.vehicle_info, null, 2)}

TIER 1 ANALYSIS (Quick categorization):
- Angle: ${tier1?.angle || 'unknown'}
- Category: ${tier1?.category || 'unknown'}
- Condition: ${tier1?.condition_glance || 'unknown'}
- Components visible: ${tier1?.components_visible?.join(', ') || 'none identified'}

AVAILABLE REFERENCES:
${referenceContext.available_references.length > 0 ? 
  referenceContext.available_references.map(r => `- ${r.title} (${r.type})`).join('\n') :
  'NO REFERENCE DOCUMENTS AVAILABLE'}

REFERENCE COVERAGE STATUS:
${referenceContext.reference_coverage.map(c => 
  `- ${c.topic}: ${c.status} (${c.percentage}%) ${c.missing.length > 0 ? '- MISSING: ' + c.missing[0] : ''}`
).join('\n')}

KNOWN COMPONENTS FOR THIS VEHICLE:
${referenceContext.known_components.slice(0, 10).map(c => 
  `- ${c.name} (${c.category}) - Priority: ${c.priority}/10`
).join('\n')}

INSTRUCTIONS:
Analyze this image with EPISTEMIC HONESTY. For each component you observe:

1. CONFIRMED: Only mark as confirmed if you can cite a reference document or the component is definitively identifiable (e.g., visible part number, unmistakable pattern)

2. INFERRED: Mark as inferred if you're making a reasonable conclusion based on visual patterns but lack definitive proof

3. UNKNOWN: Mark as unknown if you cannot determine, and specify what reference would help

OUTPUT STRICT JSON:
{
  "view_angle_corrected": "front_3quarter_passenger|front_3quarter_driver|...",
  "view_confidence": 0.0-1.0,
  
  "components": [
    {
      "type": "grille|front_bumper|fender_emblem|wheel|tire|etc",
      "identification": "detailed description",
      "part_number": "if visible",
      "brand": "if applicable",
      "status": "confirmed|inferred|unknown",
      "confidence": 0.0-1.0,
      "sources": [{"document": "title", "page": 42, "citation": "exact text"}],
      "citation": "human readable citation",
      "inference_basis": "why you think this (for inferred)",
      "blocking_gaps": ["what references needed (for unknown)"],
      "visible_features": ["what you can see"],
      "condition": "condition notes"
    }
  ],
  
  "knowledge_gaps": [
    {
      "type": "missing_reference|ambiguous_component|conflicting_data",
      "description": "what you cannot determine",
      "required_reference": "specific document needed",
      "affected_components": ["list of components"]
    }
  ],
  
  "research_queue": [
    {
      "needed": "specific document title",
      "resolves": ["what unknowns this would resolve"],
      "priority": "high|medium|low"
    }
  ],
  
  "handoff_notes": "notes for next analysis pass",
  "overall_confidence": 0.0-1.0,
  "references_cited": [{"document_id": "if available", "pages": []}]
}

Be thorough. Identify as many components as possible. Never claim certainty without evidence.`

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openaiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: imageUrl }
            },
            {
              type: "text",
              text: prompt
            }
          ]
        }
      ],
      response_format: { type: "json_object" }
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI API error: ${response.status} - ${errorText}`)
  }

  const data = await response.json()
  const content = data.choices[0].message.content
  
  return JSON.parse(content)
}
