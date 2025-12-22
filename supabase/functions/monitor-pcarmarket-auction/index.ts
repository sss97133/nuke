import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AuctionUpdate {
  current_bid?: number;
  bid_count?: number;
  view_count?: number;
  watcher_count?: number;
  comment_count?: number;
  status?: 'active' | 'sold' | 'unsold' | 'ended';
  auction_outcome?: 'sold' | 'reserve_not_met' | 'no_sale';
  final_price?: number;
  high_bid?: number;
  reserve_met?: boolean;
  auction_end_date?: string;
  last_checked_at: string;
}

/**
 * Extract current bid amount from page
 */
function extractCurrentBid(doc: any, html: string): number | null {
  // Look for bid displays
  const bidSelectors = [
    'span:contains("High bid")',
    'span:contains("Current bid")',
    'span:contains("Final bid")',
    '[class*="bid"]',
    '[class*="price"]'
  ];
  
  // Try to find bid amount in text
  const bidPatterns = [
    /(?:High|Current|Final)\s+bid[:\s]+[\$]?([\d,]+)/i,
    /[\$]([\d,]+)\s*(?:high|current|final)\s+bid/i,
    /bid[:\s]+[\$]?([\d,]+)/i
  ];
  
  for (const pattern of bidPatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      const amount = parseFloat(match[1].replace(/,/g, ''));
      if (amount > 0) return Math.round(amount * 100); // Convert to cents
    }
  }
  
  // Look in DOM
  const bidElements = doc.querySelectorAll('[class*="bid"], [class*="price"]');
  for (const el of bidElements) {
    const text = el.textContent || '';
    const match = text.match(/[\$]([\d,]+)/);
    if (match && match[1]) {
      const amount = parseFloat(match[1].replace(/,/g, ''));
      if (amount > 0) return Math.round(amount * 100);
    }
  }
  
  return null;
}

/**
 * Extract bid count
 */
function extractBidCount(doc: any, html: string): number | null {
  const patterns = [
    /(\d+)\s+bid/i,
    /bid[:\s]+(\d+)/i,
    /(\d+)\s+bids/i
  ];
  
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      return parseInt(match[1], 10);
    }
  }
  
  return null;
}

/**
 * Extract view count
 */
function extractViewCount(doc: any, html: string): number | null {
  const patterns = [
    /(\d+)\s+view/i,
    /view[:\s]+(\d+)/i,
    /(\d+)\s+views/i
  ];
  
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      return parseInt(match[1], 10);
    }
  }
  
  return null;
}

/**
 * Extract comment count
 */
function extractCommentCount(doc: any, html: string): number | null {
  // Look for comment sections
  const commentElements = doc.querySelectorAll('[class*="comment"], [id*="comment"]');
  if (commentElements.length > 0) {
    return commentElements.length;
  }
  
  // Look in text
  const patterns = [
    /(\d+)\s+comment/i,
    /comment[:\s]+(\d+)/i,
    /(\d+)\s+comments/i
  ];
  
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      return parseInt(match[1], 10);
    }
  }
  
  return null;
}

/**
 * Determine auction status and outcome
 */
function determineAuctionStatus(doc: any, html: string): {
  status: 'active' | 'sold' | 'unsold' | 'ended';
  outcome?: 'sold' | 'reserve_not_met' | 'no_sale';
  final_price?: number;
} {
  const htmlLower = html.toLowerCase();
  
  // Check for "Sold" status
  if (htmlLower.includes('sold') || htmlLower.includes('final bid')) {
    // Try to extract final price
    const finalPriceMatch = html.match(/final\s+bid[:\s]+[\$]?([\d,]+)/i);
    const finalPrice = finalPriceMatch ? parseFloat(finalPriceMatch[1].replace(/,/g, '')) : null;
    
    return {
      status: 'sold',
      outcome: 'sold',
      final_price: finalPrice ? Math.round(finalPrice * 100) : undefined
    };
  }
  
  // Check for "Unsold" or "Reserve Not Met"
  if (htmlLower.includes('unsold') || 
      htmlLower.includes('reserve not met') || 
      htmlLower.includes('reserve not reached') ||
      htmlLower.includes('rnm')) {
    return {
      status: 'unsold',
      outcome: 'reserve_not_met'
    };
  }
  
  // Check for "Ended" without sale
  if (htmlLower.includes('ended') && !htmlLower.includes('sold')) {
    return {
      status: 'ended',
      outcome: 'no_sale'
    };
  }
  
  // Default to active
  return {
    status: 'active'
  };
}

/**
 * Extract auction end date
 */
function extractAuctionEndDate(doc: any, html: string): string | null {
  // Look for countdown timers
  const countdownEl = doc.querySelector('[class*="countdown"], [class*="timer"], [id*="countdown"]');
  if (countdownEl) {
    const dataEnd = countdownEl.getAttribute('data-end') || 
                   countdownEl.getAttribute('data-end-time') ||
                   countdownEl.getAttribute('data-auction-end');
    if (dataEnd) {
      try {
        const parsed = new Date(dataEnd);
        if (!isNaN(parsed.getTime())) {
          return parsed.toISOString();
        }
      } catch (e) {}
    }
  }
  
  // Look for date patterns
  const datePatterns = [
    /ending\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i,
    /ends\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i,
    /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/
  ];
  
  for (const pattern of datePatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      try {
        const parsed = new Date(match[1]);
        if (!isNaN(parsed.getTime())) {
          return parsed.toISOString();
        }
      } catch (e) {}
    }
  }
  
  return null;
}

/**
 * Scrape auction page and extract updates
 */
async function scrapeAuctionPage(url: string): Promise<AuctionUpdate | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    
    if (!doc) {
      throw new Error('Failed to parse HTML');
    }
    
    const update: AuctionUpdate = {
      last_checked_at: new Date().toISOString()
    };
    
    // Extract all data
    update.current_bid = extractCurrentBid(doc, html);
    update.high_bid = update.current_bid || undefined;
    update.bid_count = extractBidCount(doc, html);
    update.view_count = extractViewCount(doc, html);
    update.comment_count = extractCommentCount(doc, html);
    
    // Determine status
    const statusInfo = determineAuctionStatus(doc, html);
    update.status = statusInfo.status;
    update.auction_outcome = statusInfo.outcome;
    update.final_price = statusInfo.final_price;
    
    // Extract end date
    update.auction_end_date = extractAuctionEndDate(doc, html);
    
    return update;
    
  } catch (error: any) {
    console.error(`Error scraping ${url}:`, error.message);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { vehicle_id, listing_url } = await req.json();

    if (!vehicle_id && !listing_url) {
      return new Response(
        JSON.stringify({ error: 'vehicle_id or listing_url is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get vehicle and listing URL
    let url = listing_url;
    let vehicleId = vehicle_id;

    if (!url && vehicleId) {
      const { data: vehicle } = await supabase
        .from('vehicles')
        .select('discovery_url, origin_metadata')
        .eq('id', vehicleId)
        .single();

      if (vehicle) {
        url = vehicle.discovery_url || vehicle.origin_metadata?.pcarmarket_url;
      }
    }

    if (!url) {
      return new Response(
        JSON.stringify({ error: 'Could not determine listing URL' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`🔍 Monitoring PCarMarket auction: ${url}`);

    // Scrape page for updates
    const update = await scrapeAuctionPage(url);

    if (!update) {
      return new Response(
        JSON.stringify({ error: 'Failed to scrape auction page' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update vehicle if vehicle_id provided
    if (vehicleId) {
      const vehicleUpdates: any = {
        updated_at: new Date().toISOString()
      };

      if (update.current_bid) {
        vehicleUpdates.current_value = update.current_bid;
        vehicleUpdates.high_bid = update.current_bid;
      }

      if (update.bid_count !== null) {
        vehicleUpdates.bid_count = update.bid_count;
      }

      if (update.auction_outcome) {
        vehicleUpdates.auction_outcome = update.auction_outcome;
      }

      if (update.final_price) {
        vehicleUpdates.sale_price = update.final_price;
      }

      if (update.auction_end_date) {
        vehicleUpdates.auction_end_date = update.auction_end_date;
      }

      // Update origin_metadata with latest check
      const { data: vehicle } = await supabase
        .from('vehicles')
        .select('origin_metadata')
        .eq('id', vehicleId)
        .single();

      const existingMetadata = vehicle?.origin_metadata || {};
      const updatedMetadata = {
        ...existingMetadata,
        last_checked_at: update.last_checked_at,
        current_bid: update.current_bid,
        bid_count: update.bid_count,
        view_count: update.view_count,
        comment_count: update.comment_count,
        auction_status: update.status,
        auction_outcome: update.auction_outcome
      };

      vehicleUpdates.origin_metadata = updatedMetadata;

      const { error: updateError } = await supabase
        .from('vehicles')
        .update(vehicleUpdates)
        .eq('id', vehicleId);

      if (updateError) {
        console.error('Error updating vehicle:', updateError);
      } else {
        console.log(`✅ Updated vehicle ${vehicleId} with auction data`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        listing_url: url,
        vehicle_id: vehicleId,
        update,
        changes_detected: {
          bid_changed: update.current_bid !== null,
          status_changed: update.status !== 'active',
          outcome_determined: !!update.auction_outcome
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error in monitor-pcarmarket-auction:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

