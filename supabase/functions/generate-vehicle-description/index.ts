import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { vehicle_id } = await req.json()

    if (!vehicle_id) {
      throw new Error('Vehicle ID is required')
    }

    // Initialize Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabase = createClient(supabaseUrl, supabaseKey)

    // 1. Fetch Vehicle Data
    const { data: vehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .select(`
        *,
        uploader:profiles!vehicle_images_user_id_fkey(full_name),
        contributors:vehicle_contributors(user_id, role, profiles(full_name))
      `)
      .eq('id', vehicle_id)
      .single()

    if (vehicleError) throw vehicleError

    // 2. Fetch Image Tags (for condition/mods)
    const { data: tags } = await supabase
      .from('image_tags')
      .select('tag_name, tag_type')
      .eq('vehicle_id', vehicle_id)
      .limit(50)

    // 3. Fetch Timeline Events (for history)
    const { data: events } = await supabase
      .from('timeline_events')
      .select('title, event_date, event_type')
      .eq('vehicle_id', vehicle_id)
      .order('event_date', { ascending: false })
      .limit(10)

    // 4. Construct Context for LLM
    const uniqueTags = [...new Set(tags?.map(t => t.tag_name) || [])]
    const uniqueMods = tags?.filter(t => t.tag_type === 'modification').map(t => t.tag_name) || []
    
    // Fetch latest raw listing description + provenance snippets (from extraction_metadata) if available.
    const [{ data: rawDescRow }, { data: provRows }] = await Promise.all([
      supabase
        .from('extraction_metadata')
        .select('field_value, extracted_at, source_url')
        .eq('vehicle_id', vehicle_id)
        .eq('field_name', 'raw_listing_description')
        .order('extracted_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('extraction_metadata')
        .select('field_value, extracted_at, source_url')
        .eq('vehicle_id', vehicle_id)
        .eq('field_name', 'provenance_snippet')
        .order('extracted_at', { ascending: false })
        .limit(5),
    ])
    
    const context = {
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      trim: vehicle.trim,
      mileage: vehicle.mileage,
      vin: vehicle.vin,
      color: vehicle.color,
      engine: vehicle.engine_type || vehicle.engine_size,
      transmission: vehicle.transmission,
      origin: vehicle.listing_source || vehicle.discovery_source || 'Unknown',
      listing_title: vehicle.listing_title || null,
      listing_location: vehicle.listing_location || null,
      listing_posted_at: vehicle.listing_posted_at || null,
      listing_updated_at: vehicle.listing_updated_at || null,
      imported_by: vehicle.uploader?.full_name || 'Community Member',
      modifications: uniqueMods,
      detected_features: uniqueTags,
      recent_history: events?.map(e => `${e.event_date}: ${e.title}`),
      raw_listing_description: rawDescRow?.field_value || null,
      raw_listing_description_extracted_at: (rawDescRow as any)?.extracted_at || null,
      provenance_snippets: Array.isArray(provRows) ? provRows.map((r: any) => r?.field_value).filter(Boolean) : [],
    }

    // 5. Generate Description with OpenAI (using fetch)
    const openAiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openAiKey) {
      throw new Error('OpenAI API key not configured')
    }

    const prompt = `
Write a concise, factual vehicle profile description.

Hard rules:
- Do not invent facts.
- If a field is unknown, omit it.
- Do not include VIN in the output.
- Use plain text (no icons/emojis).
      
Vehicle fields:
- Year: ${context.year ?? 'Unknown'}
- Make: ${context.make ?? 'Unknown'}
- Model: ${context.model ?? 'Unknown'}
- Trim: ${context.trim ?? 'Unknown'}
- Mileage: ${typeof context.mileage === 'number' ? context.mileage.toLocaleString() + ' miles' : 'Unknown'}
- Color: ${context.color ?? 'Unknown'}
- Engine: ${context.engine ?? 'Unknown'}
- Transmission: ${context.transmission ?? 'Unknown'}

Listing context:
- Source: ${context.origin}
- Listing title: ${context.listing_title ?? 'Unknown'}
- Location: ${context.listing_location ?? 'Unknown'}
- Posted at: ${context.listing_posted_at ?? 'Unknown'}

Provenance snippets (use only if directly relevant):
${(context.provenance_snippets || []).map((s: string) => `- ${s}`).join('\n') || '- None'}

Detected features / tags:
${(context.detected_features || []).slice(0, 25).map((t: string) => `- ${t}`).join('\n') || '- None'}
      
Recent history (timeline):
${(context.recent_history || []).slice(0, 10).map((s: string) => `- ${s}`).join('\n') || '- None'}

Raw listing description (for reference; do not copy verbatim unless it is short and clearly factual):
${context.raw_listing_description ? context.raw_listing_description.slice(0, 1200) : 'None'}

Output structure:
1) One-sentence summary (Year Make Model + what it is)
2) 3-6 bullet points of key known specs/condition/history
3) One-line source note (Source + location if known)
    `

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openAiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 300,
      })
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`OpenAI API Error: ${err}`)
    }

    const aiData = await response.json()
    const description = aiData.choices[0].message?.content

    // 6. Save to Database
    if (description) {
      await supabase
        .from('vehicles')
        .update({
          description,
          description_source: 'ai_generated',
          description_generated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as any)
        .eq('id', vehicle_id)
    }

    return new Response(
      JSON.stringify({ success: true, description }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error generating description:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
