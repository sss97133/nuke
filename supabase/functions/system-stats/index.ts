import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    // Get all stats
    const { count: totalImages } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true });

    const { count: analyzedImages } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .eq('ai_processing_status', 'completed');

    const { count: pendingImages } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .eq('ai_processing_status', 'pending');

    const { count: totalParts } = await supabase
      .from('catalog_parts')
      .select('*', { count: 'exact', head: true });

    const { count: totalVehicles } = await supabase
      .from('vehicles')
      .select('*', { count: 'exact', head: true });

    const { count: activeVehicles } = await supabase
      .from('vehicles')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');

    const stats = {
      timestamp: new Date().toISOString(),
      images: {
        total: totalImages || 0,
        analyzed: analyzedImages || 0,
        pending: pendingImages || 0,
        percent: ((analyzedImages || 0) / (totalImages || 1) * 100).toFixed(1)
      },
      catalog: {
        total_parts: totalParts || 0
      },
      vehicles: {
        total: totalVehicles || 0,
        active: activeVehicles || 0
      }
    };

    return new Response(JSON.stringify(stats, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

