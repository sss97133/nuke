// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"

import { serve, createClient, Request, Response } from "../deps.ts";

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

interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

interface ImportError {
  vehicle: VehicleImport;
  error: string;
}

interface ImportResult {
  vehicle: VehicleImport;
  id: string;
  success: boolean;
}

// CORS headers for cross-origin requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper function to validate a vehicle record
function validateVehicle(vehicle: Partial<VehicleImport>): ValidationResult {
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

// Add this function before the main handler
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

serve(async (req: Request): Promise<Response> => {
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
    const body = await req.json();
    
    let vehicles: Partial<VehicleImport>[] = [];
    
    // Handle file upload
    if (body.data && body.fileType) {
      try {
        // For now, we'll just handle CSV files
        if (body.fileType === 'csv') {
          const rows = body.data.split('\n').map((row: string) => row.split(','));
          const headers = rows[0];
          
          vehicles = rows.slice(1).map((row: string[]) => {
            const vehicle: Partial<VehicleImport> = {};
            headers.forEach((header: string, index: number) => {
              vehicle[header.trim() as keyof VehicleImport] = row[index]?.trim();
            });
            return vehicle;
          });
        } else {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: `Unsupported file type: ${body.fileType}` 
            }),
            { 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 400 
            }
          );
        }
      } catch (error) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: error instanceof Error ? error.message : 'An unknown error occurred processing file'
          }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400 
          }
        );
      }
    } else if (body.vehicles) {
      vehicles = body.vehicles;
    } else {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Invalid request: No vehicles or file data provided' 
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400 
        }
      );
    }
    
    if (!Array.isArray(vehicles) || vehicles.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Invalid request: No vehicles found in the data' 
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400 
        }
      );
    }
    
    // Process each vehicle
    const results: ImportResult[] = [];
    const errors: ImportError[] = [];
    
    for (const vehicle of vehicles) {
      // Validate vehicle data
      const validation = validateVehicle(vehicle);
      
      if (!validation.isValid) {
        errors.push({
          vehicle: vehicle as VehicleImport,
          error: validation.errors.join(', ')
        });
        continue;
      }
      
      // Process iCloud link information
      const processedVehicle = processICloudLink(vehicle as VehicleImport);
      
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
      
      results.push({
        vehicle: processedVehicle,
        id: data.id,
        success: true
      });
    }
    
    // Return results
    return new Response(
      JSON.stringify({
        success: errors.length === 0,
        results,
        errors
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: errors.length > 0 ? 207 : 200 // Use 207 Multi-Status if there are partial failures
      }
    );
  } catch (error) {
    console.error('Error processing vehicle import:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'An unknown error occurred'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});
