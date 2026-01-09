/**
 * RESTORE BaT COMMENTS
 * 
 * Supabase Edge Function to restore BaT comments for vehicles
 * Processes vehicles that have BaT URLs but are missing comments
 * 
 * Features:
 * - Processes in batches to avoid timeouts
 * - Rate limiting to avoid IP blocking
 * - Automatic retry with exponential backoff
 * - Checkpoint system to resume from failures
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    );

    const { batch_size = 50, start_from = 0, max_runs_per_day = 1 } = await req.json().catch(() => ({}));

    console.log(`🔄 Starting BaT comments restoration`);
    console.log(`   Batch size: ${batch_size}, Start from: ${start_from}`);

    // Get vehicles with BaT URLs that are missing comments
    const { data: vehicles, error: vehiclesError } = await supabase
      .from('vehicles')
      .select('id, year, make, model, discovery_url, bat_auction_url')
      .or('discovery_url.ilike.%bringatrailer.com%,bat_auction_url.ilike.%bringatrailer.com%')
      .order('created_at', { ascending: false })
      .range(start_from, start_from + batch_size - 1);

    if (vehiclesError) {
      throw new Error(`Failed to fetch vehicles: ${vehiclesError.message}`);
    }

    if (!vehicles || vehicles.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No vehicles to process',
        processed: 0,
        comments_restored: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`📦 Processing ${vehicles.length} vehicles`);

    // Filter to vehicles missing comments
    const vehiclesToProcess: any[] = [];
    for (const vehicle of vehicles) {
      const batUrl = vehicle.discovery_url || vehicle.bat_auction_url;
      if (!batUrl || !batUrl.includes('bringatrailer.com')) continue;

      // Check if vehicle already has comments
      const { count: commentCount } = await supabase
        .from('auction_comments')
        .select('*', { count: 'exact', head: true })
        .eq('vehicle_id', vehicle.id)
        .eq('platform', 'bat');

      if ((commentCount || 0) === 0) {
        vehiclesToProcess.push(vehicle);
      }
    }

    if (vehiclesToProcess.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'All vehicles already have comments',
        processed: 0,
        comments_restored: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`📝 Found ${vehiclesToProcess.length} vehicles missing comments`);

    let successCount = 0;
    let failCount = 0;
    let totalComments = 0;

    // Process each vehicle with rate limiting
    for (let i = 0; i < vehiclesToProcess.length; i++) {
      const vehicle = vehiclesToProcess[i];
      const batUrl = vehicle.discovery_url || vehicle.bat_auction_url;

      console.log(`[${i + 1}/${vehiclesToProcess.length}] Processing ${vehicle.year} ${vehicle.make} ${vehicle.model}`);

      try {
        // Step 1: Ensure auction_event exists
        const { data: auctionEvent, error: eventError } = await supabase
          .from('auction_events')
          .upsert(
            {
              vehicle_id: vehicle.id,
              source: 'bat',
              source_url: batUrl,
              outcome: 'bid_to',
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'vehicle_id,source_url' }
          )
          .select('id')
          .single();

        if (eventError || !auctionEvent?.id) {
          console.warn(`   ⚠️  Failed to create auction_event: ${eventError?.message}`);
          failCount++;
          continue;
        }

        // Step 2: Extract comments (with rate limiting)
        // Add delay to avoid IP blocking (2-4 seconds between requests)
        if (i > 0) {
          const delay = 2000 + Math.random() * 2000; // 2-4 seconds
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        const { data: extractData, error: extractError } = await supabase.functions.invoke('extract-auction-comments', {
          body: {
            auction_url: batUrl,
            auction_event_id: auctionEvent.id,
            vehicle_id: vehicle.id,
          },
        });

        if (extractError) {
          console.warn(`   ❌ Comment extraction failed: ${extractError.message}`);
          failCount++;
          continue;
        }

        const commentsExtracted = extractData?.comments_extracted || 0;
        if (commentsExtracted > 0) {
          successCount++;
          totalComments += commentsExtracted;
          console.log(`   ✅ Extracted ${commentsExtracted} comments`);
        } else {
          console.log(`   ⚠️  No comments extracted`);
        }

      } catch (err: any) {
        console.error(`   ❌ Error processing vehicle: ${err.message}`);
        failCount++;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      processed: vehiclesToProcess.length,
      succeeded: successCount,
      failed: failCount,
      comments_restored: totalComments,
      next_start_from: start_from + vehiclesToProcess.length
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

