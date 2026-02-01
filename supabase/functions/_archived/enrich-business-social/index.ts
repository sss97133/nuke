import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Use SerpAPI or similar for Google search
const SERP_API_KEY = Deno.env.get('SERP_API_KEY')

async function searchGoogle(query: string): Promise<any> {
  // If no SERP API, use a simple approach
  if (!SERP_API_KEY) {
    console.log('No SERP API key, skipping Google search')
    return null
  }

  const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${SERP_API_KEY}`
  const response = await fetch(url)
  return response.json()
}

function extractInstagramFromResults(results: any): string | null {
  if (!results?.organic_results) return null

  for (const result of results.organic_results) {
    const url = result.link || ''
    const match = url.match(/instagram\.com\/([^\/\?]+)/)
    if (match) {
      return `https://instagram.com/${match[1]}`
    }
  }

  // Also check knowledge graph
  if (results.knowledge_graph?.social_profiles) {
    for (const profile of results.knowledge_graph.social_profiles) {
      if (profile.link?.includes('instagram.com')) {
        return profile.link
      }
    }
  }

  return null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { batch_size = 10, category } = await req.json()

    // Get businesses without Instagram
    let query = supabase
      .from('businesses')
      .select('id, business_name, city, website, metadata')
      .eq('metadata->>project', 'lofficiel-concierge')
      .is('metadata->>instagram', null)
      .limit(batch_size)

    if (category) {
      query = query.ilike('metadata->>category_fr', `%${category}%`)
    }

    const { data: businesses, error } = await query

    if (error) throw error

    const results = []

    for (const biz of businesses || []) {
      // Search Google for their Instagram
      const searchQuery = `${biz.business_name} st barth instagram`
      console.log(`Searching: ${searchQuery}`)

      const searchResults = await searchGoogle(searchQuery)
      const instagram = extractInstagramFromResults(searchResults)

      if (instagram) {
        // Update the business with Instagram
        const updatedMetadata = {
          ...biz.metadata,
          instagram,
          enriched_at: new Date().toISOString(),
        }

        await supabase
          .from('businesses')
          .update({ metadata: updatedMetadata })
          .eq('id', biz.id)

        results.push({
          id: biz.id,
          name: biz.business_name,
          instagram,
          status: 'found',
        })
      } else {
        // Mark as searched but not found
        const updatedMetadata = {
          ...biz.metadata,
          instagram: 'not_found',
          enriched_at: new Date().toISOString(),
        }

        await supabase
          .from('businesses')
          .update({ metadata: updatedMetadata })
          .eq('id', biz.id)

        results.push({
          id: biz.id,
          name: biz.business_name,
          status: 'not_found',
        })
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 500))
    }

    return new Response(
      JSON.stringify({
        processed: results.length,
        found: results.filter(r => r.status === 'found').length,
        results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('Enrichment error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
