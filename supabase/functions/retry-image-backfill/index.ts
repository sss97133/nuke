import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Find vehicles with image URLs but no actual images
    const { data: vehicles, error } = await supabase
      .from('vehicles')
      .select('id, origin_metadata')
      .not('origin_metadata->image_urls', 'is', null);

    if (error) throw error;

    const results = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      vehicles_fixed: [] as string[]
    };

    for (const vehicle of vehicles || []) {
      const imageUrls = vehicle.origin_metadata?.image_urls;
      if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) continue;

      // Check if vehicle already has images
      const { count: imageCount } = await supabase
        .from('vehicle_images')
        .select('id', { count: 'exact', head: true })
        .eq('vehicle_id', vehicle.id);

      if (imageCount && imageCount > 0) continue; // Already has images

      console.log(`Retrying backfill for vehicle ${vehicle.id} with ${imageUrls.length} image URLs`);

      try {
        // Call backfill-images
        const backfillResponse = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/backfill-images`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
            },
            body: JSON.stringify({
              vehicle_id: vehicle.id,
              image_urls: imageUrls,
              source: 'retry_backfill',
              run_analysis: false
            })
          }
        );

        if (backfillResponse.ok) {
          const result = await backfillResponse.json();
          console.log(`✅ Vehicle ${vehicle.id}: ${result.uploaded || 0} images uploaded`);
          results.succeeded++;
          results.vehicles_fixed.push(vehicle.id);

          // Re-validate vehicle after images are added
          const { data: validation } = await supabase.rpc('validate_vehicle_before_public', {
            p_vehicle_id: vehicle.id
          });

          if (validation?.can_go_live) {
            await supabase
              .from('vehicles')
              .update({ status: 'active', is_public: true })
              .eq('id', vehicle.id);
            console.log(`✅ Vehicle ${vehicle.id} now public`);
          }
        } else {
          console.error(`❌ Backfill failed for ${vehicle.id}: ${backfillResponse.status}`);
          results.failed++;
        }
      } catch (err) {
        console.error(`❌ Error processing ${vehicle.id}:`, err);
        results.failed++;
      }

      results.processed++;
    }

    return new Response(JSON.stringify({
      success: true,
      ...results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Retry backfill error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

