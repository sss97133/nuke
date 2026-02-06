#!/usr/bin/env npx tsx
/**
 * PARALLEL SOURCE BLITZ
 * 
 * Runs ALL source extractors simultaneously, each in its own lane.
 * When a source runs dry, it tries to discover more URLs.
 * When discovery is exhausted, the lane exits and gets replaced.
 *
 * Usage:
 *   dotenvx run -- npx tsx scripts/parallel-source-blitz.ts
 *   dotenvx run -- npx tsx scripts/parallel-source-blitz.ts --concurrency 5
 *   dotenvx run -- npx tsx scripts/parallel-source-blitz.ts --sources bat,mecum,gooding
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// ─── Source Configuration ───────────────────────────────────────────────
// Each source: what URL pattern to match, what extractor to call, 
// optional discovery function, and concurrency per source

interface SourceConfig {
  name: string;
  urlPattern: string;         // SQL ILIKE pattern for import_queue.listing_url
  extractorFunction: string;  // Edge function name
  discoveryFunction?: string; // Edge function that discovers new URLs
  discoveryArgs?: any;        // Args to pass to discovery function
  concurrency: number;        // How many items to process in parallel per source
  delayMs: number;            // Delay between batches to avoid rate limits
  firecrawlFallback?: boolean; // Use firecrawl + AI for unknown sources
}

const SOURCES: SourceConfig[] = [
  // ─── Tier 1: Big auction sites ───
  // NOTE: BaT runs separately via `dotenvx run -- npx tsx scripts/bat-process-queue.ts`
  // because the edge function takes 10-35s per item and times out when called from another edge function.
  // {
  //   name: 'BaT',
  //   urlPattern: '%bringatrailer.com%',
  //   extractorFunction: 'extract-bat-core',
  //   ...
  // },
  {
    name: 'Cars & Bids',
    urlPattern: '%carsandbids.com%',
    extractorFunction: 'extract-cars-and-bids-core',
    discoveryFunction: 'cab-url-discovery',
    discoveryArgs: { action: 'discover', limit: 200 },
    concurrency: 3,
    delayMs: 3000,
  },
  {
    name: 'Mecum',
    urlPattern: '%mecum.com%',
    extractorFunction: 'extract-premium-auction',
    concurrency: 3,
    delayMs: 3000,
  },
  {
    name: 'Gooding',
    urlPattern: '%gooding%',
    extractorFunction: 'extract-gooding',
    concurrency: 3,
    delayMs: 2000,
  },
  // ─── Tier 2: Major auction houses ───
  {
    name: 'RM Sothebys',
    urlPattern: '%rmsothebys%',
    extractorFunction: 'extract-rmsothebys',
    concurrency: 3,
    delayMs: 2000,
  },
  {
    name: 'Bonhams',
    urlPattern: '%bonhams%',
    extractorFunction: 'extract-bonhams',
    concurrency: 3,
    delayMs: 2000,
  },
  {
    name: 'Collecting Cars',
    urlPattern: '%collectingcars%',
    extractorFunction: 'extract-collecting-cars',
    discoveryFunction: 'collecting-cars-discovery',
    discoveryArgs: { action: 'discover' },
    concurrency: 3,
    delayMs: 2000,
  },
  {
    name: 'Barrett-Jackson',
    urlPattern: '%barrett-jackson%',
    extractorFunction: 'extract-vehicle-data-ai',
    concurrency: 2,
    delayMs: 3000,
  },
  {
    name: 'BH Auction',
    urlPattern: '%bhauction%',
    extractorFunction: 'extract-bh-auction',
    concurrency: 2,
    delayMs: 2000,
  },
  {
    name: 'Broad Arrow',
    urlPattern: '%broadarrow%',
    extractorFunction: 'extract-vehicle-data-ai',
    concurrency: 2,
    delayMs: 3000,
  },
  {
    name: 'Historics UK',
    urlPattern: '%historics.co.uk%',
    extractorFunction: 'extract-historics-uk',
    concurrency: 2,
    delayMs: 2000,
  },
  {
    name: 'GAA Classic Cars',
    urlPattern: '%gaaclassiccars%',
    extractorFunction: 'extract-gaa-classics',
    concurrency: 2,
    delayMs: 2000,
  },
  // ─── Tier 3: Marketplace / classified (dedicated extractors only) ───
  {
    name: 'Craigslist',
    urlPattern: '%craigslist.org%',
    extractorFunction: 'extract-craigslist',
    concurrency: 5,
    delayMs: 1000,
  },
  {
    name: 'PCarMarket',
    urlPattern: '%pcarmarket.com%',
    extractorFunction: 'import-pcarmarket-listing',
    concurrency: 3,
    delayMs: 2000,
  },
  {
    name: 'Hagerty',
    urlPattern: '%hagerty.com%',
    extractorFunction: 'extract-hagerty-listing',
    concurrency: 2,
    delayMs: 3000,
  },
  {
    name: 'Classic.com',
    urlPattern: '%classic.com%',
    extractorFunction: 'import-classic-auction',
    concurrency: 2,
    delayMs: 2000,
  },
  {
    name: 'KSL',
    urlPattern: '%ksl.com%',
    extractorFunction: 'scrape-ksl-listings',
    concurrency: 2,
    delayMs: 3000,
  },
  {
    name: 'eBay Motors',
    urlPattern: '%ebay.com%',
    extractorFunction: 'extract-ebay-motors',
    concurrency: 2,
    delayMs: 3000,
  },
  // ─── Tier 4: Forums / registries (dedicated extractors) ───
  {
    name: 'Rennlist',
    urlPattern: '%rennlist.com%',
    extractorFunction: 'extract-rennlist',
    concurrency: 2,
    delayMs: 2000,
  },
  {
    name: 'TheSamba',
    urlPattern: '%thesamba.com%',
    extractorFunction: 'extract-thesamba',
    concurrency: 2,
    delayMs: 2000,
  },
  // ─── AI-dependent sources (requires OpenAI quota - disabled when quota exhausted) ───
  // Uncomment these when OpenAI quota is replenished:
  // { name: 'Hemmings', urlPattern: '%hemmings.com%', extractorFunction: 'extract-vehicle-data-ai', concurrency: 2, delayMs: 3000 },
  // { name: 'Mecum (AI)', urlPattern: '%mecum%', extractorFunction: 'extract-vehicle-data-ai', concurrency: 2, delayMs: 3000 },
  // { name: 'Barn Finds', urlPattern: '%barnfinds.com%', extractorFunction: 'extract-vehicle-data-ai', concurrency: 2, delayMs: 3000 },
  // { name: 'ECR', urlPattern: '%exclusivecarregistry%', extractorFunction: 'extract-vehicle-data-ai', concurrency: 2, delayMs: 3000 },
  // { name: 'Vanguard', urlPattern: '%vanguardmotorsales%', extractorFunction: 'extract-vehicle-data-ai', concurrency: 2, delayMs: 3000 },
  // { name: 'Gateway Classic', urlPattern: '%gatewayclassiccars%', extractorFunction: 'extract-vehicle-data-ai', concurrency: 2, delayMs: 3000 },
  // { name: 'Other (AI)', urlPattern: '%', extractorFunction: 'extract-vehicle-data-ai', concurrency: 2, delayMs: 3000, firecrawlFallback: true },
];

// ─── Stats tracking ─────────────────────────────────────────────────────

interface LaneStats {
  source: string;
  processed: number;
  succeeded: number;
  failed: number;
  discovered: number;
  startedAt: Date;
  lastActivity: Date;
  status: 'running' | 'discovering' | 'done' | 'error';
}

const laneStats = new Map<string, LaneStats>();
let totalProcessed = 0;
let totalSucceeded = 0;

// ─── Core extraction ────────────────────────────────────────────────────

async function callExtractor(
  extractorFunction: string,
  url: string,
  timeout = 90000
): Promise<{ success: boolean; error?: string; vehicle_id?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    // Send both url AND listing_url to cover all extractor parameter conventions
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/${extractorFunction}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url, listing_url: url, save_to_db: true }),
        signal: controller.signal,
      }
    );

    const result = await response.json();
    return {
      success: result.success === true,
      error: result.error || result.message,
      vehicle_id: result.vehicle_id || result.vehicleId,
    };
  } catch (e: any) {
    if (e.name === 'AbortError') {
      return { success: false, error: `Timeout after ${timeout / 1000}s` };
    }
    return { success: false, error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

async function callDiscovery(
  discoveryFunction: string,
  args: any
): Promise<number> {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/${discoveryFunction}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(args),
      }
    );

    const result = await response.json();
    return result.new_urls_queued || result.queued || result.discovered || 0;
  } catch (e: any) {
    console.error(`  [discovery] ${discoveryFunction} failed: ${e.message}`);
    return 0;
  }
}

// ─── Fetch pending items for a source ───────────────────────────────────

async function fetchPendingForSource(
  config: SourceConfig,
  limit: number
): Promise<Array<{ id: string; listing_url: string; attempts: number }>> {
  // For the "Other" catchall, we need to exclude all specific patterns
  if (config.name === 'Other (AI)') {
    const specificPatterns = SOURCES
      .filter((s) => s.name !== 'Other (AI)')
      .map((s) => s.urlPattern.replace(/%/g, ''));

    let query = supabase
      .from('import_queue')
      .select('id, listing_url, attempts')
      .eq('status', 'pending')
      .limit(limit);

    // Exclude all known sources
    for (const pattern of specificPatterns) {
      query = query.not('listing_url', 'ilike', `%${pattern}%`);
    }

    const { data, error } = await query;
    if (error) {
      console.error(`  [${config.name}] fetch error: ${error.message}`);
      return [];
    }
    return data || [];
  }

  const { data, error } = await supabase
    .from('import_queue')
    .select('id, listing_url, attempts')
    .eq('status', 'pending')
    .ilike('listing_url', config.urlPattern)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    console.error(`  [${config.name}] fetch error: ${error.message}`);
    return [];
  }
  return data || [];
}

// Also try retryable failed items when pending is empty
async function fetchRetryableForSource(
  config: SourceConfig,
  limit: number
): Promise<Array<{ id: string; listing_url: string; attempts: number }>> {
  if (config.name === 'Other (AI)') return [];

  const { data, error } = await supabase
    .from('import_queue')
    .select('id, listing_url, attempts')
    .eq('status', 'failed')
    .lt('attempts', 5)
    .ilike('listing_url', config.urlPattern)
    .order('attempts', { ascending: true })
    .limit(limit);

  if (error) return [];
  return data || [];
}

// ─── Process a single item ──────────────────────────────────────────────

async function processItem(
  config: SourceConfig,
  item: { id: string; listing_url: string; attempts: number }
): Promise<boolean> {
  const result = await callExtractor(config.extractorFunction, item.listing_url);

  if (result.success) {
    await supabase.from('import_queue').update({
      status: 'complete',
      processed_at: new Date().toISOString(),
      attempts: item.attempts + 1,
      vehicle_id: result.vehicle_id || null,
    }).eq('id', item.id);
    return true;
  } else {
    const isFinal = item.attempts + 1 >= 5;
    await supabase.from('import_queue').update({
      status: isFinal ? 'failed' : 'pending',
      error_message: result.error || 'Extraction failed',
      attempts: item.attempts + 1,
      next_attempt_at: isFinal ? null : new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    }).eq('id', item.id);
    return false;
  }
}

// ─── Source Lane: runs one source continuously ──────────────────────────

async function runLane(config: SourceConfig): Promise<void> {
  const stats: LaneStats = {
    source: config.name,
    processed: 0,
    succeeded: 0,
    failed: 0,
    discovered: 0,
    startedAt: new Date(),
    lastActivity: new Date(),
    status: 'running',
  };
  laneStats.set(config.name, stats);

  const tag = `[${config.name}]`;
  let emptyRounds = 0;
  const maxEmptyRounds = 3; // Try discovery 3 times before giving up

  while (true) {
    // Fetch batch of pending items
    const items = await fetchPendingForSource(config, config.concurrency * 2);

    if (items.length === 0) {
      // Try retryable failed items
      const retryable = await fetchRetryableForSource(config, config.concurrency);
      if (retryable.length > 0) {
        console.log(`${tag} No pending, retrying ${retryable.length} failed items...`);
        // Reset them to pending first
        for (const item of retryable) {
          await supabase.from('import_queue').update({ status: 'pending' }).eq('id', item.id);
        }
        continue;
      }

      // Try discovery if available
      if (config.discoveryFunction && emptyRounds < maxEmptyRounds) {
        emptyRounds++;
        stats.status = 'discovering';
        console.log(`${tag} Queue empty, running discovery (attempt ${emptyRounds}/${maxEmptyRounds})...`);
        const discovered = await callDiscovery(config.discoveryFunction, config.discoveryArgs || {});
        stats.discovered += discovered;
        if (discovered > 0) {
          console.log(`${tag} Discovered ${discovered} new URLs!`);
          emptyRounds = 0; // Reset counter on successful discovery
          continue;
        }
        console.log(`${tag} Discovery found nothing new.`);
        continue;
      }

      // Lane is done
      stats.status = 'done';
      console.log(`${tag} ✓ DONE — ${stats.succeeded} succeeded, ${stats.failed} failed, ${stats.discovered} discovered`);
      return;
    }

    emptyRounds = 0;
    stats.status = 'running';

    // Process batch with concurrency limit
    const batch = items.slice(0, config.concurrency);
    const results = await Promise.allSettled(
      batch.map((item) => processItem(config, item))
    );

    for (const result of results) {
      stats.processed++;
      totalProcessed++;
      if (result.status === 'fulfilled' && result.value) {
        stats.succeeded++;
        totalSucceeded++;
      } else {
        stats.failed++;
      }
    }

    stats.lastActivity = new Date();

    // Brief status line
    if (stats.processed % 20 === 0 || items.length < config.concurrency) {
      console.log(
        `${tag} ${stats.succeeded}✓ ${stats.failed}✗ (${items.length} remaining)`
      );
    }

    // Rate limit delay
    await new Promise((r) => setTimeout(r, config.delayMs));
  }
}

// ─── Dashboard ──────────────────────────────────────────────────────────

function printDashboard() {
  const lines: string[] = [
    '',
    '═══════════════════════════════════════════════════════════════════════',
    `  BLITZ DASHBOARD  │  ${new Date().toLocaleTimeString()}  │  Total: ${totalSucceeded}✓ / ${totalProcessed} processed`,
    '═══════════════════════════════════════════════════════════════════════',
    '  Source                   │ Status      │ OK     │ Fail  │ Disc  │ Rate',
    '───────────────────────────┼─────────────┼────────┼───────┼───────┼──────',
  ];

  for (const [, stats] of laneStats) {
    const elapsed = (Date.now() - stats.startedAt.getTime()) / 1000 / 60; // minutes
    const rate = elapsed > 0 ? (stats.succeeded / elapsed).toFixed(1) : '—';
    const statusIcon =
      stats.status === 'running' ? '🔄' :
      stats.status === 'discovering' ? '🔍' :
      stats.status === 'done' ? '✅' : '❌';

    lines.push(
      `  ${stats.source.padEnd(25)} │ ${statusIcon} ${stats.status.padEnd(9)} │ ${String(stats.succeeded).padStart(6)} │ ${String(stats.failed).padStart(5)} │ ${String(stats.discovered).padStart(5)} │ ${rate}/m`
    );
  }

  lines.push('═══════════════════════════════════════════════════════════════════════');
  console.log(lines.join('\n'));
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  // Parse args
  const args = process.argv.slice(2);
  let selectedSources: string[] | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sources' && args[i + 1]) {
      selectedSources = args[i + 1].split(',').map((s) => s.trim().toLowerCase());
    }
  }

  // Filter sources if specified
  let activeSources = SOURCES;
  if (selectedSources) {
    activeSources = SOURCES.filter((s) =>
      selectedSources!.some((sel) =>
        s.name.toLowerCase().includes(sel) || sel.includes(s.name.toLowerCase())
      )
    );
  }

  // Remove "Other (AI)" from the race if we have specific sources
  if (selectedSources) {
    activeSources = activeSources.filter((s) => s.name !== 'Other (AI)');
  }

  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║              PARALLEL SOURCE BLITZ                       ║');
  console.log('║          All sources. All night. No mercy.               ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Launching ${activeSources.length} extraction lanes...`);
  console.log(`  Sources: ${activeSources.map((s) => s.name).join(', ')}`);
  console.log('');

  // Dashboard timer
  const dashboardInterval = setInterval(printDashboard, 60000); // Every minute

  // Launch all lanes simultaneously
  const lanePromises = activeSources.map((config) => runLane(config));

  // Wait for all to complete
  await Promise.allSettled(lanePromises);

  clearInterval(dashboardInterval);

  // Final dashboard
  printDashboard();

  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║                    BLITZ COMPLETE                        ║');
  console.log(`║  ${totalSucceeded} vehicles extracted across ${activeSources.length} sources             ║`);
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');
}

main().catch(console.error);
