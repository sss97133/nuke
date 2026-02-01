/**
 * wayback-listing-history
 *
 * Given a listing URL we already have, find ALL historical snapshots in Wayback.
 * This is the practical gold mine:
 *
 * Example: A BaT listing URL we have
 * -> Wayback might have 50 snapshots from during the auction
 * -> We can see the bid progression, comment additions, final sale
 * -> We can find the COMPLETED state even if we only have mid-auction data
 *
 * For older eBay listings, forum posts, dealer sites:
 * -> Multiple snapshots = timeline of changes
 * -> Can find contact info that's since been removed
 * -> Can find original photos that are now dead links
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Snapshot {
  timestamp: string;
  original: string;
  statuscode: string;
  digest: string;
  length: string;
}

function parseCdxResponse(text: string): Snapshot[] {
  const lines = text.trim().split('\n').filter(l => l.length > 0);
  return lines.map(line => {
    const parts = line.split(' ');
    return {
      timestamp: parts[1] || '',
      original: parts[2] || '',
      statuscode: parts[4] || '',
      digest: parts[5] || '',
      length: parts[6] || '0',
    };
  }).filter(s => s.statuscode === '200');
}

function tsToIso(ts: string): string {
  const y = ts.slice(0, 4);
  const m = ts.slice(4, 6);
  const d = ts.slice(6, 8);
  const h = ts.slice(8, 10) || '00';
  const min = ts.slice(10, 12) || '00';
  const sec = ts.slice(12, 14) || '00';
  return `${y}-${m}-${d}T${h}:${min}:${sec}Z`;
}

function getWaybackUrl(ts: string, url: string): string {
  return `https://web.archive.org/web/${ts}/${url}`;
}

// Check if this is the final auction state
async function checkAuctionState(waybackUrl: string): Promise<{
  state: 'active' | 'sold' | 'ended_no_sale' | 'unknown';
  price: number | null;
  bidCount: number | null;
  indicators: string[];
}> {
  try {
    const response = await fetch(waybackUrl, {
      headers: { 'User-Agent': 'NukeBot/1.0 (vehicle-history-research)' },
    });

    if (!response.ok) {
      return { state: 'unknown', price: null, bidCount: null, indicators: ['fetch_failed'] };
    }

    const html = await response.text();
    const indicators: string[] = [];
    let state: 'active' | 'sold' | 'ended_no_sale' | 'unknown' = 'unknown';
    let price: number | null = null;
    let bidCount: number | null = null;

    // BaT patterns
    if (html.includes('bringatrailer')) {
      // SOLD - definitive final state
      const soldMatch = html.match(/sold\s+for\s+\$?([\d,]+)/i);
      if (soldMatch) {
        state = 'sold';
        price = parseInt(soldMatch[1].replace(/,/g, ''));
        indicators.push('bat_sold_for');
      }

      // Current bid (auction active or ended without sale)
      const bidMatch = html.match(/(?:current\s+bid|bid\s+to)\s+\$?([\d,]+)/i);
      if (bidMatch && state !== 'sold') {
        price = parseInt(bidMatch[1].replace(/,/g, ''));
        indicators.push('bat_current_bid');
      }

      // Bid count
      const bidCountMatch = html.match(/(\d+)\s+(?:bids?|comments?)/i);
      if (bidCountMatch) {
        bidCount = parseInt(bidCountMatch[1]);
      }

      // Reserve status
      if (/reserve\s+not\s+met/i.test(html)) {
        indicators.push('reserve_not_met');
        if (state !== 'sold') state = 'active';
      }
      if (/reserve\s+met/i.test(html) || /no\s+reserve/i.test(html)) {
        indicators.push('reserve_met_or_none');
      }

      // Time indicators
      if (/\d+\s*(?:days?|hours?|minutes?)\s+(?:left|remaining)/i.test(html)) {
        state = 'active';
        indicators.push('time_remaining');
      }
      if (/auction\s+ended/i.test(html) && state !== 'sold') {
        state = 'ended_no_sale';
        indicators.push('auction_ended');
      }
    }

    // eBay patterns
    if (html.includes('ebay.com')) {
      const ebayWinMatch = html.match(/(?:winning\s+bid|sold\s+for)[:\s]*\$?([\d,]+)/i);
      if (ebayWinMatch) {
        state = 'sold';
        price = parseInt(ebayWinMatch[1].replace(/,/g, ''));
        indicators.push('ebay_sold');
      }

      if (/time\s+left/i.test(html) || /place\s+bid/i.test(html)) {
        if (state !== 'sold') state = 'active';
        indicators.push('ebay_active');
      }

      if (/bidding\s+has\s+ended/i.test(html) || /this\s+listing\s+has\s+ended/i.test(html)) {
        if (state !== 'sold') state = 'ended_no_sale';
        indicators.push('ebay_ended');
      }
    }

    // Cars & Bids patterns
    if (html.includes('carsandbids')) {
      const cabSoldMatch = html.match(/sold\s+for\s+\$?([\d,]+)/i);
      if (cabSoldMatch) {
        state = 'sold';
        price = parseInt(cabSoldMatch[1].replace(/,/g, ''));
        indicators.push('cab_sold');
      }

      if (/current\s+bid/i.test(html) && state !== 'sold') {
        state = 'active';
        indicators.push('cab_active');
      }
    }

    return { state, price, bidCount, indicators };
  } catch (e) {
    return { state: 'unknown', price: null, bidCount: null, indicators: ['error'] };
  }
}

// Extract data from archived page
async function extractPageData(waybackUrl: string): Promise<Record<string, any>> {
  try {
    const response = await fetch(waybackUrl, {
      headers: { 'User-Agent': 'NukeBot/1.0' },
    });

    if (!response.ok) return {};

    const html = await response.text();
    const data: Record<string, any> = {};

    // Phone numbers
    const phones = html.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g);
    if (phones) data.phones = [...new Set(phones)].slice(0, 5);

    // Emails
    const emails = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
    if (emails) data.emails = [...new Set(emails)].filter(e => !e.includes('@example')).slice(0, 5);

    // Mileage
    const mileage = html.match(/(\d{1,3}(?:,\d{3})*)\s*(?:miles|mi\b)/i);
    if (mileage) data.mileage = parseInt(mileage[1].replace(/,/g, ''));

    // VIN (try common patterns)
    const vin = html.match(/(?:vin|chassis)[:\s#]*([A-HJ-NPR-Z0-9]{17})/i);
    if (vin) data.vin = vin[1].toUpperCase();

    // Location
    const location = html.match(/(?:location|located)[:\s]+([^<\n]{5,50})/i);
    if (location) data.location = location[1].trim();

    return data;
  } catch (e) {
    return {};
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const {
      url,                      // The listing URL to find history for
      vehicle_id,               // Optional: link results to vehicle
      find_final_state = true,  // Check snapshots to find final auction state
      extract_data = false,     // Extract contact info, VIN, etc.
      max_snapshots = 50,
    } = body;

    if (!url) {
      return new Response(
        JSON.stringify({ error: 'URL required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[wayback-history] Finding history for: ${url}`);

    // Normalize URL for CDX search
    let searchUrl = url.replace(/^https?:\/\//, '').replace(/^www\./, '');

    // Query Wayback CDX for ALL snapshots of this URL
    const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(url)}&matchType=exact&output=text&fl=urlkey,timestamp,original,mimetype,statuscode,digest,length&filter=statuscode:200&collapse=timestamp:8&limit=${max_snapshots}`;

    const cdxResponse = await fetch(cdxUrl, {
      headers: { 'User-Agent': 'NukeBot/1.0' },
    });

    if (!cdxResponse.ok) {
      return new Response(
        JSON.stringify({ error: 'CDX query failed', status: cdxResponse.status }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cdxText = await cdxResponse.text();
    const snapshots = parseCdxResponse(cdxText);

    console.log(`[wayback-history] Found ${snapshots.length} snapshots`);

    if (snapshots.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          url,
          message: 'No Wayback snapshots found for this URL',
          snapshots: [],
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Process snapshots
    const results = [];
    let finalState: { state: string; price: number | null; timestamp: string } | null = null;

    for (const snapshot of snapshots) {
      const waybackUrl = getWaybackUrl(snapshot.timestamp, snapshot.original);
      const observedAt = tsToIso(snapshot.timestamp);

      const result: Record<string, any> = {
        timestamp: snapshot.timestamp,
        observed_at: observedAt,
        wayback_url: waybackUrl,
        digest: snapshot.digest,
        size_bytes: parseInt(snapshot.length),
      };

      // Check auction state if requested
      if (find_final_state) {
        const stateCheck = await checkAuctionState(waybackUrl);
        result.auction_state = stateCheck.state;
        result.price = stateCheck.price;
        result.bid_count = stateCheck.bidCount;
        result.state_indicators = stateCheck.indicators;

        // Track if we found the final "sold" state
        if (stateCheck.state === 'sold' && stateCheck.price) {
          finalState = {
            state: 'sold',
            price: stateCheck.price,
            timestamp: snapshot.timestamp,
          };
        }

        // Rate limit
        await new Promise(r => setTimeout(r, 300));
      }

      // Extract additional data if requested
      if (extract_data) {
        result.extracted_data = await extractPageData(waybackUrl);
        await new Promise(r => setTimeout(r, 300));
      }

      results.push(result);
    }

    // Sort by timestamp (oldest first)
    results.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    // Summary
    const summary = {
      total_snapshots: results.length,
      date_range: {
        earliest: results[0]?.observed_at,
        latest: results[results.length - 1]?.observed_at,
      },
      final_state: finalState,
      states_found: find_final_state
        ? [...new Set(results.map(r => r.auction_state).filter(Boolean))]
        : null,
    };

    return new Response(
      JSON.stringify({
        success: true,
        url,
        summary,
        timeline: results,
        message: finalState
          ? `Found ${results.length} snapshots. FINAL STATE: ${finalState.state} at $${finalState.price?.toLocaleString()}`
          : `Found ${results.length} snapshots spanning ${summary.date_range.earliest?.slice(0, 10)} to ${summary.date_range.latest?.slice(0, 10)}`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[wayback-history] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
