/**
 * wayback-deep-mine
 *
 * DEEP historical mining of Wayback Machine for vehicle data.
 * This goes back to the 1990s - nobody else is doing this.
 *
 * Strategy:
 * 1. Search Wayback CDX for VIN appearances across ALL domains
 * 2. For auction sites (BaT, eBay), detect completion state
 * 3. Extract structured data from archived pages
 * 4. Build historical provenance chains
 *
 * For BaT specifically:
 * - Check if auction ran full 7 days
 * - Look for "Sold" vs "Bid" in page content
 * - Cross-reference with our existing data
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface WaybackSnapshot {
  timestamp: string;
  original: string;
  statuscode: string;
  digest: string;
  length: string;
}

interface MiningResult {
  url: string;
  wayback_url: string;
  timestamp: string;
  observed_at: string;
  source_type: string;
  is_complete: boolean | null;  // null = unknown
  confidence: number;
  extracted_data: Record<string, any>;
  provenance_value: string;  // 'high', 'medium', 'low'
}

// Parse CDX API response (space-delimited)
function parseCdxResponse(text: string): WaybackSnapshot[] {
  const lines = text.trim().split('\n').filter(l => l.length > 0);
  return lines.map(line => {
    const parts = line.split(' ');
    return {
      timestamp: parts[1] || '',
      original: parts[2] || '',
      statuscode: parts[4] || '',
      digest: parts[5] || '',
      length: parts[6] || '',
    };
  }).filter(s => s.statuscode === '200');
}

// Convert timestamp to date
function tsToDate(ts: string): Date {
  const y = ts.slice(0, 4);
  const m = ts.slice(4, 6);
  const d = ts.slice(6, 8);
  const h = ts.slice(8, 10) || '00';
  const min = ts.slice(10, 12) || '00';
  const sec = ts.slice(12, 14) || '00';
  return new Date(`${y}-${m}-${d}T${h}:${min}:${sec}Z`);
}

function tsToIso(ts: string): string {
  return tsToDate(ts).toISOString();
}

function getWaybackUrl(ts: string, url: string): string {
  return `https://web.archive.org/web/${ts}/${url}`;
}

// Detect source type and how to handle it
function classifySource(url: string): {
  type: string;
  name: string;
  needsCompletionCheck: boolean;
  auctionDuration?: number;  // days
  provenanceValue: 'high' | 'medium' | 'low';
} {
  const u = url.toLowerCase();

  // High-value auction sources (need completion check)
  if (u.includes('bringatrailer.com')) {
    return { type: 'auction', name: 'Bring a Trailer', needsCompletionCheck: true, auctionDuration: 7, provenanceValue: 'high' };
  }
  if (u.includes('carsandbids.com')) {
    return { type: 'auction', name: 'Cars & Bids', needsCompletionCheck: true, auctionDuration: 7, provenanceValue: 'high' };
  }
  if (u.includes('ebay.com') || u.includes('cgi.ebay.com')) {
    return { type: 'auction', name: 'eBay Motors', needsCompletionCheck: true, auctionDuration: 7, provenanceValue: 'high' };
  }
  if (u.includes('pcarmarket.com')) {
    return { type: 'auction', name: 'PCarMarket', needsCompletionCheck: true, auctionDuration: 10, provenanceValue: 'high' };
  }

  // High-value non-auction (complete as-is)
  if (u.includes('rmsothebys.com')) {
    return { type: 'auction_house', name: "RM Sotheby's", needsCompletionCheck: false, provenanceValue: 'high' };
  }
  if (u.includes('bonhams.com')) {
    return { type: 'auction_house', name: 'Bonhams', needsCompletionCheck: false, provenanceValue: 'high' };
  }
  if (u.includes('barrett-jackson.com')) {
    return { type: 'auction_house', name: 'Barrett-Jackson', needsCompletionCheck: false, provenanceValue: 'high' };
  }
  if (u.includes('mecum.com')) {
    return { type: 'auction_house', name: 'Mecum', needsCompletionCheck: false, provenanceValue: 'high' };
  }
  if (u.includes('goodingco.com')) {
    return { type: 'auction_house', name: 'Gooding & Company', needsCompletionCheck: false, provenanceValue: 'high' };
  }

  // Dealer/classified (snapshot = complete listing)
  if (u.includes('hemmings.com')) {
    return { type: 'classified', name: 'Hemmings', needsCompletionCheck: false, provenanceValue: 'high' };
  }
  if (u.includes('classiccars.com')) {
    return { type: 'classified', name: 'ClassicCars.com', needsCompletionCheck: false, provenanceValue: 'medium' };
  }
  if (u.includes('autotrader.com')) {
    return { type: 'classified', name: 'AutoTrader', needsCompletionCheck: false, provenanceValue: 'medium' };
  }
  if (u.includes('craigslist.org')) {
    return { type: 'classified', name: 'Craigslist', needsCompletionCheck: false, provenanceValue: 'high' }; // High because owner contact info
  }
  if (u.includes('cars.com')) {
    return { type: 'classified', name: 'Cars.com', needsCompletionCheck: false, provenanceValue: 'medium' };
  }

  // Forums (high provenance - owner discussions)
  if (u.includes('rennlist.com') || u.includes('pelican') || u.includes('forum')) {
    return { type: 'forum', name: 'Forum', needsCompletionCheck: false, provenanceValue: 'high' };
  }

  // Generic
  return { type: 'unknown', name: 'Unknown', needsCompletionCheck: false, provenanceValue: 'low' };
}

// Fetch page content and check for auction completion indicators
async function checkAuctionCompletion(waybackUrl: string, sourceType: string): Promise<{
  isComplete: boolean | null;
  finalPrice: number | null;
  indicators: string[];
}> {
  try {
    const response = await fetch(waybackUrl, {
      headers: { 'User-Agent': 'NukeBot/1.0 (vehicle-history-research)' },
    });

    if (!response.ok) {
      return { isComplete: null, finalPrice: null, indicators: ['fetch_failed'] };
    }

    const html = await response.text();
    const indicators: string[] = [];
    let isComplete: boolean | null = null;
    let finalPrice: number | null = null;

    // BaT-specific checks
    if (sourceType === 'Bring a Trailer') {
      // "Sold" indicator (final state)
      if (/sold\s+for\s+\$[\d,]+/i.test(html)) {
        isComplete = true;
        indicators.push('sold_for_text');
        const match = html.match(/sold\s+for\s+\$([\d,]+)/i);
        if (match) finalPrice = parseInt(match[1].replace(/,/g, ''));
      }
      // "Bid to" usually means still active or no reserve met
      else if (/bid\s+to\s+\$[\d,]+/i.test(html)) {
        isComplete = false;
        indicators.push('bid_to_text_active');
      }
      // "Reserve not met" = incomplete
      if (/reserve\s+not\s+met/i.test(html)) {
        isComplete = false;
        indicators.push('reserve_not_met');
      }
      // "Auction ended" without "Sold" = no sale
      if (/auction\s+ended/i.test(html) && !/sold/i.test(html)) {
        isComplete = true;  // Ended but didn't sell
        indicators.push('auction_ended_no_sale');
      }
    }

    // eBay-specific checks
    if (sourceType === 'eBay Motors') {
      if (/winning\s+bid/i.test(html) || /sold\s+for/i.test(html)) {
        isComplete = true;
        indicators.push('ebay_sold');
        const match = html.match(/(?:winning\s+bid|sold\s+for)[:\s]*\$?([\d,]+)/i);
        if (match) finalPrice = parseInt(match[1].replace(/,/g, ''));
      }
      if (/time\s+left/i.test(html) || /place\s+bid/i.test(html)) {
        isComplete = false;
        indicators.push('ebay_active');
      }
      if (/ended/i.test(html)) {
        indicators.push('ebay_ended');
        if (isComplete === null) isComplete = true;
      }
    }

    // Cars & Bids
    if (sourceType === 'Cars & Bids') {
      if (/sold\s+for\s+\$[\d,]+/i.test(html)) {
        isComplete = true;
        indicators.push('cab_sold');
        const match = html.match(/sold\s+for\s+\$([\d,]+)/i);
        if (match) finalPrice = parseInt(match[1].replace(/,/g, ''));
      }
      if (/current\s+bid/i.test(html) && !/sold/i.test(html)) {
        isComplete = false;
        indicators.push('cab_active');
      }
    }

    return { isComplete, finalPrice, indicators };
  } catch (e) {
    return { isComplete: null, finalPrice: null, indicators: ['error'] };
  }
}

// Extract useful data from page content
async function extractPageData(waybackUrl: string, sourceType: string): Promise<Record<string, any>> {
  try {
    const response = await fetch(waybackUrl, {
      headers: { 'User-Agent': 'NukeBot/1.0 (vehicle-history-research)' },
    });

    if (!response.ok) return {};

    const html = await response.text();
    const data: Record<string, any> = {};

    // Phone numbers (provenance gold!)
    const phoneMatches = html.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g);
    if (phoneMatches) {
      data.phone_numbers = [...new Set(phoneMatches)].slice(0, 5);
    }

    // Email addresses
    const emailMatches = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
    if (emailMatches) {
      data.emails = [...new Set(emailMatches)].filter(e => !e.includes('example.com')).slice(0, 5);
    }

    // Mileage patterns
    const mileageMatch = html.match(/(\d{1,3}(?:,\d{3})*)\s*(?:miles|mi\b)/i);
    if (mileageMatch) {
      data.mileage = parseInt(mileageMatch[1].replace(/,/g, ''));
    }

    // Price patterns
    const priceMatch = html.match(/\$\s*([\d,]+)(?:\.\d{2})?/);
    if (priceMatch) {
      data.price_found = parseInt(priceMatch[1].replace(/,/g, ''));
    }

    // Location patterns
    const locationMatch = html.match(/(?:location|located\s+in)[:\s]+([^<\n]{5,50})/i);
    if (locationMatch) {
      data.location = locationMatch[1].trim();
    }

    // Seller/dealer name patterns
    const sellerMatch = html.match(/(?:seller|sold\s+by|dealer)[:\s]+([^<\n]{3,50})/i);
    if (sellerMatch) {
      data.seller = sellerMatch[1].trim();
    }

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
      vin,
      vehicle_id,
      deep_extract = false,  // Fetch actual page content
      check_completion = true,  // Check if auctions completed
      max_results = 100,
    } = body;

    if (!vin || vin.length < 11) {
      return new Response(
        JSON.stringify({ error: 'Valid VIN required (11+ chars)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[wayback-deep] Mining VIN: ${vin} (deep=${deep_extract}, check_completion=${check_completion})`);

    // Search Wayback CDX for this VIN across ALL archived pages
    // This is the magic - searches the entire archive
    const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=*&matchType=domain&filter=statuscode:200&output=text&fl=urlkey,timestamp,original,mimetype,statuscode,digest,length&limit=${max_results * 10}`;

    // Actually, we need to search by content, not URL. CDX only searches URLs.
    // For VIN search, we need to use the Wayback availability API or search known domains.

    // Strategy: Search each known automotive domain for pages containing this VIN in the URL
    const domainsToSearch = [
      'bringatrailer.com',
      'carsandbids.com',
      'ebay.com',
      'cgi.ebay.com',
      'hemmings.com',
      'classiccars.com',
      'autotrader.com',
      'cars.com',
      'craigslist.org',
      'rmsothebys.com',
      'bonhams.com',
      'mecum.com',
      'barrett-jackson.com',
      'pcarmarket.com',
      'classic.com',
      'dupontregistry.com',
      'autotempest.com',
      'carsforsale.com',
      'rennlist.com',
      'pelicanparts.com',
    ];

    const allSnapshots: WaybackSnapshot[] = [];

    // Search each domain for URLs containing the VIN
    for (const domain of domainsToSearch) {
      try {
        // CDX search for URLs containing VIN on this domain
        const searchUrl = `https://web.archive.org/cdx/search/cdx?url=${domain}/*${vin}*&matchType=prefix&filter=statuscode:200&output=text&fl=urlkey,timestamp,original,mimetype,statuscode,digest,length&collapse=digest&limit=50`;

        const response = await fetch(searchUrl, {
          headers: { 'User-Agent': 'NukeBot/1.0' },
        });

        if (response.ok) {
          const text = await response.text();
          if (text.trim()) {
            const snapshots = parseCdxResponse(text);
            allSnapshots.push(...snapshots);
            console.log(`[wayback-deep] ${domain}: ${snapshots.length} snapshots`);
          }
        }

        // Rate limit
        await new Promise(r => setTimeout(r, 200));
      } catch (e) {
        console.warn(`[wayback-deep] Error searching ${domain}:`, e);
      }
    }

    // Also try a broader search - any URL containing the VIN
    try {
      const broadSearchUrl = `https://web.archive.org/cdx/search/cdx?url=*${vin}*&matchType=prefix&filter=statuscode:200&output=text&fl=urlkey,timestamp,original,mimetype,statuscode,digest,length&collapse=digest&limit=100`;

      const response = await fetch(broadSearchUrl, {
        headers: { 'User-Agent': 'NukeBot/1.0' },
      });

      if (response.ok) {
        const text = await response.text();
        if (text.trim()) {
          const snapshots = parseCdxResponse(text);
          // Dedupe by digest
          const existingDigests = new Set(allSnapshots.map(s => s.digest));
          const newSnapshots = snapshots.filter(s => !existingDigests.has(s.digest));
          allSnapshots.push(...newSnapshots);
          console.log(`[wayback-deep] Broad search: ${newSnapshots.length} new snapshots`);
        }
      }
    } catch (e) {
      console.warn('[wayback-deep] Broad search error:', e);
    }

    console.log(`[wayback-deep] Total snapshots found: ${allSnapshots.length}`);

    // Process each snapshot
    const results: MiningResult[] = [];

    for (const snapshot of allSnapshots.slice(0, max_results)) {
      const sourceClass = classifySource(snapshot.original);
      const waybackUrl = getWaybackUrl(snapshot.timestamp, snapshot.original);
      const observedAt = tsToIso(snapshot.timestamp);

      let isComplete: boolean | null = null;
      let completionIndicators: string[] = [];
      let finalPrice: number | null = null;
      let extractedData: Record<string, any> = {};

      // Check auction completion if needed
      if (check_completion && sourceClass.needsCompletionCheck) {
        const completion = await checkAuctionCompletion(waybackUrl, sourceClass.name);
        isComplete = completion.isComplete;
        completionIndicators = completion.indicators;
        finalPrice = completion.finalPrice;
      } else if (!sourceClass.needsCompletionCheck) {
        // Non-auction sources are always "complete"
        isComplete = true;
      }

      // Deep extract if requested
      if (deep_extract) {
        extractedData = await extractPageData(waybackUrl, sourceClass.name);
        if (finalPrice) extractedData.final_price = finalPrice;
      }

      // Calculate confidence
      let confidence = 0.5;
      if (isComplete === true) confidence = 0.90;
      else if (isComplete === false) confidence = 0.40;
      if (sourceClass.provenanceValue === 'high') confidence += 0.05;
      if (extractedData.phone_numbers?.length > 0) confidence += 0.05;

      results.push({
        url: snapshot.original,
        wayback_url: waybackUrl,
        timestamp: snapshot.timestamp,
        observed_at: observedAt,
        source_type: sourceClass.name,
        is_complete: isComplete,
        confidence: Math.min(confidence, 1.0),
        extracted_data: {
          ...extractedData,
          completion_indicators: completionIndicators,
          final_price: finalPrice,
        },
        provenance_value: sourceClass.provenanceValue,
      });

      // Rate limit for deep extraction
      if (deep_extract || check_completion) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // Sort by date (oldest first - build timeline)
    results.sort((a, b) => a.observed_at.localeCompare(b.observed_at));

    // Summary stats
    const summary = {
      total_snapshots: results.length,
      by_source: {} as Record<string, number>,
      by_provenance: { high: 0, medium: 0, low: 0 },
      complete_auctions: results.filter(r => r.is_complete === true).length,
      incomplete_auctions: results.filter(r => r.is_complete === false).length,
      with_contact_info: results.filter(r =>
        r.extracted_data.phone_numbers?.length > 0 || r.extracted_data.emails?.length > 0
      ).length,
      date_range: results.length > 0
        ? { earliest: results[0].observed_at, latest: results[results.length - 1].observed_at }
        : null,
    };

    for (const r of results) {
      summary.by_source[r.source_type] = (summary.by_source[r.source_type] || 0) + 1;
      summary.by_provenance[r.provenance_value]++;
    }

    return new Response(
      JSON.stringify({
        success: true,
        vin: vin.toUpperCase(),
        summary,
        timeline: results,
        message: results.length > 0
          ? `Found ${results.length} historical records spanning ${summary.date_range?.earliest?.slice(0, 4)} to ${summary.date_range?.latest?.slice(0, 4)}`
          : 'No historical records found',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[wayback-deep] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
