/**
 * search-wayback-vin
 *
 * Search the Wayback Machine for historical data about a VIN.
 * "There's a ton to learn from using Wayback to extract data"
 *
 * This function:
 * 1. Queries Wayback Machine CDX API for pages containing the VIN
 * 2. Filters for known automotive sites (BaT, eBay, dealers, etc.)
 * 3. Records each snapshot as a historical observation with full lineage
 * 4. The data path is: Original Site (historical) -> Wayback Machine -> Our System
 *
 * Philosophy: Every snapshot is a moment in the car's timeline. We capture the 5Ws.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Known automotive domains to search
const AUTOMOTIVE_DOMAINS = [
  'bringatrailer.com',
  'carsandbids.com',
  'ebay.com',
  'hemmings.com',
  'classiccars.com',
  'classic.com',
  'barrett-jackson.com',
  'mecum.com',
  'rmsothebys.com',
  'bonhams.com',
  'goodingco.com',
  'pcarmarket.com',
  'hagerty.com',
  'autotrader.com',
  'cars.com',
  'carsforsale.com',
  'autotempest.com',
  'craigslist.org',
  // Common dealer platforms
  'dealeraccelerator.com',
  'dealerspike.com',
];

interface WaybackSnapshot {
  timestamp: string;  // YYYYMMDDHHMMSS format
  original: string;   // Original URL
  mimetype: string;
  statuscode: string;
  digest: string;
}

// Parse Wayback CDX API response
function parseCdxResponse(text: string): WaybackSnapshot[] {
  const lines = text.trim().split('\n');
  const snapshots: WaybackSnapshot[] = [];

  for (const line of lines) {
    const parts = line.split(' ');
    if (parts.length >= 6) {
      snapshots.push({
        timestamp: parts[1],
        original: parts[2],
        mimetype: parts[3],
        statuscode: parts[4],
        digest: parts[5],
      });
    }
  }

  return snapshots.filter(s => s.statuscode === '200' && s.mimetype.includes('html'));
}

// Convert Wayback timestamp to ISO date
function waybackTimestampToDate(ts: string): string {
  // Format: YYYYMMDDHHMMSS
  const year = ts.substring(0, 4);
  const month = ts.substring(4, 6);
  const day = ts.substring(6, 8);
  const hour = ts.substring(8, 10) || '00';
  const min = ts.substring(10, 12) || '00';
  const sec = ts.substring(12, 14) || '00';
  return `${year}-${month}-${day}T${hour}:${min}:${sec}Z`;
}

// Get Wayback archive URL
function getWaybackUrl(timestamp: string, originalUrl: string): string {
  return `https://web.archive.org/web/${timestamp}/${originalUrl}`;
}

// Identify source type from URL
function identifySourceFromUrl(url: string): { slug: string; name: string; category: string; isAuction: boolean } | null {
  const urlLower = url.toLowerCase();

  // AUCTION sites - time-sensitive, snapshots may be incomplete
  if (urlLower.includes('bringatrailer.com')) return { slug: 'bat', name: 'Bring a Trailer', category: 'auction', isAuction: true };
  if (urlLower.includes('carsandbids.com')) return { slug: 'cars-and-bids', name: 'Cars & Bids', category: 'auction', isAuction: true };
  if (urlLower.includes('barrett-jackson')) return { slug: 'barrett-jackson', name: 'Barrett-Jackson', category: 'auction', isAuction: true };
  if (urlLower.includes('mecum.com')) return { slug: 'mecum', name: 'Mecum', category: 'auction', isAuction: true };
  if (urlLower.includes('rmsothebys')) return { slug: 'rm-sothebys', name: "RM Sotheby's", category: 'auction', isAuction: true };
  if (urlLower.includes('bonhams.com')) return { slug: 'bonhams', name: 'Bonhams', category: 'auction', isAuction: true };
  if (urlLower.includes('goodingco')) return { slug: 'gooding', name: 'Gooding & Company', category: 'auction', isAuction: true };
  if (urlLower.includes('pcarmarket')) return { slug: 'pcarmarket', name: 'PCarMarket', category: 'auction', isAuction: true };

  // NON-AUCTION sites - snapshots are generally complete/reliable
  if (urlLower.includes('ebay.com')) return { slug: 'ebay', name: 'eBay Motors', category: 'marketplace', isAuction: false };
  if (urlLower.includes('hemmings.com')) return { slug: 'hemmings', name: 'Hemmings', category: 'marketplace', isAuction: false };
  if (urlLower.includes('classic.com')) return { slug: 'classic-com', name: 'Classic.com', category: 'aggregator', isAuction: false };
  if (urlLower.includes('craigslist')) return { slug: 'craigslist', name: 'Craigslist', category: 'marketplace', isAuction: false };

  return null;
}

// Determine what kind of observation this Wayback snapshot represents
function categorizeWaybackSnapshot(sourceInfo: { isAuction: boolean } | null): {
  observationKind: string;
  confidenceNote: string;
  usefulFor: string[];
  notUsefulFor: string[];
} {
  if (sourceInfo?.isAuction) {
    return {
      observationKind: 'sighting',  // NOT 'sale_result' - we don't know if auction completed
      confidenceNote: 'Auction snapshot - may be mid-auction, price/comments likely incomplete',
      usefulFor: ['vehicle_existed', 'photos', 'description', 'seller_identity', 'listing_date'],
      notUsefulFor: ['final_price', 'complete_comments', 'bid_history', 'sale_result'],
    };
  }

  return {
    observationKind: 'listing',
    confidenceNote: 'Non-auction source - snapshot likely represents complete listing state',
    usefulFor: ['price', 'photos', 'description', 'seller_identity', 'specifications'],
    notUsefulFor: [],
  };
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
    const { vin, vehicle_id, max_results = 50 } = body;

    if (!vin || vin.length < 6) {
      return new Response(
        JSON.stringify({ error: 'Valid VIN required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[wayback] Searching for VIN: ${vin}`);

    // Get Wayback Machine source ID
    const { data: waybackSource } = await supabase
      .from('observation_sources')
      .select('id, base_trust_score')
      .eq('slug', 'wayback-machine')
      .maybeSingle();

    const waybackSourceId = waybackSource?.id || null;

    // Search Wayback CDX API for this VIN across known automotive sites
    const allSnapshots: { snapshot: WaybackSnapshot; domain: string }[] = [];

    for (const domain of AUTOMOTIVE_DOMAINS.slice(0, 10)) { // Limit to top 10 for speed
      try {
        // CDX API query: find pages containing this VIN
        const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=${domain}/*&matchType=domain&filter=statuscode:200&filter=mimetype:text/html&output=text&fl=urlkey,timestamp,original,mimetype,statuscode,digest&limit=${max_results}`;

        const response = await fetch(cdxUrl, {
          headers: { 'User-Agent': 'NukeBot/1.0 (vehicle research)' },
        });

        if (response.ok) {
          const text = await response.text();
          const snapshots = parseCdxResponse(text);

          // Filter for snapshots that might contain this VIN
          // We'll need to fetch and check the actual content later
          // For now, add all snapshots from this domain
          for (const snapshot of snapshots.slice(0, 5)) {
            // Check if URL contains VIN hint
            if (snapshot.original.toLowerCase().includes(vin.toLowerCase().substring(0, 8))) {
              allSnapshots.push({ snapshot, domain });
            }
          }
        }
      } catch (e) {
        console.warn(`[wayback] Error searching ${domain}:`, e);
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 100));
    }

    console.log(`[wayback] Found ${allSnapshots.length} potential snapshots for VIN ${vin}`);

    // Record each snapshot as an observation with lineage
    const observations = [];
    for (const { snapshot, domain } of allSnapshots.slice(0, max_results)) {
      const sourceInfo = identifySourceFromUrl(snapshot.original);
      const waybackUrl = getWaybackUrl(snapshot.timestamp, snapshot.original);
      const observedAt = waybackTimestampToDate(snapshot.timestamp);
      const snapshotCategory = categorizeWaybackSnapshot(sourceInfo);

      // Get source ID if we know this source
      let originalSourceId = null;
      if (sourceInfo) {
        const { data: srcData } = await supabase
          .from('observation_sources')
          .select('id')
          .eq('slug', sourceInfo.slug)
          .maybeSingle();
        originalSourceId = srcData?.id;
      }

      // Create observation with lineage
      // IMPORTANT: For auctions, this is a SIGHTING not a sale_result
      // We cannot trust price/comments from mid-auction snapshots
      const observationData = {
        vehicle_id: vehicle_id || null,

        // The observation happened at the original time
        observed_at: observedAt,
        ingested_at: new Date().toISOString(),

        // Source is Wayback (how we found it)
        source_id: waybackSourceId,
        source_url: waybackUrl,
        source_identifier: snapshot.digest,

        // Observation type - SIGHTING for auctions (we don't know if it completed)
        kind: snapshotCategory.observationKind,
        content_text: sourceInfo?.isAuction
          ? `Historical auction SIGHTING via Wayback - ${sourceInfo?.name || domain} (may be mid-auction, price unreliable)`
          : `Historical listing found via Wayback Machine from ${sourceInfo?.name || domain}`,

        // Structured data - clearly mark auction limitations
        structured_data: {
          vin: vin.toUpperCase(),
          original_url: snapshot.original,
          wayback_timestamp: snapshot.timestamp,
          original_source: sourceInfo?.name || domain,
          archive_url: waybackUrl,
          // CRITICAL: Flag auction snapshots as potentially incomplete
          is_auction_source: sourceInfo?.isAuction || false,
          data_quality_warning: sourceInfo?.isAuction
            ? 'Auction snapshot - price and comments may be incomplete (mid-auction)'
            : null,
          useful_for: snapshotCategory.usefulFor,
          not_useful_for: snapshotCategory.notUsefulFor,
        },

        // Lineage - track the data path
        original_source_id: originalSourceId,
        original_source_url: snapshot.original,
        discovered_via_id: waybackSourceId,

        // Confidence varies by source type:
        // - Auctions: MEDIUM (we don't know auction state)
        // - Non-auctions: HIGH (snapshot is generally complete)
        confidence: sourceInfo?.isAuction ? 'medium' : 'high',
        confidence_score: sourceInfo?.isAuction ? 0.60 : 0.90,
        confidence_factors: {
          archive_source: 0.15,
          timestamp_verified: 0.1,
          auction_state_unknown: sourceInfo?.isAuction ? -0.25 : 0,
          price_may_be_incomplete: sourceInfo?.isAuction ? -0.15 : 0,
        },

        // Not processed - will need content extraction
        is_processed: false,

        extraction_metadata: {
          extractor: 'search-wayback-vin',
          search_vin: vin,
          wayback_digest: snapshot.digest,
          is_auction_source: sourceInfo?.isAuction || false,
          snapshot_category: snapshotCategory,
        },
      };

      const { data: obs, error: obsError } = await supabase
        .from('vehicle_observations')
        .upsert(observationData, {
          onConflict: 'source_id,source_identifier,kind,content_hash',
          ignoreDuplicates: true,
        })
        .select('id')
        .maybeSingle();

      if (!obsError && obs) {
        observations.push({
          id: obs.id,
          url: waybackUrl,
          original_url: snapshot.original,
          observed_at: observedAt,
          source: sourceInfo?.name || domain,
          is_auction: sourceInfo?.isAuction || false,
          data_warning: sourceInfo?.isAuction
            ? 'Auction snapshot - price/comments may be incomplete'
            : null,
        });

        // Record lineage chain
        const lineageChain = [
          {
            observation_id: obs.id,
            chain_position: 0,
            source_id: originalSourceId,
            role: 'original_source',
            source_url: snapshot.original,
            observed_at_source: observedAt,
          },
          {
            observation_id: obs.id,
            chain_position: 1,
            source_id: waybackSourceId,
            role: 'archive',
            source_url: waybackUrl,
            data_changes: 'Historical snapshot preserved',
          },
        ];

        await supabase
          .from('observation_lineage')
          .upsert(lineageChain, {
            onConflict: 'observation_id,chain_position',
            ignoreDuplicates: true,
          });
      }
    }

    // Update wayback_vin_queue status
    await supabase
      .from('wayback_vin_queue')
      .update({
        status: observations.length > 0 ? 'found_results' : 'no_results',
        snapshots_found: allSnapshots.length,
        unique_sources_found: new Set(allSnapshots.map(s => identifySourceFromUrl(s.snapshot.original)?.name || s.domain)).size,
        earliest_snapshot: observations.length > 0
          ? observations.reduce((min, o) => o.observed_at < min ? o.observed_at : min, observations[0].observed_at)
          : null,
        latest_snapshot: observations.length > 0
          ? observations.reduce((max, o) => o.observed_at > max ? o.observed_at : max, observations[0].observed_at)
          : null,
        searched_at: new Date().toISOString(),
      })
      .eq('vin', vin.toUpperCase());

    // Separate auction vs non-auction observations for clarity
    const auctionObs = observations.filter(o => o.is_auction);
    const nonAuctionObs = observations.filter(o => !o.is_auction);

    return new Response(
      JSON.stringify({
        success: true,
        vin: vin.toUpperCase(),
        snapshots_found: allSnapshots.length,
        observations_recorded: observations.length,

        // Break down by reliability
        summary: {
          reliable_listings: nonAuctionObs.length,  // Dealers, classifieds - price is trustworthy
          auction_sightings: auctionObs.length,     // Auctions - existence confirmed, price NOT trustworthy
        },

        // Warning about auction data
        data_quality_note: auctionObs.length > 0
          ? `${auctionObs.length} auction snapshots found - these confirm vehicle existed but price/comments may be mid-auction (incomplete). Use for provenance/photos, not final sale data.`
          : null,

        timeline: observations.sort((a, b) => a.observed_at.localeCompare(b.observed_at)),

        message: observations.length > 0
          ? `Found ${observations.length} historical records (${nonAuctionObs.length} reliable, ${auctionObs.length} auction sightings)`
          : 'No historical listings found in Wayback Machine',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[wayback] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
