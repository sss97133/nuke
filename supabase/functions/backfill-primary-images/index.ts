/**
 * backfill-primary-images
 *
 * Sets primary_image_url for vehicles missing it by selecting the best available
 * image from vehicle_images. Runs in batches of 500 to avoid long-running queries.
 *
 * Usage:
 *   POST /functions/v1/backfill-primary-images
 *   Body: { "batch_size": 500, "max_batches": 10 }
 *
 * Can be called repeatedly (idempotent) — only touches vehicles with NULL primary_image_url.
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

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const body = await req.json().catch(() => ({}));
  const batchSize = Math.min(body.batch_size || 500, 1000);
  const maxBatches = Math.min(body.max_batches || 10, 50);

  let totalUpdated = 0;
  let batchesRun = 0;

  for (let i = 0; i < maxBatches; i++) {
    const { data, error } = await supabase.rpc('backfill_primary_image_url', {
      batch_size: batchSize,
    });

    if (error) {
      return new Response(JSON.stringify({
        success: false,
        error: error.message,
        total_updated: totalUpdated,
        batches_run: batchesRun,
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const updated = data || 0;
    totalUpdated += updated;
    batchesRun++;

    // If fewer than batch_size were updated, we've caught up
    if (updated < batchSize) break;

    // Small pause between batches to be kind to the DB
    await new Promise(r => setTimeout(r, 200));
  }

  return new Response(JSON.stringify({
    success: true,
    total_updated: totalUpdated,
    batches_run: batchesRun,
    batch_size: batchSize,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
