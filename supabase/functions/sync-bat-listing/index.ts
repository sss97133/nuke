import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { fetchBatPage, logFetchCost, shouldUseFirecrawlForLivePolling } from '../_shared/batFetcher.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function asInt(s?: string | null): number | null {
  if (!s) return null;
  const n = Number(String(s).replace(/[^\d]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Sync live BaT listing data (bid count, watcher count, current bid)
 * Called periodically or manually to update active listings
 * Note: verify_jwt is disabled for this function since it's called by cron/other functions
 */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { externalListingId } = await req.json();
    
    if (!externalListingId) {
      return new Response(JSON.stringify({ success: false, error: 'Missing externalListingId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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

    // COST CONTROL: For live polling, try direct fetch first without Firecrawl fallback
    // This is called frequently, so we want to minimize costs
    let fetchResult = await fetchBatPage(listing.listing_url, { skipFirecrawlFallback: true });
    
    // If direct fetch failed and auction is ending soon (< 10 min), it's worth paying for Firecrawl
    if (!fetchResult.html && shouldUseFirecrawlForLivePolling(listing.end_date, true)) {
      console.log(`[sync-bat-listing] Auction ending soon - trying Firecrawl fallback`);
      fetchResult = await fetchBatPage(listing.listing_url, { forceFirecrawl: true });
      await logFetchCost(supabase, 'sync-bat-listing', listing.listing_url, fetchResult);
    }
    
    if (!fetchResult.html) {
      // Log the failure but don't crash - we'll try again next poll
      console.warn(`[sync-bat-listing] Failed to fetch ${listing.listing_url}: ${fetchResult.error}`);
      return new Response(
        JSON.stringify({
          success: false,
          error: fetchResult.error || 'Failed to fetch listing',
          listing_id: externalListingId,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const html = fetchResult.html;

    // Determine ended/sold state early to avoid writing bogus end_date values on completed auctions.
    const isEndedText = /Auction Ended/i.test(html);
    const soldInTitle = html.match(/sold\s+for\s+\$([\d,]+)/i);

    // Extract current bid - multiple patterns to handle different HTML structures
    let currentBid = listing.current_bid;
    const bidPatterns = [
      /Current Bid[^>]*>.*?USD\s*\$?([\d,]+)/i,
      /<strong[^>]*class="info-value"[^>]*>USD\s*\$?([\d,]+)<\/strong>/i,
      /Current Bid[^>]*>.*?\$([\d,]+)/i,
      /"price":\s*(\d+)/i,  // JSON-LD schema
      /data-listing-currently[^>]*>.*?\$([\d,]+)/i
    ];
    
    for (const pattern of bidPatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        currentBid = asInt(match[1]) ?? currentBid;
        break;
      }
    }

    // Extract bid count - multiple patterns
    let bidCount = listing.bid_count;
    const bidCountPatterns = [
      /(\d+)\s+bids?/i,
      /number-bids-value[^>]*>(\d+)/i,
      /"bidCount":\s*(\d+)/i
    ];
    
    for (const pattern of bidCountPatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        bidCount = asInt(match[1]) ?? bidCount;
        break;
      }
    }

    // Extract watcher count
    const watcherMatch = html.match(/(\d+)\s+watchers?/i);
    const watcherCount = watcherMatch ? (asInt(watcherMatch[1]) ?? listing.watcher_count) : listing.watcher_count;

    // Extract view count
    const viewMatch = html.match(/([\d,]+)\s+views?/i);
    const viewCount = viewMatch ? (asInt(viewMatch[1]) ?? listing.view_count) : listing.view_count;

    // Check if sold
    const soldMatch = html.match(/Sold (?:for|to).*?\$([\\d,]+)/i);
    const finalPrice =
      (soldInTitle?.[1] ? asInt(soldInTitle[1]) : null) ??
      (soldMatch?.[1] ? asInt(soldMatch[1]) : null);

    const isEnded = isEndedText || !!finalPrice || /sold/i.test(html.slice(0, 5000));
    const newStatus = finalPrice ? 'sold' : (isEnded ? 'ended' : 'active');

    // Extract end date ONLY for active listings (countdown timers)
    let endDateIso: string | null = null;
    if (newStatus === 'active') {
      const attr = html.match(/data-countdown-date\s*=\s*"([^"]+)"/i);
      if (attr?.[1]) {
        const t = Date.parse(attr[1]);
        if (Number.isFinite(t)) endDateIso = new Date(t).toISOString();
      }

      // Fallback: choose the nearest reasonable endDate from JSON-LD if present.
      if (!endDateIso) {
        const matches = Array.from(html.matchAll(/"endDate"\s*:\s*"([^"]+)"/gi)).map((m) => m?.[1]).filter(Boolean) as string[];
        const nowMs = Date.now();
        const candidates = matches
          .map((iso) => ({ iso, t: Date.parse(iso) }))
          .filter((x) => Number.isFinite(x.t))
          .filter((x) => x.t > nowMs)
          // ignore wildly-future dates (usually unrelated schema fields)
          .filter((x) => x.t < nowMs + 35 * 24 * 60 * 60 * 1000)
          .sort((a, b) => a.t - b.t);
        if (candidates[0]) endDateIso = new Date(candidates[0].t).toISOString();
      }
    }

    // Update the listing
    const { error: updateError } = await supabase
      .from('external_listings')
      .update({
        current_bid: currentBid,
        bid_count: bidCount,
        watcher_count: watcherCount,
        view_count: viewCount,
        listing_status: newStatus,
        end_date: endDateIso,
        final_price: finalPrice,
        sold_at: finalPrice ? new Date().toISOString() : null,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', externalListingId);

    if (updateError) throw updateError;

    // If bid increased significantly, create timeline event and notification
    if (listing.current_bid && currentBid && currentBid > listing.current_bid) {
      const bidIncrease = currentBid - listing.current_bid;
      // Create timeline event for significant bid increases (every $5k or milestone)
      const isMilestone = bidIncrease >= 5000 || (currentBid % 10000) < bidIncrease;
      
      // Note: create_auction_timeline_event function may not exist, so wrap in try-catch
      if (isMilestone && listing.vehicle_id) {
        try {
          const { error: rpcError } = await supabase.rpc('create_auction_timeline_event', {
            p_vehicle_id: listing.vehicle_id,
            p_event_type: 'auction_bid_placed',
            p_listing_id: listing.id,
            p_metadata: {
              bid_amount: currentBid,
              bid_count: bidCount,
              previous_bid: listing.current_bid,
              increase: bidIncrease,
              watcher_count: watcherCount,
              view_count: viewCount
            }
          });
          // Silently ignore if function doesn't exist - it's optional
          if (rpcError && !rpcError.message.includes('does not exist')) {
            console.error('Timeline event creation error:', rpcError);
          }
          console.log(`Created timeline event for bid increase: $${bidIncrease}`);
        } catch (error) {
          console.error('Failed to create timeline event:', error);
          // Don't fail the sync if timeline event creation fails
        }
      }
      
      // Create notification event
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
            bid_increase: bidIncrease,
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
        },
        _fetch: {
          source: fetchResult.source,
          cost_cents: fetchResult.costCents,
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

