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
        { name: 'BaT active auctions', fn: 'sync-active-auctions', body: { max_auctions: 50 } },
        // Note: Premium auction scrapers are expensive and timeout-prone; skip for now
        // { name: 'Mecum', fn: 'extract-premium-auction', body: { source: 'mecum', max_listings: 20 } },
        // { name: 'Cars & Bids', fn: 'extract-premium-auction', body: { source: 'cars_bids', max_listings: 20 } },
        // { name: 'Broad Arrow', fn: 'extract-premium-auction', body: { source: 'broad_arrow', max_listings: 20 } },
        { name: 'Orgs inventory', fn: 'extract-all-orgs-inventory', body: { max_orgs: 5, timeout_seconds: 45 } },
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

      // 3a. Drain import_queue (raw listings → vehicle profiles)
      console.log('   Processing import_queue...');
      try {
        // Call via direct fetch with explicit auth header (supabase client invoke doesn't always forward JWT from edge env)
        const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
        const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
        
        // Fire-and-forget: don't wait for import_queue to finish (can take minutes)
        fetch(`${SUPABASE_URL}/functions/v1/process-import-queue`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SERVICE_KEY}`,
          },
          body: JSON.stringify({
            batch_size: 3,
            max_attempts: 3,
            priority_only: false,
            skip_image_upload: true, // Images backfilled separately
            fast_mode: true,
          }),
        }).then(async (resp) => {
          if (!resp.ok) {
            console.error(`   [async] import_queue HTTP ${resp.status}`);
            return;
          }
          const res = await resp.json();
          console.log(`   [async] import_queue: ${res.succeeded}/${res.processed} succeeded`);
        }).catch(e => {
          console.error(`   [async] import_queue error: ${e.message}`);
        });
        
        result.import_queue_processed = -1; // -1 indicates async (result not known yet)
        console.log(`   ✅ import_queue triggered (async, batch_size=3, fast_mode)`);

      } catch (e: any) {
        result.errors.push(`import_queue trigger error: ${e.message}`);
        console.error(`   ❌ import_queue trigger error: ${e.message}`);
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
    // STEP 4: Collect metrics
    // ============================================================================
    console.log('\n📊 Step 4: Collecting metrics...');

    // Queue depths
    const { data: importDepth } = await supabase
      .from('import_queue')
      .select('status', { count: 'exact', head: true });
    
    const { data: importStats } = await supabase
      .from('import_queue')
      .select('status')
      .in('status', ['pending', 'processing']);
    
    result.queue_depths.import_pending = importStats?.filter(x => x.status === 'pending').length || 0;
    result.queue_depths.import_processing = importStats?.filter(x => x.status === 'processing').length || 0;

    const { data: batStats } = await supabase
      .from('bat_extraction_queue')
      .select('status')
      .in('status', ['pending', 'processing']);
    
    result.queue_depths.bat_pending = batStats?.filter(x => x.status === 'pending').length || 0;
    result.queue_depths.bat_processing = batStats?.filter(x => x.status === 'processing').length || 0;

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

