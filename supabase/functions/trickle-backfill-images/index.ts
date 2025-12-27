import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Trickle Backfill Images
 * 
 * Backfills images for vehicles that have image URLs stored in origin_metadata
 * but no actual images in vehicle_images table.
 * 
 * Strategy:
 * - Find vehicles with image_urls in origin_metadata but no images
 * - Process in batches to avoid overwhelming the system
 * - Uses existing backfill-images function for actual download/upload
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TrickleRequest {
  batch_size?: number;
  limit?: number;
  organization_id?: string; // Optional: only backfill for specific org
  max_images_per_vehicle?: number; // Limit images per vehicle
  dry_run?: boolean;
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      batch_size = 10,
      limit = 100,
      organization_id,
      max_images_per_vehicle = 20, // Limit to avoid overwhelming storage
      dry_run = false,
    }: TrickleRequest = await req.json().catch(() => ({}));

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    console.log(`\n🖼️  TRICKLE BACKFILL IMAGES`);
    console.log('='.repeat(70));
    console.log(`Batch size: ${batch_size}`);
    console.log(`Limit: ${limit}`);
    console.log(`Organization ID: ${organization_id || 'all'}`);
    console.log(`Max images per vehicle: ${max_images_per_vehicle}`);
    console.log(`Dry run: ${dry_run}\n`);

    // Step 1: Find vehicles with image URLs but no images
    let query = supabase
      .from('vehicles')
      .select(`
        id,
        year,
        make,
        model,
        origin_metadata,
        (
          SELECT COUNT(*)
          FROM vehicle_images
          WHERE vehicle_id = vehicles.id
        ) as image_count
      `)
      .not('origin_metadata->image_urls', 'is', null)
      .eq('is_public', true)
      .limit(limit);

    // Filter by organization if provided
    if (organization_id) {
      // First get vehicle IDs for this organization
      const { data: orgVehicles, error: orgVehiclesError } = await supabase
        .from('organization_vehicles')
        .select('vehicle_id')
        .eq('organization_id', organization_id);
      
      if (orgVehiclesError) {
        throw new Error(`Failed to fetch organization vehicles: ${orgVehiclesError.message}`);
      }
      
      if (!orgVehicles || orgVehicles.length === 0) {
        return new Response(
          JSON.stringify({
            success: true,
            message: 'No vehicles found for this organization',
            processed: 0,
            results: [],
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      const vehicleIds = orgVehicles.map((ov: any) => ov.vehicle_id);
      
      query = supabase
        .from('vehicles')
        .select(`
          id,
          year,
          make,
          model,
          origin_metadata,
          (
            SELECT COUNT(*)
            FROM vehicle_images
            WHERE vehicle_id = vehicles.id
          ) as image_count
        `)
        .eq('is_public', true)
        .not('origin_metadata->image_urls', 'is', null)
        .in('id', vehicleIds)
        .limit(limit);
    }

    const { data: vehicles, error: vehiclesError } = await query;

    if (vehiclesError) {
      throw new Error(`Failed to fetch vehicles: ${vehiclesError.message}`);
    }

    if (!vehicles || vehicles.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No vehicles found with image URLs to backfill',
          processed: 0,
          results: [],
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Filter vehicles that actually have image URLs but no images
    const vehiclesNeedingBackfill = vehicles.filter((v: any) => {
      const imageCount = v.image_count || 0;
      if (imageCount > 0) return false; // Already has images
      
      const om = v.origin_metadata || {};
      const imageUrls = om.image_urls || om.images || [];
      return Array.isArray(imageUrls) && imageUrls.length > 0;
    });

    console.log(`📋 Found ${vehiclesNeedingBackfill.length} vehicles needing image backfill\n`);

    if (vehiclesNeedingBackfill.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No vehicles need image backfill',
          processed: 0,
          results: [],
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 2: Process vehicles in batches
    const results = [];
    const batches = [];
    
    for (let i = 0; i < vehiclesNeedingBackfill.length; i += batch_size) {
      batches.push(vehiclesNeedingBackfill.slice(i, i + batch_size));
    }

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx];
      console.log(`\n📦 Processing batch ${batchIdx + 1}/${batches.length} (${batch.length} vehicles)`);

      for (const vehicle of batch) {
        const externalImages = vehicle.external_images || [];
        
        if (!Array.isArray(externalImages) || externalImages.length === 0) {
          console.log(`   ⏭️  Skipping ${vehicle.year} ${vehicle.make} ${vehicle.model} (no external images)`);
          continue;
        }

        const limitedImages = externalImages.slice(0, max_images_per_vehicle);
        const imageUrls = limitedImages.map((img: any) => img.image_url).filter((url: string) => url && url.startsWith('http'));
        const vehicleName = `${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim() || vehicle.id;

        console.log(`   🔍 Processing: ${vehicleName}`);
        console.log(`      External images: ${imageUrls.length} (of ${externalImages.length} total)`);

        if (dry_run) {
          console.log(`      [DRY RUN] Would download/replace ${imageUrls.length} external images`);
          results.push({
            vehicle_id: vehicle.id,
            vehicle_name: vehicleName,
            status: 'dry_run',
            image_urls_count: imageUrls.length,
          });
          continue;
        }

        try {
          // Call backfill-images function to download and replace external URLs
          const backfillUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/backfill-images`;
          const backfillResponse = await fetch(backfillUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${SERVICE_KEY}`,
            },
            body: JSON.stringify({
              vehicle_id: vehicle.id,
              image_urls: imageUrls,
              source: organization_id ? 'organization_import' : 'external_import',
              run_analysis: false,
              max_images: max_images_per_vehicle,
              continue: false,
              sleep_ms: 200,
              max_runtime_ms: 30000,
            }),
          });

          if (backfillResponse.ok) {
            const backfillData = await backfillResponse.json();
            const inserted = backfillData.inserted || 0;
            
            console.log(`      ✅ Downloaded and inserted ${inserted} images`);

            // Delete external image records for the URLs we just processed
            // backfill-images deduplicates by source_url, so it won't re-insert duplicates
            // We delete the external records so they're replaced by the downloaded versions
            try {
              const imageIdsToDelete = limitedImages.map((img: any) => img.id);
              if (imageIdsToDelete.length > 0) {
                const { error: deleteError } = await supabase
                  .from('vehicle_images')
                  .delete()
                  .in('id', imageIdsToDelete)
                  .eq('is_external', true);
                
                if (!deleteError) {
                  console.log(`      🗑️  Deleted ${imageIdsToDelete.length} external image records`);
                }
              }
            } catch (deleteErr: any) {
              console.warn(`      ⚠️  Failed to delete external images (non-blocking): ${deleteErr.message}`);
            }

            results.push({
              vehicle_id: vehicle.id,
              vehicle_name: vehicleName,
              status: 'success',
              image_urls_count: imageUrls.length,
              images_inserted: inserted,
            });
          } else {
            const errorText = await backfillResponse.text();
            console.log(`      ❌ Failed: ${backfillResponse.status} - ${errorText.substring(0, 200)}`);
            
            results.push({
              vehicle_id: vehicle.id,
              vehicle_name: vehicleName,
              status: 'failed',
              image_urls_count: imageUrls.length,
              error: errorText.substring(0, 500),
            });
          }
        } catch (error: any) {
          console.log(`      ❌ Error: ${error.message}`);
          
          results.push({
            vehicle_id: vehicle.id,
            vehicle_name: vehicleName,
            status: 'error',
            image_urls_count: imageUrls.length,
            error: error.message,
          });
        }

        // Small delay between vehicles
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Delay between batches
      if (batchIdx < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Step 3: Summary statistics
    const successful = results.filter(r => r.status === 'success');
    const failed = results.filter(r => r.status === 'failed' || r.status === 'error');
    const totalImagesInserted = successful.reduce((sum, r) => sum + (r.images_inserted || 0), 0);

    console.log(`\n📊 Summary:`);
    console.log(`   - Processed: ${results.length}`);
    console.log(`   - Successful: ${successful.length}`);
    console.log(`   - Failed: ${failed.length}`);
    console.log(`   - Total images inserted: ${totalImagesInserted}\n`);

    return new Response(
      JSON.stringify({
        success: true,
        processed: results.length,
        successful: successful.length,
        failed: failed.length,
        total_images_inserted: totalImagesInserted,
        results: results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Trickle backfill error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        stack: error.stack,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

