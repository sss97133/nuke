/**
 * backfill-vehicle-counts
 *
 * Backfills denormalized image_count and observation_count on vehicles table.
 * Processes vehicles with the highest data_quality_score first (most likely
 * to appear in search results). Safe to run repeatedly — only updates vehicles
 * where the count is still 0 but actual data exists.
 *
 * Usage:
 *   POST /functions/v1/backfill-vehicle-counts
 *   Body: { "batch_size": 50, "min_quality_score": 0 }
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
  const batchSize = Math.min(body.batch_size || 50, 200);
  const minQualityScore = body.min_quality_score ?? 0;

  let imageUpdated = 0;
  let obsUpdated = 0;
  const errors: string[] = [];

  // 1. Find vehicles needing image_count backfill
  try {
    const { data: needsImages } = await supabase
      .from('vehicles')
      .select('id')
      .eq('image_count', 0)
      .eq('is_public', true)
      .gte('data_quality_score', minQualityScore)
      .order('data_quality_score', { ascending: false })
      .limit(batchSize);

    if (needsImages?.length) {
      // Count images per vehicle in parallel
      const imgResults = await Promise.allSettled(
        needsImages.map(async (v: { id: string }) => {
          const { count } = await supabase
            .from('vehicle_images')
            .select('id', { count: 'exact', head: true })
            .eq('vehicle_id', v.id)
            .not('is_duplicate', 'eq', true);

          if (count && count > 0) {
            const { error } = await supabase
              .from('vehicles')
              .update({ image_count: count })
              .eq('id', v.id);
            if (error) throw error;
            return 1;
          }
          return 0;
        })
      );

      for (const r of imgResults) {
        if (r.status === 'fulfilled') imageUpdated += r.value;
        else errors.push(`img: ${r.reason?.message || r.reason}`);
      }
    }
  } catch (e: any) {
    errors.push(`image batch: ${e.message}`);
  }

  // 2. Find vehicles needing observation_count backfill
  try {
    const { data: needsObs } = await supabase
      .from('vehicles')
      .select('id')
      .eq('observation_count', 0)
      .eq('is_public', true)
      .gte('data_quality_score', minQualityScore)
      .order('data_quality_score', { ascending: false })
      .limit(batchSize);

    if (needsObs?.length) {
      const obsResults = await Promise.allSettled(
        needsObs.map(async (v: { id: string }) => {
          const { count } = await supabase
            .from('vehicle_observations')
            .select('id', { count: 'exact', head: true })
            .eq('vehicle_id', v.id);

          if (count && count > 0) {
            const { error } = await supabase
              .from('vehicles')
              .update({ observation_count: count })
              .eq('id', v.id);
            if (error) throw error;
            return 1;
          }
          return 0;
        })
      );

      for (const r of obsResults) {
        if (r.status === 'fulfilled') obsUpdated += r.value;
        else errors.push(`obs: ${r.reason?.message || r.reason}`);
      }
    }
  } catch (e: any) {
    errors.push(`obs batch: ${e.message}`);
  }

  return new Response(JSON.stringify({
    success: errors.length === 0,
    image_count_updated: imageUpdated,
    observation_count_updated: obsUpdated,
    batch_size: batchSize,
    errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
