import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    const body = await req.json().catch(() => ({}));
    const { batch_size = 10, priority_only = false, source_id, use_intelligence = false } = body;
    const workerId = 'process-import-queue:' + Date.now();
    const supabaseUrl = Deno.env.get('SUPABASE_URL');

    const { data: queueItems, error: queueError } = await supabase.rpc('claim_import_queue_batch', {
      p_batch_size: batch_size,
      p_max_attempts: 3,
      p_priority_only: priority_only,
      p_source_id: source_id || null,
      p_worker_id: workerId,
    });

    if (queueError) throw queueError;
    if (!queueItems || queueItems.length === 0) {
      return new Response(JSON.stringify({ success: true, processed: 0, message: 'No items' }), 
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const results = [];
    for (const item of queueItems) {
      try {
        const url = item.listing_url;
        let extractorUrl = null;

        if (url.includes('bringatrailer.com')) {
          extractorUrl = Deno.env.get('SUPABASE_URL') + '/functions/v1/bat-simple-extract';
        } else if (url.includes('carsandbids.com')) {
          extractorUrl = Deno.env.get('SUPABASE_URL') + '/functions/v1/extract-cars-and-bids-core';
        } else if (url.includes('pcarmarket.com')) {
          extractorUrl = Deno.env.get('SUPABASE_URL') + '/functions/v1/import-pcarmarket-listing';
        } else if (url.includes('hagerty.com')) {
          extractorUrl = Deno.env.get('SUPABASE_URL') + '/functions/v1/extract-hagerty-listing';
        } else {
          extractorUrl = Deno.env.get('SUPABASE_URL') + '/functions/v1/extract-vehicle-data-ai';
        }

        const extractResponse = await fetch(extractorUrl, {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ url, save_to_db: true }),
        });

        const extractData = await extractResponse.json();

        if (extractData.success) {
          const extractedVehicle = extractData.extracted || extractData;
          let vehicleId = extractedVehicle.vehicle_id || null;
          let intelligenceDecision = null;

          // INTELLIGENCE LAYER: Validate before accepting
          if (use_intelligence && extractedVehicle) {
            try {
              const intelligenceResponse = await fetch(supabaseUrl + '/functions/v1/intelligence-evaluate', {
                method: 'POST',
                headers: {
                  'Authorization': 'Bearer ' + Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  extracted_data: extractedVehicle,
                  source_url: url,
                  persist_decision: true
                }),
              });
              intelligenceDecision = await intelligenceResponse.json();

              // If DOUBT or REJECT, don't mark as complete
              if (intelligenceDecision.decision === 'REJECT') {
                await supabase.from('import_queue').update({
                  status: 'rejected',
                  error_message: `Intelligence REJECT: ${intelligenceDecision.reject_reasons.join(', ')}`,
                  attempts: item.attempts + 1,
                }).eq('id', item.id);
                results.push({
                  id: item.id,
                  status: 'rejected',
                  url,
                  decision: 'REJECT',
                  reasons: intelligenceDecision.reject_reasons
                });
                continue;
              }

              if (intelligenceDecision.decision === 'DOUBT') {
                await supabase.from('import_queue').update({
                  status: 'pending_review',
                  error_message: `Intelligence DOUBT: ${intelligenceDecision.doubts.map((d: any) => d.reason).join(', ')}`,
                  attempts: item.attempts + 1,
                }).eq('id', item.id);
                results.push({
                  id: item.id,
                  status: 'pending_review',
                  url,
                  decision: 'DOUBT',
                  doubts: intelligenceDecision.doubts
                });
                continue;
              }
            } catch (intError: any) {
              console.error('Intelligence evaluation failed:', intError.message);
              // Continue without intelligence if it fails
            }
          }

          await supabase.from('import_queue').update({
            status: 'complete',
            processed_at: new Date().toISOString(),
            attempts: item.attempts + 1,
            vehicle_id: vehicleId,
          }).eq('id', item.id);
          results.push({
            id: item.id,
            status: 'complete',
            url,
            vehicle_id: vehicleId,
            decision: intelligenceDecision?.decision || 'N/A'
          });
        } else {
          await supabase.from('import_queue').update({
            status: 'failed',
            error_message: extractData.error || 'Extraction failed',
            attempts: item.attempts + 1,
          }).eq('id', item.id);
          results.push({ id: item.id, status: 'failed', url, error: extractData.error });
        }
      } catch (error) {
        await supabase.from('import_queue').update({
          status: 'failed',
          error_message: error.message,
          attempts: item.attempts + 1,
        }).eq('id', item.id);
        results.push({ id: item.id, status: 'failed', url: item.listing_url, error: error.message });
      }
    }

    return new Response(JSON.stringify({ success: true, processed: results.length, results }), 
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
