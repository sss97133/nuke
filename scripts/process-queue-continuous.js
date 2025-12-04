#!/usr/bin/env node

/**
 * Continuously process the import queue
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

let stats = {
  batches: 0,
  processed: 0,
  succeeded: 0,
  failed: 0,
  duplicates: 0
};

async function processQueue() {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/process-import-queue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        batch_size: 10,
        priority_only: false
      })
    });

    const result = await response.json();
    
    if (result.success) {
      stats.batches++;
      stats.processed += result.processed || 0;
      stats.succeeded += result.succeeded || 0;
      stats.failed += result.failed || 0;
      stats.duplicates += result.duplicates || 0;
      
      console.log(`Batch ${stats.batches}: ${result.processed} processed, ${result.succeeded} succeeded, ${result.failed} failed`);
      
      if (result.vehicles_created?.length > 0) {
        console.log(`  Created: ${result.vehicles_created.join(', ')}`);
      }
      
      return result.processed || 0;
    } else {
      console.log(`Batch failed: ${result.error}`);
      return 0;
    }
  } catch (error) {
    console.log(`Error: ${error.message}`);
    return 0;
  }
}

async function main() {
  console.log('='.repeat(50));
  console.log('CONTINUOUS QUEUE PROCESSOR');
  console.log('='.repeat(50));
  console.log('');

  // Process until queue is empty or we hit 500 items
  while (stats.processed < 500) {
    const processed = await processQueue();
    
    if (processed === 0) {
      console.log('\nQueue empty or all items processed. Waiting 30s...');
      await new Promise(r => setTimeout(r, 30000));
    } else {
      // 5 second delay between batches
      await new Promise(r => setTimeout(r, 5000));
    }
    
    // Print stats every 10 batches
    if (stats.batches % 10 === 0) {
      console.log('\n--- STATS ---');
      console.log(`Batches: ${stats.batches}`);
      console.log(`Processed: ${stats.processed}`);
      console.log(`Succeeded: ${stats.succeeded}`);
      console.log(`Failed: ${stats.failed}`);
      console.log(`Duplicates: ${stats.duplicates}`);
      console.log('-------------\n');
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('FINAL STATS:');
  console.log('='.repeat(50));
  console.log(`Total batches: ${stats.batches}`);
  console.log(`Total processed: ${stats.processed}`);
  console.log(`Total succeeded: ${stats.succeeded}`);
  console.log(`Total failed: ${stats.failed}`);
  console.log(`Total duplicates: ${stats.duplicates}`);
}

main().catch(console.error);

