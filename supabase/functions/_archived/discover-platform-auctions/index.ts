import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Discover Platform Auctions
 *
 * Scans a platform's listing pages to find all active auctions
 * and registers them for monitoring.
 *
 * Supported platforms:
 * - bat: Scans bringatrailer.com homepage and active auctions
 * - cars-and-bids: Scans carsandbids.com active listings
 * - pcarmarket: Scans pcarmarket.com auctions
 * - collecting-cars: Scans collectingcars.com live auctions
 *
 * Request body:
 * - platform: Platform slug (required)
 * - limit: Max auctions to register (default: 50)
 */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const body = await req.json().catch(() => ({}));
    const { platform, limit = 50 } = body;

    if (!platform) {
      return new Response(
        JSON.stringify({ success: false, error: 'platform is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Verify platform exists
    const { data: source, error: sourceError } = await supabase
      .from('live_auction_sources')
      .select('*')
      .eq('slug', platform)
      .single();

    if (sourceError || !source) {
      return new Response(
        JSON.stringify({ success: false, error: `Platform '${platform}' not configured` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[discover-platform-auctions] Discovering auctions on ${platform}`);

    // Get already monitored auction IDs to avoid duplicates
    const { data: existing } = await supabase
      .from('monitored_auctions')
      .select('external_auction_id')
      .eq('source_id', source.id);

    const existingIds = new Set((existing || []).map(a => a.external_auction_id));

    // Discover auctions based on platform
    let auctionUrls: string[] = [];

    switch (platform) {
      case 'bat':
        auctionUrls = await discoverBatAuctions(limit);
        break;
      case 'cars-and-bids':
        auctionUrls = await discoverCarsAndBidsAuctions(limit);
        break;
      case 'pcarmarket':
        auctionUrls = await discoverPcarmarketAuctions(limit);
        break;
      case 'collecting-cars':
        auctionUrls = await discoverCollectingCarsAuctions(limit);
        break;
      default:
        return new Response(
          JSON.stringify({ success: false, error: `Discovery not implemented for '${platform}'` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    console.log(`[discover-platform-auctions] Found ${auctionUrls.length} auction URLs on ${platform}`);

    // Register new auctions
    const registered: string[] = [];
    const skipped: string[] = [];
    const failed: string[] = [];

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    for (const url of auctionUrls) {
      const auctionId = extractAuctionId(url, platform);

      if (existingIds.has(auctionId)) {
        skipped.push(auctionId);
        continue;
      }

      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/register-auction-monitor`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ auction_url: url, platform }),
        });

        const data = await resp.json();

        if (data.success) {
          registered.push(auctionId);
          existingIds.add(auctionId); // Prevent re-registering in same run
        } else {
          failed.push(auctionId);
        }
      } catch (err) {
        console.error(`[discover-platform-auctions] Failed to register ${url}:`, err);
        failed.push(auctionId);
      }

      // Rate limit to avoid overwhelming the platform
      await sleep(200);
    }

    const duration = Date.now() - startTime;

    console.log(`[discover-platform-auctions] ${platform}: registered ${registered.length}, skipped ${skipped.length}, failed ${failed.length}`);

    return new Response(
      JSON.stringify({
        success: true,
        platform,
        discovered: auctionUrls.length,
        registered: registered.length,
        skipped: skipped.length,
        failed: failed.length,
        duration_ms: duration,
        registered_ids: registered,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[discover-platform-auctions] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function extractAuctionId(url: string, platform: string): string {
  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname;

    switch (platform) {
      case 'bat': {
        const match = path.match(/\/listing\/([^\/]+)/);
        return match?.[1] || path;
      }
      case 'cars-and-bids': {
        const match = path.match(/\/auctions\/([^\/]+)/);
        return match?.[1] || path;
      }
      case 'pcarmarket': {
        const match = path.match(/\/auction\/([^\/]+)/);
        return match?.[1] || path;
      }
      case 'collecting-cars': {
        const match = path.match(/\/for-sale\/([^\/]+)/);
        return match?.[1] || path;
      }
      default: {
        const segments = path.split('/').filter(Boolean);
        return segments[segments.length - 1] || path;
      }
    }
  } catch {
    return url;
  }
}

// ============================================================================
// Platform-specific discovery functions
// ============================================================================

async function discoverBatAuctions(limit: number): Promise<string[]> {
  const urls: string[] = [];

  // Fetch BaT homepage which lists active auctions
  const pages = [
    'https://bringatrailer.com/',
    'https://bringatrailer.com/auctions/',
  ];

  for (const pageUrl of pages) {
    if (urls.length >= limit) break;

    try {
      const resp = await fetch(pageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      });

      if (!resp.ok) continue;

      const html = await resp.text();

      // Extract listing URLs
      const matches = html.matchAll(/href="(https:\/\/bringatrailer\.com\/listing\/[^"]+)"/gi);
      for (const match of matches) {
        const url = match[1].replace(/\/$/, ''); // Normalize trailing slash
        if (!urls.includes(url) && urls.length < limit) {
          urls.push(url);
        }
      }
    } catch (err) {
      console.error(`[discoverBatAuctions] Failed to fetch ${pageUrl}:`, err);
    }
  }

  return urls;
}

async function discoverCarsAndBidsAuctions(limit: number): Promise<string[]> {
  const urls: string[] = [];

  // Browser-like headers to avoid anti-bot detection
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  };

  try {
    // Try the auctions page first, then homepage
    const pagesToTry = [
      'https://carsandbids.com/auctions/',
      'https://carsandbids.com/',
    ];

    for (const pageUrl of pagesToTry) {
      if (urls.length >= limit) break;

      const resp = await fetch(pageUrl, { headers });
      console.log(`[discoverCarsAndBidsAuctions] ${pageUrl} status: ${resp.status}`);

      if (!resp.ok) continue;

      const html = await resp.text();
      console.log(`[discoverCarsAndBidsAuctions] Got ${html.length} bytes`);

      // C&B uses multiple URL formats
      // Pattern 1: /auctions/ID/title
      const pattern1 = html.matchAll(/href="(\/auctions\/[a-zA-Z0-9-]+\/[^"]+)"/gi);
      for (const match of pattern1) {
        const url = `https://carsandbids.com${match[1]}`;
        if (!urls.includes(url) && urls.length < limit && !url.includes('/past/')) {
          urls.push(url);
        }
      }

      // Pattern 2: Just /auctions/ID for API-like links
      const pattern2 = html.matchAll(/href="(\/auctions\/[a-zA-Z0-9]+)"[^>]*>/gi);
      for (const match of pattern2) {
        const url = `https://carsandbids.com${match[1]}`;
        if (!urls.includes(url) && urls.length < limit) {
          urls.push(url);
        }
      }
    }
  } catch (err) {
    console.error('[discoverCarsAndBidsAuctions] Failed:', err);
  }

  console.log(`[discoverCarsAndBidsAuctions] Found ${urls.length} URLs`);
  return urls;
}

async function discoverPcarmarketAuctions(limit: number): Promise<string[]> {
  const urls: string[] = [];

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
  };

  try {
    const pagesToTry = [
      'https://pcarmarket.com/auctions/',
      'https://pcarmarket.com/',
    ];

    for (const pageUrl of pagesToTry) {
      if (urls.length >= limit) break;

      const resp = await fetch(pageUrl, { headers });
      console.log(`[discoverPcarmarketAuctions] ${pageUrl} status: ${resp.status}`);

      if (!resp.ok) continue;

      const html = await resp.text();
      console.log(`[discoverPcarmarketAuctions] Got ${html.length} bytes`);

      // PCARMARKET URL patterns
      // Pattern 1: /auction/slug-name
      const pattern1 = html.matchAll(/href="(\/auction\/[a-zA-Z0-9-]+)"/gi);
      for (const match of pattern1) {
        const url = `https://pcarmarket.com${match[1]}`;
        if (!urls.includes(url) && urls.length < limit) {
          urls.push(url);
        }
      }

      // Pattern 2: Full URL
      const pattern2 = html.matchAll(/href="(https:\/\/pcarmarket\.com\/auction\/[^"]+)"/gi);
      for (const match of pattern2) {
        if (!urls.includes(match[1]) && urls.length < limit) {
          urls.push(match[1]);
        }
      }
    }
  } catch (err) {
    console.error('[discoverPcarmarketAuctions] Failed:', err);
  }

  console.log(`[discoverPcarmarketAuctions] Found ${urls.length} URLs`);
  return urls;
}

async function discoverCollectingCarsAuctions(limit: number): Promise<string[]> {
  const urls: string[] = [];

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
  };

  try {
    const pagesToTry = [
      'https://collectingcars.com/buy',
      'https://collectingcars.com/',
    ];

    for (const pageUrl of pagesToTry) {
      if (urls.length >= limit) break;

      const resp = await fetch(pageUrl, { headers });
      console.log(`[discoverCollectingCarsAuctions] ${pageUrl} status: ${resp.status}`);

      if (!resp.ok) continue;

      const html = await resp.text();
      console.log(`[discoverCollectingCarsAuctions] Got ${html.length} bytes`);

      // Collecting Cars URL patterns
      // Pattern 1: /for-sale/slug
      const pattern1 = html.matchAll(/href="(\/for-sale\/[a-zA-Z0-9-]+)"/gi);
      for (const match of pattern1) {
        const url = `https://collectingcars.com${match[1]}`;
        if (!urls.includes(url) && urls.length < limit) {
          urls.push(url);
        }
      }

      // Pattern 2: Full URL
      const pattern2 = html.matchAll(/href="(https:\/\/collectingcars\.com\/for-sale\/[^"]+)"/gi);
      for (const match of pattern2) {
        const url = match[1].split('?')[0]; // Remove query params
        if (!urls.includes(url) && urls.length < limit) {
          urls.push(url);
        }
      }
    }
  } catch (err) {
    console.error('[discoverCollectingCarsAuctions] Failed:', err);
  }

  console.log(`[discoverCollectingCarsAuctions] Found ${urls.length} URLs`);
  return urls;
}
