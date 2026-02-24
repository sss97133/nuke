import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Betting Market Settler
 *
 * Runs on cron every 5 minutes. Checks for betting markets linked to
 * vehicles whose auctions have ended, and settles them:
 *
 * - If sale_price > 0: settle as 'yes' (over) or 'no' (under) vs line_value
 * - If no sale (reserve not met): settle as 'push' (refund all bets)
 */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Find open/locked markets whose vehicles have ended
    const { data: markets, error: marketError } = await supabase
      .from('betting_markets')
      .select(`
        id, line_value, vehicle_id, status,
        vehicles!inner(id, auction_status, sale_price)
      `)
      .in('status', ['open', 'locked'])
      .not('vehicle_id', 'is', null);

    if (marketError) throw marketError;

    if (!markets?.length) {
      return new Response(
        JSON.stringify({ success: true, settled: 0, message: 'No markets to settle' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Filter to only those with ended auctions
    const endedMarkets = markets.filter((m: any) => {
      const vehicle = m.vehicles;
      return vehicle?.auction_status === 'ended' || vehicle?.auction_status === 'sold' || vehicle?.auction_status === 'no_sale';
    });

    if (endedMarkets.length === 0) {
      return new Response(
        JSON.stringify({ success: true, settled: 0, message: 'No ended auctions to settle' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let settled = 0;
    let pushed = 0;
    const errors: any[] = [];

    for (const market of endedMarkets) {
      try {
        const vehicle = (market as any).vehicles;
        const salePrice = vehicle?.sale_price;

        let outcome: string;
        let resolutionValue: number;

        if (salePrice && salePrice > 0) {
          // Auction sold — settle based on sale price vs line
          resolutionValue = salePrice;
          outcome = salePrice > market.line_value ? 'yes' : 'no';
        } else {
          // No sale (reserve not met, withdrawn, etc.) — push/refund
          outcome = 'push';
          resolutionValue = 0;
        }

        const { data: result, error: settleError } = await supabase.rpc('settle_market', {
          p_market_id: market.id,
          p_outcome: outcome,
          p_resolution_value: resolutionValue,
        });

        if (settleError) throw settleError;

        if (result?.success) {
          if (outcome === 'push') {
            pushed++;
          } else {
            settled++;
          }
        }
      } catch (err: any) {
        errors.push({ market_id: market.id, error: err.message });
      }
    }

    const duration = Date.now() - startTime;

    return new Response(
      JSON.stringify({
        success: true,
        settled,
        pushed,
        errors: errors.length > 0 ? errors : undefined,
        duration_ms: duration,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[betting-market-settler] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
