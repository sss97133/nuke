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

    const { batchSize = 10, maxAttempts = 3, concurrency = 2 } = await req.json().catch(() => ({ batchSize: 10, maxAttempts: 3, concurrency: 2 }));

    const safeBatchSize = Math.max(1, Math.min(Number(batchSize) || 10, 200));
    const safeMaxAttempts = Math.max(1, Math.min(Number(maxAttempts) || 3, 20));
    const safeConcurrency = Math.max(1, Math.min(Number(concurrency) || 2, 10));
    const workerId = `process-bat-extraction-queue:${crypto.randomUUID?.() || String(Date.now())}`;

    console.log(`Processing BaT extraction queue (batch size: ${safeBatchSize}, max attempts: ${safeMaxAttempts}, concurrency: ${safeConcurrency})`);

    // Claim work atomically (prevents double-processing under concurrent cron / manual runs).
    const { data: queueItems, error: queueError } = await supabase.rpc('claim_bat_extraction_queue_batch', {
      p_batch_size: safeBatchSize,
      p_max_attempts: safeMaxAttempts,
      p_worker_id: workerId,
      p_lock_ttl_seconds: 15 * 60,
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

    const processOne = async (item: any) => {
      results.processed++;
      try {
        console.log(`Processing vehicle ${item.vehicle_id} (${item.bat_url})`);

        // Call comprehensive extraction
        const { data: extractionResult, error: extractionError } = await supabase.functions.invoke(
          'comprehensive-bat-extraction',
          {
            body: {
              batUrl: item.bat_url,
              vehicleId: item.vehicle_id
            }
          }
        );

        if (extractionError) {
          throw new Error(`Extraction failed: ${extractionError.message}`);
        }

        if (!extractionResult || !extractionResult.success) {
          throw new Error(`Extraction returned failure: ${extractionResult?.error || 'Unknown error'}`);
        }

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
    };

    const workerCount = Math.min(safeConcurrency, queueItems.length);
    let nextIndex = 0;
    const workers = Array.from({ length: workerCount }, async () => {
      while (true) {
        const idx = nextIndex++;
        if (idx >= queueItems.length) break;
        await processOne(queueItems[idx]);
      }
    });
    await Promise.all(workers);

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

