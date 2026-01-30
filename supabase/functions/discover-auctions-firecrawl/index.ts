import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Discover Auctions via Firecrawl
 *
 * Uses Firecrawl API for JavaScript-rendered pages that block direct scraping.
 * Handles anti-bot protection by using a real browser.
 *
 * Request body:
 * - platform: Platform slug (required)
 * - limit: Max auctions to register (default: 20)
 */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const body = await req.json().catch(() => ({}));
    const { platform, limit = 20 } = body;

    if (!platform) {
      return new Response(
        JSON.stringify({ success: false, error: 'platform is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!firecrawlKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'FIRECRAWL_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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

    console.log(`[discover-auctions-firecrawl] Discovering ${platform} auctions via Firecrawl`);
    console.log(`[discover-auctions-firecrawl] Firecrawl API key present: ${!!firecrawlKey}`);

    // Get platform config
    const platformConfig = getPlatformConfig(platform);
    console.log(`[discover-auctions-firecrawl] Platform config: ${JSON.stringify(platformConfig?.url)}`);

    if (!platformConfig) {
      return new Response(
        JSON.stringify({ success: false, error: `Platform '${platform}' not supported for Firecrawl discovery` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get existing auction IDs to avoid duplicates
    const { data: existing } = await supabase
      .from('monitored_auctions')
      .select('external_auction_id')
      .eq('source_id', source.id);

    const existingIds = new Set((existing || []).map(a => a.external_auction_id));

    // Scrape with Firecrawl
    const auctionUrls = await scrapeWithFirecrawl(firecrawlKey, platformConfig, limit);

    console.log(`[discover-auctions-firecrawl] Found ${auctionUrls.length} auction URLs on ${platform}`);

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
          existingIds.add(auctionId);
        } else {
          console.warn(`[discover-auctions-firecrawl] Failed to register ${url}: ${data.error}`);
          failed.push(auctionId);
        }
      } catch (err) {
        console.error(`[discover-auctions-firecrawl] Error registering ${url}:`, err);
        failed.push(auctionId);
      }

      // Rate limit
      await sleep(300);
    }

    const duration = Date.now() - startTime;

    console.log(`[discover-auctions-firecrawl] ${platform}: registered ${registered.length}, skipped ${skipped.length}, failed ${failed.length}`);

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
    console.error('[discover-auctions-firecrawl] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface PlatformConfig {
  url: string;
  urlPatterns: RegExp[];
  baseUrl: string;
}

function getPlatformConfig(platform: string): PlatformConfig | null {
  switch (platform) {
    case 'cars-and-bids':
      return {
        url: 'https://carsandbids.com/',
        urlPatterns: [
          /\/auctions\/([a-zA-Z0-9]+)\/[^"'\s]+/g,
          /href="(\/auctions\/[^"]+)"/gi,
        ],
        baseUrl: 'https://carsandbids.com',
      };
    case 'pcarmarket':
      return {
        url: 'https://pcarmarket.com/auctions/',
        urlPatterns: [
          /\/auction\/([a-zA-Z0-9-]+)/g,
          /href="(https:\/\/pcarmarket\.com\/auction\/[^"]+)"/gi,
        ],
        baseUrl: 'https://pcarmarket.com',
      };
    case 'collecting-cars':
      return {
        url: 'https://collectingcars.com/buy',
        urlPatterns: [
          /\/for-sale\/([a-zA-Z0-9-]+)/g,
          /href="(\/for-sale\/[^"]+)"/gi,
        ],
        baseUrl: 'https://collectingcars.com',
      };
    default:
      return null;
  }
}

async function scrapeWithFirecrawl(
  apiKey: string,
  config: PlatformConfig,
  limit: number
): Promise<string[]> {
  const urls: string[] = [];

  console.log(`[scrapeWithFirecrawl] Starting scrape of ${config.url}`);

  try {
    // Use Firecrawl scrape endpoint
    const requestBody = {
      url: config.url,
      formats: ['html', 'links'],
      waitFor: 3000, // Wait for JS to render
      timeout: 30000,
    };

    console.log(`[scrapeWithFirecrawl] Request: ${JSON.stringify(requestBody)}`);

    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    console.log(`[scrapeWithFirecrawl] Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[scrapeWithFirecrawl] Firecrawl error: ${response.status} - ${errorText}`);
      return urls;
    }

    const data = await response.json();
    console.log(`[scrapeWithFirecrawl] Success: ${data.success}, Links: ${data.data?.links?.length || 0}, HTML length: ${data.data?.html?.length || 0}`);

    // Extract from links array if available
    if (data.data?.links) {
      for (const link of data.data.links) {
        if (urls.length >= limit) break;

        for (const pattern of config.urlPatterns) {
          if (pattern.test(link)) {
            const fullUrl = link.startsWith('http') ? link : `${config.baseUrl}${link}`;
            if (!urls.includes(fullUrl)) {
              urls.push(fullUrl);
            }
            break;
          }
        }
      }
    }

    // Also check HTML content for additional links
    if (data.data?.html && urls.length < limit) {
      const html = data.data.html;

      for (const pattern of config.urlPatterns) {
        // Reset regex lastIndex
        pattern.lastIndex = 0;

        let match;
        while ((match = pattern.exec(html)) !== null && urls.length < limit) {
          const path = match[1];
          const fullUrl = path.startsWith('http') ? path : `${config.baseUrl}${path}`;

          // Filter out non-auction URLs
          if (fullUrl.includes('/past') || fullUrl.includes('/ended') || fullUrl.includes('/sold')) {
            continue;
          }

          if (!urls.includes(fullUrl)) {
            urls.push(fullUrl);
          }
        }
      }
    }
  } catch (err) {
    console.error('[scrapeWithFirecrawl] Error:', err);
  }

  return urls;
}

function extractAuctionId(url: string, platform: string): string {
  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname;

    switch (platform) {
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
