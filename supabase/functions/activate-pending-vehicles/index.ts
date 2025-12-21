import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { batch_size = 100 } = await req.json().catch(() => ({}));

    console.log('🔓 Activating pending vehicles...');

    // Find pending vehicles that should be activated
    // Criteria: has images, basic info (make/model/year), and from trusted sources
    const { data: pendingVehicles, error: findError } = await supabase
      .from('vehicles')
      .select('id, make, model, year, discovery_source, bat_auction_url, discovery_url, created_at')
      .eq('status', 'pending')
      .eq('is_public', false)
      .not('make', 'is', null)
      .not('model', 'is', null)
      .not('year', 'is', null)
      .limit(batch_size);

    if (findError) {
      console.error('Error finding pending vehicles:', findError);
      return new Response(
        JSON.stringify({ error: findError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!pendingVehicles || pendingVehicles.length === 0) {
      return new Response(
        JSON.stringify({ activated: 0, message: 'No pending vehicles found' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${pendingVehicles.length} pending vehicles to check`);

    // Check which ones have images (process in chunks to avoid URL length limits)
    const vehicleIds = pendingVehicles.map(v => v.id);
    const vehiclesWithImageSet = new Set<string>();
    
    // Process in chunks of 50 to avoid URL length limits
    for (let i = 0; i < vehicleIds.length; i += 50) {
      const chunk = vehicleIds.slice(i, i + 50);
      const { data: chunkImages, error: imagesError } = await supabase
        .from('vehicle_images')
        .select('vehicle_id')
        .in('vehicle_id', chunk);
      
      if (imagesError) {
        console.error('Error checking images chunk:', imagesError);
        continue;
      }
      
      if (chunkImages) {
        chunkImages.forEach(img => vehiclesWithImageSet.add(img.vehicle_id));
      }
    }

    if (imagesError) {
      console.error('Error checking images:', imagesError);
      return new Response(
        JSON.stringify({ error: imagesError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }


    // Activate vehicles that have images and are from trusted sources
    // For trusted auction sources, we bypass VIN requirement (many auctions don't show VINs)
    const toActivate = pendingVehicles.filter(v => {
      const hasImages = vehiclesWithImageSet.has(v.id);
      const isTrustedSource = 
        v.bat_auction_url !== null ||
        v.discovery_source === 'carsandbids' ||
        v.discovery_source === 'mecum' ||
        v.discovery_source === 'barrett-jackson' ||
        v.discovery_source === 'russo_steele' ||
        v.discovery_source === 'classic.com' ||
        (v.discovery_url && (
          v.discovery_url.includes('bringatrailer.com') ||
          v.discovery_url.includes('carsandbids.com') ||
          v.discovery_url.includes('mecum.com') ||
          v.discovery_url.includes('barrett-jackson.com') ||
          v.discovery_url.includes('classic.com')
        ));

      return hasImages && isTrustedSource;
    });

    if (toActivate.length === 0) {
      return new Response(
        JSON.stringify({ 
          activated: 0, 
          checked: pendingVehicles.length,
          message: 'No vehicles met activation criteria (need images + trusted source)' 
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const activateIds = toActivate.map(v => v.id);

    // For trusted auction sources, set placeholder VINs if missing
    // Process in chunks to avoid URL limits
    for (let i = 0; i < activateIds.length; i += 50) {
      const chunk = activateIds.slice(i, i + 50);
      const { data: vehiclesNeedingVin, error: vinCheckError } = await supabase
        .from('vehicles')
        .select('id, vin')
        .in('id', chunk)
        .or('vin.is.null,vin.eq.');

      if (!vinCheckError && vehiclesNeedingVin && vehiclesNeedingVin.length > 0) {
        // Set temporary placeholder VINs (will be backfilled later)
        const tempVinIds = vehiclesNeedingVin.map(v => v.id);
        await supabase
          .from('vehicles')
          .update({ vin: `TEMP-AUCTION-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` })
          .in('id', tempVinIds);
      }
    }

    // Activate them (now they have VINs, so trigger won't block)
    const { error: updateError } = await supabase
      .from('vehicles')
      .update({
        status: 'active',
        is_public: true
      })
      .in('id', activateIds);

    if (updateError) {
      console.error('Error activating vehicles:', updateError);
      return new Response(
        JSON.stringify({ error: updateError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`✅ Activated ${activateIds.length} vehicles`);

    return new Response(
      JSON.stringify({ 
        activated: activateIds.length,
        checked: pendingVehicles.length,
        vehicle_ids: activateIds
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

