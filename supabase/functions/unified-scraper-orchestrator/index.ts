/**
 * UNIFIED SCRAPER ORCHESTRATOR
 * 
 * Single entry point that ties everything together:
 * 1. Checks all active sources
 * 2. Runs scrapers for active sources
 * 3. Processes import_queue
 * 4. Reports accountability
 * 
 * Fixes: Broken integration, no visibility, new sources don't work
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SourceStatus {
  id: string;
  domain: string;
  url: string;
  source_name: string;
  scraper_function: string;
  is_active: boolean;
  last_successful_scrape: string | null;
  has_site_map: boolean;
  site_map_coverage: number;
  queue_pending: number;
  queue_processed: number;
  success_rate: number;
  status: 'healthy' | 'degraded' | 'failing' | 'unmapped';
}

interface OrchestratorResult {
  cycle_id: string;
  started_at: string;
  completed_at: string;
  sources_checked: number;
  sources_scraped: number;
  queue_processed: number;
  vehicles_added: number;
  issues: string[];
  status: 'success' | 'partial' | 'failed';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json().catch(() => ({}));
    const { action = 'run_cycle' } = body;

    console.log('='.repeat(70));
    console.log('UNIFIED SCRAPER ORCHESTRATOR');
    console.log('='.repeat(70));
    console.log(`Action: ${action}\n`);

    switch (action) {
      case 'run_cycle':
        return await runCycle(supabase);
      case 'check_health':
        return await checkHealth(supabase);
      case 'get_status':
        return await getStatus(supabase);
      case 'add_source':
        return await addSource(supabase, body);
      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

  } catch (error: any) {
    console.error('Error in unified-scraper-orchestrator:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || String(error)
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

async function runCycle(supabase: any) {
  const cycleId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  console.log('🔄 Starting unified scraper cycle...\n');

  const result: OrchestratorResult = {
    cycle_id: cycleId,
    started_at: startedAt,
    completed_at: '',
    sources_checked: 0,
    sources_scraped: 0,
    queue_processed: 0,
    vehicles_added: 0,
    issues: [],
    status: 'success'
  };

  // Step 1: Check all active sources
  console.log('📋 Step 1: Checking all active sources...');
  const sources = await getActiveSources(supabase);
  result.sources_checked = sources.length;
  console.log(`   Found ${sources.length} active sources\n`);

  // Step 2: Check source health and mappings
  console.log('🔍 Step 2: Checking source health and mappings...');
  const sourceStatuses = await checkSourceStatuses(sources, supabase);
  
  const unmappedSources = sourceStatuses.filter(s => !s.has_site_map);
  const failingSources = sourceStatuses.filter(s => s.status === 'failing');
  const healthySources = sourceStatuses.filter(s => s.status === 'healthy');

  console.log(`   ✅ Healthy: ${healthySources.length}`);
  console.log(`   ⚠️  Degraded: ${sourceStatuses.filter(s => s.status === 'degraded').length}`);
  console.log(`   ❌ Failing: ${failingSources.length}`);
  console.log(`   🗺️  Unmapped: ${unmappedSources.length}\n`);

  // Step 3: Create site maps for unmapped sources
  if (unmappedSources.length > 0) {
    console.log('🗺️  Step 3: Creating site maps for unmapped sources...');
    for (const source of unmappedSources) {
      try {
        console.log(`   Mapping: ${source.domain}`);
        await supabase.functions.invoke('thorough-site-mapper', {
          body: {
            source_url: source.url,
            source_id: source.id,
            create_complete_map: true
          }
        });
        // Wait a bit between mappings
        await sleep(2000);
      } catch (err: any) {
        console.warn(`   ⚠️  Failed to map ${source.domain}:`, err.message);
        result.issues.push(`Failed to map ${source.domain}: ${err.message}`);
      }
    }
    console.log('');
  }

  // Step 4: Run scrapers for healthy sources
  console.log('🚀 Step 4: Running scrapers for healthy sources...');
  let totalQueued = 0;
  
  for (const source of healthySources) {
    try {
      console.log(`   Scraping: ${source.domain} (${source.scraper_function})`);
      
      const { data, error } = await supabase.functions.invoke(source.scraper_function, {
        body: {
          max_listings: 100, // Reasonable batch size
          source_id: source.id
        }
      });

      if (error) {
        console.warn(`   ⚠️  Error scraping ${source.domain}:`, error.message);
        result.issues.push(`Error scraping ${source.domain}: ${error.message}`);
        continue;
      }

      const queued = data?.stats?.queued || data?.queued || 0;
      totalQueued += queued;
      result.sources_scraped++;

      console.log(`   ✅ Queued ${queued} listings`);

      // Update last_successful_scrape
      await supabase
        .from('scrape_sources')
        .update({ last_successful_scrape: new Date().toISOString() })
        .eq('id', source.id);

      // Small delay between sources
      await sleep(1000);

    } catch (err: any) {
      console.warn(`   ⚠️  Failed to scrape ${source.domain}:`, err.message);
      result.issues.push(`Failed to scrape ${source.domain}: ${err.message}`);
    }
  }

  console.log(`\n   ✅ Scraped ${result.sources_scraped} sources, queued ${totalQueued} listings\n`);

  // Step 5: Process import_queue
  console.log('⚙️  Step 5: Processing import_queue...');
  const queueResult = await processQueue(supabase);
  result.queue_processed = queueResult.processed;
  result.vehicles_added = queueResult.vehicles_created;
  console.log(`   ✅ Processed ${queueResult.processed} items, created ${queueResult.vehicles_created} vehicles\n`);

  // Step 6: Report status
  result.completed_at = new Date().toISOString();
  result.status = result.issues.length > 0 ? 'partial' : 'success';

  // Log cycle result
  await logCycleResult(supabase, result);

  console.log('='.repeat(70));
  console.log('CYCLE COMPLETE');
  console.log('='.repeat(70));
  console.log(`Sources checked: ${result.sources_checked}`);
  console.log(`Sources scraped: ${result.sources_scraped}`);
  console.log(`Queue processed: ${result.queue_processed}`);
  console.log(`Vehicles added: ${result.vehicles_added}`);
  console.log(`Issues: ${result.issues.length}`);
  console.log(`Status: ${result.status}`);

  return new Response(
    JSON.stringify({
      success: true,
      cycle: result,
      summary: {
        sources_checked: result.sources_checked,
        sources_scraped: result.sources_scraped,
        queue_processed: result.queue_processed,
        vehicles_added: result.vehicles_added,
        issues_count: result.issues.length,
        status: result.status
      }
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function checkHealth(supabase: any) {
  const sources = await getActiveSources(supabase);
  const statuses = await checkSourceStatuses(sources, supabase);

  const health = {
    total_sources: sources.length,
    healthy: statuses.filter(s => s.status === 'healthy').length,
    degraded: statuses.filter(s => s.status === 'degraded').length,
    failing: statuses.filter(s => s.status === 'failing').length,
    unmapped: statuses.filter(s => !s.has_site_map).length,
    sources: statuses
  };

  return new Response(
    JSON.stringify({
      success: true,
      health
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function getStatus(supabase: any) {
  // Get comprehensive status
  const sources = await getActiveSources(supabase);
  const statuses = await checkSourceStatuses(sources, supabase);

  // Get queue stats
  const { count: pendingCount } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');

  const { count: processingCount } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'processing');

  const { count: completeCount } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'complete');

  // Get recent vehicles
  const { count: vehiclesToday } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', new Date(Date.now() - 24 * 3600000).toISOString());

  const { count: totalVehicles } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true });

  return new Response(
    JSON.stringify({
      success: true,
      status: {
        sources: {
          total: sources.length,
          healthy: statuses.filter(s => s.status === 'healthy').length,
          degraded: statuses.filter(s => s.status === 'degraded').length,
          failing: statuses.filter(s => s.status === 'failing').length,
          unmapped: statuses.filter(s => !s.has_site_map).length,
          details: statuses
        },
        queue: {
          pending: pendingCount || 0,
          processing: processingCount || 0,
          complete: completeCount || 0
        },
        database: {
          total_vehicles: totalVehicles || 0,
          vehicles_today: vehiclesToday || 0
        }
      }
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function addSource(supabase: any, body: any) {
  const { domain, url, source_name, scraper_function = 'scrape-multi-source' } = body;

  if (!domain || !url) {
    return new Response(
      JSON.stringify({ error: 'domain and url required' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Create or update source
  const { data: source, error } = await supabase
    .from('scrape_sources')
    .upsert({
      domain,
      url,
      source_name: source_name || domain,
      scraper_function,
      is_active: false, // Start inactive until mapped
      source_type: 'marketplace'
    }, {
      onConflict: 'domain'
    })
    .select()
    .single();

  if (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Create site map
  try {
    await supabase.functions.invoke('thorough-site-mapper', {
      body: {
        source_url: url,
        source_id: source.id,
        create_complete_map: true
      }
    });
  } catch (err: any) {
    console.warn('Failed to create site map:', err.message);
  }

  return new Response(
    JSON.stringify({
      success: true,
      source,
      message: 'Source added. Create site map, then activate.'
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function getActiveSources(supabase: any) {
  const { data, error } = await supabase
    .from('scrape_sources')
    .select('*')
    .eq('is_active', true)
    .order('last_successful_scrape', { ascending: true, nullsFirst: true });

  if (error) {
    console.error('Error fetching sources:', error);
    return [];
  }

  return data || [];
}

async function checkSourceStatuses(sources: any[], supabase: any): Promise<SourceStatus[]> {
  const statuses: SourceStatus[] = [];

  for (const source of sources) {
    // Check for site map
    const { data: siteMap } = await supabase
      .from('site_maps')
      .select('coverage_percentage, status')
      .eq('source_id', source.id)
      .maybeSingle();

    const hasSiteMap = !!siteMap;
    const coverage = siteMap?.coverage_percentage || 0;

    // Check queue stats
    const { count: pendingCount } = await supabase
      .from('import_queue')
      .select('*', { count: 'exact', head: true })
      .eq('source_id', source.id)
      .eq('status', 'pending');

    const { count: processedCount } = await supabase
      .from('import_queue')
      .select('*', { count: 'exact', head: true })
      .eq('source_id', source.id)
      .eq('status', 'complete');

    const { count: failedCount } = await supabase
      .from('import_queue')
      .select('*', { count: 'exact', head: true })
      .eq('source_id', source.id)
      .eq('status', 'failed');

    const total = (processedCount || 0) + (failedCount || 0);
    const successRate = total > 0 ? (processedCount || 0) / total : 1.0;

    // Determine status
    let status: 'healthy' | 'degraded' | 'failing' | 'unmapped';
    if (!hasSiteMap || coverage < 95) {
      status = 'unmapped';
    } else if (successRate < 0.5) {
      status = 'failing';
    } else if (successRate < 0.8) {
      status = 'degraded';
    } else {
      status = 'healthy';
    }

    statuses.push({
      id: source.id,
      domain: source.domain,
      url: source.url,
      source_name: source.source_name,
      scraper_function: source.scraper_function || 'scrape-multi-source',
      is_active: source.is_active,
      last_successful_scrape: source.last_successful_scrape,
      has_site_map: hasSiteMap,
      site_map_coverage: coverage,
      queue_pending: pendingCount || 0,
      queue_processed: processedCount || 0,
      success_rate: successRate,
      status
    });
  }

  return statuses;
}

async function processQueue(supabase: any) {
  // Process import_queue in batches
  let processed = 0;
  let vehiclesCreated = 0;
  const BATCH_SIZE = 50;
  const MAX_BATCHES = 10; // Process up to 500 items per cycle

  for (let i = 0; i < MAX_BATCHES; i++) {
    try {
      const { data, error } = await supabase.functions.invoke('process-import-queue', {
        body: {
          batch_size: BATCH_SIZE,
          priority_only: false
        }
      });

      if (error) {
        console.warn(`Batch ${i + 1} error:`, error.message);
        break;
      }

      processed += data?.processed || 0;
      vehiclesCreated += data?.succeeded || 0;

      // If no items processed, queue is empty
      if (!data?.processed || data.processed === 0) {
        break;
      }

    } catch (err: any) {
      console.warn(`Batch ${i + 1} failed:`, err.message);
      break;
    }
  }

  return { processed, vehicles_created: vehiclesCreated };
}

async function logCycleResult(supabase: any, result: OrchestratorResult) {
  // Log to database for tracking
  try {
    await supabase
      .from('scraper_runs')
      .insert({
        cycle_id: result.cycle_id,
        started_at: result.started_at,
        completed_at: result.completed_at,
        sources_checked: result.sources_checked,
        sources_scraped: result.sources_scraped,
        queue_processed: result.queue_processed,
        vehicles_added: result.vehicles_added,
        issues: result.issues,
        status: result.status
      });
  } catch (err: any) {
    console.warn('Failed to log cycle result:', err.message);
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

