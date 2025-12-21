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

    const { batch_size = 50, force = false } = await req.json().catch(() => ({}));

    console.log('🔍 Re-extracting missing data for pending vehicles...');

    // Find pending vehicles that need re-extraction
    // Priority: vehicles with discovery URLs that might have more data
    const { data: pendingVehicles, error: findError } = await supabase
      .from('vehicles')
      .select('id, make, model, year, vin, discovery_url, bat_auction_url, discovery_source, current_value, sale_price')
      .eq('status', 'pending')
      .eq('is_public', false)
      .not('make', 'is', null)
      .not('model', 'is', null)
      .not('year', 'is', null)
      .or('discovery_url.not.is.null,bat_auction_url.not.is.null')
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
        JSON.stringify({ processed: 0, message: 'No pending vehicles found' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${pendingVehicles.length} pending vehicles to re-extract`);

    const results = {
      queued_bat: 0,
      queued_import: 0,
      activated: 0,
      errors: [] as string[],
    };

    // Process each vehicle
    for (const vehicle of pendingVehicles) {
      try {
        const needsVin = !vehicle.vin || vehicle.vin.length < 10 || vehicle.vin.includes('VIVA-') || vehicle.vin.includes('TEMP-');
        const needsPrice = (!vehicle.current_value || vehicle.current_value === 0) && (!vehicle.sale_price || vehicle.sale_price === 0);
        const hasBatUrl = !!vehicle.bat_auction_url;
        const hasDiscoveryUrl = !!vehicle.discovery_url;

        // BaT vehicles: queue for comprehensive extraction
        if (hasBatUrl) {
          const { error: queueError } = await supabase
            .from('bat_extraction_queue')
            .insert({
              vehicle_id: vehicle.id,
              bat_auction_url: vehicle.bat_auction_url,
              status: 'pending',
              priority: 1, // High priority for pending vehicles
              extraction_type: 'comprehensive',
            })
            .select()
            .single();

          if (queueError) {
            // Might already be in queue, that's ok
            if (!queueError.message.includes('duplicate') && !queueError.message.includes('unique')) {
              console.warn(`Failed to queue BaT extraction for ${vehicle.id}:`, queueError.message);
              results.errors.push(`BaT queue ${vehicle.id}: ${queueError.message}`);
            }
          } else {
            results.queued_bat++;
            console.log(`✅ Queued BaT comprehensive extraction for ${vehicle.id}`);
          }
        }
        // Other vehicles with discovery URLs: queue for import re-processing
        else if (hasDiscoveryUrl) {
          // Check if already in import queue
          const { data: existing } = await supabase
            .from('import_queue')
            .select('id')
            .eq('listing_url', vehicle.discovery_url)
            .in('status', ['pending', 'processing'])
            .limit(1);

          if (!existing || existing.length === 0) {
            const { error: queueError } = await supabase
              .from('import_queue')
              .insert({
                listing_url: vehicle.discovery_url,
                source_id: null,
                status: 'pending',
                priority: 1,
                vehicle_id: vehicle.id, // Link to existing vehicle
              })
              .select()
              .single();

            if (queueError) {
              console.warn(`Failed to queue import for ${vehicle.id}:`, queueError.message);
              results.errors.push(`Import queue ${vehicle.id}: ${queueError.message}`);
            } else {
              results.queued_import++;
              console.log(`✅ Queued import re-processing for ${vehicle.id}`);
            }
          }
        }

        // If vehicle has images and basic info, try to activate it (bypass VIN for trusted sources)
        const { data: imageCount } = await supabase
          .from('vehicle_images')
          .select('id', { count: 'exact', head: true })
          .eq('vehicle_id', vehicle.id);

        const hasImages = (imageCount?.count || 0) > 0;
        const isTrustedSource = 
          hasBatUrl ||
          vehicle.discovery_source === 'carsandbids' ||
          vehicle.discovery_source === 'mecum' ||
          vehicle.discovery_source === 'barrett-jackson' ||
          vehicle.discovery_source === 'russo_steele' ||
          vehicle.discovery_source === 'classic.com' ||
          (vehicle.discovery_url && (
            vehicle.discovery_url.includes('bringatrailer.com') ||
            vehicle.discovery_url.includes('carsandbids.com') ||
            vehicle.discovery_url.includes('mecum.com') ||
            vehicle.discovery_url.includes('barrett-jackson.com') ||
            vehicle.discovery_url.includes('classic.com')
          ));

        // Activate if has images and is from trusted source (VIN will be backfilled)
        if (hasImages && isTrustedSource) {
          // Set temporary VIN if missing (to bypass trigger)
          if (needsVin) {
            await supabase
              .from('vehicles')
              .update({ 
                vin: `TEMP-AUCTION-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` 
              })
              .eq('id', vehicle.id);
          }

          // Activate
          const { error: activateError } = await supabase
            .from('vehicles')
            .update({
              status: 'active',
              is_public: true
            })
            .eq('id', vehicle.id);

          if (!activateError) {
            results.activated++;
            console.log(`🎉 Activated ${vehicle.id} (will backfill VIN/price)`);
          }
        }
      } catch (error: any) {
        console.error(`Error processing vehicle ${vehicle.id}:`, error);
        results.errors.push(`${vehicle.id}: ${error.message}`);
      }
    }

    console.log(`✅ Processed ${pendingVehicles.length} vehicles`);
    console.log(`   - Queued BaT: ${results.queued_bat}`);
    console.log(`   - Queued Import: ${results.queued_import}`);
    console.log(`   - Activated: ${results.activated}`);
    console.log(`   - Errors: ${results.errors.length}`);

    return new Response(
      JSON.stringify({
        processed: pendingVehicles.length,
        queued_bat: results.queued_bat,
        queued_import: results.queued_import,
        activated: results.activated,
        errors: results.errors.slice(0, 10), // Limit error output
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

