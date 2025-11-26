import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

/**
 * Monitor Price Drops for Auto-Buy Triggers
 * 
 * Checks active listings for price changes and triggers auto-buy orders
 * when prices drop to watchlist target prices.
 * 
 * Like limit buy orders in stock market - executes when price hits target
 */

interface Deno {
  serve: (handler: (req: Request) => Promise<Response>) => void;
}

Deno.serve(async (req: Request) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('🔍 Monitoring price drops for auto-buy triggers...');

    // Get all active external listings with prices
    const { data: listings, error: listingsError } = await supabase
      .from('external_listings')
      .select('*, vehicles(*)')
      .eq('listing_status', 'active')
      .not('current_bid', 'is', null);

    if (listingsError) throw listingsError;

    console.log(`📊 Checking ${listings?.length || 0} active listings`);

    let triggersFound = 0;
    let executionsCreated = 0;

    // Check each listing for auto-buy triggers
    for (const listing of listings || []) {
      const currentPrice = listing.current_bid || listing.buy_now_price;
      if (!currentPrice) continue;

      const vehicle = listing.vehicles;
      if (!vehicle) continue;

      // Check if price triggers any auto-buy orders
      const { data: triggers, error: triggerError } = await supabase.rpc(
        'check_auto_buy_trigger',
        {
          p_vehicle_id: vehicle.id,
          p_current_price: currentPrice,
          p_listing_type: listing.buy_now_price ? 'buy_now' : 'auction'
        }
      );

      if (triggerError) {
        console.error(`Error checking triggers for ${vehicle.id}:`, triggerError);
        continue;
      }

      if (!triggers || triggers.length === 0) continue;

      triggersFound += triggers.length;

      // Create execution records for each trigger
      for (const trigger of triggers) {
        try {
          // Check if execution already exists
          const { data: existing } = await supabase
            .from('auto_buy_executions')
            .select('id')
            .eq('watchlist_id', trigger.watchlist_id)
            .eq('vehicle_id', vehicle.id)
            .eq('execution_type', trigger.execution_type)
            .in('status', ['pending', 'executing'])
            .single();

          if (existing) {
            console.log(`  ⏭️  Execution already exists for watchlist ${trigger.watchlist_id}`);
            continue;
          }

          // Create execution record
          const { data: execution, error: execError } = await supabase
            .from('auto_buy_executions')
            .insert({
              watchlist_id: trigger.watchlist_id,
              vehicle_id: vehicle.id,
              external_listing_id: listing.id,
              execution_type: trigger.execution_type,
              target_price: trigger.target_price,
              executed_price: currentPrice,
              status: 'pending',
              requires_confirmation: true // Default to requiring confirmation
            })
            .select('id')
            .single();

          if (execError) {
            console.error(`  ❌ Error creating execution:`, execError);
            continue;
          }

          console.log(`  ✅ Created auto-buy execution: ${execution.id}`);
          console.log(`     Watchlist: ${trigger.watchlist_id}`);
          console.log(`     Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
          console.log(`     Price: $${currentPrice} (target: $${trigger.target_price})`);
          console.log(`     Type: ${trigger.execution_type}`);

          executionsCreated++;

          // Update price monitoring
          await supabase
            .from('price_monitoring')
            .upsert({
              vehicle_id: vehicle.id,
              external_listing_id: listing.id,
              current_price: currentPrice,
              monitor_type: 'watchlist_auto_buy',
              target_price: trigger.target_price,
              watchlist_id: trigger.watchlist_id,
              is_active: true,
              triggered: true,
              triggered_at: new Date().toISOString()
            }, {
              onConflict: 'vehicle_id,external_listing_id,watchlist_id'
            });

          // If auto-buy doesn't require confirmation, execute immediately
          // Otherwise, create notification for user to confirm
          // (Notification system integration would go here)

        } catch (error) {
          console.error(`  ❌ Error processing trigger:`, error);
          continue;
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        listings_checked: listings?.length || 0,
        triggers_found: triggersFound,
        executions_created: executionsCreated
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});


