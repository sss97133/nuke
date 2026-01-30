import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

/**
 * Live Auction Cron - Scheduled Sync Coordinator
 *
 * Called periodically to:
 * 1. Find all auctions due for polling
 * 2. Batch them by urgency (soft-close first)
 * 3. Invoke sync-live-auction for each batch
 * 4. Track sync health metrics
 *
 * Can be triggered by pg_cron, external scheduler, or manual invocation.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AuctionDue {
  id: string;
  source_slug: string;
  is_in_soft_close: boolean;
  seconds_until_end: number | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log(`[live-auction-cron] Starting sync cycle at ${new Date().toISOString()}`);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get auctions due for polling, prioritized by urgency
    const { data: auctionsDue, error: queryError } = await supabase
      .from('monitored_auctions')
      .select(`
        id,
        source_id,
        external_auction_url,
        auction_end_time,
        is_in_soft_close,
        live_auction_sources!inner(slug, is_active)
      `)
      .eq('is_live', true)
      .eq('live_auction_sources.is_active', true)
      .or('next_poll_at.is.null,next_poll_at.lte.now()')
      .order('is_in_soft_close', { ascending: false })
      .order('auction_end_time', { ascending: true, nullsFirst: false })
      .limit(100); // Process up to 100 auctions per cycle

    if (queryError) {
      throw queryError;
    }

    const totalDue = auctionsDue?.length || 0;
    console.log(`[live-auction-cron] Found ${totalDue} auctions due for sync`);

    if (totalDue === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No auctions due for sync',
          processed: 0,
          duration_ms: Date.now() - startTime,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Categorize by urgency
    const softCloseAuctions: string[] = [];
    const urgentAuctions: string[] = []; // < 10 min
    const normalAuctions: string[] = [];

    for (const auction of auctionsDue || []) {
      if (auction.is_in_soft_close) {
        softCloseAuctions.push(auction.id);
      } else if (auction.auction_end_time) {
        const secondsRemaining = (new Date(auction.auction_end_time).getTime() - Date.now()) / 1000;
        if (secondsRemaining <= 600) {
          urgentAuctions.push(auction.id);
        } else {
          normalAuctions.push(auction.id);
        }
      } else {
        normalAuctions.push(auction.id);
      }
    }

    console.log(`[live-auction-cron] Breakdown: ${softCloseAuctions.length} soft-close, ${urgentAuctions.length} urgent, ${normalAuctions.length} normal`);

    // Process auctions - soft-close and urgent first, in parallel batches
    const results = {
      soft_close: { processed: 0, succeeded: 0, failed: 0 },
      urgent: { processed: 0, succeeded: 0, failed: 0 },
      normal: { processed: 0, succeeded: 0, failed: 0 },
    };

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Helper to sync a batch of auctions
    const syncBatch = async (ids: string[], category: keyof typeof results) => {
      const batchSize = 10; // Process 10 at a time

      for (let i = 0; i < ids.length; i += batchSize) {
        const batch = ids.slice(i, i + batchSize);

        // Sync batch in parallel
        const promises = batch.map(async (id) => {
          try {
            const resp = await fetch(`${supabaseUrl}/functions/v1/sync-live-auction`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${serviceKey}`,
              },
              body: JSON.stringify({ monitored_auction_id: id }),
            });

            const data = await resp.json();
            results[category].processed++;

            if (data.success && data.succeeded > 0) {
              results[category].succeeded++;
            } else {
              results[category].failed++;
            }
          } catch (err) {
            console.error(`[live-auction-cron] Failed to sync ${id}:`, err);
            results[category].processed++;
            results[category].failed++;
          }
        });

        await Promise.all(promises);
      }
    };

    // Process in priority order
    // 1. Soft-close auctions - these need immediate attention
    if (softCloseAuctions.length > 0) {
      console.log(`[live-auction-cron] Processing ${softCloseAuctions.length} soft-close auctions`);
      await syncBatch(softCloseAuctions, 'soft_close');
    }

    // 2. Urgent auctions (< 10 min)
    if (urgentAuctions.length > 0) {
      console.log(`[live-auction-cron] Processing ${urgentAuctions.length} urgent auctions`);
      await syncBatch(urgentAuctions, 'urgent');
    }

    // 3. Normal auctions - only if we have time budget left
    const elapsedMs = Date.now() - startTime;
    const timebudgetMs = 25000; // Leave 5s buffer before next cron tick

    if (normalAuctions.length > 0 && elapsedMs < timebudgetMs) {
      const remainingBudget = timebudgetMs - elapsedMs;
      const estimatedPerAuction = 500; // ~500ms per auction
      const maxNormal = Math.floor(remainingBudget / estimatedPerAuction);
      const toProcess = normalAuctions.slice(0, Math.min(maxNormal, normalAuctions.length));

      console.log(`[live-auction-cron] Processing ${toProcess.length}/${normalAuctions.length} normal auctions (time budget)`);
      await syncBatch(toProcess, 'normal');
    }

    // Update source health metrics
    const { data: sources } = await supabase
      .from('live_auction_sources')
      .select('id, slug');

    for (const source of sources || []) {
      const { count: activeCount } = await supabase
        .from('monitored_auctions')
        .select('*', { count: 'exact', head: true })
        .eq('source_id', source.id)
        .eq('is_live', true);

      const { count: failedCount } = await supabase
        .from('monitored_auctions')
        .select('*', { count: 'exact', head: true })
        .eq('source_id', source.id)
        .eq('is_live', true)
        .gt('consecutive_failures', 0);

      // Update health status
      let healthStatus = 'healthy';
      if (failedCount && activeCount && failedCount > activeCount * 0.5) {
        healthStatus = 'unhealthy';
      } else if (failedCount && failedCount > 0) {
        healthStatus = 'degraded';
      }

      await supabase
        .from('live_auction_sources')
        .update({
          health_status: healthStatus,
          last_successful_sync: new Date().toISOString(),
        })
        .eq('id', source.id);
    }

    const totalProcessed = results.soft_close.processed + results.urgent.processed + results.normal.processed;
    const totalSucceeded = results.soft_close.succeeded + results.urgent.succeeded + results.normal.succeeded;
    const totalFailed = results.soft_close.failed + results.urgent.failed + results.normal.failed;
    const duration = Date.now() - startTime;

    console.log(`[live-auction-cron] Completed: ${totalSucceeded}/${totalProcessed} succeeded in ${duration}ms`);

    // Log metrics (optional - table may not exist)
    try {
      await supabase.from('sync_metrics').insert({
        sync_type: 'live_auction_cron',
        auctions_due: totalDue,
        auctions_processed: totalProcessed,
        auctions_succeeded: totalSucceeded,
        auctions_failed: totalFailed,
        soft_close_count: softCloseAuctions.length,
        urgent_count: urgentAuctions.length,
        normal_count: normalAuctions.length,
        duration_ms: duration,
        created_at: new Date().toISOString(),
      });
    } catch {
      // Metrics table may not exist yet - that's OK
    }

    return new Response(
      JSON.stringify({
        success: true,
        auctions_due: totalDue,
        processed: totalProcessed,
        succeeded: totalSucceeded,
        failed: totalFailed,
        breakdown: results,
        duration_ms: duration,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[live-auction-cron] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
