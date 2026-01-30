import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface MonitoredAuction {
  id: string;
  source_id: string;
  external_auction_id: string;
  external_auction_url: string;
  auction_end_time: string | null;
  is_in_soft_close: boolean;
  current_bid_cents: number | null;
  bid_count: number | null;
}

interface LiveAuctionSource {
  id: string;
  slug: string;
  display_name: string;
  base_url: string;
  soft_close_window_seconds: number;
  default_poll_interval_ms: number;
  soft_close_poll_interval_ms: number;
}

interface AuctionState {
  current_bid_cents: number | null;
  bid_count: number | null;
  high_bidder_username: string | null;
  auction_end_time: string | null;
  reserve_status: 'met' | 'not_met' | 'no_reserve' | 'unknown' | null;
  watcher_count: number | null;
  comment_count: number | null;
  is_ended: boolean;
}

/**
 * Unified Live Auction Sync
 *
 * Syncs auction state from any supported platform:
 * - bat (Bring a Trailer)
 * - cars-and-bids
 * - pcarmarket
 * - collecting-cars
 * - hagerty-marketplace
 * - etc.
 *
 * Can be called:
 * 1. With specific monitored_auction_id to sync one auction
 * 2. With platform slug to sync all due auctions for that platform
 * 3. Without params to sync all due auctions across all platforms
 */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const body = await req.json().catch(() => ({}));
    const { monitored_auction_id, platform_slug, force_sync } = body;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get auctions to sync
    let auctions: MonitoredAuction[] = [];
    let sources: Record<string, LiveAuctionSource> = {};

    if (monitored_auction_id) {
      // Sync specific auction
      const { data, error } = await supabase
        .from('monitored_auctions')
        .select('*, live_auction_sources(*)')
        .eq('id', monitored_auction_id)
        .single();

      if (error || !data) {
        throw new Error(`Auction not found: ${monitored_auction_id}`);
      }

      auctions = [data];
      sources[data.source_id] = data.live_auction_sources;
    } else {
      // Get auctions due for polling
      let query = supabase
        .from('monitored_auctions')
        .select('*, live_auction_sources(*)')
        .eq('is_live', true);

      if (!force_sync) {
        query = query.or('next_poll_at.is.null,next_poll_at.lte.now()');
      }

      if (platform_slug) {
        query = query.eq('live_auction_sources.slug', platform_slug);
      }

      const { data, error } = await query
        .order('is_in_soft_close', { ascending: false })
        .order('auction_end_time', { ascending: true })
        .limit(50); // Process up to 50 auctions per invocation

      if (error) throw error;

      auctions = data || [];
      for (const a of auctions) {
        if (a.live_auction_sources) {
          sources[a.source_id] = a.live_auction_sources;
        }
      }
    }

    console.log(`[sync-live-auction] Processing ${auctions.length} auctions`);

    const results = [];
    const errors = [];

    // Process each auction
    for (const auction of auctions) {
      const source = sources[auction.source_id];
      if (!source) {
        errors.push({ id: auction.id, error: 'Source not found' });
        continue;
      }

      try {
        const state = await syncAuction(supabase, auction, source);
        results.push({
          id: auction.id,
          platform: source.slug,
          success: true,
          current_bid_cents: state.current_bid_cents,
          bid_count: state.bid_count,
          is_ended: state.is_ended,
        });
      } catch (err: any) {
        console.error(`[sync-live-auction] Error syncing ${auction.id}:`, err.message);
        errors.push({ id: auction.id, error: err.message });

        // Update failure count
        await supabase
          .from('monitored_auctions')
          .update({
            last_sync_error: err.message,
            updated_at: new Date().toISOString(),
          })
          .eq('id', auction.id);
      }
    }

    const duration = Date.now() - startTime;

    return new Response(
      JSON.stringify({
        success: true,
        processed: auctions.length,
        succeeded: results.length,
        failed: errors.length,
        duration_ms: duration,
        results,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[sync-live-auction] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Sync a single auction based on its platform
 */
async function syncAuction(
  supabase: any,
  auction: MonitoredAuction,
  source: LiveAuctionSource
): Promise<AuctionState> {
  console.log(`[sync-live-auction] Syncing ${source.slug}: ${auction.external_auction_url}`);

  // Route to platform-specific extractor
  let state: AuctionState;

  switch (source.slug) {
    case 'bat':
      state = await syncBatAuction(auction.external_auction_url);
      break;
    case 'cars-and-bids':
      state = await syncCarsAndBidsAuction(auction.external_auction_url);
      break;
    case 'pcarmarket':
      state = await syncPcarmarketAuction(auction.external_auction_url);
      break;
    case 'collecting-cars':
      state = await syncCollectingCarsAuction(auction.external_auction_url);
      break;
    default:
      state = await syncGenericAuction(auction.external_auction_url);
  }

  // Calculate soft-close status
  const isInSoftClose = state.auction_end_time
    ? (new Date(state.auction_end_time).getTime() - Date.now()) / 1000 <= source.soft_close_window_seconds
    : false;

  // Calculate next poll time
  const pollInterval = isInSoftClose
    ? source.soft_close_poll_interval_ms
    : getAdaptivePollInterval(state.auction_end_time, source.default_poll_interval_ms);

  const nextPollAt = new Date(Date.now() + pollInterval).toISOString();

  // Detect bid change for bid_events
  if (auction.current_bid_cents !== null &&
      state.current_bid_cents !== null &&
      state.current_bid_cents > auction.current_bid_cents) {

    // Log bid event
    await supabase.from('bid_events').insert({
      monitored_auction_id: auction.id,
      bid_amount_cents: state.current_bid_cents,
      bidder_username: state.high_bidder_username,
      bid_time: new Date().toISOString(),
      caused_extension: state.auction_end_time !== auction.auction_end_time,
      new_end_time: state.auction_end_time !== auction.auction_end_time ? state.auction_end_time : null,
    });
  }

  // Detect extension
  const extensionDetected = auction.auction_end_time &&
    state.auction_end_time &&
    new Date(state.auction_end_time) > new Date(auction.auction_end_time);

  // Update monitored_auctions - basic fields first
  const updateData: Record<string, any> = {
    current_bid_cents: state.current_bid_cents,
    bid_count: state.bid_count,
    high_bidder_username: state.high_bidder_username,
    auction_end_time: state.auction_end_time,
    reserve_status: state.reserve_status,
    is_in_soft_close: isInSoftClose,
    is_live: !state.is_ended,
    last_synced_at: new Date().toISOString(),
    poll_interval_ms: pollInterval,
    next_poll_at: state.is_ended ? null : nextPollAt,
    updated_at: new Date().toISOString(),
  };

  if (extensionDetected) {
    updateData.last_extension_at = new Date().toISOString();
  }

  await supabase
    .from('monitored_auctions')
    .update(updateData)
    .eq('id', auction.id);

  // If extension detected, increment counter separately
  if (extensionDetected) {
    await supabase.rpc('increment_extension_count', {
      p_auction_id: auction.id
    }).then(() => {}).catch(() => {
      // RPC may not exist, that's OK - we already set last_extension_at
    });
  }

  // Update auction_state_cache for frontend realtime subscriptions (optional)
  try {
    await supabase.rpc('update_auction_state', {
      p_monitored_auction_id: auction.id,
      p_current_bid_cents: state.current_bid_cents,
      p_bid_count: state.bid_count,
      p_high_bidder: state.high_bidder_username,
      p_auction_end_time: state.auction_end_time,
      p_reserve_status: state.reserve_status,
      p_sync_latency_ms: 0,
    });
  } catch {
    // Function may not exist, that's OK
  }

  return state;
}

/**
 * Calculate adaptive poll interval based on time remaining
 */
function getAdaptivePollInterval(endTime: string | null, defaultInterval: number): number {
  if (!endTime) return defaultInterval;

  const remainingMs = new Date(endTime).getTime() - Date.now();

  if (remainingMs <= 0) return defaultInterval; // Ended
  if (remainingMs <= 2 * 60 * 1000) return 5000;     // < 2 min: 5s
  if (remainingMs <= 10 * 60 * 1000) return 15000;   // < 10 min: 15s
  if (remainingMs <= 60 * 60 * 1000) return 30000;   // < 1 hour: 30s
  return defaultInterval;
}

// ============================================================================
// Platform-specific extractors
// ============================================================================

async function syncBatAuction(url: string): Promise<AuctionState> {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  if (!resp.ok) {
    throw new Error(`BaT fetch failed: ${resp.status}`);
  }

  const html = await resp.text();
  return parseBatHtml(html);
}

function parseBatHtml(html: string): AuctionState {
  const isEnded = /Auction Ended/i.test(html) || /sold\s+for\s+\$/i.test(html);

  // Current bid
  let currentBidCents: number | null = null;
  const bidMatch = html.match(/Current Bid[^>]*>.*?USD\s*\$?([\d,]+)/i) ||
                   html.match(/\$([\d,]+)\s+bid placed by/i);
  if (bidMatch?.[1]) {
    currentBidCents = parseInt(bidMatch[1].replace(/,/g, ''), 10) * 100;
  }

  // Bid count
  let bidCount: number | null = null;
  const bidCountMatches = html.match(/\$[\d,]+\s+bid placed by/gi);
  if (bidCountMatches) {
    bidCount = bidCountMatches.length;
  }

  // High bidder
  let highBidder: string | null = null;
  const bidderMatch = html.match(/bid placed by\s+<[^>]+>([^<]+)</i);
  if (bidderMatch?.[1]) {
    highBidder = bidderMatch[1].trim();
  }

  // End time - try multiple patterns
  let endTime: string | null = null;

  // Pattern 1: data-countdown-date attribute
  const countdownMatch = html.match(/data-countdown-date\s*=\s*"([^"]+)"/i);
  if (countdownMatch?.[1]) {
    const t = Date.parse(countdownMatch[1]);
    if (Number.isFinite(t)) {
      endTime = new Date(t).toISOString();
    }
  }

  // Pattern 2: JSON-LD endDate (most reliable for BaT)
  if (!endTime) {
    const jsonLdMatches = html.match(/"endDate"\s*:\s*"([^"]+)"/gi);
    if (jsonLdMatches) {
      const now = Date.now();
      for (const match of jsonLdMatches) {
        const dateMatch = match.match(/"endDate"\s*:\s*"([^"]+)"/i);
        if (dateMatch?.[1]) {
          const t = Date.parse(dateMatch[1]);
          // Only use future dates within 30 days
          if (Number.isFinite(t) && t > now && t < now + 30 * 24 * 60 * 60 * 1000) {
            endTime = new Date(t).toISOString();
            break;
          }
        }
      }
    }
  }

  // Reserve status
  let reserveStatus: 'met' | 'not_met' | 'no_reserve' | 'unknown' = 'unknown';
  if (/No Reserve/i.test(html)) {
    reserveStatus = 'no_reserve';
  } else if (/Reserve Met/i.test(html)) {
    reserveStatus = 'met';
  } else if (/Reserve Not Met/i.test(html)) {
    reserveStatus = 'not_met';
  }

  // Watcher count
  let watcherCount: number | null = null;
  const watcherMatch = html.match(/>\s*([\d,]+)\s*<\/?\w*>\s*watchers?\s*</i);
  if (watcherMatch?.[1]) {
    watcherCount = parseInt(watcherMatch[1].replace(/,/g, ''), 10);
  }

  // Comment count
  let commentCount: number | null = null;
  const commentMatch = html.match(/>\s*([\d,]+)\s*<\/?\w*>\s*comments?\s*</i);
  if (commentMatch?.[1]) {
    commentCount = parseInt(commentMatch[1].replace(/,/g, ''), 10);
  }

  return {
    current_bid_cents: currentBidCents,
    bid_count: bidCount,
    high_bidder_username: highBidder,
    auction_end_time: endTime,
    reserve_status: reserveStatus,
    watcher_count: watcherCount,
    comment_count: commentCount,
    is_ended: isEnded,
  };
}

async function syncCarsAndBidsAuction(url: string): Promise<AuctionState> {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  if (!resp.ok) {
    throw new Error(`Cars & Bids fetch failed: ${resp.status}`);
  }

  const html = await resp.text();

  // Cars & Bids uses similar patterns to BaT
  const isEnded = /auction\s+ended/i.test(html) || /sold\s+for/i.test(html);

  // Current bid - C&B format
  let currentBidCents: number | null = null;
  const bidMatch = html.match(/Current Bid[:\s]*\$?([\d,]+)/i) ||
                   html.match(/class="[^"]*bid[^"]*"[^>]*>\s*\$?([\d,]+)/i);
  if (bidMatch?.[1]) {
    currentBidCents = parseInt(bidMatch[1].replace(/,/g, ''), 10) * 100;
  }

  // Bid count
  let bidCount: number | null = null;
  const bidCountMatch = html.match(/(\d+)\s+bids?/i);
  if (bidCountMatch?.[1]) {
    bidCount = parseInt(bidCountMatch[1], 10);
  }

  // End time
  let endTime: string | null = null;
  const endTimeMatch = html.match(/data-[^=]*end[^=]*=\s*["']([^"']+)["']/i) ||
                       html.match(/"endDate"\s*:\s*"([^"]+)"/i);
  if (endTimeMatch?.[1]) {
    const t = Date.parse(endTimeMatch[1]);
    if (Number.isFinite(t)) {
      endTime = new Date(t).toISOString();
    }
  }

  // Reserve status - C&B typically no reserve
  let reserveStatus: 'met' | 'not_met' | 'no_reserve' | 'unknown' = 'no_reserve';
  if (/reserve\s+met/i.test(html)) {
    reserveStatus = 'met';
  } else if (/reserve\s+not\s+met/i.test(html)) {
    reserveStatus = 'not_met';
  }

  return {
    current_bid_cents: currentBidCents,
    bid_count: bidCount,
    high_bidder_username: null, // Would need more parsing
    auction_end_time: endTime,
    reserve_status: reserveStatus,
    watcher_count: null,
    comment_count: null,
    is_ended: isEnded,
  };
}

async function syncPcarmarketAuction(url: string): Promise<AuctionState> {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });

  if (!resp.ok) {
    throw new Error(`PCARMARKET fetch failed: ${resp.status}`);
  }

  const html = await resp.text();

  const isEnded = /auction\s+ended/i.test(html) || /sold/i.test(html.slice(0, 5000));

  // PCARMARKET bid patterns
  let currentBidCents: number | null = null;
  const bidMatch = html.match(/Current Bid[:\s]*\$?([\d,]+)/i) ||
                   html.match(/High Bid[:\s]*\$?([\d,]+)/i);
  if (bidMatch?.[1]) {
    currentBidCents = parseInt(bidMatch[1].replace(/,/g, ''), 10) * 100;
  }

  let bidCount: number | null = null;
  const bidCountMatch = html.match(/(\d+)\s+bids?/i);
  if (bidCountMatch?.[1]) {
    bidCount = parseInt(bidCountMatch[1], 10);
  }

  let endTime: string | null = null;
  const endTimeMatch = html.match(/data-countdown[^=]*=\s*["']([^"']+)["']/i) ||
                       html.match(/"endDate"\s*:\s*"([^"]+)"/i);
  if (endTimeMatch?.[1]) {
    const t = Date.parse(endTimeMatch[1]);
    if (Number.isFinite(t)) {
      endTime = new Date(t).toISOString();
    }
  }

  return {
    current_bid_cents: currentBidCents,
    bid_count: bidCount,
    high_bidder_username: null,
    auction_end_time: endTime,
    reserve_status: 'unknown',
    watcher_count: null,
    comment_count: null,
    is_ended: isEnded,
  };
}

async function syncCollectingCarsAuction(url: string): Promise<AuctionState> {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });

  if (!resp.ok) {
    throw new Error(`Collecting Cars fetch failed: ${resp.status}`);
  }

  const html = await resp.text();

  const isEnded = /auction\s+ended/i.test(html) || /sold/i.test(html.slice(0, 5000));

  // Collecting Cars patterns (UK site, uses GBP often)
  let currentBidCents: number | null = null;
  const bidMatch = html.match(/Current Bid[:\s]*[£$€]?([\d,]+)/i) ||
                   html.match(/High Bid[:\s]*[£$€]?([\d,]+)/i);
  if (bidMatch?.[1]) {
    currentBidCents = parseInt(bidMatch[1].replace(/,/g, ''), 10) * 100;
  }

  let bidCount: number | null = null;
  const bidCountMatch = html.match(/(\d+)\s+bids?/i);
  if (bidCountMatch?.[1]) {
    bidCount = parseInt(bidCountMatch[1], 10);
  }

  let endTime: string | null = null;
  // Collecting Cars uses various date formats
  const endTimeMatch = html.match(/data-[^=]*end[^=]*=\s*["']([^"']+)["']/i) ||
                       html.match(/"endDate"\s*:\s*"([^"]+)"/i);
  if (endTimeMatch?.[1]) {
    const t = Date.parse(endTimeMatch[1]);
    if (Number.isFinite(t)) {
      endTime = new Date(t).toISOString();
    }
  }

  return {
    current_bid_cents: currentBidCents,
    bid_count: bidCount,
    high_bidder_username: null,
    auction_end_time: endTime,
    reserve_status: 'unknown',
    watcher_count: null,
    comment_count: null,
    is_ended: isEnded,
  };
}

async function syncGenericAuction(url: string): Promise<AuctionState> {
  // Generic fallback - try to extract common patterns
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
  });

  if (!resp.ok) {
    throw new Error(`Fetch failed: ${resp.status}`);
  }

  const html = await resp.text();

  const isEnded = /auction\s+ended/i.test(html) || /sold\s+for/i.test(html);

  let currentBidCents: number | null = null;
  const bidMatch = html.match(/(?:Current|High)\s*Bid[:\s]*\$?([\d,]+)/i);
  if (bidMatch?.[1]) {
    currentBidCents = parseInt(bidMatch[1].replace(/,/g, ''), 10) * 100;
  }

  let bidCount: number | null = null;
  const bidCountMatch = html.match(/(\d+)\s+bids?/i);
  if (bidCountMatch?.[1]) {
    bidCount = parseInt(bidCountMatch[1], 10);
  }

  let endTime: string | null = null;
  const endTimeMatch = html.match(/"endDate"\s*:\s*"([^"]+)"/i);
  if (endTimeMatch?.[1]) {
    const t = Date.parse(endTimeMatch[1]);
    if (Number.isFinite(t)) {
      endTime = new Date(t).toISOString();
    }
  }

  return {
    current_bid_cents: currentBidCents,
    bid_count: bidCount,
    high_bidder_username: null,
    auction_end_time: endTime,
    reserve_status: 'unknown',
    watcher_count: null,
    comment_count: null,
    is_ended: isEnded,
  };
}
