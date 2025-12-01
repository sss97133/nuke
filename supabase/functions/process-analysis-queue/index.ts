/**
 * Process Analysis Queue - Bulletproof Analysis Processor
 * 
 * This function processes the analysis queue with:
 * - Automatic retries with exponential backoff
 * - Error handling and recovery
 * - Health checks
 * - Status tracking
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      }
    });
  }

  try {
    const { batchSize = 5 } = await req.json().catch(() => ({}));
    
    console.log(`🔄 Processing analysis queue (batch size: ${batchSize})...`);
    
    // Get next batch of analyses
    const { data: queueItems, error: queueError } = await supabase
      .rpc('get_analysis_batch', { p_batch_size: batchSize });
    
    if (queueError) {
      throw new Error(`Failed to get queue batch: ${queueError.message}`);
    }
    
    if (!queueItems || queueItems.length === 0) {
      return new Response(JSON.stringify({
        processed: 0,
        message: 'No analyses to process'
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    console.log(`📋 Found ${queueItems.length} analyses to process`);
    
    const results = {
      processed: 0,
      completed: 0,
      failed: 0,
      retrying: 0,
      errors: [] as string[]
    };
    
    // Process each item
    for (const item of queueItems) {
      try {
        // Mark as processing
        await supabase.rpc('mark_analysis_processing', { p_queue_id: item.id });
        
        console.log(`🤖 Processing analysis ${item.id} for vehicle ${item.vehicle_id} (attempt ${item.retry_count + 1})...`);
        
        // Call the appropriate analysis function
        let analysisResult: any;
        let resultId: string | null = null;
        
        if (item.analysis_type === 'expert_valuation') {
          // Get queue item details for config
          const { data: queueItem } = await supabase
            .from('analysis_queue')
            .select('llm_provider, llm_model, analysis_tier, analysis_config')
            .eq('id', item.id)
            .single();
          
          // Call vehicle-expert-agent with user preferences
          const { data: expertData, error: expertError } = await supabase.functions.invoke(
            'vehicle-expert-agent',
            { 
              body: { 
                vehicleId: item.vehicle_id,
                queueId: item.id,
                llmProvider: queueItem?.llm_provider,
                llmModel: queueItem?.llm_model,
                analysisTier: queueItem?.analysis_tier,
                ...(queueItem?.analysis_config || {})
              } 
            }
          );
          
          if (expertError) {
            throw new Error(`Expert agent error: ${expertError.message}`);
          }
          
          analysisResult = expertData;
          
          // Get the resulting valuation ID
          const { data: valuation } = await supabase
            .from('vehicle_valuations')
            .select('id')
            .eq('vehicle_id', item.vehicle_id)
            .order('valuation_date', { ascending: false })
            .limit(1)
            .maybeSingle();
          
          resultId = valuation?.id || null;
        } else {
          throw new Error(`Unknown analysis type: ${item.analysis_type}`);
        }
        
        // Mark as completed
        await supabase.rpc('mark_analysis_completed', {
          p_queue_id: item.id,
          p_result_id: resultId
        });
        
        results.completed++;
        results.processed++;
        console.log(`✅ Analysis ${item.id} completed successfully`);
        
      } catch (error: any) {
        console.error(`❌ Analysis ${item.id} failed:`, error);
        
        // Mark as failed (with retry logic)
        await supabase.rpc('mark_analysis_failed', {
          p_queue_id: item.id,
          p_error_message: error.message || 'Unknown error',
          p_error_details: {
            error_type: error.name || 'Error',
            stack: error.stack,
            timestamp: new Date().toISOString()
          }
        });
        
        // Check if it will retry or is permanently failed
        const { data: queueItem } = await supabase
          .from('analysis_queue')
          .select('status')
          .eq('id', item.id)
          .single();
        
        if (queueItem?.status === 'retrying') {
          results.retrying++;
        } else {
          results.failed++;
        }
        
        results.processed++;
        results.errors.push(`${item.id}: ${error.message}`);
      }
    }
    
    return new Response(JSON.stringify({
      ...results,
      message: `Processed ${results.processed} analyses: ${results.completed} completed, ${results.retrying} retrying, ${results.failed} failed`
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
    
  } catch (error: any) {
    console.error('Queue processor error:', error);
    return new Response(JSON.stringify({
      error: error.message,
      processed: 0
    }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
});

