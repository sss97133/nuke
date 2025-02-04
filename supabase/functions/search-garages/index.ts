import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { lat, lng, radius = 5000 } = await req.json();

    if (!lat || !lng) {
      throw new Error('Latitude and longitude are required');
    }

    console.log(`Searching for garages near ${lat},${lng} within ${radius}m`);

    // 1. Search using Google Places API
    const googlePlacesResults = await searchGooglePlaces(lat, lng, radius);
    
    // 2. Enrich with Yelp data
    const enrichedResults = await enrichWithYelpData(googlePlacesResults);

    // 3. Store results in Supabase
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Insert or update garages in the database
    for (const garage of enrichedResults) {
      const { error } = await supabaseClient
        .from('garages')
        .upsert({
          name: garage.name,
          google_place_id: garage.place_id,
          location: { lat: garage.geometry.location.lat, lng: garage.geometry.location.lng },
          address: garage.vicinity,
          rating: garage.rating,
          yelp_data: garage.yelpData
        }, {
          onConflict: 'google_place_id'
        });

      if (error) {
        console.error('Error upserting garage:', error);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        garages: enrichedResults
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error in search-garages function:', error);
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

async function searchGooglePlaces(lat: number, lng: number, radius: number) {
  const GOOGLE_PLACES_API_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY');
  if (!GOOGLE_PLACES_API_KEY) {
    throw new Error('Google Places API key not configured');
  }

  const placesUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=car_repair&key=${GOOGLE_PLACES_API_KEY}`;
  const response = await fetch(placesUrl);
  const data = await response.json();

  if (!response.ok) {
    throw new Error('Failed to fetch places from Google API');
  }

  return data.results;
}

async function enrichWithYelpData(googlePlaces: any[]) {
  const YELP_API_KEY = Deno.env.get('YELP_API_KEY');
  if (!YELP_API_KEY) {
    throw new Error('Yelp API key not configured');
  }

  const enrichedPlaces = await Promise.all(
    googlePlaces.map(async (place) => {
      try {
        const yelpSearchUrl = `https://api.yelp.com/v3/businesses/search?term=${encodeURIComponent(place.name)}&latitude=${place.geometry.location.lat}&longitude=${place.geometry.location.lng}&radius=100&categories=autorepair`;
        
        const yelpResponse = await fetch(yelpSearchUrl, {
          headers: {
            'Authorization': `Bearer ${YELP_API_KEY}`,
            'Accept': 'application/json',
          },
        });

        const yelpData = await yelpResponse.json();
        const bestMatch = yelpData.businesses?.[0];

        return {
          ...place,
          yelpData: bestMatch ? {
            yelp_id: bestMatch.id,
            yelp_rating: bestMatch.rating,
            review_count: bestMatch.review_count,
            price: bestMatch.price,
            phone: bestMatch.phone,
            url: bestMatch.url,
            photos: bestMatch.photos,
          } : null
        };
      } catch (error) {
        console.error(`Error fetching Yelp data for ${place.name}:`, error);
        return place;
      }
    })
  );

  return enrichedPlaces;
}