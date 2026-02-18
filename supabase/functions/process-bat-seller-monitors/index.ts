import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { normalizeVehicleFields } from '../_shared/normalizeVehicle.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Process BAT Seller Monitors
 *
 * Iterates over active bat_seller_monitors that are due for checking,
 * scrapes each seller's BaT profile via Firecrawl to discover listing URLs,
 * creates vehicles + external_listings for new ones, and updates monitor stats.
 *
 * Modes:
 *   - Default: process all due monitors
 *   - { seller_username: "X" }: process a specific monitor
 *   - { backfill: true }: click "Show more" to load all past listings
 */

interface MonitorResult {
  seller_username: string;
  organization_id: string;
  listings_discovered: number;
  new_listings: number;
  vehicles_created: number;
  vehicles_updated: number;
  errors: string[];
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { seller_username, backfill = false, dry_run = false, listing_urls: manualUrls } = body;

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch monitors to process
    let query = supabase
      .from('bat_seller_monitors')
      .select('*')
      .eq('is_active', true);

    if (seller_username) {
      query = query.ilike('seller_username', seller_username);
    }

    const { data: monitors, error: monitorsError } = await query;
    if (monitorsError) throw monitorsError;

    if (!monitors || monitors.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No active monitors found', results: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Filter to monitors that are due for checking (unless specific seller requested)
    const now = new Date();
    const dueMonitors = seller_username ? monitors : monitors.filter(m => {
      if (!m.last_checked_at) return true;
      const lastChecked = new Date(m.last_checked_at);
      const hoursElapsed = (now.getTime() - lastChecked.getTime()) / (1000 * 60 * 60);
      return hoursElapsed >= (m.check_frequency_hours || 6);
    });

    console.log(`Processing ${dueMonitors.length} due monitors (of ${monitors.length} active)`);

    const results: MonitorResult[] = [];

    for (const monitor of dueMonitors) {
      const result = await processMonitor(monitor, supabase, firecrawlApiKey, backfill, dry_run, manualUrls);
      results.push(result);
    }

    return new Response(
      JSON.stringify({ success: true, monitors_processed: results.length, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function processMonitor(
  monitor: any,
  supabase: any,
  firecrawlApiKey: string | undefined,
  backfill: boolean,
  dryRun: boolean,
  manualUrls?: string[]
): Promise<MonitorResult> {
  const result: MonitorResult = {
    seller_username: monitor.seller_username,
    organization_id: monitor.organization_id,
    listings_discovered: 0,
    new_listings: 0,
    vehicles_created: 0,
    vehicles_updated: 0,
    errors: [],
  };

  try {
    const profileUrl = monitor.seller_url ||
      `https://bringatrailer.com/member/${monitor.seller_username}/`;

    console.log(`\n=== Processing monitor: ${monitor.seller_username} ===`);
    console.log(`Profile: ${profileUrl}`);

    // Step 1: Discover listing URLs - either manual list or scrape profile
    let listingUrls: string[];
    if (manualUrls && manualUrls.length > 0) {
      // Manual backfill: use provided URLs directly
      listingUrls = manualUrls.map(url => {
        url = url.split('?')[0].split('#')[0];
        if (!url.endsWith('/')) url += '/';
        return url;
      });
      console.log(`Using ${listingUrls.length} manually provided URLs`);
    } else {
      listingUrls = await scrapeProfileListings(profileUrl, firecrawlApiKey, backfill);
    }
    result.listings_discovered = listingUrls.length;
    console.log(`Discovered ${listingUrls.length} listing URLs`);

    if (listingUrls.length === 0) {
      result.errors.push('No listing URLs found on profile page');
      await updateMonitorStats(supabase, monitor, result);
      return result;
    }

    // Step 2: Check which URLs we already know about
    // Check external_listings
    const { data: existingExternal } = await supabase
      .from('external_listings')
      .select('listing_url')
      .eq('platform', 'bat')
      .in('listing_url', listingUrls);
    const knownUrls = new Set(existingExternal?.map((l: any) => l.listing_url) || []);

    // Also check vehicles.bat_auction_url
    const { data: existingVehicles } = await supabase
      .from('vehicles')
      .select('bat_auction_url')
      .in('bat_auction_url', listingUrls);
    existingVehicles?.forEach((v: any) => {
      if (v.bat_auction_url) knownUrls.add(v.bat_auction_url);
    });

    // Also check normalized URLs (with/without trailing slash)
    const normalizedKnown = new Set<string>();
    knownUrls.forEach(url => {
      normalizedKnown.add(url);
      normalizedKnown.add(url.replace(/\/$/, ''));
      normalizedKnown.add(url + '/');
    });

    const newUrls = listingUrls.filter(url =>
      !normalizedKnown.has(url) && !normalizedKnown.has(url.replace(/\/$/, ''))
    );
    result.new_listings = newUrls.length;
    console.log(`${newUrls.length} new listings, ${listingUrls.length - newUrls.length} already known`);

    if (dryRun) {
      console.log('Dry run - not creating vehicles or listings');
      console.log('New URLs:', newUrls);
      await updateMonitorStats(supabase, monitor, result);
      return result;
    }

    // Step 3: Process new listings - create vehicles + external_listings
    for (const listingUrl of newUrls) {
      try {
        await processNewListing(listingUrl, monitor, supabase, firecrawlApiKey, result);
      } catch (err: any) {
        const errMsg = `Failed to process ${listingUrl}: ${err.message}`;
        console.error(errMsg);
        result.errors.push(errMsg);
      }
    }

    // Step 4: Update monitor stats
    await updateMonitorStats(supabase, monitor, result);

    console.log(`=== Done: ${monitor.seller_username} - ${result.vehicles_created} created, ${result.vehicles_updated} updated, ${result.errors.length} errors ===\n`);
  } catch (err: any) {
    result.errors.push(`Monitor error: ${err.message}`);
    console.error(`Monitor error for ${monitor.seller_username}:`, err);
  }

  return result;
}

async function scrapeProfileListings(
  profileUrl: string,
  firecrawlApiKey: string | undefined,
  backfill: boolean
): Promise<string[]> {
  let html = '';

  if (firecrawlApiKey) {
    console.log('Scraping profile with Firecrawl...');
    try {
      // Build Firecrawl request - use actions for backfill to click "Show more"
      const firecrawlBody: any = {
        url: profileUrl,
        formats: ['html'],
        waitFor: 8000,
        mobile: false,
      };

      if (backfill) {
        // Click "Show more" repeatedly to load all past listings
        const showMoreActions: any[] = [];
        for (let i = 0; i < 15; i++) {
          showMoreActions.push(
            { type: 'click', selector: '.auctions-item-load-more button, button.load-more, [data-auctions-load-more] button' },
            { type: 'wait', milliseconds: 2000 }
          );
        }
        firecrawlBody.actions = showMoreActions;
        firecrawlBody.waitFor = 5000;
      }

      const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${firecrawlApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(firecrawlBody),
        signal: AbortSignal.timeout(backfill ? 120000 : 45000),
      });

      if (response.ok) {
        const data = await response.json();
        html = data.data?.html || '';
        console.log(`Firecrawl returned ${html.length} chars of HTML`);
      } else {
        const errText = await response.text();
        console.warn(`Firecrawl failed (${response.status}): ${errText.slice(0, 200)}`);
      }
    } catch (err: any) {
      console.warn('Firecrawl error:', err.message);
    }
  }

  // Fallback to direct fetch (won't get JS-rendered content, but may get some data)
  if (!html) {
    console.log('Falling back to direct HTTP fetch...');
    try {
      const response = await fetch(profileUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      });
      html = await response.text();
    } catch (err: any) {
      console.error('Direct fetch failed:', err.message);
      return [];
    }
  }

  // Extract listing URLs from HTML
  const listingUrls = new Set<string>();

  // Pattern 1: href links to /listing/
  const hrefRegex = /href=["']([^"']*\/listing\/[^"']+)["']/g;
  let match;
  while ((match = hrefRegex.exec(html)) !== null) {
    let url = match[1];
    if (!url.startsWith('http')) {
      url = `https://bringatrailer.com${url}`;
    }
    // Clean up URL - remove query params and anchors
    url = url.split('?')[0].split('#')[0];
    // Ensure trailing slash for consistency
    if (!url.endsWith('/')) url += '/';
    listingUrls.add(url);
  }

  // Pattern 2: JSON embedded data
  const jsonPatterns = [
    /"url"\s*:\s*"([^"]*\/listing\/[^"]+)"/g,
    /"permalink"\s*:\s*"([^"]*\/listing\/[^"]+)"/g,
    /"link"\s*:\s*"([^"]*\/listing\/[^"]+)"/g,
  ];
  for (const pattern of jsonPatterns) {
    while ((match = pattern.exec(html)) !== null) {
      let url = match[1].replace(/\\\//g, '/');
      if (!url.startsWith('http')) {
        url = `https://bringatrailer.com${url}`;
      }
      url = url.split('?')[0].split('#')[0];
      if (!url.endsWith('/')) url += '/';
      listingUrls.add(url);
    }
  }

  return Array.from(listingUrls);
}

function parseVehicleInfoFromUrl(listingUrl: string): { year: number | null; make: string | null; model: string | null; slug: string } {
  // Extract slug from URL: /listing/1982-delorean-dmc-12-46/
  const slugMatch = listingUrl.match(/\/listing\/([^\/\?]+)/);
  const slug = slugMatch ? slugMatch[1] : '';

  // Try to parse year-make-model from slug
  const parts = slug.split('-');
  let year: number | null = null;
  let make: string | null = null;
  let model: string | null = null;

  if (parts.length >= 3) {
    const possibleYear = parseInt(parts[0]);
    if (possibleYear >= 1900 && possibleYear <= 2030) {
      year = possibleYear;
      make = parts[1];
      // Model is the rest, excluding the trailing number suffix
      const lastPart = parts[parts.length - 1];
      const hasTrailingNum = /^\d+$/.test(lastPart);
      const modelParts = hasTrailingNum ? parts.slice(2, -1) : parts.slice(2);
      model = modelParts.join(' ');
    }
  }

  return { year, make, model, slug };
}

async function processNewListing(
  listingUrl: string,
  monitor: any,
  supabase: any,
  firecrawlApiKey: string | undefined,
  result: MonitorResult
): Promise<void> {
  console.log(`Processing new listing: ${listingUrl}`);

  // Parse basic info from URL slug
  const { year, make, model, slug } = parseVehicleInfoFromUrl(listingUrl);
  const listingId = slug;

  // Try to find existing vehicle by bat_auction_url (normalized)
  const urlVariants = [listingUrl, listingUrl.replace(/\/$/, ''), listingUrl + '/'];
  let vehicleId: string | null = null;

  for (const urlVariant of urlVariants) {
    const { data: existing } = await supabase
      .from('vehicles')
      .select('id')
      .eq('bat_auction_url', urlVariant)
      .maybeSingle();
    if (existing) {
      vehicleId = existing.id;
      break;
    }
  }

  if (vehicleId) {
    console.log(`  Found existing vehicle: ${vehicleId}`);
    result.vehicles_updated++;
  } else {
    // Create stub vehicle with minimal info from URL
    const vehicleData: any = {
      bat_auction_url: listingUrl,
      listing_url: listingUrl,
      discovery_url: listingUrl,
      profile_origin: 'bat_import',
      discovery_source: 'bat_seller_monitor',
      origin_metadata: {
        bat_seller: monitor.seller_username,
        discovered_via: 'seller_monitor',
        discovered_at: new Date().toISOString(),
        url_slug: slug,
      },
    };

    if (year) vehicleData.year = year;
    const norm = normalizeVehicleFields({ make, model, year });
    if (make) vehicleData.make = norm.make ?? make;
    if (model) vehicleData.model = norm.model ?? model;

    const { data: newVehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .insert(vehicleData)
      .select('id')
      .maybeSingle();

    if (vehicleError) {
      throw new Error(`Vehicle creation failed: ${vehicleError.message}`);
    }

    vehicleId = newVehicle?.id;
    if (!vehicleId) throw new Error('No vehicle ID returned');

    console.log(`  Created stub vehicle: ${vehicleId} (${year || '?'} ${make || '?'} ${model || '?'})`);
    result.vehicles_created++;
  }

  // Link vehicle to organization
  await supabase
    .from('organization_vehicles')
    .upsert({
      organization_id: monitor.organization_id,
      vehicle_id: vehicleId,
      relationship_type: 'seller',
      auto_tagged: true,
    }, {
      onConflict: 'organization_id,vehicle_id',
    });

  // Create external_listing record
  // Unique constraint is (vehicle_id, platform, listing_id)
  const { error: listingError } = await supabase
    .from('external_listings')
    .upsert({
      vehicle_id: vehicleId,
      organization_id: monitor.organization_id,
      platform: 'bat',
      listing_url: listingUrl,
      listing_id: listingId,
      listing_status: 'pending',
      metadata: {
        seller: monitor.seller_username,
        discovered_via: 'seller_monitor',
        discovered_at: new Date().toISOString(),
      },
    }, {
      onConflict: 'vehicle_id,platform,listing_id',
      ignoreDuplicates: false,
    });

  if (listingError) {
    console.warn(`  External listing upsert warning: ${listingError.message}`);
  }

  // Queue for full extraction (fills in VIN, price, specs, images, etc.)
  const { error: queueError } = await supabase
    .from('bat_extraction_queue')
    .upsert({
      vehicle_id: vehicleId,
      bat_url: listingUrl,
      status: 'pending',
      priority: 50, // Medium-high priority for seller monitor discoveries
    }, {
      onConflict: 'vehicle_id',
      ignoreDuplicates: true,
    });

  if (queueError) {
    console.warn(`  Queue upsert warning: ${queueError.message}`);
  }

  console.log(`  Queued for extraction: ${vehicleId}`);
}

async function updateMonitorStats(
  supabase: any,
  monitor: any,
  result: MonitorResult
): Promise<void> {
  const updateData: any = {
    last_checked_at: new Date().toISOString(),
    total_listings_found: (monitor.total_listings_found || 0) + result.new_listings,
    listings_processed: (monitor.listings_processed || 0) + result.vehicles_created + result.vehicles_updated,
    updated_at: new Date().toISOString(),
  };

  if (result.new_listings > 0) {
    updateData.last_listing_found_at = new Date().toISOString();
  }

  await supabase
    .from('bat_seller_monitors')
    .update(updateData)
    .eq('id', monitor.id);

  console.log(`Monitor stats updated: found=${result.listings_discovered}, new=${result.new_listings}`);
}
