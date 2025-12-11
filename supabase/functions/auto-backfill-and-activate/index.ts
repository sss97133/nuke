/**
 * AUTO-BACKFILL AND ACTIVATE
 * 
 * Automatically backfills missing data for pending vehicles and activates them.
 * Runs after vehicles are created to ensure they go live in seconds.
 */

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

    const body = await req.json().catch(() => ({}));
    const { batch_size = 50, vehicle_ids } = body;

    // Get pending vehicles that need backfilling
    let query = supabase
      .from('vehicles')
      .select('id, discovery_url, year, make, model, description, asking_price, vin, mileage, color, image_count, status, is_public')
      .eq('status', 'pending')
      .is('is_public', false);

    if (vehicle_ids && vehicle_ids.length > 0) {
      query = query.in('id', vehicle_ids);
    } else {
      query = query.limit(batch_size);
    }

    const { data: pendingVehicles, error: fetchError } = await query;

    if (fetchError) {
      throw new Error(`Failed to fetch pending vehicles: ${fetchError.message}`);
    }

    if (!pendingVehicles || pendingVehicles.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No pending vehicles to process',
        processed: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`🔄 Auto-backfilling ${pendingVehicles.length} pending vehicles...`);

    const results = {
      processed: 0,
      backfilled: 0,
      activated: 0,
      failed: 0,
      vehicles_activated: [] as string[]
    };

    for (const vehicle of pendingVehicles) {
      try {
        console.log(`Processing vehicle ${vehicle.id} (${vehicle.year} ${vehicle.make} ${vehicle.model})`);
        
        const listingUrl = vehicle.discovery_url;
        if (!listingUrl) {
          console.warn(`Skipping ${vehicle.id}: No discovery_url`);
          results.failed++;
          continue;
        }

        let needsBackfill = false;
        const updates: any = {};

        // Check what's missing
        if (!vehicle.description || vehicle.description.length < 50) {
          needsBackfill = true;
        }
        if (!vehicle.asking_price) {
          needsBackfill = true;
        }
        if (!vehicle.image_count || vehicle.image_count === 0) {
          needsBackfill = true;
        }
        if (!vehicle.vin) {
          needsBackfill = true;
        }

        // Step 1: Use AI extraction to get missing data
        if (needsBackfill) {
          console.log(`  🔍 Extracting data from ${listingUrl}`);
          
          const { data: extractedData, error: extractError } = await supabase.functions.invoke('extract-vehicle-data-ai', {
            body: { url: listingUrl }
          });

          if (extractError || !extractedData?.success) {
            console.warn(`  ⚠️  Extraction failed: ${extractError?.message || 'Unknown error'}`);
          } else {
            const aiData = extractedData.data;
            
            // Backfill missing fields
            if ((!vehicle.description || vehicle.description.length < 50) && aiData.description) {
              updates.description = aiData.description;
              console.log(`  ✅ Backfilled description`);
            }
            
            if (!vehicle.asking_price && aiData.asking_price) {
              updates.asking_price = aiData.asking_price;
              console.log(`  ✅ Backfilled price: $${aiData.asking_price}`);
            }
            
            if (!vehicle.vin && aiData.vin && aiData.vin.length === 17) {
              updates.vin = aiData.vin;
              console.log(`  ✅ Backfilled VIN`);
            }
            
            if (!vehicle.mileage && aiData.mileage) {
              updates.mileage = aiData.mileage;
              console.log(`  ✅ Backfilled mileage`);
            }
            
            if (!vehicle.color && aiData.color) {
              updates.color = aiData.color;
              console.log(`  ✅ Backfilled color`);
            }

            // Backfill images if missing
            if ((!vehicle.image_count || vehicle.image_count === 0) && aiData.images && aiData.images.length > 0) {
              console.log(`  🖼️  Backfilling ${aiData.images.length} images...`);
              
              const { data: backfillResult, error: backfillError } = await supabase.functions.invoke('backfill-images', {
                body: {
                  vehicle_id: vehicle.id,
                  image_urls: aiData.images,
                  source: 'auto_backfill',
                  run_analysis: false
                }
              });

              if (!backfillError && backfillResult?.uploaded) {
                updates.image_count = (vehicle.image_count || 0) + backfillResult.uploaded;
                console.log(`  ✅ Backfilled ${backfillResult.uploaded} images`);
              }
            }
          }
        }

        // Step 2: Update vehicle with backfilled data
        if (Object.keys(updates).length > 0) {
          const { error: updateError } = await supabase
            .from('vehicles')
            .update(updates)
            .eq('id', vehicle.id);

          if (updateError) {
            throw new Error(`Failed to update: ${updateError.message}`);
          }
          
          results.backfilled++;
          console.log(`  ✅ Vehicle ${vehicle.id} backfilled`);
        }

        // Step 3: Validate and activate if ready
        console.log(`  🔍 Validating vehicle for activation...`);
        
        const { data: validationResult, error: validationError } = await supabase.rpc(
          'validate_vehicle_before_public',
          { p_vehicle_id: vehicle.id }
        );

        if (validationError) {
          console.warn(`  ⚠️  Validation error: ${validationError.message}`);
        } else if (validationResult && validationResult.can_go_live) {
          // Activate the vehicle
          const { error: activateError } = await supabase
            .from('vehicles')
            .update({ 
              status: 'active', 
              is_public: true 
            })
            .eq('id', vehicle.id);

          if (activateError) {
            console.warn(`  ⚠️  Activation error: ${activateError.message}`);
          } else {
            results.activated++;
            results.vehicles_activated.push(vehicle.id);
            console.log(`  🎉 Vehicle ${vehicle.id} ACTIVATED and LIVE!`);
          }
        } else {
          const reason = validationResult?.recommendation || 'Unknown reason';
          console.log(`  ⚠️  Vehicle not ready: ${reason}`);
        }

        results.processed++;

      } catch (error: any) {
        console.error(`❌ Error processing vehicle ${vehicle.id}:`, error.message);
        results.failed++;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      message: 'Auto-backfill and activation complete',
      ...results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('Auto-backfill error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

