/**
 * Forensics Process Broadcast - Edge Function
 *
 * Cloud-triggerable forensics processing. Processes one chunk at a time
 * to stay within edge function timeout limits.
 *
 * Endpoints:
 *   POST /forensics-process-broadcast
 *     - action: "status" - Get queue status
 *     - action: "process-chunk" - Process next chunk of a broadcast
 *     - action: "trigger-local" - Signal local workers to start (webhook)
 *
 * For full broadcast processing, use local workers or trigger repeatedly.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const { action, broadcast_id, webhook_url } = await req.json();

    // ════════════════════════════════════════════════════════════════
    // STATUS - Get queue overview
    // ════════════════════════════════════════════════════════════════
    if (action === 'status') {
      const { data: queue } = await supabase
        .from('broadcast_backfill_queue')
        .select('*')
        .order('priority', { ascending: false });

      const { count: forensicsCount } = await supabase
        .from('auction_events')
        .select('*', { count: 'exact', head: true })
        .not('forensics_data', 'is', null);

      const { count: flaggedCount } = await supabase
        .from('auction_events')
        .select('*', { count: 'exact', head: true })
        .not('forensics_data', 'is', null)
        .gt('forensics_data->alertScore', 30);

      const byStatus: Record<string, number> = {};
      for (const item of queue || []) {
        byStatus[item.status] = (byStatus[item.status] || 0) + 1;
      }

      const totalHours = Math.round((queue || []).reduce((s, i) => s + (i.duration_seconds || 0), 0) / 3600);

      return new Response(JSON.stringify({
        queue: {
          total: queue?.length || 0,
          totalHours,
          pending: byStatus['pending'] || 0,
          processing: byStatus['processing'] || 0,
          completed: byStatus['completed'] || 0,
        },
        forensics: {
          vehiclesAnalyzed: forensicsCount || 0,
          flaggedAlerts: flaggedCount || 0,
        },
        broadcasts: queue?.slice(0, 10).map(b => ({
          id: b.id,
          name: `[${b.auction_house}] ${b.auction_name} ${b.broadcast_date}`,
          status: b.status,
          duration: Math.round(b.duration_seconds / 60),
          lotsLinked: b.lots_linked || 0,
        })),
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ════════════════════════════════════════════════════════════════
    // TRIGGER-LOCAL - Webhook to signal local workers
    // ════════════════════════════════════════════════════════════════
    if (action === 'trigger-local') {
      // This would notify a local service to start processing
      // For now, just return instructions
      return new Response(JSON.stringify({
        message: 'Local worker trigger',
        instructions: [
          'Run locally: npx tsx scripts/broadcast-backfill-worker.ts --all',
          'Or parallel: npx tsx scripts/forensics-worker-parallel.ts --workers=3',
        ],
        webhook_url: webhook_url || 'Not configured',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ════════════════════════════════════════════════════════════════
    // GET-FLAGGED - Return flagged vehicles for review
    // ════════════════════════════════════════════════════════════════
    if (action === 'get-flagged') {
      const { data: flagged } = await supabase
        .from('auction_events')
        .select(`
          id, lot_number, estimate_low, estimate_high, winning_bid,
          forensics_data,
          vehicles(id, year, make, model)
        `)
        .not('forensics_data', 'is', null)
        .gt('forensics_data->alertScore', 30)
        .order('forensics_data->alertScore', { ascending: false })
        .limit(50);

      return new Response(JSON.stringify({
        count: flagged?.length || 0,
        flagged: flagged?.map(f => ({
          vehicle: `${(f.vehicles as any)?.year} ${(f.vehicles as any)?.make} ${(f.vehicles as any)?.model}`,
          lotNumber: f.lot_number,
          estimate: f.estimate_low && f.estimate_high
            ? `$${(f.estimate_low/1000).toFixed(0)}K-$${(f.estimate_high/1000).toFixed(0)}K`
            : null,
          finalPrice: f.winning_bid ? `$${f.winning_bid.toLocaleString()}` : 'No sale',
          alertScore: f.forensics_data?.alertScore,
          reasons: f.forensics_data?.alerts,
          duration: f.forensics_data?.duration,
          bidCount: f.forensics_data?.bidCount,
        })),
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      error: 'Unknown action',
      available: ['status', 'trigger-local', 'get-flagged'],
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
