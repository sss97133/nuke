import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Sync live BaT listing data (bid count, watcher count, current bid)
 * Called periodically or manually to update active listings
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { externalListingId } = await req.json();

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get the external listing
    const { data: listing, error: listingError } = await supabase
      .from('external_listings')
      .select('*')
      .eq('id', externalListingId)
      .single();

    if (listingError || !listing) {
      throw new Error('Listing not found');
    }

    console.log(`Syncing BaT listing: ${listing.listing_url}`);

    // Fetch the BaT page
    const response = await fetch(listing.listing_url);
    const html = await response.text();

    // Extract current bid
    const bidMatch = html.match(/(?:Current Bid|Bid to|High Bid).*?USD \$([\\d,]+)/);
    const currentBid = bidMatch ? parseInt(bidMatch[1].replace(/,/g, '')) : listing.current_bid;

    // Extract bid count
    const bidCountMatch = html.match(/(\d+)\s+Bids?/i);
    const bidCount = bidCountMatch ? parseInt(bidCountMatch[1]) : listing.bid_count;

    // Extract watcher count
    const watcherMatch = html.match(/(\d+)\s+watchers?/i);
    const watcherCount = watcherMatch ? parseInt(watcherMatch[1]) : listing.watcher_count;

    // Extract view count
    const viewMatch = html.match(/([\d,]+)\s+views?/i);
    const viewCount = viewMatch ? parseInt(viewMatch[1].replace(/,/g, '')) : listing.view_count;

    // Check if auction ended
    const endedMatch = html.match(/Auction Ended/i);
    const isEnded = endedMatch !== null;

    // Check if sold
    const soldMatch = html.match(/Sold (?:for|to).*?\$([\\d,]+)/i);
    const finalPrice = soldMatch ? parseInt(soldMatch[1].replace(/,/g, '')) : null;

    const newStatus = finalPrice ? 'sold' : (isEnded ? 'ended' : 'active');

    // Update the listing
    const { error: updateError } = await supabase
      .from('external_listings')
      .update({
        current_bid: currentBid,
        bid_count: bidCount,
        watcher_count: watcherCount,
        view_count: viewCount,
        listing_status: newStatus,
        final_price: finalPrice,
        sold_at: finalPrice ? new Date().toISOString() : null,
        last_synced_at: new Date().toISOString()
      })
      .eq('id', externalListingId);

    if (updateError) throw updateError;

    // If bid increased significantly, create notification event
    if (listing.current_bid && currentBid && currentBid > listing.current_bid) {
      await supabase
        .from('notification_events')
        .insert({
          event_type: 'vehicle_price_change',
          entity_type: 'vehicle',
          entity_id: listing.vehicle_id,
          metadata: {
            platform: 'bat',
            old_bid: listing.current_bid,
            new_bid: currentBid,
            bid_increase: currentBid - listing.current_bid,
            listing_url: listing.listing_url
          }
        });
    }

    // If auction ending soon (< 24h), create notification
    if (listing.end_date && newStatus === 'active') {
      const hoursRemaining = (new Date(listing.end_date).getTime() - Date.now()) / (1000 * 60 * 60);
      if (hoursRemaining > 0 && hoursRemaining <= 24) {
        await supabase
          .from('notification_events')
          .insert({
            event_type: 'auction_ending_soon',
            entity_type: 'vehicle',
            entity_id: listing.vehicle_id,
            metadata: {
              platform: 'bat',
              hours_remaining: Math.round(hoursRemaining),
              current_bid: currentBid,
              listing_url: listing.listing_url
            }
          });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        listing: {
          id: externalListingId,
          currentBid,
          bidCount,
          watcherCount,
          viewCount,
          status: newStatus,
          finalPrice
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error syncing BaT listing:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

