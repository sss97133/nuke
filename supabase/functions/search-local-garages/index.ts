import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { lat, lng, radius = 5000 } = await req.json();

    if (!lat || !lng) {
      throw new Error('Latitude and longitude are required');
    }

    const GOOGLE_PLACES_API_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY');
    if (!GOOGLE_PLACES_API_KEY) {
      throw new Error('Google Places API key not configured');
    }

    // Search for auto repair shops nearby
    const placesUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=car_repair&key=${GOOGLE_PLACES_API_KEY}`;
    const response = await fetch(placesUrl);
    const data = await response.json();

    if (!response.ok) {
      throw new Error('Failed to fetch places from Google API');
    }

    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Process and insert each place
    const garages = await Promise.all(
      data.results.map(async (place: any) => {
        const { error } = await supabaseClient
          .from('garages')
          .insert({
            name: place.name,
            google_place_id: place.place_id,
            location: { lat: place.geometry.location.lat, lng: place.geometry.location.lng },
            address: place.vicinity,
            rating: place.rating
          })
          .select()
          .single();

        if (error && error.code !== '23505') { // Ignore unique constraint violations
          console.error('Error inserting garage:', error);
          return null;
        }

        return place;
      })
    );

    return new Response(
      JSON.stringify({
        success: true,
        message: `Successfully processed ${garages.filter(Boolean).length} garages`,
        garages: garages.filter(Boolean)
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});