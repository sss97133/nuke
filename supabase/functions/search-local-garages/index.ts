import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { latitude, longitude, radius = 5000 } = await req.json()
    
    const GOOGLE_API_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY')
    if (!GOOGLE_API_KEY) {
      throw new Error('Google Places API key not configured')
    }

    // Search for auto repair shops and car dealers
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${latitude},${longitude}&radius=${radius}&type=car_repair&key=${GOOGLE_API_KEY}`
    )

    const data = await response.json()
    
    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Process and store each garage
    const garages = await Promise.all(
      data.results.map(async (place: any) => {
        const { error } = await supabaseClient
          .from('garages')
          .insert({
            name: place.name,
            google_place_id: place.place_id,
            location: place.geometry.location,
            address: place.vicinity,
            rating: place.rating,
          })
          .select()
          .single()

        if (error && error.code !== '23505') { // Ignore unique constraint violations
          console.error('Error inserting garage:', error)
          return null
        }

        return {
          name: place.name,
          address: place.vicinity,
          rating: place.rating,
        }
      })
    )

    return new Response(
      JSON.stringify({ garages: garages.filter(Boolean) }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})