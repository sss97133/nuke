/**
 * recalculate-quality-scores
 *
 * Recalculates data_quality_score for vehicles based on ACTUAL data:
 * - Image count from vehicle_images (not 0/1)
 * - Observation count from vehicle_observations
 * - Timeline events from timeline_events
 * - Nuke estimate presence from nuke_estimates
 *
 * This fixes the "F tier" problem where vehicles with rich data
 * still show low quality scores.
 *
 * Usage:
 *   POST /functions/v1/recalculate-quality-scores
 *   Body: { "batch_size": 1000 }
 *
 * Can be called repeatedly — processes vehicles with lowest scores first.
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
  const batchSize = Math.min(body.batch_size || 1000, 5000);

  const { data, error } = await supabase.rpc('batch_recalculate_quality_scores', {
    batch_size: batchSize,
  });

  if (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    success: true,
    vehicles_processed: data || 0,
    batch_size: batchSize,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
