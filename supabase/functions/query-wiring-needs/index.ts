/**
 * QUERY WIRING NEEDS
 * 
 * Handles natural language queries like:
 * - "I need a motec wiring for my 77 blazer"
 * - "What wiring do I need for a 1977 Blazer with Motec ECU?"
 * - "Quote me a complete wiring system for my 77 Chevy"
 * 
 * Parses query → Finds vehicle → Recommends Motec + ProWire → Generates quote
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getLLMConfig, callLLM } from '../_shared/llmProvider.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface QueryRequest {
  query: string
  vehicle_id?: string
  year?: number
  make?: string
  model?: string
  user_id?: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { query, vehicle_id, year, make, model, user_id }: QueryRequest = await req.json()
    
    if (!query) {
      throw new Error('Query is required')
    }

    console.log(`🔍 Processing query: "${query}"`)

    // Step 1: Parse query with AI to extract intent
    const llmConfig = await getLLMConfig(supabase, user_id || null, undefined, undefined, 'tier3')
    
    const parsePrompt = `Parse this user query about vehicle wiring needs: "${query}"

Extract:
1. Vehicle information (year, make, model)
2. What they need (Motec ECU, wiring, connectors, etc.)
3. Intent (quote, recommendation, information)

Return JSON:
{
  "vehicle": {
    "year": 1977,
    "make": "Chevrolet",
    "model": "Blazer",
    "series": "K5"
  },
  "needs": {
    "motec_ecu": true,
    "wiring_components": true,
    "connectors": true,
    "software": false,
    "displays": false
  },
  "intent": "quote",
  "specific_requirements": ["Motec ECU", "wiring harness", "connectors"]
}`

    let parsed
    try {
      const parseResult = await callLLM(llmConfig, parsePrompt, 'json')
      parsed = typeof parseResult === 'string' ? JSON.parse(parseResult) : parseResult
    } catch (error) {
      // Fallback: Simple parsing without AI
      console.warn('AI parsing failed, using simple parser:', error)
      const lowerQuery = query.toLowerCase()
      parsed = {
        vehicle: {
          year: year || (lowerQuery.match(/\b(19|20)\d{2}\b/)?.[0] ? parseInt(lowerQuery.match(/\b(19|20)\d{2}\b/)?.[0] || '1977') : 1977),
          make: make || (lowerQuery.includes('chevy') || lowerQuery.includes('chevrolet') ? 'Chevrolet' : null),
          model: model || (lowerQuery.includes('blazer') ? 'Blazer' : null)
        },
        needs: {
          motec_ecu: lowerQuery.includes('motec'),
          wiring_components: lowerQuery.includes('wiring'),
          connectors: true
        },
        intent: 'quote',
        specific_requirements: []
      }
    }

    console.log('📋 Parsed query:', JSON.stringify(parsed, null, 2))

    // Step 2: Get or find vehicle
    let vehicle
    if (vehicle_id) {
      const { data } = await supabase
        .from('vehicles')
        .select('id, year, make, model')
        .eq('id', vehicle_id)
        .single()
      vehicle = data
    } else if (parsed.vehicle?.year && parsed.vehicle?.make && parsed.vehicle?.model) {
      // Try to find vehicle
      const { data } = await supabase
        .from('vehicles')
        .select('id, year, make, model')
        .eq('year', parsed.vehicle.year)
        .eq('make', parsed.vehicle.make)
        .ilike('model', `%${parsed.vehicle.model}%`)
        .limit(1)
        .single()
      vehicle = data
    } else if (year && make && model) {
      vehicle = { year, make, model, id: null }
    }

    const vehicleContext = vehicle 
      ? `${vehicle.year} ${vehicle.make} ${vehicle.model}`
      : parsed.vehicle 
        ? `${parsed.vehicle.year} ${parsed.vehicle.make} ${parsed.vehicle.model}`
        : 'Vehicle'

    console.log(`🚗 Vehicle context: ${vehicleContext}`)

    // Step 3: Query catalog for relevant products
    const catalogQuery = supabase
      .from('catalog_parts')
      .select(`
        id,
        part_number,
        name,
        price_current,
        category,
        description,
        product_image_url,
        catalog_id,
        catalog_sources:catalog_id(provider, name)
      `)

    // Build filters based on parsed needs
    const suppliers: string[] = []
    const categories: string[] = []

    if (parsed.needs?.motec_ecu || query.toLowerCase().includes('motec')) {
      suppliers.push('Motec')
      categories.push('ECU Kits', 'Engine Management')
    }

    if (parsed.needs?.wiring_components || parsed.needs?.connectors || query.toLowerCase().includes('wiring')) {
      suppliers.push('ProWire')
      categories.push('Connectors', 'Rubber Boots', 'wiring')
    }

    if (parsed.needs?.software) {
      suppliers.push('Motec')
      categories.push('Software')
    }

    if (parsed.needs?.displays) {
      suppliers.push('Motec')
      categories.push('Displays', 'Display')
    }

    // If no specific needs, include both Motec and ProWire
    if (suppliers.length === 0) {
      suppliers.push('Motec', 'ProWire')
    }

    // Get catalog source IDs
    const { data: sources } = await supabase
      .from('catalog_sources')
      .select('id')
      .in('provider', suppliers)

    if (sources && sources.length > 0) {
      catalogQuery.in('catalog_id', sources.map(s => s.id))
    }

    if (categories.length > 0) {
      catalogQuery.in('category', categories)
    }

    const { data: products } = await catalogQuery.limit(100)

    console.log(`📦 Found ${products?.length || 0} relevant products`)

    // Step 4: Generate recommendations
    // Use AI if available, otherwise use simple logic
    let recommendations
    try {
      const recommendationPrompt = `You are an expert automotive wiring specialist.

USER REQUEST: "${query}"
VEHICLE: ${vehicleContext}

AVAILABLE PRODUCTS:
${products?.slice(0, 30).map(p => 
  `- ${p.part_number}: ${p.name} (${p.catalog_sources?.provider || 'Unknown'}) - ${p.category}${p.price_current ? ` - $${p.price_current}` : ' - Quote required'}`
).join('\n') || 'No products found'}

Recommend a complete wiring system for this ${vehicleContext}:

1. Motec ECU (the "nervous system" - controls wiring logic)
2. Required wiring components (connectors, terminals, wire)
3. Software (if needed for ECU configuration)
4. Displays (if user wants dashboard displays)

Return JSON:
{
  "recommendations": [
    {
      "part_number": "MCM112",
      "name": "MCM112 Plug-In ECU Kit",
      "reason": "Plug-in ECU kit perfect for 1977 Blazer",
      "required": true,
      "category": "ECU"
    }
  ],
  "system_description": "Complete Motec wiring system for 1977 Blazer including...",
  "estimated_labor_hours": 18,
  "notes": ["Motec products require quote", "ProWire connectors have prices"]
}`

      const recommendationResult = await callLLM(llmConfig, recommendationPrompt, 'json')
      recommendations = typeof recommendationResult === 'string' 
        ? JSON.parse(recommendationResult) 
        : recommendationResult
    } catch (error) {
      // Fallback: Simple recommendations
      console.warn('AI recommendations failed, using simple logic:', error)
      const ecuProducts = products?.filter(p => 
        p.category?.toLowerCase().includes('ecu') || 
        p.name?.toLowerCase().includes('ecu')
      ) || []
      const wiringProducts = products?.filter(p => 
        p.catalog_sources?.provider === 'ProWire'
      ) || []
      
      recommendations = {
        recommendations: [
          ...ecuProducts.slice(0, 2).map(p => ({
            part_number: p.part_number,
            name: p.name,
            reason: `ECU for ${vehicleContext}`,
            required: true,
            category: 'ECU'
          })),
          ...wiringProducts.slice(0, 5).map(p => ({
            part_number: p.part_number,
            name: p.name,
            reason: `Wiring component for ${vehicleContext}`,
            required: false,
            category: p.category
          }))
        ],
        system_description: `Complete Motec wiring system for ${vehicleContext} including ECU, connectors, and wiring components`,
        estimated_labor_hours: 18,
        notes: ['Motec products require quote', 'ProWire connectors have prices']
      }
    }

    // Step 5: Generate quote
    const recommendedPartNumbers = recommendations.recommendations?.map((r: any) => r.part_number).filter(Boolean) || []
    
    const { data: quoteData } = await supabase.functions.invoke('generate-wiring-quote', {
      body: {
        vehicle_id: vehicle?.id,
        parts: recommendedPartNumbers.length > 0 ? recommendedPartNumbers : undefined,
        suppliers: suppliers,
        categories: categories.length > 0 ? categories : undefined,
        include_labor: true,
        labor_rate: 125.00
      }
    })

    // Step 6: Build response
    const response = {
      query: query,
      vehicle: vehicle || parsed.vehicle,
      parsed_intent: parsed,
      recommendations: recommendations.recommendations || [],
      system_description: recommendations.system_description || '',
      products_found: products?.length || 0,
      quote: quoteData?.quote || null,
      next_steps: [
        'Review recommended products',
        'Request quote for Motec products (pricing not publicly available)',
        'Order ProWire components (prices available)',
        'Schedule installation (estimated ' + (recommendations.estimated_labor_hours || 18) + ' hours)'
      ]
    }

    return new Response(
      JSON.stringify({
        success: true,
        ...response
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

