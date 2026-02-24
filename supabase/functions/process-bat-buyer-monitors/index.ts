import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Process BAT Buyer Monitors
 *
 * Discovers auction wins for monitored BaT buyers by scraping their profile's
 * "Auction Wins" section. New wins are imported via complete-bat-import and
 * buyer attribution is set on the resulting vehicles.
 *
 * Modes:
 *   - Default: process all due monitors
 *   - { buyer_username: "X" }: process a specific buyer
 *   - { backfill: true }: click "Show more" repeatedly to load all historical wins
 *   - { dry_run: true }: discover URLs but don't import
 */

interface MonitorResult {
  buyer_username: string;
  wins_discovered: number;
  new_wins: number;
  imported: number;
  already_had: number;
  attribution_fixed: number;
  errors: string[];
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { buyer_username, backfill = false, dry_run = false } = body;

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch monitors to process
    let query = supabase
      .from('bat_buyer_monitors')
      .select('*')
      .eq('is_active', true);

    if (buyer_username) {
      query = query.ilike('buyer_username', buyer_username);
    }

    const { data: monitors, error: monitorsError } = await query;
    if (monitorsError) throw monitorsError;

    if (!monitors || monitors.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No active buyer monitors found', results: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Filter to monitors that are due for checking (unless specific buyer requested)
    const now = new Date();
    const dueMonitors = buyer_username ? monitors : monitors.filter(m => {
      if (!m.last_checked_at) return true;
      const lastChecked = new Date(m.last_checked_at);
      const hoursElapsed = (now.getTime() - lastChecked.getTime()) / (1000 * 60 * 60);
      return hoursElapsed >= (m.check_frequency_hours || 12);
    });

    console.log(`Processing ${dueMonitors.length} due buyer monitors (of ${monitors.length} active)`);

    const results: MonitorResult[] = [];

    for (const monitor of dueMonitors) {
      const result = await processMonitor(monitor, supabase, supabaseUrl, supabaseKey, firecrawlApiKey, backfill, dry_run);
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
  supabaseUrl: string,
  supabaseKey: string,
  firecrawlApiKey: string | undefined,
  backfill: boolean,
  dryRun: boolean
): Promise<MonitorResult> {
  const result: MonitorResult = {
    buyer_username: monitor.buyer_username,
    wins_discovered: 0,
    new_wins: 0,
    imported: 0,
    already_had: 0,
    attribution_fixed: 0,
    errors: [],
  };

  try {
    const profileUrl = monitor.buyer_url ||
      `https://bringatrailer.com/member/${monitor.buyer_username.toLowerCase()}/`;

    console.log(`\n=== Processing buyer monitor: ${monitor.buyer_username} ===`);

    // Step 1: Get the initial page HTML to find wins section
    // The wins section is in <section class="section-won-listings"> but only shows 5 items
    // "Show more" button has data-item-type="auction_wins"
    const winUrls = await scrapeWinListings(profileUrl, firecrawlApiKey, backfill);
    result.wins_discovered = winUrls.length;
    console.log(`Discovered ${winUrls.length} win URLs from profile`);

    if (winUrls.length === 0) {
      result.errors.push('No win URLs found on profile page');
      await updateMonitorStats(supabase, monitor, result);
      return result;
    }

    // Step 2: Check which ones we already have
    // Check bat_listings by URL
    const { data: existingListings } = await supabase
      .from('bat_listings')
      .select('bat_listing_url, vehicle_id, buyer_username')
      .in('bat_listing_url', winUrls);

    const existingByUrl = new Map<string, { vehicle_id: string; buyer_username: string | null }>();
    existingListings?.forEach((l: any) => {
      existingByUrl.set(l.bat_listing_url, { vehicle_id: l.vehicle_id, buyer_username: l.buyer_username });
    });

    // Also check vehicles by bat_auction_url
    const { data: existingVehicles } = await supabase
      .from('vehicles')
      .select('id, bat_auction_url, bat_buyer')
      .in('bat_auction_url', winUrls);

    const existingVehiclesByUrl = new Map<string, { id: string; bat_buyer: string | null }>();
    existingVehicles?.forEach((v: any) => {
      if (v.bat_auction_url) {
        existingVehiclesByUrl.set(v.bat_auction_url, { id: v.id, bat_buyer: v.bat_buyer });
      }
    });

    // Categorize URLs
    const newUrls: string[] = [];
    const needsAttribution: { url: string; vehicle_id: string }[] = [];

    for (const url of winUrls) {
      const listing = existingByUrl.get(url);
      const vehicle = existingVehiclesByUrl.get(url);

      if (!listing && !vehicle) {
        // Completely new — needs import
        newUrls.push(url);
      } else {
        result.already_had++;
        // Check if buyer attribution is missing or wrong
        const vehicleId = listing?.vehicle_id || vehicle?.id;
        const currentBuyer = vehicle?.bat_buyer || listing?.buyer_username;
        if (vehicleId && (!currentBuyer || currentBuyer.toLowerCase() !== monitor.buyer_username.toLowerCase())) {
          needsAttribution.push({ url, vehicle_id: vehicleId });
        }
      }
    }

    result.new_wins = newUrls.length;
    console.log(`${newUrls.length} new wins to import, ${needsAttribution.length} need buyer attribution fix, ${result.already_had} already had`);

    if (dryRun) {
      console.log('Dry run - not importing');
      console.log('New URLs:', newUrls);
      console.log('Needs attribution:', needsAttribution);
      await updateMonitorStats(supabase, monitor, result);
      return result;
    }

    // Step 3: Import new listings via complete-bat-import
    for (const url of newUrls) {
      try {
        console.log(`Importing: ${url}`);
        const importResponse = await fetch(`${supabaseUrl}/functions/v1/complete-bat-import`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ url }),
          signal: AbortSignal.timeout(30000),
        });

        const importResult = await importResponse.json();
        if (importResult.success) {
          result.imported++;
          const vehicleId = importResult.vehicle_id || importResult.vehicle?.id;
          if (vehicleId) {
            // Set buyer attribution on newly imported vehicle
            await supabase
              .from('vehicles')
              .update({ bat_buyer: monitor.buyer_username })
              .eq('id', vehicleId);
          }
          console.log(`  Imported: ${vehicleId}`);
        } else {
          result.errors.push(`Import failed for ${url}: ${importResult.error || 'unknown'}`);
          console.warn(`  Import failed: ${importResult.error}`);
        }
      } catch (err: any) {
        result.errors.push(`Import error for ${url}: ${err.message}`);
        console.error(`  Import error: ${err.message}`);
      }
    }

    // Step 4: Fix buyer attribution on existing listings
    for (const { url, vehicle_id } of needsAttribution) {
      try {
        await supabase
          .from('vehicles')
          .update({ bat_buyer: monitor.buyer_username })
          .eq('id', vehicle_id);

        // Also update bat_listings if exists
        await supabase
          .from('bat_listings')
          .update({ buyer_username: monitor.buyer_username })
          .eq('vehicle_id', vehicle_id);

        result.attribution_fixed++;
      } catch (err: any) {
        result.errors.push(`Attribution fix failed for ${vehicle_id}: ${err.message}`);
      }
    }

    console.log(`Attribution fixed on ${result.attribution_fixed} existing listings`);

    // Step 5: Update monitor stats
    await updateMonitorStats(supabase, monitor, result);

    console.log(`=== Done: ${monitor.buyer_username} - ${result.imported} imported, ${result.attribution_fixed} attribution fixes, ${result.errors.length} errors ===\n`);
  } catch (err: any) {
    result.errors.push(`Monitor error: ${err.message}`);
    console.error(`Monitor error for ${monitor.buyer_username}:`, err);
  }

  return result;
}

async function scrapeWinListings(
  profileUrl: string,
  firecrawlApiKey: string | undefined,
  backfill: boolean
): Promise<string[]> {
  const winUrls = new Set<string>();

  // First: direct fetch to get the initial 5 wins from the won-listings section
  // This works without JS rendering
  try {
    const response = await fetch(profileUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });
    const html = await response.text();

    // Extract URLs specifically from the won-listings section
    const wonSection = html.match(/section-won-listings[\s\S]*?(?=<section|<\/main|$)/);
    if (wonSection) {
      const hrefRegex = /href="(https:\/\/bringatrailer\.com\/listing\/[^"#]+)"/g;
      let match;
      while ((match = hrefRegex.exec(wonSection[0])) !== null) {
        let url = match[1];
        url = url.split('?')[0].split('#')[0];
        if (!url.endsWith('/')) url += '/';
        winUrls.add(url);
      }
    }
    console.log(`Direct fetch found ${winUrls.size} win URLs from initial page`);
  } catch (err: any) {
    console.warn('Direct fetch failed:', err.message);
  }

  // Then: use Firecrawl to click "Show more" and get the rest
  if (firecrawlApiKey) {
    try {
      // Click "Show more" on the auction_wins section in multiple Firecrawl batches
      // Each batch does a few clicks to stay within timeout limits
      const clicksPerBatch = 4;
      const totalBatches = backfill ? 5 : 2;

      for (let batch = 0; batch < totalBatches; batch++) {
        const actions: any[] = [{ type: 'wait', milliseconds: 2000 }];
        // Each batch clicks the total cumulative times needed
        const totalClicks = (batch + 1) * clicksPerBatch;
        for (let i = 0; i < totalClicks; i++) {
          actions.push(
            { type: 'click', selector: 'button[data-item-type="auction_wins"]' },
            { type: 'wait', milliseconds: 1500 }
          );
        }

        console.log(`Firecrawl batch ${batch + 1}/${totalBatches}: ${totalClicks} cumulative clicks...`);
        const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${firecrawlApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: profileUrl,
            formats: ['html'],
            waitFor: 3000,
            mobile: false,
            actions,
          }),
          signal: AbortSignal.timeout(45000),
        });

        if (response.ok) {
          const data = await response.json();
          const html = data.data?.html || '';
          const prevSize = winUrls.size;

          // Extract all listing URLs from the rendered HTML
          const hrefRegex = /href="(https:\/\/bringatrailer\.com\/listing\/[^"#]+)"/g;
          let match;
          while ((match = hrefRegex.exec(html)) !== null) {
            let url = match[1];
            url = url.split('?')[0].split('#')[0];
            if (!url.endsWith('/')) url += '/';
            winUrls.add(url);
          }

          // Also extract from non-href contexts (JSON data, etc)
          const slugRegex = /bringatrailer\.com\/listing\/([a-z0-9-]+)/g;
          while ((match = slugRegex.exec(html)) !== null) {
            const url = `https://bringatrailer.com/listing/${match[1]}/`;
            winUrls.add(url);
          }

          const newFound = winUrls.size - prevSize;
          console.log(`Batch ${batch + 1}: found ${newFound} new URLs (${winUrls.size} total)`);

          // If no new URLs found, stop clicking — we've loaded them all
          if (newFound === 0 && batch > 0) {
            console.log('No new URLs in this batch, stopping pagination');
            break;
          }
        } else {
          console.warn(`Firecrawl batch ${batch + 1} failed: ${response.status}`);
          break;
        }
      }
    } catch (err: any) {
      console.warn('Firecrawl error:', err.message);
    }
  }

  return Array.from(winUrls);
}

async function updateMonitorStats(
  supabase: any,
  monitor: any,
  result: MonitorResult
): Promise<void> {
  const updateData: any = {
    last_checked_at: new Date().toISOString(),
    total_wins_found: (monitor.total_wins_found || 0) + result.new_wins,
    wins_processed: (monitor.wins_processed || 0) + result.imported + result.attribution_fixed,
    updated_at: new Date().toISOString(),
  };

  if (result.new_wins > 0 || result.attribution_fixed > 0) {
    updateData.last_win_found_at = new Date().toISOString();
  }

  await supabase
    .from('bat_buyer_monitors')
    .update(updateData)
    .eq('id', monitor.id);

  console.log(`Monitor stats updated: discovered=${result.wins_discovered}, new=${result.new_wins}, imported=${result.imported}, attribution_fixed=${result.attribution_fixed}`);
}
