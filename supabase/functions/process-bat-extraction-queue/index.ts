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

    const { batchSize = 10 } = await req.json().catch(() => ({ batchSize: 10 }));

    console.log(`🔄 Processing BaT extraction queue (batch size: ${batchSize})...`);

    // Get next batch of pending extractions
    const { data: queueItems, error: queueError } = await supabase
      .from('bat_extraction_queue')
      .select('*')
      .eq('status', 'pending')
      .order('priority', { ascending: false }) // Higher priority first
      .order('created_at', { ascending: true }) // Then oldest first
      .limit(batchSize);

    if (queueError) {
      throw new Error(`Failed to fetch queue: ${queueError.message}`);
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

    console.log(`📋 Found ${queueItems.length} extractions to process`);

    const results = {
      processed: 0,
      completed: 0,
      failed: 0,
      errors: [] as string[]
    };

    // Process each item
    for (const item of queueItems) {
      results.processed++;

      // Mark as processing
      await supabase
        .from('bat_extraction_queue')
        .update({
          status: 'processing',
          attempts: item.attempts + 1,
          updated_at: new Date().toISOString()
        })
        .eq('id', item.id);

      try {
        console.log(`🔄 Processing vehicle ${item.vehicle_id} (${item.bat_url})`);

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
            updated_at: new Date().toISOString()
          })
          .eq('id', item.id);

        results.completed++;
        console.log(`✅ Completed extraction for vehicle ${item.vehicle_id}`);

      } catch (error: any) {
        const errorMsg = error.message || String(error);
        console.error(`❌ Failed to process ${item.vehicle_id}: ${errorMsg}`);

        // Mark as failed if max attempts reached, otherwise leave as pending for retry
        if (item.attempts >= 3) {
          await supabase
            .from('bat_extraction_queue')
            .update({
              status: 'failed',
              error_message: errorMsg,
              updated_at: new Date().toISOString()
            })
            .eq('id', item.id);
        } else {
          // Reset to pending for retry
          await supabase
            .from('bat_extraction_queue')
            .update({
              status: 'pending',
              error_message: errorMsg,
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

    console.log(`✅ Queue processing complete: ${results.completed} completed, ${results.failed} failed`);

    return new Response(JSON.stringify({
      success: true,
      ...results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('❌ Queue processing error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message || String(error)
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

