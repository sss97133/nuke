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
      imported_by: vehicle.uploader?.full_name || 'Community Member',
      modifications: uniqueMods,
      detected_features: uniqueTags,
      recent_history: events?.map(e => `${e.event_date}: ${e.title}`)
    }

    // 5. Generate Description with OpenAI (using fetch)
    const openAiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openAiKey) {
      throw new Error('OpenAI API key not configured')
    }

    const prompt = `
      Write a concise, engaging listing description for this vehicle.
      
      Vehicle: ${context.year} ${context.make} ${context.model} ${context.trim || ''}
      Mileage: ${context.mileage ? context.mileage.toLocaleString() + ' miles' : 'Unknown'}
      Engine: ${context.engine || 'Not specified'}
      Transmission: ${context.transmission || 'Not specified'}
      
      Key Features & Modifications Detected:
      ${context.detected_features.join(', ')}
      
      History Highlights:
      ${context.recent_history?.join('\n') || 'No recent history recorded.'}
      
      Context:
      This vehicle was discovered on ${context.origin} and imported to the N-Zero registry by ${context.imported_by}.
      
      Tone: Professional, enthusiast-focused, factual but appreciative. 
      Structure: 
      1. Hook (Year/Make/Model + key spec)
      2. Condition/Features summary
      3. History/Origin note
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
        .update({ ai_description: description })
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
