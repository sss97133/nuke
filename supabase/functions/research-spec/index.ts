/**
 * Spec Research with AI Guardrails
 * 
 * Researches vehicle specifications using AI with source constraints:
 * - Factory manuals
 * - Historical market data
 * - Forum discussions  
 * - Facebook group intel
 * - Current market comparables
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ResearchRequest {
  vehicle_id: string
  spec_name: string  // 'engine', 'transmission', etc.
  spec_value: string // '350ci V8', 'TH350', etc.
  vehicle: {
    year: number
    make: string
    model: string
    vin?: string
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { vehicle_id, spec_name, spec_value, vehicle }: ResearchRequest = await req.json()

    if (!vehicle_id || !spec_name || !spec_value || !vehicle) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { 'content-type': 'application/json', ...corsHeaders } }
      )
    }

    // Initialize Supabase client
    const { createClient } = await import('jsr:@supabase/supabase-js@2')
    const supabaseUrl = Deno.env.get('PROJECT_URL')!
    const supabaseKey = Deno.env.get('SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Check cache first
    const { data: cached } = await supabase
      .from('spec_research_cache')
      .select('*')
      .eq('vehicle_id', vehicle_id)
      .eq('spec_name', spec_name)
      .gt('expires_at', new Date().toISOString())
      .single()

    if (cached) {
      console.log(`Cache hit for ${spec_name} on vehicle ${vehicle_id}`)
      return new Response(
        JSON.stringify(cached.research_data),
        { headers: { 'content-type': 'application/json', ...corsHeaders } }
      )
    }

    // Perform AI research with guardrails
    const researchData = await performGuardrailedResearch(vehicle, spec_name, spec_value)

    // Cache the result
    await supabase.from('spec_research_cache').upsert({
      vehicle_id,
      spec_name,
      spec_value,
      research_data: researchData,
      sources: researchData.sources,
      confidence_score: researchData.confidence || 75
    })

    return new Response(
      JSON.stringify(researchData),
      { headers: { 'content-type': 'application/json', ...corsHeaders } }
    )

  } catch (error) {
    console.error('Research error:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Research failed' }),
      { status: 500, headers: { 'content-type': 'application/json', ...corsHeaders } }
    )
  }
})

async function performGuardrailedResearch(
  vehicle: any,
  specName: string,
  specValue: string
): Promise<any> {
  const openAiKey = Deno.env.get('OPENAI_API_KEY') || Deno.env.get('OPEN_AI_API_KEY')
  if (!openAiKey) {
    throw new Error('OPENAI_API_KEY not configured')
  }

  // Build guardrailed prompt
  const prompt = buildGuardrailedPrompt(vehicle, specName, specValue)

  // Call OpenAI
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openAiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are a classic vehicle specification researcher. You MUST:
1. Only cite information from factory service manuals, NADA data, or documented forums
2. Provide specific source references (manual page numbers, forum threads, etc.)
3. Focus on factual data, not speculation
4. If data is unavailable, state that clearly
5. Structure response as JSON with: factoryData, marketContext, communityIntel, sources`
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI API error: ${response.status} - ${errorText}`)
  }

  const result = await response.json()
  const content = result.choices[0].message.content

  try {
    const researchData = JSON.parse(content)
    return {
      ...researchData,
      confidence: 85,
      cached_at: new Date().toISOString()
    }
  } catch (e) {
    throw new Error(`Failed to parse AI response: ${e.message}`)
  }
}

function buildGuardrailedPrompt(vehicle: any, specName: string, specValue: string): string {
  const vehicleDesc = `${vehicle.year} ${vehicle.make} ${vehicle.model}`
  
  const sourceConstraints = {
    engine: [
      `Factory service manual for ${vehicleDesc}`,
      'NADA historical specifications database',
      'Forum discussions (e.g., Pirate4x4, ClassicBroncos, K5blazerforum)',
      'Facebook groups specific to this model',
      'Current market rebuild costs'
    ],
    transmission: [
      `Factory transmission specifications for ${vehicleDesc}`,
      'Gear ratio charts from manufacturer',
      'Common rebuild shops and costs',
      'Forum threads about transmission swaps/rebuilds',
      'Parts availability and pricing'
    ],
    drivetrain: [
      `4WD system documentation for ${vehicleDesc}`,
      'Transfer case specifications',
      'Forum discussions about drivetrain modifications',
      'Common upgrade paths',
      'Reliability ratings'
    ],
    axles: [
      `Axle specifications for ${vehicleDesc}`,
      'Gear ratio options from factory',
      'Common locker installations',
      'Forum discussions about axle swaps',
      'Strength/durability data'
    ],
    suspension: [
      `Factory suspension specifications for ${vehicleDesc}`,
      'Lift kit compatibility data',
      'Forum discussions about ride quality',
      'Common suspension upgrades',
      'Spring rates and shock options'
    ],
    tires: [
      `Tire size specifications for ${vehicleDesc}`,
      'Backspacing and offset data',
      'Common tire sizes for lifts',
      'Forum discussions about tire performance',
      'Load ratings and durability'
    ]
  }

  const sources = sourceConstraints[specName as keyof typeof sourceConstraints] || sourceConstraints.engine

  return `
Research the ${specName} specification for a ${vehicleDesc}.
Current ${specName}: ${specValue}

You MUST only use these sources:
${sources.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Provide a JSON response with this structure:
{
  "factoryData": {
    "type": "<spec value>",
    "details": ["<detail 1>", "<detail 2>", "<detail 3>"]
  },
  "marketContext": {
    "commonality": "<% of vehicles with this spec>",
    "rebuildCost": "<cost range>",
    "reliability": "<rating>"
  },
  "communityIntel": {
    "forumPosts": <number of relevant discussions>,
    "facebookGroups": <number of active groups>,
    "commonMods": ["<mod 1>", "<mod 2>", "<mod 3>"]
  },
  "sources": [
    { "type": "manual", "ref": "<reference>" },
    { "type": "data", "ref": "<reference>" },
    { "type": "forum", "ref": "<reference>" },
    { "type": "social", "ref": "<reference>" }
  ]
}

Be specific with source references (page numbers, thread titles, etc.).
If data is not available, state that clearly in the response.
`
}

