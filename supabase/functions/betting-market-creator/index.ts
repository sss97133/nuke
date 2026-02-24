import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Betting Market Creator
 *
 * Runs on cron every 30 minutes. Creates over/under prediction markets
 * for active BaT auctions that don't already have one.
 *
 * Line = sale_price * 1.5 (rounded to nearest $5k)
 * Locks at = auction_end_date - 1 hour
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

    // Find active BaT auctions without a betting market
    const { data: vehicles, error: vehicleError } = await supabase
      .from('vehicles')
      .select(`
        id, year, make, model, sale_price, listing_url,
        auction_events(auction_end_date, platform)
      `)
      .eq('auction_status', 'active')
      .ilike('listing_url', '%bringatrailer%')
      .limit(50);

    if (vehicleError) throw vehicleError;

    if (!vehicles?.length) {
      return new Response(
        JSON.stringify({ success: true, created: 0, message: 'No active BaT auctions found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get existing markets to avoid duplicates
    const vehicleIds = vehicles.map(v => v.id);
    const { data: existingMarkets } = await supabase
      .from('betting_markets')
      .select('vehicle_id')
      .in('vehicle_id', vehicleIds)
      .in('status', ['open', 'locked']);

    const existingVehicleIds = new Set((existingMarkets || []).map(m => m.vehicle_id));

    const newVehicles = vehicles.filter(v => !existingVehicleIds.has(v.id));

    if (newVehicles.length === 0) {
      return new Response(
        JSON.stringify({ success: true, created: 0, message: 'All active auctions already have markets' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let created = 0;
    const errors: any[] = [];

    for (const vehicle of newVehicles) {
      try {
        // Use sale_price or estimate for line value
        // If no sale_price yet (active auction), try to estimate from current bid or use a default
        let estimatedPrice = vehicle.sale_price;
        if (!estimatedPrice || estimatedPrice <= 0) {
          // Check if there's a monitored auction with current bid
          const { data: monitored } = await supabase
            .from('monitored_auctions')
            .select('current_bid_cents')
            .ilike('external_auction_url', `%${vehicle.listing_url?.split('/').pop() || 'NOMATCH'}%`)
            .maybeSingle();

          if (monitored?.current_bid_cents) {
            estimatedPrice = monitored.current_bid_cents / 100;
          } else {
            // Skip vehicles with no price signal
            continue;
          }
        }

        // Line = price * 1.5, rounded to nearest $5,000
        const rawLine = estimatedPrice * 1.5;
        const lineValue = Math.round(rawLine / 5000) * 5000;

        if (lineValue <= 0) continue;

        // Determine lock time: auction end - 1 hour, or 24h from now
        let locksAt: string;
        const auctionEvent = vehicle.auction_events?.[0];
        if (auctionEvent?.auction_end_date) {
          const endDate = new Date(auctionEvent.auction_end_date);
          locksAt = new Date(endDate.getTime() - 60 * 60 * 1000).toISOString();
        } else {
          // Default: locks 24h from now
          locksAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        }

        const title = `${vehicle.year} ${vehicle.make} ${vehicle.model} - Over/Under`;
        const lineDesc = `Will it sell for over or under $${lineValue.toLocaleString()}?`;

        const { error: insertError } = await supabase
          .from('betting_markets')
          .insert({
            market_type: 'auction_over_under',
            title,
            description: lineDesc,
            vehicle_id: vehicle.id,
            line_value: lineValue,
            line_description: lineDesc,
            locks_at: locksAt,
            min_bet: 100,   // $1.00
            max_bet: 10000, // $100.00
            rake_percent: 5,
          });

        if (insertError) throw insertError;
        created++;
      } catch (err: any) {
        errors.push({ vehicle_id: vehicle.id, error: err.message });
      }
    }

    const duration = Date.now() - startTime;

    return new Response(
      JSON.stringify({
        success: true,
        created,
        skipped: newVehicles.length - created - errors.length,
        errors: errors.length > 0 ? errors : undefined,
        duration_ms: duration,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[betting-market-creator] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
