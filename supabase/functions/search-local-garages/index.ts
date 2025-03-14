
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
    const { lat, lng, radius_miles, content_type } = await req.json();

    // Validate required parameters
    if (!lat || !lng || !radius_miles || !content_type) {
      return new Response(
        JSON.stringify({ error: "Missing required parameters: lat, lng, radius_miles, content_type" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Create a Supabase client with the Auth context of the function
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    // For PostgreSQL, we'll use the cube and earthdistance extensions
    // The function earth_distance(point(lng, lat), point(lng, lat)) returns distance in meters
    // We'll convert miles to meters for the query (1 mile ≈ 1609.34 meters)
    const radiusMeters = radius_miles * 1609.34;

    let results;

    if (content_type === 'garages') {
      const { data, error } = await supabaseClient
  if (error) console.error("Database query error:", error);
        .from('garages')
        .select('id, name, address, contact_info, location, created_at')
        .filter('location', 'not.is', null)
        .limit(50);

      if (error) throw error;

      // Filter results by distance (since we can't use PostgreSQL's earthdistance in RLS policies)
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
        
        return distanceMiles <= radius_miles;
      });
    } 
    else if (content_type === 'discovered_vehicles') {
      // For discovered vehicles, we need to parse location strings
      const { data, error } = await supabaseClient
  if (error) console.error("Database query error:", error);
        
        .select('*')
        .limit(50);

      if (error) throw error;

      // Get geocoding results for locations and filter by distance
      results = await Promise.all(
        data.map(async (vehicle) => {
          if (!vehicle.location) return null;
          
          try {
            // Try to geocode the location
            const coords = await getCoordinatesFromLocation(vehicle.location);
            
            if (coords) {
              // Calculate distance using Haversine formula
              const distance = calculateHaversineDistance(
                lat,
                lng,
                coords.lat,
                coords.lng
              );
              
              // Convert distance to miles (Haversine returns km)
              const distanceMiles = distance * 0.621371;
              
              return distanceMiles <= radius_miles ? vehicle : null;
            }
          } catch (error) {
            console.error(`Error geocoding ${vehicle.location}:`, error);
          }
          
          return null;
        })
      );
      
      // Remove null results
      results = results.filter(Boolean);
    }
    else {
      // Default empty response for unsupported content types
      results = [];
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

// Simple geocoding function using Nominatim (for demo purposes)
// In production, use a more robust geocoding service with proper rate limits and caching
async function getCoordinatesFromLocation(locationStr: string): Promise<{ lat: number; lng: number } | null> {
  // Simple location cache for demo
  const locationCache: Record<string, { lat: number; lng: number }> = {
    'Los Angeles, CA': { lat: 34.0522, lng: -118.2437 },
    'Chicago, IL': { lat: 41.8781, lng: -87.6298 },
    'New York, NY': { lat: 40.7128, lng: -74.0060 },
    'San Francisco, CA': { lat: 37.7749, lng: -122.4194 },
    'Miami, FL': { lat: 25.7617, lng: -80.1918 },
    'Seattle, WA': { lat: 47.6062, lng: -122.3321 },
    'Austin, TX': { lat: 30.2672, lng: -97.7431 },
    'Denver, CO': { lat: 39.7392, lng: -104.9903 },
  };
  
  // Check if location is in our simple cache
  if (locationCache[locationStr]) {
    return locationCache[locationStr];
  }
  
  // For demo purposes, return null for locations we don't know
  // In production, you would use a geocoding API
  return null;
}
