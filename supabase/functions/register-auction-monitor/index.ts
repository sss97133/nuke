import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Register Auction for Live Monitoring
 *
 * Adds an auction to the monitored_auctions table for real-time sync.
 *
 * Request body:
 * - auction_url: The full URL of the auction page (required)
 * - platform: Platform slug (optional - will auto-detect from URL)
 * - vehicle_id: Link to internal vehicle record (optional)
 * - user_id: User requesting monitoring (optional, for notifications)
 * - priority: Override priority (optional, default uses platform priority)
 */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { auction_url, platform, vehicle_id, user_id, priority } = body;

    if (!auction_url) {
      return new Response(
        JSON.stringify({ success: false, error: 'auction_url is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Detect platform from URL if not provided
    const detectedPlatform = platform || detectPlatform(auction_url);
    if (!detectedPlatform) {
      return new Response(
        JSON.stringify({ success: false, error: 'Could not detect platform from URL' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get source configuration
    const { data: source, error: sourceError } = await supabase
      .from('live_auction_sources')
      .select('*')
      .eq('slug', detectedPlatform)
      .single();

    if (sourceError || !source) {
      return new Response(
        JSON.stringify({ success: false, error: `Platform '${detectedPlatform}' not configured` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract auction ID from URL
    const externalAuctionId = extractAuctionId(auction_url, detectedPlatform);

    // Check if already monitored
    const { data: existing } = await supabase
      .from('monitored_auctions')
      .select('id, is_live')
      .eq('source_id', source.id)
      .eq('external_auction_id', externalAuctionId)
      .maybeSingle();

    if (existing) {
      // If already exists but not live, reactivate
      if (!existing.is_live) {
        await supabase
          .from('monitored_auctions')
          .update({
            is_live: true,
            next_poll_at: new Date().toISOString(),
            watching_user_ids: user_id
              ? supabase.raw(`array_append(COALESCE(watching_user_ids, '{}'), '${user_id}'::uuid)`)
              : undefined,
          })
          .eq('id', existing.id);
      } else if (user_id) {
        // Add user to watchers if not already
        await supabase
          .from('monitored_auctions')
          .update({
            watching_user_ids: supabase.raw(`
              CASE
                WHEN NOT ('${user_id}'::uuid = ANY(COALESCE(watching_user_ids, '{}')))
                THEN array_append(COALESCE(watching_user_ids, '{}'), '${user_id}'::uuid)
                ELSE watching_user_ids
              END
            `),
          })
          .eq('id', existing.id);
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Auction already being monitored',
          monitored_auction_id: existing.id,
          platform: detectedPlatform,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch initial auction state
    console.log(`[register-auction-monitor] Fetching initial state for ${auction_url}`);

    let initialState: any = {};
    try {
      const resp = await fetch(auction_url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      });

      if (resp.ok) {
        const html = await resp.text();
        initialState = parseAuctionState(html, detectedPlatform);
      }
    } catch (err) {
      console.warn(`[register-auction-monitor] Could not fetch initial state:`, err);
    }

    // Create monitored auction record
    const { data: newAuction, error: insertError } = await supabase
      .from('monitored_auctions')
      .insert({
        source_id: source.id,
        external_auction_id: externalAuctionId,
        external_auction_url: auction_url,
        vehicle_id: vehicle_id || null,
        auction_start_time: null,
        auction_end_time: initialState.auction_end_time || null,
        current_bid_cents: initialState.current_bid_cents || null,
        bid_count: initialState.bid_count || 0,
        high_bidder_username: initialState.high_bidder_username || null,
        reserve_status: initialState.reserve_status || 'unknown',
        is_live: !initialState.is_ended,
        is_in_soft_close: false,
        priority: priority || source.priority,
        watching_user_ids: user_id ? [user_id] : [],
        next_poll_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      throw insertError;
    }

    // Immediately trigger first sync
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

      fetch(`${supabaseUrl}/functions/v1/sync-live-auction`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ monitored_auction_id: newAuction.id }),
      }).catch(() => {});
    } catch {}

    console.log(`[register-auction-monitor] Registered ${detectedPlatform} auction: ${externalAuctionId}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Auction registered for monitoring',
        monitored_auction_id: newAuction.id,
        platform: detectedPlatform,
        initial_state: initialState,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[register-auction-monitor] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Detect platform from auction URL
 */
function detectPlatform(url: string): string | null {
  const urlLower = url.toLowerCase();

  if (urlLower.includes('bringatrailer.com')) return 'bat';
  if (urlLower.includes('carsandbids.com')) return 'cars-and-bids';
  if (urlLower.includes('pcarmarket.com')) return 'pcarmarket';
  if (urlLower.includes('collectingcars.com')) return 'collecting-cars';
  if (urlLower.includes('hagerty.com/marketplace')) return 'hagerty-marketplace';
  if (urlLower.includes('mecum.com')) return 'mecum';
  if (urlLower.includes('barrett-jackson.com')) return 'barrett-jackson';
  if (urlLower.includes('rmsothebys.com')) return 'rm-sothebys';
  if (urlLower.includes('bonhams.com')) return 'bonhams';
  if (urlLower.includes('broadarrowauctions.com')) return 'broad-arrow';
  if (urlLower.includes('themarket.co.uk')) return 'the-market';
  if (urlLower.includes('sbxcars.com')) return 'sbx-cars';
  if (urlLower.includes('hemmings.com')) return 'hemmings';
  if (urlLower.includes('issimi.com')) return 'issimi';
  if (urlLower.includes('kickdown.com')) return 'kickdown';
  if (urlLower.includes('thembmarket.com')) return 'mb-market';

  return null;
}

/**
 * Extract auction ID from URL
 */
function extractAuctionId(url: string, platform: string): string {
  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname;

    switch (platform) {
      case 'bat':
        // https://bringatrailer.com/listing/2024-porsche-911-gt3-rs/
        const batMatch = path.match(/\/listing\/([^\/]+)/);
        return batMatch?.[1] || path;

      case 'cars-and-bids':
        // https://carsandbids.com/auctions/abc123/2023-toyota-supra
        const cabMatch = path.match(/\/auctions\/([^\/]+)/);
        return cabMatch?.[1] || path;

      case 'pcarmarket':
        // https://pcarmarket.com/auction/123456
        const pcmMatch = path.match(/\/auction\/([^\/]+)/);
        return pcmMatch?.[1] || path;

      case 'collecting-cars':
        // https://collectingcars.com/for-sale/slug-name
        const ccMatch = path.match(/\/for-sale\/([^\/]+)/);
        return ccMatch?.[1] || path;

      default:
        // Use last path segment
        const segments = path.split('/').filter(Boolean);
        return segments[segments.length - 1] || path;
    }
  } catch {
    return url;
  }
}

/**
 * Parse auction state from HTML
 */
function parseAuctionState(html: string, platform: string): any {
  const isEnded = /auction\s+ended/i.test(html) || /sold\s+for/i.test(html);

  // Current bid
  let currentBidCents: number | null = null;
  const bidMatch = html.match(/Current Bid[^>]*>.*?\$?([\d,]+)/i) ||
                   html.match(/High Bid[^>]*>.*?\$?([\d,]+)/i);
  if (bidMatch?.[1]) {
    currentBidCents = parseInt(bidMatch[1].replace(/,/g, ''), 10) * 100;
  }

  // Bid count
  let bidCount: number | null = null;
  if (platform === 'bat') {
    const bidMatches = html.match(/\$[\d,]+\s+bid placed by/gi);
    if (bidMatches) bidCount = bidMatches.length;
  } else {
    const countMatch = html.match(/(\d+)\s+bids?/i);
    if (countMatch?.[1]) bidCount = parseInt(countMatch[1], 10);
  }

  // High bidder
  let highBidderUsername: string | null = null;
  const bidderMatch = html.match(/bid placed by\s+<[^>]+>([^<]+)</i);
  if (bidderMatch?.[1]) highBidderUsername = bidderMatch[1].trim();

  // End time
  let auctionEndTime: string | null = null;
  const endMatch = html.match(/data-countdown-date\s*=\s*"([^"]+)"/i) ||
                   html.match(/"endDate"\s*:\s*"([^"]+)"/i);
  if (endMatch?.[1]) {
    const t = Date.parse(endMatch[1]);
    if (Number.isFinite(t)) auctionEndTime = new Date(t).toISOString();
  }

  // Reserve status
  let reserveStatus = 'unknown';
  if (/No Reserve/i.test(html)) reserveStatus = 'no_reserve';
  else if (/Reserve Met/i.test(html)) reserveStatus = 'met';
  else if (/Reserve Not Met/i.test(html)) reserveStatus = 'not_met';

  return {
    current_bid_cents: currentBidCents,
    bid_count: bidCount,
    high_bidder_username: highBidderUsername,
    auction_end_time: auctionEndTime,
    reserve_status: reserveStatus,
    is_ended: isEnded,
  };
}
