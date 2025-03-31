import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface VehicleData {
  id: string;
  make: string;
  model: string;
  year: number;
  condition: string;
  mileage: number;
}

interface RequestEvent {
  request: Request;
  method: string;
  json(): Promise<{ vehicleData: VehicleData }>;
}

serve(async (req: RequestEvent) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { vehicleData } = await req.json() as { vehicleData: VehicleData };

    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    // Calculate probability based on vehicle data
    const probability = await calculateProbability(vehicleData);

    return new Response(
      JSON.stringify({ probability }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});

async function calculateProbability(vehicleData: VehicleData): Promise<number> {
  // Implement probability calculation logic here
  // This is a placeholder implementation
  const baseScore = 0.5;
  const yearFactor = (new Date().getFullYear() - vehicleData.year) * 0.01;
  const conditionFactor = vehicleData.condition === 'excellent' ? 0.2 : 0.1;
  const mileageFactor = vehicleData.mileage > 100000 ? -0.1 : 0;

  return Math.min(Math.max(baseScore - yearFactor + conditionFactor - mileageFactor, 0), 1);
}
