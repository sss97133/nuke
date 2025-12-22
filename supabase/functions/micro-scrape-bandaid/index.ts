import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GapAnalysis {
  vehicle_id: string;
  source_url: string | null;
  missing_fields: string[];
  quality_score: number;
  can_improve: boolean;
  recommended_actions: string[];
}

interface QualityThreshold {
  min_score: number; // Minimum score to mark as "complete"
  critical_fields: string[]; // Must have these
  important_fields: string[]; // Should have these
  nice_to_have_fields: string[]; // Bonus points
}

const QUALITY_THRESHOLD: QualityThreshold = {
  min_score: 85, // 85/100 = "complete"
  critical_fields: ['year', 'make', 'model'],
  important_fields: ['vin', 'sale_price', 'description'],
  nice_to_have_fields: ['mileage', 'color', 'transmission'],
};

/**
 * Analyze vehicle for data gaps
 */
async function analyzeGaps(
  supabase: any,
  vehicle: any,
  images: any[],
  qualityScore: number
): Promise<GapAnalysis> {
  const missing: string[] = [];
  const actions: string[] = [];

  // Check critical fields
  for (const field of QUALITY_THRESHOLD.critical_fields) {
    if (!vehicle[field] || vehicle[field] === '') {
      missing.push(field);
    }
  }

  // Check important fields
  for (const field of QUALITY_THRESHOLD.important_fields) {
    if (!vehicle[field] || vehicle[field] === '') {
      missing.push(field);
    }
  }

  // Check images
  const hasImages = images.length > 0;
  const hasStoredImageUrls = vehicle.origin_metadata?.image_urls?.length > 0;

  if (!hasImages && hasStoredImageUrls) {
    missing.push('images_downloaded');
    actions.push('retry-image-backfill');
  } else if (!hasImages && !hasStoredImageUrls && vehicle.discovery_url) {
    missing.push('images_extracted');
    actions.push('extract-images');
  }

  // Determine if we can improve
  const canImprove = 
    missing.length > 0 && 
    vehicle.discovery_url && 
    qualityScore < QUALITY_THRESHOLD.min_score;

  // Recommend actions based on gaps
  if (missing.includes('vin')) {
    actions.push('extract-vin-from-vehicle');
  }
  if (missing.includes('sale_price') && vehicle.discovery_url?.includes('bringatrailer.com')) {
    actions.push('comprehensive-bat-extraction');
  }
  if (missing.includes('description')) {
    actions.push('generate-vehicle-description');
  }

  return {
    vehicle_id: vehicle.id,
    source_url: vehicle.discovery_url,
    missing_fields: missing,
    quality_score: qualityScore,
    can_improve: canImprove,
    recommended_actions: [...new Set(actions)],
  };
}

/**
 * Execute recommended actions
 */
async function executeActions(
  supabase: any,
  gap: GapAnalysis,
  vehicle: any
): Promise<{ executed: number; succeeded: number; failed: number }> {
  const results = { executed: 0, succeeded: 0, failed: 0 };

  for (const action of gap.recommended_actions) {
    try {
      results.executed++;

      switch (action) {
        case 'retry-image-backfill':
          if (vehicle.origin_metadata?.image_urls?.length > 0) {
            const { error } = await supabase.functions.invoke('retry-image-backfill', {
              body: {
                vehicle_ids: [gap.vehicle_id],
                only_missing: true,
              },
            });
            if (!error) results.succeeded++;
            else results.failed++;
          }
          break;

        case 'extract-vin-from-vehicle':
          const { error: vinError } = await supabase.functions.invoke('extract-vin-from-vehicle', {
            body: {
              vehicle_id: gap.vehicle_id,
              notify_if_missing: false,
            },
          });
          if (!vinError) results.succeeded++;
          else results.failed++;
          break;

        case 'comprehensive-bat-extraction':
          if (vehicle.discovery_url?.includes('bringatrailer.com')) {
            const { error: batError } = await supabase.functions.invoke('comprehensive-bat-extraction', {
              body: {
                vehicle_id: gap.vehicle_id,
                bat_url: vehicle.discovery_url,
              },
            });
            if (!batError) results.succeeded++;
            else results.failed++;
          }
          break;

        case 'extract-images':
          if (vehicle.discovery_url) {
            // Try to extract images from source
            const { error: scrapeError } = await supabase.functions.invoke('simple-scraper', {
              body: {
                url: vehicle.discovery_url,
                extract_images: true,
                vehicle_id: gap.vehicle_id,
              },
            });
            if (!scrapeError) results.succeeded++;
            else results.failed++;
          }
          break;

        default:
          console.log(`Unknown action: ${action}`);
      }
    } catch (error: any) {
      console.error(`Action ${action} failed:`, error.message);
      results.failed++;
    }
  }

  return results;
}

/**
 * Main function - finds vehicles with gaps and fills them
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json().catch(() => ({}));
    const batchSize = Number(body?.batch_size || 20);
    const maxRuntimeMs = Number(body?.max_runtime_ms || 30000); // 30 seconds default
    const vehicleIds = Array.isArray(body?.vehicle_ids) ? body.vehicle_ids : [];
    const dryRun = body?.dry_run === true;

    const startTime = Date.now();
    const results = {
      analyzed: 0,
      can_improve: 0,
      actions_executed: 0,
      actions_succeeded: 0,
      actions_failed: 0,
      marked_complete: 0,
      gaps_found: [] as GapAnalysis[],
    };

    // Find vehicles with source URLs but potential gaps
    let query = supabase
      .from('vehicles')
      .select(`
        id,
        year,
        make,
        model,
        vin,
        sale_price,
        description,
        mileage,
        color,
        transmission,
        discovery_url,
        origin_metadata,
        status
      `)
      .not('discovery_url', 'is', null)
      .neq('discovery_url', '');

    if (vehicleIds.length > 0) {
      query = query.in('id', vehicleIds);
    } else {
      // Prioritize: low quality score, recent, has source URL
      query = query
        .order('created_at', { ascending: false })
        .limit(batchSize);
    }

    const { data: vehicles, error: vehiclesError } = await query;

    if (vehiclesError) throw vehiclesError;
    if (!vehicles || vehicles.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No vehicles to process',
        ...results,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Calculate quality scores directly from database entries
    const vehicleIdsList = vehicles.map((v: any) => v.id);
    
    // Get quality scores (or calculate on-the-fly from DB state)
    const { data: qualityScores } = await supabase
      .from('vehicle_quality_scores')
      .select('vehicle_id, overall_score')
      .in('vehicle_id', vehicleIdsList);

    const qualityMap = new Map<string, number>();
    
    // For vehicles without quality scores, calculate from actual DB state
    for (const vehicle of vehicles) {
      const existing = (qualityScores || []).find((qs: any) => qs.vehicle_id === vehicle.id);
      if (existing) {
        qualityMap.set(vehicle.id, existing.overall_score || 0);
      } else {
        // Calculate quality score from actual DB entries
        let score = 0;
        
        // VIN (20 points)
        if (vehicle.vin && vehicle.vin.length >= 10 && !vehicle.vin.startsWith('VIVA-')) {
          score += 20;
        }
        
        // Price (20 points)
        if (vehicle.sale_price > 0) {
          score += 20;
        }
        
        // Images will be counted below
        // Timeline events will be counted below
        
        // Mileage (5 points)
        if (vehicle.mileage) {
          score += 5;
        }
        
        qualityMap.set(vehicle.id, score);
      }
    }

    // Get image counts
    const { data: images } = await supabase
      .from('vehicle_images')
      .select('vehicle_id')
      .in('vehicle_id', vehicleIdsList);

    const imageCountMap = new Map<string, number>();
    (images || []).forEach((img: any) => {
      imageCountMap.set(img.vehicle_id, (imageCountMap.get(img.vehicle_id) || 0) + 1);
    });

    // Analyze each vehicle
    for (const vehicle of vehicles) {
      // Check runtime
      if (Date.now() - startTime > maxRuntimeMs) {
        console.log(`⏱️  Runtime limit reached (${maxRuntimeMs}ms)`);
        break;
      }

      results.analyzed++;

      const qualityScore = qualityMap.get(vehicle.id) || 0;
      const imageCount = imageCountMap.get(vehicle.id) || 0;

      // Skip if already complete
      if (qualityScore >= QUALITY_THRESHOLD.min_score && imageCount > 0) {
        continue;
      }

      // Analyze gaps
      const gap = await analyzeGaps(
        supabase,
        vehicle,
        Array(imageCount).fill({}), // Mock images array for count
        qualityScore
      );

      if (!gap.can_improve) {
        continue;
      }

      results.can_improve++;
      results.gaps_found.push(gap);

      console.log(`🔍 Vehicle ${vehicle.id.substring(0, 8)}: Score ${qualityScore}, Missing: ${gap.missing_fields.join(', ')}`);

      if (dryRun) {
        console.log(`  [DRY RUN] Would execute: ${gap.recommended_actions.join(', ')}`);
        continue;
      }

      // Execute actions
      const actionResults = await executeActions(supabase, gap, vehicle);
      results.actions_executed += actionResults.executed;
      results.actions_succeeded += actionResults.succeeded;
      results.actions_failed += actionResults.failed;

      // Recalculate quality score after actions
      if (actionResults.succeeded > 0) {
        try {
          // Recalculate quality score from updated DB state (direct DB query)
          const { data: updatedVehicle } = await supabase
            .from('vehicles')
            .select('vin, sale_price, mileage')
            .eq('id', vehicle.id)
            .single();
          
          const { count: updatedImageCount } = await supabase
            .from('vehicle_images')
            .select('id', { count: 'exact', head: true })
            .eq('vehicle_id', vehicle.id);

          // Calculate score from actual DB entries
          let newScore = 0;
          if (updatedVehicle?.vin && updatedVehicle.vin.length >= 10 && !updatedVehicle.vin.startsWith('VIVA-')) {
            newScore += 20;
          }
          if (updatedVehicle?.sale_price > 0) {
            newScore += 20;
          }
          const imgCount = updatedImageCount || 0;
          if (imgCount > 0) {
            newScore += 15;
            if (imgCount >= 5) newScore += 10;
            if (imgCount >= 20) newScore += 5;
          }
          if (updatedVehicle?.mileage) {
            newScore += 5;
          }

          if (newScore >= QUALITY_THRESHOLD.min_score) {
            // Mark as complete in origin_metadata
            await supabase
              .from('vehicles')
              .update({
                origin_metadata: {
                  ...(vehicle.origin_metadata || {}),
                  micro_scrape_complete: true,
                  micro_scrape_completed_at: new Date().toISOString(),
                },
              })
              .eq('id', vehicle.id);

            results.marked_complete++;
            console.log(`✅ Vehicle ${vehicle.id.substring(0, 8)} marked as complete (score: ${newScore})`);
          }
        } catch (error: any) {
          console.error(`Error recalculating quality:`, error.message);
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      ...results,
      runtime_ms: Date.now() - startTime,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Micro-scrape error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

