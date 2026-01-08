/**
 * PIPELINE ORCHESTRATOR
 * 
 * Single source of truth for keeping the vehicle ingestion pipeline moving.
 * Call this every 5-10 minutes (GitHub Action or Supabase cron).
 * 
 * What it does:
 * 1. Unlock orphaned "processing" rows in all queues
 * 2. Activate scrapers for each source (BaT, auctions, orgs)
 * 3. Drain import_queue (raw listings → vehicle profiles)
 * 4. Drain bat_extraction_queue (BaT profiles → complete data)
 * 5. Log metrics (profiles created per source, queue depth)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { selectProcessor, groupByProcessor, getProcessorSummary, type QueueItem } from '../_shared/select-processor.ts';
import { isApprovedBatExtractor, APPROVED_BAT_EXTRACTORS } from '../_shared/approved-extractors.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OrchestrationResult {
  success: boolean;
  timestamp: string;
  duration_ms: number;
  
  // Step 1: Queue cleanup
  unlocked_import_queue: number;
  unlocked_bat_queue: number;
  
  // Step 2: Scraper activation
  scrapers_triggered: string[];
  scraper_errors: string[];
  
  // Step 3: Queue processing
  import_queue_processed: number;
  import_queue_succeeded: number;
  import_queue_failed: number;
  bat_queue_processed: number;
  bat_queue_completed: number;
  bat_queue_failed: number;
  
  // Step 4: Metrics
  profiles_created_this_run: number;
  queue_depths: {
    import_pending: number;
    import_processing: number;
    bat_pending: number;
    bat_processing: number;
  };
  
  errors: string[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const startTime = Date.now();
  const result: OrchestrationResult = {
    success: false,
    timestamp: new Date().toISOString(),
    duration_ms: 0,
    unlocked_import_queue: 0,
    unlocked_bat_queue: 0,
    scrapers_triggered: [],
    scraper_errors: [],
    import_queue_processed: 0,
    import_queue_succeeded: 0,
    import_queue_failed: 0,
    bat_queue_processed: 0,
    bat_queue_completed: 0,
    bat_queue_failed: 0,
    profiles_created_this_run: 0,
    queue_depths: {
      import_pending: 0,
      import_processing: 0,
      bat_pending: 0,
      bat_processing: 0,
    },
    errors: [],
  };

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json().catch(() => ({}));
    const skipScrapers = body.skip_scrapers === true;
    const skipQueues = body.skip_queues === true;

    console.log('🎯 Pipeline Orchestrator starting...');
    console.log(`   Mode: ${skipScrapers ? 'queues only' : skipQueues ? 'scrapers only' : 'full pipeline'}`);

    // ============================================================================
    // STEP 0: Auto-queue backfill vehicles (runs periodically, doesn't block)
    // ============================================================================
    if (!skipQueues && !skipScrapers) {
      try {
        console.log('\n🔄 Step 0: Checking for BaT vehicles needing backfill...');
        const { data: backfillResult, error: backfillError } = await supabase.rpc('auto_queue_bat_backfills', {
          p_batch_size: 20, // Queue 20 at a time per run
          p_priority: 75, // Lower priority than new extractions (100)
        });
        
        if (!backfillError && backfillResult && backfillResult.length > 0) {
          const queued = backfillResult[0]?.queued_count || 0;
          const skipped = backfillResult[0]?.skipped_count || 0;
          if (queued > 0) {
            console.log(`   ✅ Queued ${queued} vehicles for backfill${skipped > 0 ? ` (${skipped} already queued)` : ''}`);
          }
        } else if (backfillError) {
          console.warn(`   ⚠️  Backfill queuing error (non-critical): ${backfillError.message}`);
        }
      } catch (e: any) {
        console.warn(`   ⚠️  Backfill queuing exception (non-critical): ${e.message}`);
      }
    }

    // ============================================================================
    // STEP 1: Unlock orphaned "processing" rows
    // ============================================================================
    console.log('\n📂 Step 1: Unlocking orphaned queue items...');
    
    const LOCK_TIMEOUT_MINUTES = 15;
    const cutoffTime = new Date(Date.now() - LOCK_TIMEOUT_MINUTES * 60 * 1000).toISOString();

    // Unlock import_queue
    const { data: unlockedImport } = await supabase
      .from('import_queue')
      .update({
        status: 'pending',
        updated_at: new Date().toISOString(),
        locked_at: null,
        locked_by: null,
      })
      .eq('status', 'processing')
      .lt('updated_at', cutoffTime)
      .select('id');
    
    result.unlocked_import_queue = unlockedImport?.length || 0;
    console.log(`   ✅ Unlocked ${result.unlocked_import_queue} import_queue items`);

    // Unlock bat_extraction_queue
    const { data: unlockedBat } = await supabase
      .from('bat_extraction_queue')
      .update({
        status: 'pending',
        updated_at: new Date().toISOString(),
        locked_at: null,
        locked_by: null,
      })
      .eq('status', 'processing')
      .lt('updated_at', cutoffTime)
      .select('id');
    
    result.unlocked_bat_queue = unlockedBat?.length || 0;
    console.log(`   ✅ Unlocked ${result.unlocked_bat_queue} bat_extraction_queue items`);

    // ============================================================================
    // STEP 2: Activate scrapers for each source
    // ============================================================================
    if (!skipScrapers) {
      console.log('\n🔍 Step 2: Activating scrapers...');

      const scrapers = [
        { name: 'BaT active auctions', fn: 'sync-active-auctions', body: { batch_size: 20 } },
        // Note: Premium auction scrapers are expensive and timeout-prone; skip for now
        // The orchestrator will trigger sync-active-auctions which handles BaT discovery
        // Individual auction scrapers (Mecum, Cars & Bids, Broad Arrow) have their own crons
        // that run less frequently - we don't need to duplicate that here
        { name: 'Orgs inventory', fn: 'extract-all-orgs-inventory', body: { limit: 5, min_vehicle_threshold: 10 } },
      ];

      for (const scraper of scrapers) {
        try {
          console.log(`   Triggering: ${scraper.name}...`);
          
          // Fire-and-forget pattern (don't wait for long-running scrapers)
          supabase.functions.invoke(scraper.fn, { body: scraper.body })
            .then(({ error }) => {
              if (error) {
                console.error(`   [async] ${scraper.name} failed: ${error.message}`);
              } else {
                console.log(`   [async] ${scraper.name} completed`);
              }
            })
            .catch((e: any) => {
              console.error(`   [async] ${scraper.name} error: ${e.message}`);
            });

          result.scrapers_triggered.push(scraper.name);
          console.log(`   ✅ ${scraper.name} triggered (async)`);
        } catch (e: any) {
          result.scraper_errors.push(`${scraper.name}: ${e.message}`);
          console.error(`   ❌ ${scraper.name} error: ${e.message}`);
        }
      }
    }

    // ============================================================================
    // STEP 3: Drain queues
    // ============================================================================
    if (!skipQueues) {
      console.log('\n⚙️  Step 3: Processing queues...');

      // 3a. Route import_queue items using intelligent processor selection
      console.log('   Routing import_queue using processor selection...');
      try {
        const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
        const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';

        // Query pending items to determine routing
        const { data: pendingItems, error: queueError } = await supabase
          .from('import_queue')
          .select('id, listing_url, raw_data, source_id, listing_title, listing_year, listing_make, listing_model')
          .eq('status', 'pending')
          .limit(100); // Sample first 100 to determine distribution

        if (queueError) {
          throw new Error(`Failed to query import_queue: ${queueError.message}`);
        }

        if (!pendingItems || pendingItems.length === 0) {
          console.log(`   ℹ️  No pending items in import_queue`);
          result.import_queue_processed = 0;
        } else {
          // Use intelligent processor selection
          const summary = getProcessorSummary(pendingItems as QueueItem[]);
          console.log(`   📊 Processor distribution:`);
          for (const [funcName, info] of Object.entries(summary)) {
            console.log(`      ${funcName}: ${info.count} items (${info.reason})`);
          }

          // Group items by selected processor
          const groups = groupByProcessor(pendingItems as QueueItem[]);

          // Process each group by its selected function
          for (const [functionName, items] of groups.entries()) {
            if (items.length === 0) continue;

            // Get selection details from first item (all items in group use same processor)
            const selection = selectProcessor(items[0]);

            console.log(`   🎯 Routing ${items.length} items to ${functionName}...`);

            // Special handling for batch processors vs per-item processors
            if (functionName === 'process-bhcc-queue' || functionName === 'process-import-queue') {
              // Batch processors: call once with batch_size
              fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${SERVICE_KEY}`,
                },
                body: JSON.stringify({
                  ...selection.parameters,
                  batch_size: Math.min(items.length, selection.parameters.batch_size || 10),
                }),
              }).then(async (resp) => {
                if (!resp.ok) {
                  console.error(`   [async] ${functionName} HTTP ${resp.status}`);
                  return;
                }
                const res = await resp.json();
                console.log(`   [async] ${functionName}: ${res.created || res.processed || 0} processed`);
              }).catch(e => {
                console.error(`   [async] ${functionName} error: ${e.message}`);
              });
            } else if (functionName === 'process-bat-from-import-queue') {
              // ✅ APPROVED BaT WORKFLOW (DO NOT CHANGE)
              // This implements the mandatory two-step workflow:
              // 1. extract-premium-auction (APPROVED_BAT_EXTRACTORS.CORE_DATA)
              // 2. extract-auction-comments (APPROVED_BAT_EXTRACTORS.COMMENTS)
              // 
              // ⚠️ Do NOT replace with deprecated functions:
              // - comprehensive-bat-extraction
              // - import-bat-listing
              // - bat-extract-complete-v*
              //
              // Documentation: docs/BAT_EXTRACTION_SUCCESS_WORKFLOW.md
              // 
              const batch = items.slice(0, 2); // Process max 2 per cycle (BaT extractions take 30-60s each)
              
              // Validate we're using approved extractors
              const step1Function = APPROVED_BAT_EXTRACTORS.CORE_DATA; // 'extract-premium-auction'
              const step2Function = APPROVED_BAT_EXTRACTORS.COMMENTS; // 'extract-auction-comments'
              
              if (!isApprovedBatExtractor(step1Function)) {
                console.error(`❌ CRITICAL: Step 1 function ${step1Function} is not approved!`);
                throw new Error(`CRITICAL: Step 1 function ${step1Function} is not approved!`);
              }
              if (!isApprovedBatExtractor(step2Function)) {
                console.error(`❌ CRITICAL: Step 2 function ${step2Function} is not approved!`);
                throw new Error(`CRITICAL: Step 2 function ${step2Function} is not approved!`);
              }
              
              Promise.all(batch.map(async (item) => {
                try {
                  const listingUrl = item.listing_url;
                  
                  // Step 1: Extract core vehicle data (VIN, specs, images, auction_events)
                  // ✅ Using APPROVED extractor: extract-premium-auction
                  console.log(`   [async] BaT Step 1: ${step1Function} for ${listingUrl.substring(0, 60)}...`);
                  const step1Resp = await fetch(`${SUPABASE_URL}/functions/v1/${step1Function}`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${SERVICE_KEY}`,
                    },
                    body: JSON.stringify({
                      url: listingUrl,
                      max_vehicles: 1,
                    }),
                  });

                  if (!step1Resp.ok) {
                    throw new Error(`Step 1 failed: HTTP ${step1Resp.status}`);
                  }

                  const step1Result = await step1Resp.json();
                  const vehicleId = step1Result.created_vehicle_ids?.[0] || step1Result.updated_vehicle_ids?.[0];

                  if (!vehicleId) {
                    throw new Error(`No vehicle_id returned from ${step1Function}`);
                  }

                  // Step 2: Extract comments and bids
                  // ✅ Using APPROVED extractor: extract-auction-comments
                  console.log(`   [async] BaT Step 2: ${step2Function} for vehicle ${vehicleId}`);
                  const step2Resp = await fetch(`${SUPABASE_URL}/functions/v1/${step2Function}`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${SERVICE_KEY}`,
                    },
                    body: JSON.stringify({
                      auction_url: listingUrl,
                      vehicle_id: vehicleId,
                    }),
                  });

                  if (!step2Resp.ok) {
                    console.warn(`   [async] BaT Step 2 warning: extract-auction-comments failed (non-critical): HTTP ${step2Resp.status}`);
                  }

                  // Mark queue item as complete
                  await supabase
                    .from('import_queue')
                    .update({
                      status: 'complete',
                      vehicle_id: vehicleId,
                      processed_at: new Date().toISOString(),
                    })
                    .eq('id', item.id);

                  console.log(`   [async] BaT extraction complete for ${item.id}: vehicle ${vehicleId}`);
                } catch (e: any) {
                  console.error(`   [async] BaT extraction error for ${item.id}: ${e.message}`);
                  // Don't mark as failed yet - will retry on next cycle
                }
              })).then(() => {
                console.log(`   [async] BaT: processed ${batch.length}/${items.length} items`);
              }).catch(e => {
                console.error(`   [async] BaT batch error: ${e.message}`);
              });
            } else if (functionName === 'import-classic-auction' || functionName === 'import-pcarmarket-listing') {
              // Other per-item processors: process items individually (limit batch size to avoid overwhelming)
              const batch = items.slice(0, 3); // Process max 3 per cycle for per-item processors
              
              Promise.all(batch.map(async (item) => {
                try {
                  const resp = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${SERVICE_KEY}`,
                    },
                    body: JSON.stringify(selection.parameters),
                  });

                  if (resp.ok) {
                    const res = await resp.json();
                    // Mark queue item as complete
                    if (res.vehicleId || res.vehicle_id || res.success) {
                      await supabase
                        .from('import_queue')
                        .update({
                          status: 'complete',
                          vehicle_id: res.vehicleId || res.vehicle_id || null,
                          processed_at: new Date().toISOString(),
                        })
                        .eq('id', item.id);
                    }
                  } else {
                    console.error(`   [async] ${functionName} failed for ${item.id}: HTTP ${resp.status}`);
                  }
                } catch (e: any) {
                  console.error(`   [async] ${functionName} error for ${item.id}: ${e.message}`);
                }
              })).then(() => {
                console.log(`   [async] ${functionName}: processed ${batch.length}/${items.length} items`);
              }).catch(e => {
                console.error(`   [async] ${functionName} batch error: ${e.message}`);
              });
            } else {
              console.log(`   ⚠️  Unknown processor function: ${functionName}, skipping ${items.length} items`);
            }
          }

          result.import_queue_processed = -1; // -1 indicates async (result not known yet)
        }

      } catch (e: any) {
        result.errors.push(`import_queue routing error: ${e.message}`);
        console.error(`   ❌ import_queue routing error: ${e.message}`);
      }

      // 3b. Drain bat_extraction_queue (BaT profiles → complete data)
      console.log('   Processing bat_extraction_queue...');
      try {
        const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
        const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
        
        // Fire-and-forget: don't wait for bat_extraction_queue to finish (can take minutes)
        fetch(`${SUPABASE_URL}/functions/v1/process-bat-extraction-queue`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SERVICE_KEY}`,
          },
          body: JSON.stringify({
            batchSize: 3,
            maxAttempts: 3,
          }),
        }).then(async (resp) => {
          if (!resp.ok) {
            console.error(`   [async] bat_extraction_queue HTTP ${resp.status}`);
            return;
          }
          const res = await resp.json();
          console.log(`   [async] bat_extraction_queue: ${res.completed}/${res.processed} completed`);
        }).catch(e => {
          console.error(`   [async] bat_extraction_queue error: ${e.message}`);
        });
        
        result.bat_queue_processed = -1; // -1 indicates async (result not known yet)
        console.log(`   ✅ bat_extraction_queue triggered (async, batch_size=3)`);

      } catch (e: any) {
        result.errors.push(`bat_extraction_queue trigger error: ${e.message}`);
        console.error(`   ❌ bat_extraction_queue trigger error: ${e.message}`);
      }
    }

    // ============================================================================
    // STEP 4: Collect metrics (fast queries only)
    // ============================================================================
    console.log('\n📊 Step 4: Collecting metrics...');

    // Fast queue depth queries (parallel)
    const [importStatsResult, batStatsResult] = await Promise.all([
      supabase
        .from('import_queue')
        .select('status')
        .in('status', ['pending', 'processing'])
        .limit(10000), // Limit to avoid timeout
      supabase
        .from('bat_extraction_queue')
        .select('status')
        .in('status', ['pending', 'processing'])
        .limit(10000)
    ]);
    
    const importStats = importStatsResult.data || [];
    const batStats = batStatsResult.data || [];
    
    result.queue_depths.import_pending = importStats.filter(x => x.status === 'pending').length || 0;
    result.queue_depths.import_processing = importStats.filter(x => x.status === 'processing').length || 0;
    result.queue_depths.bat_pending = batStats.filter(x => x.status === 'pending').length || 0;
    result.queue_depths.bat_processing = batStats.filter(x => x.status === 'processing').length || 0;

    console.log(`   Queue depths:`);
    console.log(`     import_queue: ${result.queue_depths.import_pending} pending, ${result.queue_depths.import_processing} processing`);
    console.log(`     bat_extraction_queue: ${result.queue_depths.bat_pending} pending, ${result.queue_depths.bat_processing} processing`);

    // ============================================================================
    // Done
    // ============================================================================
    result.duration_ms = Date.now() - startTime;
    result.success = result.errors.length === 0;

    console.log(`\n✅ Pipeline Orchestrator completed in ${result.duration_ms}ms`);
    console.log(`   Profiles created: ${result.profiles_created_this_run}`);
    console.log(`   Scrapers triggered: ${result.scrapers_triggered.length}`);
    console.log(`   Errors: ${result.errors.length}`);

    return new Response(JSON.stringify(result, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    result.duration_ms = Date.now() - startTime;
    result.success = false;
    result.errors.push(error.message || String(error));

    console.error('❌ Pipeline Orchestrator failed:', error);

    return new Response(
      JSON.stringify(result, null, 2),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

