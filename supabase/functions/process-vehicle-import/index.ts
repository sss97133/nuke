
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

// Define types
interface VehicleImport {
  make: string;
  model: string;
  year: number | string;
  color?: string;
  purchase_date?: string;
  purchase_price?: number | string;
  current_value?: number | string;
  mileage?: number | string;
  condition?: string;
  location?: string;
  vin?: string;
  license_plate?: string;
  insurance_policy?: string;
  notes?: string;
  icloud_album_link?: string;
  icloud_folder_id?: string;
}

// CORS headers for cross-origin requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper function to validate a vehicle record
function validateVehicle(vehicle: any): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Required fields
  if (!vehicle.make) errors.push('Make is required');
  if (!vehicle.model) errors.push('Model is required');
  if (!vehicle.year) errors.push('Year is required');
  
  // Basic validation
  if (vehicle.year && (isNaN(Number(vehicle.year)) || Number(vehicle.year) < 1900 || Number(vehicle.year) > new Date().getFullYear() + 1)) {
    errors.push('Year must be a valid year');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

// Process iCloud links
function processICloudLink(vehicle: VehicleImport): VehicleImport {
  // If no iCloud link, return vehicle as is
  if (!vehicle.icloud_album_link) return vehicle;
  
  // If no folder ID provided, generate one
  if (!vehicle.icloud_folder_id) {
    vehicle.icloud_folder_id = `${vehicle.make}${vehicle.model}${vehicle.year}_FOLDER`.toUpperCase();
  }
  
  return vehicle;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }
  
  try {
    // Initialize Supabase client with service role for admin access
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );
    
    // Initialize Supabase client with the user's auth token
    const authHeader = req.headers.get('Authorization')!;
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: {
            Authorization: authHeader,
          },
        },
      }
    );
    
    // Get the current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    
    if (userError || !user) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Unauthorized' 
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 401 
        }
      );
    }
    
    // Parse the request body
    const { vehicles } = await req.json();
    
    if (!vehicles || !Array.isArray(vehicles) || vehicles.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Invalid request: No vehicles provided' 
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400 
        }
      );
    }
    
    // Process each vehicle
    const results = [];
    const errors = [];
    
    for (const vehicle of vehicles) {
      // Validate vehicle data
      const validation = validateVehicle(vehicle);
      
      if (!validation.isValid) {
        errors.push({
          vehicle,
          errors: validation.errors
        });
        continue;
      }
      
      // Process iCloud link information
      const processedVehicle = processICloudLink(vehicle);
      
      // Add user_id to the vehicle
      const vehicleWithUser = {
        ...processedVehicle,
        user_id: user.id
      };
      
      // Insert the vehicle into the cars table
      const { data, error } = await supabase
        .from('cars')
        .upsert(vehicleWithUser)
        .select('id')
        .single();
      
      if (error) {
        errors.push({
          vehicle: processedVehicle,
          error: error.message
        });
        continue;
      }
      
      const vehicleId = data.id;
      
      // Process iCloud images if link is provided
      if (processedVehicle.icloud_album_link) {
        // In a production environment, you might:
        // 1. Fetch the shared album data
        // 2. Process the images
        // 3. Store references in the car_images table
        
        // For now, we'll just log that we would process the iCloud album
        console.log(`Processing iCloud album for vehicle ${vehicleId}: ${processedVehicle.icloud_album_link}`);
        
        // Add a record in the car_images table to indicate iCloud source
        await supabase
          .from('car_images')
          .insert({
            car_id: vehicleId,
            file_path: processedVehicle.icloud_album_link,
            file_name: 'icloud_album',
            source: 'icloud',
            user_id: user.id
          });
      }
      
      results.push({
        id: vehicleId,
        make: processedVehicle.make,
        model: processedVehicle.model,
        year: processedVehicle.year
      });
    }
    
    return new Response(
      JSON.stringify({
        success: true,
        imported: results.length,
        results,
        errors: errors.length > 0 ? errors : undefined
      }),
      { 
        headers: { 
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    );
    
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});
