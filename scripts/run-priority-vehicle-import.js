#!/usr/bin/env node

/**
 * Run Priority Vehicle Profile Importing
 * 
 * 1. Finds pending vehicles and queues them with priority
 * 2. Processes the priority import queue
 */

// Try to load from .env.local if it exists
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
let SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

// Try to read from .env.local
const envLocalPath = path.join(__dirname, '../nuke_frontend/.env.local');
if (!SUPABASE_SERVICE_KEY && fs.existsSync(envLocalPath)) {
  const envContent = fs.readFileSync(envLocalPath, 'utf8');
  const lines = envContent.split('\n');
  for (const line of lines) {
    if (line.startsWith('SUPABASE_SERVICE_ROLE_KEY=') || line.startsWith('SERVICE_ROLE_KEY=')) {
      SUPABASE_SERVICE_KEY = line.split('=')[1]?.trim().replace(/^["']|["']$/g, '');
      break;
    }
    if (line.startsWith('VITE_SUPABASE_URL=') && !SUPABASE_URL.includes('qkgaybvrernstplzjaam')) {
      SUPABASE_URL = line.split('=')[1]?.trim().replace(/^["']|["']$/g, '');
    }
  }
}

if (!SUPABASE_SERVICE_KEY) {
  console.log('❌ Missing SUPABASE_SERVICE_ROLE_KEY environment variable');
  console.log('   Set it in your shell, .env.local, or nuke_frontend/.env.local file');
  process.exit(1);
}

async function runPriorityImport() {
  console.log('🚀 Running Priority Vehicle Profile Importing...\n');
  
  // Step 0: Process BaT extraction queue (910 priority items waiting)
  console.log('🎯 Step 0: Processing BaT extraction queue (priority items)...');
  try {
    const batResponse = await fetch(`${SUPABASE_URL}/functions/v1/process-bat-extraction-queue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      },
      body: JSON.stringify({ batchSize: 20, maxAttempts: 3 })
    });
    
    const batResult = await batResponse.json();
    if (batResult.error) {
      console.log('   ⚠️  Error:', batResult.error);
    } else {
      console.log(`   ✅ Processed ${batResult.processed || 0} BaT extractions`);
      console.log(`   ✅ Completed: ${batResult.completed || 0}, Failed: ${batResult.failed || 0}`);
    }
  } catch (error) {
    console.error('   ❌ Error processing BaT queue:', error.message);
  }
  
  console.log('\n');
  
  // Step 1: Re-extract pending vehicles (queues them with priority)
  console.log('📋 Step 1: Finding and queuing pending vehicles...');
  try {
    const reExtractResponse = await fetch(`${SUPABASE_URL}/functions/v1/re-extract-pending-vehicles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      },
      body: JSON.stringify({ batch_size: 50 })
    });
    
    const reExtractResult = await reExtractResponse.json();
    
    if (reExtractResult.error) {
      console.log('   ⚠️  Error:', reExtractResult.error);
    } else {
      console.log(`   ✅ Found ${reExtractResult.processed || 0} pending vehicles`);
      console.log(`   ✅ Queued ${reExtractResult.queued_import || 0} for import re-processing`);
      console.log(`   ✅ Queued ${reExtractResult.queued_bat || 0} for BaT comprehensive extraction`);
      console.log(`   ✅ Activated ${reExtractResult.activated || 0} vehicles`);
      
      if (reExtractResult.errors && reExtractResult.errors.length > 0) {
        console.log(`   ⚠️  ${reExtractResult.errors.length} errors occurred`);
      }
    }
    
    if ((reExtractResult.queued_import || 0) === 0 && (reExtractResult.queued_bat || 0) === 0) {
      console.log('\n   ℹ️  No vehicles needed queuing. Checking for existing priority items...\n');
    } else {
      console.log('\n   ⏳ Waiting 3 seconds for queue to populate...\n');
      await new Promise(r => setTimeout(r, 3000));
    }
  } catch (error) {
    console.error('   ❌ Error in re-extract:', error.message);
  }
  
  // Step 2: Process priority queue
  console.log('⚡ Step 2: Processing priority import queue...');
  let totalProcessed = 0;
  let totalSucceeded = 0;
  let totalFailed = 0;
  let batches = 0;
  
  for (let i = 0; i < 10; i++) {
    try {
      const processResponse = await fetch(`${SUPABASE_URL}/functions/v1/process-import-queue`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
        },
        body: JSON.stringify({
          batch_size: 20,
          priority_only: true
        })
      });
      
      const processResult = await processResponse.json();
      
      if (processResult.error) {
        console.log(`   ⚠️  Batch ${batches + 1} error:`, processResult.error);
        break;
      }
      
      batches++;
      const processed = processResult.processed || 0;
      const succeeded = processResult.succeeded || 0;
      const failed = processResult.failed || 0;
      
      totalProcessed += processed;
      totalSucceeded += succeeded;
      totalFailed += failed;
      
      if (processed > 0) {
        console.log(`   Batch ${batches}: ${processed} processed, ${succeeded} succeeded, ${failed} failed`);
        
        if (processResult.vehicles_created && processResult.vehicles_created.length > 0) {
          console.log(`      Created vehicles: ${processResult.vehicles_created.length}`);
        }
      } else {
        console.log(`   Batch ${batches}: No items to process`);
        break;
      }
      
      // Small delay between batches
      if (i < 9) {
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (error) {
      console.error(`   ❌ Error in batch ${batches + 1}:`, error.message);
      break;
    }
  }
  
  console.log(`\n✅ Priority import complete!`);
  console.log(`   Total batches: ${batches}`);
  console.log(`   Total processed: ${totalProcessed}`);
  console.log(`   Total succeeded: ${totalSucceeded}`);
  console.log(`   Total failed: ${totalFailed}`);
}

runPriorityImport().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

