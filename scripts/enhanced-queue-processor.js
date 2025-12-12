#!/usr/bin/env node

/**
 * Enhanced Import Queue Processor
 * 
 * Processes pending import queue items with:
 * 1. Enhanced scraping and data extraction
 * 2. Image backfill with AI analysis
 * 3. AI expert agent for proofreading/validation
 * 4. Field consensus building
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const BATCH_SIZE = 10; // Process in smaller batches to avoid timeouts
const DELAY_BETWEEN_BATCHES = 5000; // 5 seconds between batches

async function enhanceVehicle(vehicleId, listingUrl) {
  const results = {
    vehicle_id: vehicleId,
    images_backfilled: 0,
    analysis_queued: false,
    fields_enhanced: 0,
    errors: []
  };

  try {
    console.log(`\n🔧 Enhancing vehicle: ${vehicleId}`);

    // Get vehicle and check for stored image URLs
    const { data: vehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .select('origin_metadata, discovery_url')
      .eq('id', vehicleId)
      .single();

    if (vehicleError) {
      throw new Error(`Failed to fetch vehicle: ${vehicleError.message}`);
    }

    // Step 1: Backfill images with AI analysis enabled
    const imageUrls = vehicle.origin_metadata?.image_urls || [];
    if (imageUrls.length > 0) {
      console.log(`   Step 1: Backfilling ${imageUrls.length} images with AI analysis...`);
      
      const backfillResponse = await fetch(`${SUPABASE_URL}/functions/v1/backfill-images`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({
          vehicle_id: vehicleId,
          image_urls: imageUrls,
          source: 'import_queue_enhanced',
          run_analysis: true, // Enable AI analysis
          listed_date: vehicle.origin_metadata?.listed_date || new Date().toISOString().split('T')[0]
        })
      });

      if (backfillResponse.ok) {
        const backfillResult = await backfillResponse.json();
        results.images_backfilled = backfillResult.uploaded || 0;
        console.log(`   ✅ Images backfilled: ${results.images_backfilled} uploaded, ${backfillResult.analyzed || 0} analyzed`);
      } else {
        console.warn(`   ⚠️  Image backfill returned ${backfillResponse.status}`);
        results.errors.push('Image backfill failed');
      }
    } else {
      console.log('   ⚠️  No image URLs found in metadata');
    }

    // Step 2: Rescrape to fill in missing fields
    const urlToScrape = listingUrl || vehicle.discovery_url;
    if (urlToScrape) {
      console.log('   Step 2: Rescraping to extract missing fields...');
      
      try {
        // Use the forensic processing system to extract more data
        const { data: scrapedData, error: scrapeError } = await supabase.functions.invoke('scrape-vehicle', {
          body: { url: urlToScrape }
        });

        if (!scrapeError && scrapedData?.success && scrapedData.data) {
          // Process through forensic system
          const { error: forensicError } = await supabase.rpc('process_scraped_data_forensically', {
            p_vehicle_id: vehicleId,
            p_scraped_data: scrapedData.data,
            p_source_url: urlToScrape,
            p_scraper_name: 'enhanced_processor',
            p_context: { enhanced_processing: true }
          });

          if (!forensicError) {
            console.log('   ✅ Enhanced data extraction completed');
            
            // Build consensus for critical fields
            const criticalFields = ['vin', 'trim', 'series', 'drivetrain', 'engine_type', 'mileage', 'color', 'asking_price'];
            for (const field of criticalFields) {
              if (scrapedData.data[field]) {
                await supabase.rpc('build_field_consensus', {
                  p_vehicle_id: vehicleId,
                  p_field_name: field,
                  p_auto_assign: true
                });
                results.fields_enhanced++;
              }
            }
          } else {
            console.warn(`   ⚠️  Forensic processing error: ${forensicError.message}`);
          }
        }
      } catch (scrapeErr) {
        console.warn(`   ⚠️  Rescrape failed: ${scrapeErr.message}`);
        results.errors.push('Rescrape failed');
      }
    }

    // Step 3: Queue AI expert analysis for proofreading/validation
    console.log('   Step 3: Queueing AI expert analysis for proofreading...');
    const { data: queueId, error: queueError } = await supabase.rpc('queue_analysis', {
      p_vehicle_id: vehicleId,
      p_analysis_type: 'expert_valuation',
      p_priority: 2, // High priority for new imports
      p_triggered_by: 'enhanced_processor'
    });

    if (!queueError && queueId) {
      results.analysis_queued = true;
      console.log(`   ✅ AI analysis queued (ID: ${queueId})`);
    } else {
      console.warn(`   ⚠️  Failed to queue analysis: ${queueError?.message || 'Unknown error'}`);
      results.errors.push('Analysis queue failed');
    }

    // Step 4: Re-validate vehicle and make public if ready
    const { data: validationResult, error: validationError } = await supabase.rpc(
      'validate_vehicle_before_public',
      { p_vehicle_id: vehicleId }
    );

    if (!validationError && validationResult?.can_go_live) {
      await supabase
        .from('vehicles')
        .update({
          status: 'active',
          is_public: true
        })
        .eq('id', vehicleId);
      console.log(`   ✅ Vehicle validated and made public`);
    }

    return results;

  } catch (error) {
    console.error(`   ❌ Error processing item: ${error.message}`);
    results.errors.push(error.message);
    return results;
  }
}

async function processPendingItems() {
  console.log('🚀 Enhanced Import Queue Processor\n');
  console.log('='.repeat(60));

  // Step 1: Process items through normal queue first
  console.log('📋 Step 1: Processing items through import queue...\n');
  
  const stats = {
    total: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    duplicates: 0,
    vehicles_created: [],
    images_backfilled: 0,
    analyses_queued: 0,
    fields_enhanced: 0
  };

  // Process in batches through the normal queue
  let hasMore = true;
  let batchNum = 0;
  
  while (hasMore) {
    batchNum++;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📦 Processing Batch ${batchNum} (${BATCH_SIZE} items)`);
    console.log('='.repeat(60));

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/4d355282-c690-469e-97e1-0114c2a0ef69',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H5',location:'scripts/enhanced-queue-processor.js:call_process_import_queue',message:'Calling process-import-queue',data:{SUPABASE_URL,endpoint:`${SUPABASE_URL}/functions/v1/process-import-queue`,batch_size:BATCH_SIZE,has_service_key:!!SUPABASE_SERVICE_ROLE_KEY},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    const processResponse = await fetch(`${SUPABASE_URL}/functions/v1/process-import-queue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        batch_size: BATCH_SIZE,
        priority_only: false
      })
    });

    if (!processResponse.ok) {
      console.error(`❌ Queue processing failed: ${processResponse.status}`);
      break;
    }

    const processResult = await processResponse.json();
    
    if (!processResult.success || processResult.processed === 0) {
      console.log('✅ No more items to process');
      hasMore = false;
      break;
    }

    stats.total += processResult.processed || 0;
    stats.succeeded += processResult.succeeded || 0;
    stats.failed += processResult.failed || 0;
    stats.duplicates += processResult.duplicates || 0;
    
    if (processResult.vehicles_created) {
      stats.vehicles_created.push(...processResult.vehicles_created);
    }

    console.log(`   Processed: ${processResult.processed}, Created: ${processResult.succeeded}, Failed: ${processResult.failed}`);

    // Step 2: Enhance each created vehicle
    if (processResult.vehicles_created && processResult.vehicles_created.length > 0) {
      console.log(`\n🔧 Enhancing ${processResult.vehicles_created.length} vehicles...`);
      
      for (const vehicleId of processResult.vehicles_created) {
        // Get the queue item to find the listing URL
        const { data: queueItem } = await supabase
          .from('import_queue')
          .select('listing_url')
          .eq('vehicle_id', vehicleId)
          .single();

        const result = await enhanceVehicle(vehicleId, queueItem?.listing_url);
        
        stats.images_backfilled += result.images_backfilled;
        if (result.analysis_queued) stats.analyses_queued++;
        stats.fields_enhanced += result.fields_enhanced;

        // Small delay between vehicles
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Delay between batches
    if (processResult.processed > 0) {
      console.log(`\n⏳ Waiting ${DELAY_BETWEEN_BATCHES / 1000}s before next batch...`);
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
    } else {
      hasMore = false;
    }
  }

  // Final summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 PROCESSING COMPLETE');
  console.log('='.repeat(60));
  console.log(`Total items processed: ${stats.total}`);
  console.log(`Succeeded: ${stats.succeeded}`);
  console.log(`Failed: ${stats.failed}`);
  console.log(`Duplicates: ${stats.duplicates}`);
  console.log(`Vehicles created: ${stats.vehicles_created.length}`);
  console.log(`Images backfilled: ${stats.images_backfilled}`);
  console.log(`AI analyses queued: ${stats.analyses_queued}`);
  console.log(`Fields enhanced: ${stats.fields_enhanced}`);
  console.log('='.repeat(60));
}

// Run if called directly
processPendingItems()
  .then(() => {
    console.log('\n✅ Script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });

