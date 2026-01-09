#!/usr/bin/env node
/**
 * Manual BaT Queue Processor
 * 
 * Processes BaT extraction queue with configurable batch size.
 * Use this to test processing and show results before speeding up cron.
 * 
 * Usage:
 *   node scripts/process-bat-queue-manual.js 5    # Process 5 items
 *   node scripts/process-bat-queue-manual.js 10   # Process 10 items
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczODM2OTAyMSwiZXhwIjoyMDUzOTQ1MDIxfQ.NEbqSnSamR5f7Fqon25ierv5yJgdDy_o2nrixOej_Xg';

const batchSize = parseInt(process.argv[2]) || 5; // Default to 5 items
const runs = parseInt(process.argv[3]) || 1; // Number of batches to process

async function processBatch(runNumber) {
  console.log(`\n🚀 Run ${runNumber}/${runs}: Processing ${batchSize} items...\n`);

  const response = await fetch(`${SUPABASE_URL}/functions/v1/process-bat-extraction-queue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
    },
    body: JSON.stringify({
      batchSize: batchSize,
      maxAttempts: 3
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  const result = await response.json();
  
  if (result.success) {
    console.log(`✅ Success!`);
    console.log(`   Processed: ${result.processed || 0}`);
    console.log(`   Completed: ${result.completed || 0}`);
    console.log(`   Failed: ${result.failed || 0}`);
    
    if (result.created_vehicle_ids && result.created_vehicle_ids.length > 0) {
      console.log(`   Vehicles created: ${result.created_vehicle_ids.length}`);
    }
    if (result.updated_vehicle_ids && result.updated_vehicle_ids.length > 0) {
      console.log(`   Vehicles updated: ${result.updated_vehicle_ids.length}`);
    }
    if (result.errors && result.errors.length > 0) {
      console.log(`   Errors: ${result.errors.length}`);
      result.errors.slice(0, 3).forEach(err => console.log(`     - ${err.substring(0, 100)}`));
    }
    
    return result;
  } else {
    console.error(`❌ Failed: ${result.error || 'Unknown error'}`);
    return null;
  }
}

async function checkQueueStatus() {
  console.log('\n📊 Current Queue Status:\n');
  
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_bat_queue_stats`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'apikey': SUPABASE_SERVICE_KEY
    }
  });

  if (response.ok) {
    const stats = await response.json();
    console.log(`   Pending: ${stats.pending || 0}`);
    console.log(`   Processing: ${stats.processing || 0}`);
    console.log(`   Complete: ${stats.complete || 0}`);
    console.log(`   Failed: ${stats.failed || 0}`);
  } else {
    // Fallback: direct query
    console.log('   (Could not fetch stats, check manually)');
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('   BaT Queue Processor - Manual Run');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`\n📋 Configuration:`);
  console.log(`   Batch size: ${batchSize} items per run`);
  console.log(`   Number of runs: ${runs}`);
  console.log(`   Total items to process: ${batchSize * runs}`);

  await checkQueueStatus();

  let totalProcessed = 0;
  let totalSucceeded = 0;
  let totalFailed = 0;

  for (let i = 1; i <= runs; i++) {
    const result = await processBatch(i);
    
    if (result) {
      totalProcessed += result.processed || 0;
      totalSucceeded += result.succeeded || 0;
      totalFailed += result.failed || 0;
    }

    // Wait 2 seconds between runs to avoid overwhelming the system
    if (i < runs) {
      console.log(`\n⏳ Waiting 2 seconds before next run...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('   Summary');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`   Total processed: ${totalProcessed}`);
  console.log(`   Total succeeded: ${totalSucceeded}`);
  console.log(`   Total failed: ${totalFailed}`);
  
  await checkQueueStatus();
  console.log('\n✅ Done!\n');
}

main().catch(error => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});

