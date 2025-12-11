/**
 * Analyze and Source Missing Data for Pending Vehicles
 * 
 * For admins: Analyzes what each pending vehicle needs and sources it automatically
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AnalyzeRequest {
  vehicle_id?: string;
  batch_size?: number;
  auto_source?: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body: AnalyzeRequest = await req.json().catch(() => ({}));
    const { vehicle_id, batch_size = 10, auto_source = false } = body;

    // Get pending vehicles
    let query = supabase
      .from('vehicles')
      .select(`
        id,
        year,
        make,
        model,
        vin,
        mileage,
        color,
        description,
        asking_price,
        current_value,
        discovery_url,
        origin_metadata,
        created_at,
        updated_at
      `)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (vehicle_id) {
      query = query.eq('id', vehicle_id);
    } else {
      query = query.limit(batch_size);
    }

    const { data: vehicles, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch vehicles: ${error.message}`);
    }

    if (!vehicles || vehicles.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No pending vehicles found',
        vehicles: [],
        needs_analysis: []
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Analyze what each vehicle needs
    const needsAnalysis = await Promise.all(
      vehicles.map(async (vehicle) => {
        const needs: string[] = [];
        const priorities: { [key: string]: number } = {};
        const sources: { [key: string]: string[] } = {};

        // Check for missing VIN
        if (!vehicle.vin) {
          needs.push('vin');
          priorities['vin'] = 1; // Highest priority
          if (vehicle.discovery_url) {
            sources['vin'] = ['discovery_url', 'image_ocr'];
          } else {
            sources['vin'] = ['image_ocr'];
          }
        }

        // Check for missing images
        const { data: images } = await supabase
          .from('vehicle_images')
          .select('id')
          .eq('vehicle_id', vehicle.id)
          .limit(1);

        const hasImages = (images && images.length > 0);
        const storedImageUrls = vehicle.origin_metadata?.image_urls || [];
        const hasStoredUrls = Array.isArray(storedImageUrls) && storedImageUrls.length > 0;

        if (!hasImages && hasStoredUrls) {
          needs.push('images');
          priorities['images'] = 2;
          sources['images'] = ['origin_metadata'];
        } else if (!hasImages && vehicle.discovery_url) {
          needs.push('images');
          priorities['images'] = 2;
          sources['images'] = ['discovery_url'];
        }

        // Check for missing description
        if (!vehicle.description || vehicle.description.trim().length < 10) {
          needs.push('description');
          priorities['description'] = 3;
          if (vehicle.discovery_url) {
            sources['description'] = ['discovery_url'];
          }
        }

        // Check for missing price
        if (!vehicle.asking_price && !vehicle.current_value) {
          needs.push('price');
          priorities['price'] = 4;
          if (vehicle.discovery_url) {
            sources['price'] = ['discovery_url'];
          }
        }

        // Check for missing mileage
        if (!vehicle.mileage) {
          needs.push('mileage');
          priorities['mileage'] = 5;
          if (vehicle.discovery_url) {
            sources['mileage'] = ['discovery_url'];
          }
        }

        // Check for missing color
        if (!vehicle.color) {
          needs.push('color');
          priorities['color'] = 6;
          if (vehicle.discovery_url) {
            sources['color'] = ['discovery_url', 'image_analysis'];
          }
        }

        // Sort needs by priority
        const sortedNeeds = needs.sort((a, b) => (priorities[a] || 99) - (priorities[b] || 99));

        return {
          vehicle_id: vehicle.id,
          vehicle_name: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
          discovery_url: vehicle.discovery_url,
          needs: sortedNeeds,
          priorities,
          sources,
          can_source: vehicle.discovery_url ? true : (hasStoredUrls ? true : false)
        };
      })
    );

    // If auto_source is enabled, source the missing data
    const sourcingResults = [];
    if (auto_source) {
      for (const analysis of needsAnalysis) {
        if (!analysis.can_source) {
          sourcingResults.push({
            vehicle_id: analysis.vehicle_id,
            status: 'skipped',
            reason: 'no_source_url'
          });
          continue;
        }

        try {
          const result = await sourceMissingData(supabase, analysis);
          sourcingResults.push(result);
        } catch (error: any) {
          sourcingResults.push({
            vehicle_id: analysis.vehicle_id,
            status: 'failed',
            error: error.message
          });
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      vehicles_analyzed: vehicles.length,
      needs_analysis: needsAnalysis,
      sourcing_results: auto_source ? sourcingResults : null,
      summary: {
        total_pending: vehicles.length,
        missing_vin: needsAnalysis.filter(a => a.needs.includes('vin')).length,
        missing_images: needsAnalysis.filter(a => a.needs.includes('images')).length,
        missing_description: needsAnalysis.filter(a => a.needs.includes('description')).length,
        missing_price: needsAnalysis.filter(a => a.needs.includes('price')).length,
        missing_mileage: needsAnalysis.filter(a => a.needs.includes('mileage')).length,
        missing_color: needsAnalysis.filter(a => a.needs.includes('color')).length
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('Analyze error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

/**
 * Source missing data for a vehicle
 */
async function sourceMissingData(supabase: any, analysis: any) {
  const { vehicle_id, discovery_url, needs, sources } = analysis;
  
  console.log(`Sourcing data for vehicle ${vehicle_id}: ${needs.join(', ')}`);

  const results: any = {
    vehicle_id,
    sourced_fields: [],
    failed_fields: []
  };

  // If we have a discovery URL, scrape it
  if (discovery_url) {
    try {
      const { data: scrapedData, error: scrapeError } = await supabase.functions.invoke('scrape-vehicle', {
        body: { url: discovery_url }
      });

      if (!scrapeError && scrapedData) {
        const updates: any = {};

        // Source VIN
        if (needs.includes('vin') && scrapedData.vin) {
          updates.vin = scrapedData.vin;
          results.sourced_fields.push('vin');
        }

        // Source description
        if (needs.includes('description') && scrapedData.description) {
          updates.description = scrapedData.description;
          results.sourced_fields.push('description');
        }

        // Source price
        if (needs.includes('price') && (scrapedData.price || scrapedData.asking_price)) {
          updates.asking_price = scrapedData.price || scrapedData.asking_price;
          results.sourced_fields.push('price');
        }

        // Source mileage
        if (needs.includes('mileage') && scrapedData.mileage) {
          updates.mileage = scrapedData.mileage;
          results.sourced_fields.push('mileage');
        }

        // Source color
        if (needs.includes('color') && scrapedData.color) {
          updates.color = scrapedData.color;
          results.sourced_fields.push('color');
        }

        // Update vehicle if we have any updates
        if (Object.keys(updates).length > 0) {
          const { error: updateError } = await supabase
            .from('vehicles')
            .update(updates)
            .eq('id', vehicle_id);

          if (updateError) {
            throw new Error(`Update failed: ${updateError.message}`);
          }
        }

        // Source images if needed
        if (needs.includes('images')) {
          const imageUrls = scrapedData.images || scrapedData.data?.images || [];
          if (imageUrls.length > 0) {
            // Call backfill-images function
            const { data: backfillResult, error: backfillError } = await supabase.functions.invoke('backfill-images', {
              body: {
                vehicle_id,
                image_urls: imageUrls,
                source: 'pending_vehicle_sourcing',
                run_analysis: false
              }
            });

            if (!backfillError && backfillResult) {
              results.sourced_fields.push('images');
              results.images_imported = backfillResult.uploaded || 0;
            } else {
              results.failed_fields.push('images');
            }
          }
        }
      }
    } catch (error: any) {
      results.error = error.message;
      results.status = 'partial';
    }
  }

  // Check if we have stored image URLs in origin_metadata
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('origin_metadata')
    .eq('id', vehicle_id)
    .single();

  if (needs.includes('images') && vehicle?.origin_metadata?.image_urls) {
    const imageUrls = vehicle.origin_metadata.image_urls;
    if (Array.isArray(imageUrls) && imageUrls.length > 0) {
      try {
        const { data: backfillResult, error: backfillError } = await supabase.functions.invoke('backfill-images', {
          body: {
            vehicle_id,
            image_urls: imageUrls,
            source: 'origin_metadata',
            run_analysis: false
          }
        });

        if (!backfillError && backfillResult) {
          if (!results.sourced_fields.includes('images')) {
            results.sourced_fields.push('images');
          }
          results.images_imported = (results.images_imported || 0) + (backfillResult.uploaded || 0);
        }
      } catch (error: any) {
        if (!results.failed_fields.includes('images')) {
          results.failed_fields.push('images');
        }
      }
    }
  }

  results.status = results.failed_fields.length === 0 ? 'success' : 
                   results.sourced_fields.length > 0 ? 'partial' : 'failed';

  return results;
}

