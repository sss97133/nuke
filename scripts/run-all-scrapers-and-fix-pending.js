#!/usr/bin/env node

/**
 * Run All Scrapers and Fix Pending Profiles
 * 
 * 1. Queues pending vehicles for import
 * 2. Runs all available scrapers
 * 3. Processes import queues
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env vars
let SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
let SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

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
  console.log('❌ Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

async function callFunction(functionName, body = {}) {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      },
      body: JSON.stringify(body)
    });
    
    const text = await response.text();
    let result;
    try {
      result = text ? JSON.parse(text) : {};
    } catch (e) {
      // If not JSON, return as text
      result = { message: text, raw: true };
    }
    
    return { success: response.ok, data: result, status: response.status, text };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function queuePendingVehicles() {
  console.log('📋 Step 1: Queuing pending vehicles for import...\n');
  
  // Queue vehicles in batches
  const batchSize = 100;
  let totalQueued = 0;
  
  for (let offset = 0; offset < 500; offset += batchSize) {
    const response = await callFunction('re-extract-pending-vehicles', {
      batch_size: batchSize,
      force: false
    });
    
    if (response.success && response.data) {
      const queued = (response.data.queued_import || 0) + (response.data.queued_bat || 0);
      totalQueued += queued;
      
      if (queued > 0) {
        console.log(`   ✅ Batch ${Math.floor(offset / batchSize) + 1}: Queued ${queued} vehicles`);
      }
      
      if (queued === 0 && offset === 0) {
        console.log('   ℹ️  No vehicles needed queuing (may already be queued)');
        break;
      }
    } else {
      console.log(`   ⚠️  Batch ${Math.floor(offset / batchSize) + 1} error:`, response.error || response.data?.error);
    }
    
    // Small delay between batches
    await new Promise(r => setTimeout(r, 2000));
  }
  
  console.log(`\n   ✅ Total queued: ${totalQueued} vehicles\n`);
  return totalQueued;
}

async function runScrapers() {
  console.log('🚀 Step 2: Running all scrapers...\n');
  
  const scrapers = [
    {
      name: 'Discover CL Squarebodies',
      function: 'discover-cl-squarebodies',
      body: { max_regions: 10, max_listings_per_search: 30 }
    },
    {
      name: 'Process CL Queue',
      function: 'process-cl-queue',
      body: { batch_size: 20 }
    }
  ];
  
  const results = [];
  
  for (const scraper of scrapers) {
    console.log(`   🔍 Running ${scraper.name}...`);
    const result = await callFunction(scraper.function, scraper.body);
    
    if (result.success) {
      console.log(`      ✅ ${scraper.name} completed`);
      results.push({ name: scraper.name, success: true });
    } else {
      console.log(`      ⚠️  ${scraper.name} error:`, result.error || result.data?.error);
      results.push({ name: scraper.name, success: false, error: result.error || result.data?.error });
    }
    
    // Delay between scrapers
    await new Promise(r => setTimeout(r, 3000));
  }
  
  console.log('\n   ✅ Scrapers completed\n');
  return results;
}

async function processQueues() {
  console.log('⚡ Step 3: Processing import queues...\n');
  
  let totalProcessed = 0;
  let totalSucceeded = 0;
  let batches = 0;
  
  // Process import queue
  for (let i = 0; i < 20; i++) {
    const result = await callFunction('process-import-queue', {
      batch_size: 20,
      priority_only: false
    });
    
    if (!result.success || !result.data) {
      break;
    }
    
    const processed = result.data.processed || 0;
    const succeeded = result.data.succeeded || 0;
    
    if (processed > 0) {
      batches++;
      totalProcessed += processed;
      totalSucceeded += succeeded;
      console.log(`   Batch ${batches}: ${processed} processed, ${succeeded} succeeded`);
    } else {
      break;
    }
    
    await new Promise(r => setTimeout(r, 2000));
  }
  
  // Process BaT extraction queue
  console.log('\n   Processing BaT extraction queue...');
  for (let i = 0; i < 10; i++) {
    const result = await callFunction('process-bat-extraction-queue', {
      batchSize: 10,
      maxAttempts: 3
    });
    
    if (!result.success || !result.data) {
      break;
    }
    
    const processed = result.data.processed || 0;
    if (processed > 0) {
      console.log(`   BaT batch ${i + 1}: ${processed} processed`);
    } else {
      break;
    }
    
    await new Promise(r => setTimeout(r, 2000));
  }
  
  console.log(`\n   ✅ Queues processed: ${totalProcessed} items, ${totalSucceeded} succeeded\n`);
  return { processed: totalProcessed, succeeded: totalSucceeded };
}

async function main() {
  console.log('='.repeat(70));
  console.log('🚀 RUNNING ALL SCRAPERS AND FIXING PENDING PROFILES');
  console.log('='.repeat(70));
  console.log('');
  
  try {
    // Step 1: Queue pending vehicles
    const queued = await queuePendingVehicles();
    
    // Step 2: Run scrapers
    const scraperResults = await runScrapers();
    
    // Step 3: Process queues
    const queueResults = await processQueues();
    
    // Summary
    console.log('='.repeat(70));
    console.log('✅ COMPLETE');
    console.log('='.repeat(70));
    console.log(`   Vehicles queued: ${queued}`);
    console.log(`   Scrapers run: ${scraperResults.filter(r => r.success).length}/${scraperResults.length}`);
    console.log(`   Items processed: ${queueResults.processed}`);
    console.log(`   Items succeeded: ${queueResults.succeeded}`);
    console.log('');
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

main();

