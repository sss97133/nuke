
import type { Database } from '../types';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { query, location, radius, type, limit = 20 } = await req.json();

    // Create a Supabase client with the Auth context of the function
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    // Build the query based on provided parameters
    let garageQuery = supabaseClient
      .from('garages')
      .select('*')
      .limit(limit);

    // Add filters if provided
    if (query) {
      garageQuery = garageQuery.ilike('name', `%${query}%`);
    }

    if (type) {
      // Assuming there's a 'type' column in the garages table
      garageQuery = garageQuery.eq('type', type);
    }

    // Execute the query
    const { data, error } = await garageQuery;

    if (error) throw error;

    // If location and radius are provided, filter results by distance
    let results = data;
    if (location && radius) {
      const { lat, lng } = location;
      const radiusMiles = radius;

      results = data.filter(garage => {
        if (!garage.location || !garage.location.lat || !garage.location.lng) return false;
        
        // Calculate distance using Haversine formula
        const distance = calculateHaversineDistance(
          lat, 
          lng, 
          garage.location.lat, 
          garage.location.lng
        );
        
        // Convert distance to miles (Haversine returns km)
        const distanceMiles = distance * 0.621371;
        
        return distanceMiles <= radiusMiles;
      });
    }

    return new Response(
      JSON.stringify(results),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    console.error("Error processing request:", error);
    
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});

// Haversine formula to calculate distance between two points on Earth
function calculateHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = degToRad(lat2 - lat1);
  const dLon = degToRad(lon2 - lon1);
  
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(degToRad(lat1)) * Math.cos(degToRad(lat2)) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = R * c;
  
  return distance;
}

function degToRad(deg: number): number {
  return deg * (Math.PI / 180);
}
