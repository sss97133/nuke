/**
 * Batch Market Proof Edge Function
 *
 * Finds all pipeline entries at 'discovered' stage and runs market-proof
 * analysis on each. Optionally auto-advances STRONG_BUY deals to 'target'.
 *
 * Can be called on a schedule (cron) or manually to process new discoveries.
 *
 * Input:  { batch_size?, auto_advance?, min_score_to_advance? }
 * Output: { success, processed, results[], advanced[] }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const {
      batch_size = 20,
      auto_advance = true,
      min_score_to_advance = 80,
      max_price_to_advance = 50000,
      stage_filter = 'discovered',
    } = await req.json();

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    console.log(`[batch-market-proof] Processing up to ${batch_size} entries at stage '${stage_filter}'`);

    // -----------------------------------------------------------------------
    // 1. Find unprocessed pipeline entries
    // -----------------------------------------------------------------------
    const { data: entries, error: fetchError } = await supabase
      .from('acquisition_pipeline')
      .select('id, year, make, model, asking_price')
      .eq('stage', stage_filter)
      .not('make', 'is', null)
      .order('priority', { ascending: true }) // primary first
      .order('created_at', { ascending: true })
      .limit(batch_size);

    if (fetchError) {
      throw new Error(`Failed to fetch pipeline entries: ${fetchError.message}`);
    }

    if (!entries || entries.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          processed: 0,
          message: `No entries at stage '${stage_filter}' to process`,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.log(`[batch-market-proof] Found ${entries.length} entries to process`);

    // -----------------------------------------------------------------------
    // 2. Run market-proof on each entry
    // -----------------------------------------------------------------------
    const fnBase = `${supabaseUrl.replace(/\/$/, '')}/functions/v1`;
    const results: Array<{
      id: string;
      year: number | null;
      make: string;
      model: string | null;
      asking_price: number | null;
      deal_score: number | null;
      recommendation: string | null;
      comp_count: number | null;
      comp_median: number | null;
      error: string | null;
    }> = [];

    for (const entry of entries) {
      try {
        console.log(`[batch-market-proof] Processing: ${entry.year || '?'} ${entry.make} ${entry.model || '?'}`);

        const response = await fetch(`${fnBase}/market-proof`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ pipeline_id: entry.id }),
          signal: AbortSignal.timeout(30_000),
        });

        if (!response.ok) {
          const errBody = await response.text();
          results.push({
            id: entry.id,
            year: entry.year,
            make: entry.make,
            model: entry.model,
            asking_price: entry.asking_price,
            deal_score: null,
            recommendation: null,
            comp_count: null,
            comp_median: null,
            error: `HTTP ${response.status}: ${errBody.slice(0, 200)}`,
          });
          continue;
        }

        const data = await response.json();
        results.push({
          id: entry.id,
          year: entry.year,
          make: entry.make,
          model: entry.model,
          asking_price: entry.asking_price,
          deal_score: data.deal_score,
          recommendation: data.recommendation,
          comp_count: data.comp_count,
          comp_median: data.comp_median,
          error: null,
        });
      } catch (err: unknown) {
        const isTimeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
        const msg = isTimeout ? 'market-proof timed out after 30s' : (err instanceof Error ? err.message : String(err));
        console.error(`[batch-market-proof] ${isTimeout ? 'TIMEOUT' : 'ERROR'}: ${entry.year} ${entry.make} ${entry.model} — ${msg}`);
        results.push({
          id: entry.id,
          year: entry.year,
          make: entry.make,
          model: entry.model,
          asking_price: entry.asking_price,
          deal_score: null,
          recommendation: null,
          comp_count: null,
          comp_median: null,
          error: msg,
        });
      }

      // Small delay between calls to avoid overwhelming the system
      await new Promise((r) => setTimeout(r, 200));
    }

    // -----------------------------------------------------------------------
    // 3. Auto-advance high-scoring deals to 'target'
    // -----------------------------------------------------------------------
    const advanced: string[] = [];

    if (auto_advance) {
      const toAdvance = results.filter(
        (r) =>
          r.deal_score !== null &&
          r.deal_score >= min_score_to_advance &&
          r.error === null &&
          (r.asking_price === null || r.asking_price <= max_price_to_advance),
      );

      if (toAdvance.length > 0) {
        const ids = toAdvance.map((r) => r.id);
        const { error: advanceError } = await supabase
          .from('acquisition_pipeline')
          .update({ stage: 'target' })
          .in('id', ids);

        if (advanceError) {
          console.error(`[batch-market-proof] Auto-advance error: ${advanceError.message}`);
        } else {
          advanced.push(...ids);
          console.log(`[batch-market-proof] Auto-advanced ${ids.length} deals to 'target'`);
        }
      }
    }

    // -----------------------------------------------------------------------
    // 4. Summary
    // -----------------------------------------------------------------------
    const successful = results.filter((r) => !r.error).length;
    const strongBuys = results.filter((r) => r.recommendation === 'STRONG_BUY').length;
    const buys = results.filter((r) => r.recommendation === 'BUY').length;

    console.log(`[batch-market-proof] Done: ${successful}/${entries.length} processed, ${strongBuys} STRONG_BUY, ${buys} BUY, ${advanced.length} auto-advanced`);

    return new Response(
      JSON.stringify({
        success: true,
        processed: entries.length,
        successful,
        strong_buys: strongBuys,
        buys,
        auto_advanced: advanced.length,
        results: results.map((r) => ({
          id: r.id,
          vehicle: `${r.year || '?'} ${r.make} ${r.model || '?'}`,
          asking_price: r.asking_price,
          deal_score: r.deal_score,
          recommendation: r.recommendation,
          comp_count: r.comp_count,
          comp_median: r.comp_median,
          advanced: advanced.includes(r.id),
          error: r.error,
        })),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[batch-market-proof] Error: ${message}`);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
