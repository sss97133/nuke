import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { externalListingId } = await req.json();
    
    if (!externalListingId) {
      return new Response(
        JSON.stringify({ error: 'externalListingId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get the external listing
    // Handle both 'cars_and_bids' (DB format) and 'carsandbids' (legacy format)
    const { data: listing, error: listingError } = await supabase
      .from('external_listings')
      .select('*')
      .eq('id', externalListingId)
      .in('platform', ['cars_and_bids', 'carsandbids'])
      .single();

    if (listingError || !listing) {
      return new Response(
        JSON.stringify({ error: 'Listing not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const listingUrl = listing.listing_url;
    if (!listingUrl || !listingUrl.includes('carsandbids.com/auctions/')) {
      return new Response(
        JSON.stringify({ error: 'Invalid Cars & Bids URL' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch the listing page
    const response = await fetch(listingUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();

    // Helper functions
    const asInt = (s: string | null | undefined): number | null => {
      if (!s) return null;
      const num = parseInt(String(s).replace(/,/g, ''), 10);
      return Number.isFinite(num) && num >= 0 ? num : null;
    };

    const parseCurrency = (text: string | null | undefined): number | null => {
      if (!text) return null;
      const match = text.match(/[\$]?([\d,]+)/);
      if (match && match[1]) {
        const amount = parseInt(match[1].replace(/,/g, ''), 10);
        return Number.isFinite(amount) && amount > 0 ? amount : null;
      }
      return null;
    };

    // Extract current bid - multiple patterns
    let currentBid = listing.current_bid;
    const bidPatterns = [
      /Current\s+Bid[^>]*>.*?USD\s*\$?([\d,]+)/i,
      /Current\s+Bid[^>]*>.*?\$([\d,]+)/i,
      /<strong[^>]*class[^>]*bid[^>]*>.*?\$([\d,]+)/i,
      /"currentBid":\s*(\d+)/i,
      /data-current-bid[^>]*>.*?\$([\d,]+)/i,
      /High\s+Bid[^>]*>.*?\$([\d,]+)/i,
    ];
    
    for (const pattern of bidPatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        const bid = parseCurrency(match[1]);
        if (bid) {
          currentBid = bid;
          break;
        }
      }
    }

    // Extract bid count
    let bidCount = listing.bid_count;
    const bidCountPatterns = [
      /(\d+)\s+bids?/i,
      /Bid\s+Count[^>]*>.*?(\d+)/i,
      /"bidCount":\s*(\d+)/i,
      /data-bid-count[^>]*>.*?(\d+)/i,
    ];
    
    for (const pattern of bidCountPatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        const count = asInt(match[1]);
        if (count !== null) {
          bidCount = count;
          break;
        }
      }
    }

    // Extract watcher count
    const watcherMatch = html.match(/(\d+)\s+watchers?/i);
    const watcherCount = watcherMatch ? (asInt(watcherMatch[1]) ?? listing.watcher_count) : listing.watcher_count;

    // Extract view count
    const viewMatch = html.match(/([\d,]+)\s+views?/i);
    const viewCount = viewMatch ? (asInt(viewMatch[1]) ?? listing.view_count) : listing.view_count;

    // Check if sold
    const soldMatch = html.match(/Sold\s+for[^>]*>.*?\$([\d,]+)/i);
    const finalPrice = soldMatch?.[1] ? parseCurrency(soldMatch[1]) : null;

    const isEnded = /Auction\s+Ended/i.test(html) || !!finalPrice || /sold/i.test(html.slice(0, 5000));
    const newStatus = finalPrice ? 'sold' : (isEnded ? 'ended' : 'active');

    // Extract end date ONLY for active listings (countdown timers)
    let endDateIso: string | null = null;
    if (newStatus === 'active') {
      const endDatePatterns = [
        /data-countdown-date\s*=\s*"([^"]+)"/i,
        /data-end-date\s*=\s*"([^"]+)"/i,
        /"endDate"\s*:\s*"([^"]+)"/i,
        /Auction\s+Ends[^>]*>.*?(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2})/i,
      ];
      
      for (const pattern of endDatePatterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
          const dateStr = match[1].trim();
          const parsed = Date.parse(dateStr);
          if (Number.isFinite(parsed)) {
            endDateIso = new Date(parsed).toISOString();
            break;
          }
        }
      }
    }

    // Build update object - only update end_date if we have a new value
    // This preserves the original end_date for sold/ended auctions
    const updateObj: Record<string, any> = {
        current_bid: currentBid,
        bid_count: bidCount,
        watcher_count: watcherCount,
        view_count: viewCount,
        listing_status: newStatus,
        final_price: finalPrice,
        sold_at: finalPrice ? new Date().toISOString() : null,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };
    // Only update end_date if we extracted a value (don't clear existing)
    if (endDateIso) {
        updateObj.end_date = endDateIso;
    }

    // Update the listing
    const { error: updateError } = await supabase
      .from('external_listings')
      .update(updateObj)
      .eq('id', externalListingId);

    if (updateError) throw updateError;

    return new Response(
      JSON.stringify({
        success: true,
        listing: {
          id: externalListingId,
          current_bid: currentBid,
          bid_count: bidCount,
          watcher_count: watcherCount,
          view_count: viewCount,
          status: newStatus,
          end_date: endDateIso,
          final_price: finalPrice,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

