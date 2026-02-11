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
        if (!url) {
          await supabase.from('import_queue').update({
            status: 'failed',
            error_message: 'listing_url is required',
            attempts: (item.attempts || 0) + 1,
          }).eq('id', item.id);
          results.push({ id: item.id, status: 'failed', url: null, error: 'listing_url is required' });
          continue;
        }
        let extractorUrl = null;

        if (url.includes('bringatrailer.com')) {
          extractorUrl = supabaseUrl + '/functions/v1/complete-bat-import';
        } else if (url.includes('carsandbids.com')) {
          extractorUrl = supabaseUrl + '/functions/v1/extract-cars-and-bids-core';
        } else if (url.includes('pcarmarket.com')) {
          extractorUrl = supabaseUrl + '/functions/v1/import-pcarmarket-listing';
        } else if (url.includes('hagerty.com')) {
          extractorUrl = supabaseUrl + '/functions/v1/extract-hagerty-listing';
        } else if (url.includes('classic.com')) {
          extractorUrl = supabaseUrl + '/functions/v1/import-classic-auction';
        } else if (url.includes('collectingcars.com')) {
          extractorUrl = supabaseUrl + '/functions/v1/extract-collecting-cars';
        } else if (url.includes('barnfinds.com')) {
          extractorUrl = supabaseUrl + '/functions/v1/extract-barn-finds-listing';
        } else if (url.includes('craigslist.org')) {
          extractorUrl = supabaseUrl + '/functions/v1/extract-craigslist';
        } else if (url.includes('barrett-jackson.com')) {
          extractorUrl = supabaseUrl + '/functions/v1/extract-barrett-jackson';
        } else if (url.includes('broadarrowauctions.com')) {
          extractorUrl = supabaseUrl + '/functions/v1/extract-vehicle-data-ai';
        } else if (url.includes('gaaclassiccars.com')) {
          extractorUrl = supabaseUrl + '/functions/v1/extract-gaa-classics';
        } else if (url.includes('bhauction.com')) {
          extractorUrl = supabaseUrl + '/functions/v1/extract-bh-auction';
        } else if (url.includes('bonhams.com') || url.includes('cars.bonhams.com')) {
          extractorUrl = supabaseUrl + '/functions/v1/extract-bonhams';
        } else if (url.includes('rmsothebys.com')) {
          extractorUrl = supabaseUrl + '/functions/v1/extract-rmsothebys';
        } else if (url.includes('goodingco.com')) {
          extractorUrl = supabaseUrl + '/functions/v1/extract-gooding';
        } else if (url.includes('velocityrestorations.com') || url.includes('coolnvintage.com') || url.includes('brabus.com') || url.includes('icon4x4.com') || url.includes('ringbrothers.com')) {
          extractorUrl = supabaseUrl + '/functions/v1/extract-specialty-builder';
        } else if (url.includes('vanguardmotorsales.com')) {
          extractorUrl = supabaseUrl + '/functions/v1/extract-vehicle-data-ai';
        } else {
          extractorUrl = supabaseUrl + '/functions/v1/extract-vehicle-data-ai';
        }

        const extractResponse = await fetch(extractorUrl, {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ url, save_to_db: true }),
          signal: AbortSignal.timeout(120_000),
        });

        const extractData = await extractResponse.json().catch(() => ({
          success: false,
          error: `HTTP ${extractResponse.status}: non-JSON response`,
        }));

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
                signal: AbortSignal.timeout(30_000),
              });
              intelligenceDecision = await intelligenceResponse.json().catch(() => null);

              // If DOUBT or REJECT, don't mark as complete
              if (intelligenceDecision?.decision === 'REJECT') {
                await supabase.from('import_queue').update({
                  status: 'rejected',
                  error_message: `Intelligence REJECT: ${(intelligenceDecision.reject_reasons || []).join(', ')}`,
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

              if (intelligenceDecision?.decision === 'DOUBT') {
                await supabase.from('import_queue').update({
                  status: 'pending_review',
                  error_message: `Intelligence DOUBT: ${(intelligenceDecision.doubts || []).map((d: any) => d.reason).join(', ')}`,
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
          const errorMsg = extractData.error || 'Extraction failed';
          // Detect non-vehicle pages (memorabilia, collectibles, etc.) and skip instead of fail
          const isNonVehicle = errorMsg.includes('No vehicle data found') ||
            errorMsg.includes('could not find real vehicle data');
          const status = isNonVehicle ? 'skipped' : 'failed';

          await supabase.from('import_queue').update({
            status,
            error_message: isNonVehicle ? `Non-vehicle page: ${errorMsg.slice(0, 200)}` : errorMsg,
            attempts: item.attempts + 1,
          }).eq('id', item.id);
          results.push({ id: item.id, status, url, error: errorMsg });
        }
      } catch (error: any) {
        const errMsg = error?.message || String(error);
        await supabase.from('import_queue').update({
          status: 'failed',
          error_message: errMsg.slice(0, 500),
          attempts: (item.attempts || 0) + 1,
        }).eq('id', item.id);
        results.push({ id: item.id, status: 'failed', url: item.listing_url, error: errMsg });
      }
    }

    return new Response(JSON.stringify({ success: true, processed: results.length, results }), 
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error?.message || String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
