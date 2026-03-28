/**
 * Process BaT Extraction Queue
 *
 * Automatically processes vehicles queued for comprehensive BaT data extraction.
 * Processes items in parallel batches of 3 for higher throughput (~500/hr vs ~175/hr serial).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { batchSize = 15, maxAttempts = 3 } = await req.json().catch(() => ({ batchSize: 15, maxAttempts: 3 }));

    const safeBatchSize = Math.max(1, Math.min(Number(batchSize) || 15, 30));
    const safeMaxAttempts = Math.max(1, Math.min(Number(maxAttempts) || 3, 20));
    const workerId = `bat-queue:${crypto.randomUUID?.() || String(Date.now())}`;

    console.log(`Processing BaT extraction queue (batch: ${safeBatchSize}, maxAttempts: ${safeMaxAttempts})`);

    // Claim work atomically
    const { data: queueItems, error: queueError } = await supabase.rpc('claim_bat_extraction_queue_batch', {
      p_batch_size: safeBatchSize,
      p_max_attempts: safeMaxAttempts,
      p_worker_id: workerId,
      p_lock_ttl_seconds: 20 * 60,
    });

    if (queueError) {
      throw new Error(`Failed to claim queue: ${queueError.message}`);
    }

    if (!queueItems || queueItems.length === 0) {
      return new Response(JSON.stringify({
        success: true, processed: 0, message: 'No pending extractions'
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`Claimed ${queueItems.length} extractions to process`);

    const results = { processed: 0, completed: 0, failed: 0, errors: [] as string[] };

    // Process items in parallel batches of 3
    // Each item is I/O bound (calls extract-bat-core), so parallelism helps significantly
    const CONCURRENCY = 3;
    for (let i = 0; i < queueItems.length; i += CONCURRENCY) {
      const batch = queueItems.slice(i, i + CONCURRENCY);
      await Promise.allSettled(
        batch.map(item => processOneItem(item, supabase, safeMaxAttempts, results))
      );
    }

    console.log(`Queue processing complete: ${results.completed} completed, ${results.failed} failed out of ${results.processed}`);

    return new Response(JSON.stringify({
      success: true, ...results
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    console.error('Queue processing error:', error);
    return new Response(JSON.stringify({
      success: false, error: error.message || String(error)
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

async function processOneItem(
  item: any,
  supabase: any,
  safeMaxAttempts: number,
  results: { processed: number; completed: number; failed: number; errors: string[] }
) {
  results.processed++;

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const invokeJwt = Deno.env.get('INTERNAL_INVOKE_JWT') ??
                   Deno.env.get('SUPABASE_ANON_KEY') ??
                   Deno.env.get('ANON_KEY') ?? '';

  try {
    if (!invokeJwt) {
      throw new Error('Missing invoke JWT for function-to-function calls');
    }

    console.log(`[${item.vehicle_id}] Step 1: Extracting core data...`);

    // Step 1: Extract core vehicle data
    const coreResponse = await fetch(
      `${supabaseUrl}/functions/v1/extract-bat-core`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(300_000),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${invokeJwt}`,
          'apikey': invokeJwt,
        },
        body: JSON.stringify({ url: item.bat_url, max_vehicles: 1 }),
      }
    );

    if (!coreResponse.ok) {
      const errorText = await coreResponse.text().catch(() => 'Unknown error');
      const msg = `HTTP ${coreResponse.status}: ${errorText}`;
      if (msg.includes('504') || msg.includes('timeout') || msg.includes('Gateway Timeout')) {
        throw new Error(`extract-bat-core timed out. Will retry with backoff.`);
      }
      throw new Error(`extract-bat-core failed: ${msg}`);
    }

    const coreResult = await coreResponse.json();
    if (!coreResult?.success) {
      throw new Error(`extract-bat-core returned failure: ${coreResult?.error || 'Unknown'}`);
    }

    const vehicleId = coreResult.created_vehicle_ids?.[0] || coreResult.updated_vehicle_ids?.[0] || item.vehicle_id;
    const extractedImages = coreResult.debug_extraction?.images_count || 0;
    const extractedVin = coreResult.debug_extraction?.vin || null;

    console.log(`[${item.vehicle_id}] Step 1 done: vehicleId=${vehicleId}, images=${extractedImages}, vin=${extractedVin ? 'yes' : 'no'}`);

    // Step 2: Extract comments and bids (non-critical, fire and forget with timeout)
    if (vehicleId) {
      try {
        const commentResponse = await fetch(
          `${supabaseUrl}/functions/v1/extract-auction-comments`,
          {
            method: 'POST',
            signal: AbortSignal.timeout(60_000),
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${invokeJwt}`,
              'apikey': invokeJwt,
            },
            body: JSON.stringify({ auction_url: item.bat_url, vehicle_id: vehicleId }),
          }
        );
        if (commentResponse.ok) {
          const cr = await commentResponse.json();
          console.log(`[${item.vehicle_id}] Step 2 done: ${cr?.comments_extracted || 0} comments`);
        }
      } catch (e: any) {
        console.warn(`[${item.vehicle_id}] Step 2 warn: ${e.message}`);
      }
    }

    // Validate extraction completeness
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('id, vin, mileage, color, transmission, engine_size')
      .eq('id', vehicleId)
      .single();

    const { count: imageCount } = await supabase
      .from('vehicle_images')
      .select('id', { count: 'exact', head: true })
      .eq('vehicle_id', vehicleId);

    const hasVin = vehicle?.vin && vehicle.vin !== '';
    const hasSpecs = vehicle?.mileage || vehicle?.color || vehicle?.transmission || vehicle?.engine_size;
    const hasImages = (imageCount || 0) > 0;
    const isPartial = !hasImages || (!hasVin && !hasSpecs);

    if (isPartial) {
      const missingData = [];
      if (!hasImages) missingData.push(extractedImages > 0 ? 'images(storage failed)' : 'images');
      if (!hasVin && !hasSpecs) missingData.push('critical_data');

      const attemptsNow = Number(item.attempts || 0);
      if (attemptsNow >= safeMaxAttempts) {
        await supabase.from('bat_extraction_queue').update({
          status: 'failed',
          error_message: `Partial: Missing ${missingData.join(', ')}`,
          locked_at: null, locked_by: null, next_attempt_at: null,
          updated_at: new Date().toISOString()
        }).eq('id', item.id);
        results.failed++;
      } else {
        const delaySeconds = Math.min(6 * 3600, 300 * Math.pow(2, Math.max(0, attemptsNow - 1)));
        await supabase.from('bat_extraction_queue').update({
          status: 'pending',
          error_message: `Partial (attempt ${attemptsNow}): Missing ${missingData.join(', ')}`,
          locked_at: null, locked_by: null,
          next_attempt_at: new Date(Date.now() + delaySeconds * 1000).toISOString(),
          updated_at: new Date().toISOString()
        }).eq('id', item.id);
      }
    } else {
      // Complete extraction
      await supabase.from('bat_extraction_queue').update({
        status: 'complete',
        completed_at: new Date().toISOString(),
        error_message: null,
        locked_at: null, locked_by: null, next_attempt_at: null,
        updated_at: new Date().toISOString()
      }).eq('id', item.id);
      results.completed++;
      console.log(`[${item.vehicle_id}] Complete: ${imageCount || 0} images, VIN: ${hasVin ? 'yes' : 'no'}`);
    }

  } catch (error: any) {
    const errorMsg = error.message || String(error);
    console.error(`[${item.vehicle_id}] Failed: ${errorMsg}`);

    const attemptsNow = Number(item.attempts || 0);
    if (attemptsNow >= safeMaxAttempts) {
      await supabase.from('bat_extraction_queue').update({
        status: 'failed', error_message: errorMsg,
        locked_at: null, locked_by: null, next_attempt_at: null,
        updated_at: new Date().toISOString()
      }).eq('id', item.id);
    } else {
      const delaySeconds = Math.min(6 * 3600, 300 * Math.pow(2, Math.max(0, attemptsNow - 1)));
      await supabase.from('bat_extraction_queue').update({
        status: 'pending', error_message: errorMsg,
        locked_at: null, locked_by: null,
        next_attempt_at: new Date(Date.now() + delaySeconds * 1000).toISOString(),
        updated_at: new Date().toISOString()
      }).eq('id', item.id);
    }

    results.failed++;
    results.errors.push(`${item.vehicle_id}: ${errorMsg}`);
  }
}
