/**
 * HAGERTY BID TRACKER
 *
 * Scheduled function to track bid progression on active Hagerty auctions.
 * Runs periodically to capture current_bid, bid_count changes over time.
 *
 * Usage:
 * - Call manually: POST /functions/v1/hagerty-bid-tracker
 * - Schedule via cron: Every hour during active auctions
 *
 * Stores snapshots in external_listings.metadata.bid_history[]
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BidSnapshot {
  timestamp: string;
  current_bid: number | null;
  bid_count: number;
  view_count: number;
  status: string;
}

interface TrackingResult {
  listing_id: string;
  vehicle_id: string;
  title: string;
  previous_bid: number | null;
  current_bid: number | null;
  bid_change: number;
  status: string;
  error?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const startTime = Date.now();
  const results: TrackingResult[] = [];
  let totalBidChange = 0;

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Parse request options
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const { limit = 50, force = false } = body;

    console.log(`[hagerty-bid-tracker] Starting bid tracking run (limit: ${limit})`);

    // Find active Hagerty listings
    // Active = listing_status is 'active' and end_date is in the future (or null)
    const now = new Date().toISOString();
    const { data: activeListings, error: listingsError } = await supabase
      .from('external_listings')
      .select('id, vehicle_id, listing_url, listing_id, current_bid, bid_count, view_count, listing_status, metadata')
      .eq('platform', 'hagerty')
      .in('listing_status', ['active', 'live'])
      .order('updated_at', { ascending: true }) // Oldest first, so we refresh stale ones
      .limit(limit);

    if (listingsError) {
      throw new Error(`Failed to fetch active listings: ${listingsError.message}`);
    }

    if (!activeListings || activeListings.length === 0) {
      console.log('[hagerty-bid-tracker] No active Hagerty listings found');
      return new Response(JSON.stringify({
        success: true,
        message: 'No active Hagerty listings to track',
        tracked: 0,
        duration_ms: Date.now() - startTime,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`[hagerty-bid-tracker] Found ${activeListings.length} active listings to track`);

    // Get vehicle titles for reporting
    const vehicleIds = activeListings.map(l => l.vehicle_id).filter(Boolean);
    const { data: vehicles } = await supabase
      .from('vehicles')
      .select('id, year, make, model')
      .in('id', vehicleIds);

    const vehicleMap = new Map(vehicles?.map(v => [v.id, `${v.year} ${v.make} ${v.model}`]) || []);

    // Track each listing
    for (const listing of activeListings) {
      const title = vehicleMap.get(listing.vehicle_id) || 'Unknown Vehicle';

      try {
        // Call extract-hagerty-listing to get current data
        const extractUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/extract-hagerty-listing`;
        const extractResponse = await fetch(extractUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: listing.listing_url,
            // Don't save to DB - we just want the current bid info
          }),
        });

        if (!extractResponse.ok) {
          throw new Error(`Extract failed: ${extractResponse.status}`);
        }

        const extractResult = await extractResponse.json();

        if (!extractResult.success) {
          throw new Error(extractResult.error || 'Extraction failed');
        }

        const extracted = extractResult.extracted;
        const previousBid = listing.current_bid;
        const currentBid = extracted.current_bid;
        const bidChange = (currentBid || 0) - (previousBid || 0);

        // Create bid snapshot
        const snapshot: BidSnapshot = {
          timestamp: now,
          current_bid: currentBid,
          bid_count: extracted.bid_count,
          view_count: extracted.view_count,
          status: extracted.status,
        };

        // Get existing bid history or initialize
        const existingMetadata = listing.metadata || {};
        const bidHistory = existingMetadata.bid_history || [];

        // Only add snapshot if bid changed or first snapshot
        if (bidHistory.length === 0 || bidChange !== 0 || extracted.status !== listing.listing_status) {
          bidHistory.push(snapshot);

          // Keep only last 100 snapshots to prevent bloat
          if (bidHistory.length > 100) {
            bidHistory.shift();
          }
        }

        // Update external_listing with current bid info
        // Build update object conditionally to avoid overwriting with null
        const updateFields: Record<string, any> = {
            current_bid: currentBid,
            bid_count: extracted.bid_count,
            view_count: extracted.view_count,
            listing_status: extracted.status,
            final_price: extracted.status === 'sold' ? extracted.sale_price : null,
            updated_at: now,
        };
        // Update end_date with full timestamp if available (fixes countdown timer)
        if (extracted.auction_end) {
            updateFields.end_date = extracted.auction_end;
        }
        updateFields.metadata = {
              ...existingMetadata,
              bid_history: bidHistory,
              last_tracked_at: now,
              seller_username: extracted.seller_username,
              seller_slug: extracted.seller_slug,
              buyer_username: extracted.buyer_username,
              has_reserve: extracted.has_reserve,
              reserve_met: extracted.reserve_met,
              comment_count: extracted.comment_count,
        };

        const { error: updateError } = await supabase
          .from('external_listings')
          .update(updateFields)
          .eq('id', listing.id);

        if (updateError) {
          throw new Error(`Update failed: ${updateError.message}`);
        }

        totalBidChange += bidChange;

        results.push({
          listing_id: listing.id,
          vehicle_id: listing.vehicle_id,
          title,
          previous_bid: previousBid,
          current_bid: currentBid,
          bid_change: bidChange,
          status: extracted.status,
        });

        console.log(`[hagerty-bid-tracker] ${title}: $${previousBid?.toLocaleString() || 0} → $${currentBid?.toLocaleString() || 0} (${bidChange >= 0 ? '+' : ''}${bidChange})`);

        // Small delay to avoid hammering Hagerty
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (err: any) {
        console.error(`[hagerty-bid-tracker] Error tracking ${title}:`, err.message);
        results.push({
          listing_id: listing.id,
          vehicle_id: listing.vehicle_id,
          title,
          previous_bid: listing.current_bid,
          current_bid: null,
          bid_change: 0,
          status: 'error',
          error: err.message,
        });
      }
    }

    const duration = Date.now() - startTime;
    const successCount = results.filter(r => !r.error).length;
    const errorCount = results.filter(r => r.error).length;

    console.log(`[hagerty-bid-tracker] Completed: ${successCount} tracked, ${errorCount} errors, $${totalBidChange} total bid change, ${duration}ms`);

    return new Response(JSON.stringify({
      success: true,
      tracked: successCount,
      errors: errorCount,
      total_bid_change: totalBidChange,
      duration_ms: duration,
      results,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    console.error('[hagerty-bid-tracker] Fatal error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      duration_ms: Date.now() - startTime,
      results,
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
