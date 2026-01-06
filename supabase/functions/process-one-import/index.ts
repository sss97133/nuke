/**
 * PROCESS ONE IMPORT
 * 
 * Processes a single import_queue item (called in fan-out pattern by orchestrator).
 * This avoids batch timeout issues—orchestrator triggers 20x of these in parallel.
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

    const body = await req.json();
    const { queue_id } = body;

    if (!queue_id) {
      return new Response(JSON.stringify({ error: 'queue_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Claim this specific item
    const { data: item, error: claimError } = await supabase
      .from('import_queue')
      .update({
        status: 'processing',
        locked_at: new Date().toISOString(),
        locked_by: 'process-one-import',
        processing_attempts: supabase.rpc('increment', { x: 1 }), // Atomic increment
        updated_at: new Date().toISOString(),
      })
      .eq('id', queue_id)
      .eq('status', 'pending') // Only claim if still pending (avoid race)
      .select()
      .maybeSingle();

    if (claimError || !item) {
      return new Response(JSON.stringify({ skipped: true, reason: 'Already claimed or not found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Call the existing heavy-duty process-import-queue with batch_size=1
    const { data: result, error: processError } = await supabase.functions.invoke('process-import-queue', {
      body: {
        batch_size: 1,
        max_attempts: 3,
        skip_image_upload: true,
        fast_mode: true,
      },
    });

    if (processError) {
      // Mark as failed
      await supabase
        .from('import_queue')
        .update({
          status: 'failed',
          error_message: processError.message,
          locked_at: null,
          locked_by: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', queue_id);

      return new Response(JSON.stringify({ success: false, error: processError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('process-one-import error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

