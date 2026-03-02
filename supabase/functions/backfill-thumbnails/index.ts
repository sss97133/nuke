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
    const maxBatches = body.max_batches ?? 10;
    const batchSize = body.batch_size ?? 10000;

    let totalUpdated = 0;
    let remaining = 0;

    for (let i = 0; i < maxBatches; i++) {
      const { data, error } = await supabase.rpc('backfill_primary_image_urls', {
        batch_size: batchSize,
      });

      if (error) {
        return new Response(JSON.stringify({ 
          error: error.message,
          totalUpdated,
          batchesCompleted: i 
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const result = data?.[0] ?? data;
      const batchUpdated = Number(result?.updated_count ?? 0);
      remaining = Number(result?.remaining_count ?? 0);
      totalUpdated += batchUpdated;

      // If no more to update, stop
      if (batchUpdated === 0) break;
    }

    return new Response(JSON.stringify({
      success: true,
      totalUpdated,
      remaining,
      batchesRun: Math.min(maxBatches, Math.ceil(totalUpdated / batchSize) + 1),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
