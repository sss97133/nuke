/**
 * Process BaT Extraction Queue
 * 
 * Automatically processes vehicles queued for comprehensive BaT data extraction.
 * This ensures all BaT vehicles get complete data (comments, features, dates, etc.)
 */

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
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { batchSize = 1, maxAttempts = 3 } = await req.json().catch(() => ({ batchSize: 1, maxAttempts: 3 }));

    // Configurable batch size (default: 1 for accuracy, can be increased for speed)
    // Recommended: Start with 1-5 for testing, then increase to 10-20 once stable
    const safeBatchSize = Math.max(1, Math.min(Number(batchSize) || 1, 50)); // Max 50 at a time
    const safeMaxAttempts = Math.max(1, Math.min(Number(maxAttempts) || 3, 20));
    const workerId = `process-bat-extraction-queue:${crypto.randomUUID?.() || String(Date.now())}`;

    console.log(`Processing BaT extraction queue (batch size: ${safeBatchSize}, max attempts: ${safeMaxAttempts})`);

    // Claim work atomically (prevents double-processing under concurrent cron / manual runs).
    const { data: queueItems, error: queueError } = await supabase.rpc('claim_bat_extraction_queue_batch', {
      p_batch_size: safeBatchSize,
      p_max_attempts: safeMaxAttempts,
      p_worker_id: workerId,
      p_lock_ttl_seconds: 20 * 60, // 20 minutes lock (extractions can take 3-5 minutes)
    });

    if (queueError) {
      throw new Error(`Failed to claim queue: ${queueError.message}`);
    }

    if (!queueItems || queueItems.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        processed: 0,
        message: 'No pending extractions'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`Claimed ${queueItems.length} extractions to process`);

    const results = {
      processed: 0,
      completed: 0,
      failed: 0,
      errors: [] as string[]
    };

    // Process each item
    for (const item of queueItems) {
      results.processed++;

      try {
        console.log(`Processing vehicle ${item.vehicle_id} (${item.bat_url})`);

        // Step 1: Extract core vehicle data (VIN, specs, images)
        // SLOW & ACCURATE: Let it take as long as it needs (up to Edge Function limit)
        console.log(`  Step 1: Extracting core data (this may take 3-5 minutes, be patient)...`);
        
        // Use anon key for function-to-function calls (extract-premium-auction has verify_jwt: true)
        // Prefer INTERNAL_INVOKE_JWT, fall back to SUPABASE_ANON_KEY
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const invokeJwt = Deno.env.get('INTERNAL_INVOKE_JWT') ?? 
                         Deno.env.get('SUPABASE_ANON_KEY') ?? 
                         Deno.env.get('ANON_KEY') ?? '';
        
        if (!invokeJwt) {
          throw new Error('Missing INTERNAL_INVOKE_JWT or SUPABASE_ANON_KEY for function-to-function calls');
        }
        
        let coreResult: any;
        let coreError: any;
        
        try {
          const response = await fetch(
            `${supabaseUrl}/functions/v1/extract-premium-auction`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${invokeJwt}`,
                'apikey': invokeJwt,
              },
              body: JSON.stringify({
                url: item.bat_url,
                max_vehicles: 1,
              }),
            }
          );

          if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            throw new Error(`HTTP ${response.status}: ${errorText}`);
          }

          coreResult = await response.json();
        } catch (e: any) {
          // Catch any thrown errors (including timeouts)
          coreError = e;
        }

        if (coreError) {
          // Check if it's a timeout - these are expected for complex listings
          const errorMsg = coreError.message || String(coreError);
          if (errorMsg.includes('504') || errorMsg.includes('timeout') || errorMsg.includes('Gateway Timeout') || errorMsg.includes('non-2xx')) {
            // Timeout is expected for complex listings - retry with exponential backoff
            throw new Error(`extract-premium-auction timed out (listing may be too complex). Will retry with backoff.`);
          }
          throw new Error(`extract-premium-auction failed: ${errorMsg}`);
        }

        if (!coreResult || !coreResult.success) {
          throw new Error(`extract-premium-auction returned failure: ${coreResult?.error || 'Unknown error'}`);
        }

        // Get vehicle_id from result (may create new or update existing)
        const vehicleId = coreResult.created_vehicle_ids?.[0] || coreResult.updated_vehicle_ids?.[0] || item.vehicle_id;
        console.log(`  Step 1 complete: Vehicle ID ${vehicleId}`);

        // Step 2: Extract comments and bids
        if (vehicleId) {
          console.log(`  Step 2: Extracting comments/bids...`);
          try {
            const commentResponse = await fetch(
              `${supabaseUrl}/functions/v1/extract-auction-comments`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${invokeJwt}`,
                  'apikey': invokeJwt,
                },
                body: JSON.stringify({
                  auction_url: item.bat_url,
                  vehicle_id: vehicleId,
                }),
              }
            );

            if (!commentResponse.ok) {
              const errorText = await commentResponse.text().catch(() => 'Unknown error');
              console.warn(`  Step 2 warning: extract-auction-comments failed: HTTP ${commentResponse.status}: ${errorText}`);
            } else {
              const commentResult = await commentResponse.json();
              console.log(`  Step 2 complete: ${commentResult?.comments_extracted || 0} comments, ${commentResult?.bids_extracted || 0} bids`);
            }
          } catch (e: any) {
            // Non-critical - log but continue
            console.warn(`  Step 2 warning: extract-auction-comments exception: ${e.message}`);
          }
        }

        const extractionResult = { success: true, vehicle_id: vehicleId };

        // Mark as complete
        await supabase
          .from('bat_extraction_queue')
          .update({
            status: 'complete',
            completed_at: new Date().toISOString(),
            error_message: null,
            locked_at: null,
            locked_by: null,
            next_attempt_at: null,
            updated_at: new Date().toISOString()
          })
          .eq('id', item.id);

        results.completed++;
        console.log(`Completed extraction for vehicle ${item.vehicle_id}`);

      } catch (error: any) {
        const errorMsg = error.message || String(error);
        console.error(`Failed to process ${item.vehicle_id}: ${errorMsg}`);

        // item.attempts is already incremented by claim_bat_extraction_queue_batch
        const attemptsNow = Number(item.attempts || 0);

        // Mark as failed if max attempts reached, otherwise leave as pending with backoff
        if (attemptsNow >= safeMaxAttempts) {
          await supabase
            .from('bat_extraction_queue')
            .update({
              status: 'failed',
              error_message: errorMsg,
              locked_at: null,
              locked_by: null,
              next_attempt_at: null,
              updated_at: new Date().toISOString()
            })
            .eq('id', item.id);
        } else {
          // Reset to pending for retry with exponential backoff (cap at 6 hours)
          const baseSeconds = 5 * 60;
          const delaySeconds = Math.min(6 * 60 * 60, baseSeconds * Math.pow(2, Math.max(0, attemptsNow - 1)));
          const nextAttemptAt = new Date(Date.now() + delaySeconds * 1000).toISOString();

          await supabase
            .from('bat_extraction_queue')
            .update({
              status: 'pending',
              error_message: errorMsg,
              locked_at: null,
              locked_by: null,
              next_attempt_at: nextAttemptAt,
              updated_at: new Date().toISOString()
            })
            .eq('id', item.id);
        }

        results.failed++;
        results.errors.push(`${item.vehicle_id}: ${errorMsg}`);
      }

      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`Queue processing complete: ${results.completed} completed, ${results.failed} failed`);

    return new Response(JSON.stringify({
      success: true,
      ...results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('Queue processing error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message || String(error)
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

