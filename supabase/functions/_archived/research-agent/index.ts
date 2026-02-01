/**
 * RESEARCH AGENT - Intelligent Reference Acquisition
 * 
 * Triggered when analysis discovers a knowledge gap
 * Searches appropriate sources for missing data
 * Indexes findings into reference library
 * Enables: Component ID → Research → Pricing → Repair Estimates
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

    const { 
      search_type,
      search_query,
      vehicle_context,
      component_types,
      analysis_id,
      gap_id,
      user_id
    } = await req.json()

    console.log(`Research Agent: ${search_type} - "${search_query}"`)

    // 1. Create research request
    const { data: request, error: reqError } = await supabase
      .from('research_requests')
      .insert({
        triggered_by_analysis_id: analysis_id,
        triggered_by_gap_id: gap_id,
        triggered_by_user_id: user_id,
        vehicle_context,
        search_type,
        search_query,
        component_types,
        status: 'searching'
      })
      .select()
      .single()

    if (reqError) throw reqError

    console.log(`Created research request: ${request.id}`)

    // 2. Determine target sources
    const sources = await determineTargetSources(supabase, search_type, vehicle_context)
    
    console.log(`Target sources: ${sources.map(s => s.source_name).join(', ')}`)

    // 3. Execute searches in parallel
    const results = await Promise.allSettled(
      sources.map(source => searchSource(supabase, source, search_query, vehicle_context))
    )

    // 4. Aggregate results
    const successfulResults = results
      .filter(r => r.status === 'fulfilled' && r.value !== null)
      .map(r => r.value)

    console.log(`Found ${successfulResults.length} results across ${results.length} sources`)

    // 5. Index findings
    let documentsCreated = 0
    let pricingAdded = 0

    for (const result of successfulResults) {
      if (result.type === 'reference_document') {
        // Store as library document
        const docId = await storeReferenceDocument(supabase, result, vehicle_context)
        if (docId) documentsCreated++
      } else if (result.type === 'parts_pricing') {
        // Store pricing data
        const priceId = await storePricingData(supabase, result, vehicle_context)
        if (priceId) pricingAdded++
      }
    }

    // 6. Update request status
    await supabase
      .from('research_requests')
      .update({
        status: successfulResults.length > 0 ? 'found' : 'not_found',
        completed_at: new Date().toISOString(),
        results_found: successfulResults.length,
        sources_searched: sources.map(s => s.source_name),
        sources_successful: successfulResults.map(r => r.source_name),
        reference_documents_created: documentsCreated > 0 ? [/* doc IDs */] : [],
        parts_pricing_added: pricingAdded
      })
      .eq('id', request.id)

    // 7. If gap was resolved, mark it
    if (gap_id && successfulResults.length > 0) {
      await supabase
        .from('knowledge_gaps')
        .update({
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          resolution_notes: `Found via automated research: ${successfulResults.length} sources`
        })
        .eq('id', gap_id)
    }

    return new Response(
      JSON.stringify({
        success: true,
        request_id: request.id,
        results_found: successfulResults.length,
        documents_created: documentsCreated,
        pricing_added: pricingAdded,
        sources_searched: sources.map(s => s.source_name)
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

async function determineTargetSources(supabase: any, searchType: string, vehicleContext: any) {
  const { data: allSources } = await supabase
    .from('data_source_registry')
    .select('*')
    .order('authority_level', { ascending: false })

  if (!allSources) return []

  // Filter sources relevant to this search type and vehicle
  const relevantSources = allSources.filter(source => {
    // Check if source covers this make
    if (source.makes_covered && !source.makes_covered.includes(vehicleContext.make)) {
      return false
    }

    // Check capabilities based on search type
    if (searchType === 'component_identification' && !source.has_parts_catalog && !source.has_visual_references) {
      return false
    }
    if (searchType === 'part_number_lookup' && !source.has_parts_catalog) {
      return false
    }
    if (searchType.includes('price') && !source.has_pricing) {
      return false
    }

    return true
  })

  // Prioritize by authority
  return relevantSources.slice(0, 3) // Top 3 most authoritative sources
}

async function searchSource(supabase: any, source: any, query: string, vehicleContext: any) {
  console.log(`  Searching ${source.source_name}...`)

  try {
    // Check cache first
    const { data: cached } = await supabase
      .from('reference_search_cache')
      .select('results_json')
      .eq('search_query', query)
      .eq('source_id', source.id)
      .gte('expires_at', new Date().toISOString())
      .single()

    if (cached) {
      console.log(`    Cache hit`)
      await supabase
        .from('reference_search_cache')
        .update({ hit_count: supabase.rpc('increment', 1), last_hit: new Date().toISOString() })
        .eq('search_query', query)
        .eq('source_id', source.id)
      
      return cached.results_json
    }

    // Route to appropriate scraper
    let result = null

    if (source.source_name === 'LMC Truck') {
      result = await scrapeLMCTruck(query, vehicleContext)
    } else if (source.crawl_strategy === 'firecrawl') {
      result = await genericFirecrawl(source, query, vehicleContext)
    } else {
      console.log(`    No scraper implemented for ${source.source_name}`)
      return null
    }

    // Cache result
    if (result) {
      await supabase
        .from('reference_search_cache')
        .insert({
          search_query: query,
          source_id: source.id,
          vehicle_context: vehicleContext,
          results_json: result,
          result_count: Array.isArray(result) ? result.length : 1
        })
    }

    return result

  } catch (error) {
    console.error(`    Error searching ${source.source_name}:`, error.message)
    return null
  }
}

async function scrapeLMCTruck(query: string, vehicleContext: any) {
  // Build LMC search URL
  const year = vehicleContext.year
  const searchTerm = query.replace(/\d{4}/, '').replace(/chevrolet|chevy|gm/gi, '').trim()
  const lmcUrl = `https://lmctruck.com/search?year=${year}&ymm=chevrolet-c-k-pickup-${year}&q=${encodeURIComponent(searchTerm)}`

  console.log(`    LMC URL: ${lmcUrl}`)

  // Use Firecrawl to scrape
  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY')
  if (!firecrawlKey) {
    console.log('    No Firecrawl key available')
    return null
  }

  const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${firecrawlKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      url: lmcUrl,
      formats: ['markdown'],
      onlyMainContent: true
    })
  })

  if (!response.ok) {
    console.log(`    Firecrawl error: ${response.status}`)
    return null
  }

  const data = await response.json()
  const markdown = data.data?.markdown || ''

  // Parse LMC results
  const parts = parseLMCResults(markdown, vehicleContext)

  console.log(`    Found ${parts.length} parts`)

  return parts.map(part => ({
    type: 'parts_pricing',
    source_name: 'LMC Truck',
    source_url: lmcUrl,
    ...part
  }))
}

function parseLMCResults(markdown: string, vehicleContext: any) {
  const parts = []
  
  // LMC typically shows: Product name, Part #, Price, Description
  const productPattern = /###\s+(.+?)\n.*?Part\s*#[:\s]+(\S+).*?\$(\d+\.\d{2})/gis
  
  let match
  while ((match = productPattern.exec(markdown)) !== null) {
    parts.push({
      component_name: match[1].trim(),
      part_number: match[2].trim(),
      price: parseFloat(match[3]),
      description: match[0],
      year_range_start: vehicleContext.year - 2,
      year_range_end: vehicleContext.year + 2,
      make: vehicleContext.make
    })
  }

  return parts
}

async function genericFirecrawl(source: any, query: string, vehicleContext: any) {
  // Generic Firecrawl for other sites
  const searchUrl = `${source.source_url}/search?q=${encodeURIComponent(query)}`
  
  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY')
  if (!firecrawlKey) return null

  const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${firecrawlKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      url: searchUrl,
      formats: ['markdown'],
      onlyMainContent: true
    })
  })

  if (!response.ok) return null

  const data = await response.json()
  
  return {
    type: 'reference_document',
    source_name: source.source_name,
    source_url: searchUrl,
    content: data.data?.markdown,
    title: query
  }
}

async function storeReferenceDocument(supabase: any, result: any, vehicleContext: any) {
  // Would need to upload to storage and create library_document entry
  // For now, just log that we found it
  console.log(`    Would store reference: ${result.title}`)
  return null
}

async function storePricingData(supabase: any, result: any, vehicleContext: any) {
  try {
    // Get supplier ID
    const { data: supplier } = await supabase
      .from('data_source_registry')
      .select('id')
      .eq('source_name', result.source_name)
      .single()

    if (!supplier) return null

    // Insert pricing
    const { data, error } = await supabase
      .from('parts_pricing')
      .insert({
        component_type: result.component_name.toLowerCase().replace(/\s+/g, '_'),
        component_name: result.component_name,
        year_range_start: result.year_range_start,
        year_range_end: result.year_range_end,
        make: result.make,
        part_number: result.part_number,
        part_description: result.description,
        supplier_source_id: supplier.id,
        supplier_name: result.source_name,
        supplier_url: result.source_url,
        price: result.price,
        part_type: 'aftermarket'
      })
      .select()
      .single()

    if (error) {
      console.error(`    Pricing insert error:`, error.message)
      return null
    }

    console.log(`    ✅ Stored pricing: ${result.component_name} - $${result.price}`)
    return data.id

  } catch (error) {
    console.error(`    Error storing pricing:`, error.message)
    return null
  }
}

