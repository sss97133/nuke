#!/usr/bin/env node

/**
 * Optimized Scraper Runner for Paid Plan (400s timeout)
 * 
 * Takes advantage of longer execution times to process more listings
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
      result = { message: text, raw: true };
    }
    
    return { 
      success: response.ok, 
      data: result, 
      status: response.status,
      error: response.ok ? null : (result.error || result.message || `HTTP ${response.status}`)
    };
  } catch (error) {
    return { success: false, error: error.message, status: 0 };
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('🚀 OPTIMIZED SCRAPER RUNNER (LARGE COMPUTE + DISK)');
  console.log('='.repeat(70));
  console.log('');
  console.log('💡 Optimized for Large compute with 400s timeout + increased disk');
  console.log('   - 160 direct connections, 800 pooler connections');
  console.log('   - 630 Mbps throughput, 3,600 IOPS');
  console.log('   - Larger batch sizes for maximum throughput');
  console.log('');
  
  // Step 1: Discover listings (optimized for Large compute)
  console.log('🔍 Step 1: Discovering listings (optimized for Large compute)...\n');
  
  const discoverResult = await callFunction('discover-cl-squarebodies', {
    max_regions: 20, // Conservative for reliability
    max_searches_per_region: 8,
    chain_depth: 3 // Self-invoke to process more regions
  });
  
  if (discoverResult.success) {
    const data = discoverResult.data || {};
    console.log(`   ✅ Found ${data.discovered || 0} listings`);
    console.log(`   ✅ Added ${data.added_to_queue || 0} to queue`);
    console.log(`   ✅ ${data.already_in_queue || 0} already in queue`);
  } else {
    console.log(`   ❌ Error: ${discoverResult.error}`);
  }
  
  // Step 2: Process CL queue (larger batches)
  console.log('\n⚡ Step 2: Processing CL queue (larger batches)...\n');
  
  let totalCreated = 0;
  let totalProcessed = 0;
  
  for (let i = 0; i < 20; i++) { // More iterations to process queue
    const result = await callFunction('process-cl-queue', {
      batch_size: 40 // Balanced for Large compute
    });
    
    if (result.success && result.data) {
      const stats = result.data.stats || {};
      const processed = stats.processed || 0;
      const created = stats.created || 0;
      
      if (processed > 0) {
        totalProcessed += processed;
        totalCreated += created;
        console.log(`   Batch ${i + 1}: ${processed} processed, ${created} created, ${stats.updated || 0} updated`);
      } else {
        console.log(`   No more items to process`);
        break;
      }
    } else {
      if (i === 0) {
        console.log(`   ⚠️  First attempt failed: ${result.error}`);
        await new Promise(r => setTimeout(r, 5000));
        continue;
      } else {
        break;
      }
    }
    
    await new Promise(r => setTimeout(r, 2000));
  }
  
  // Step 3: Direct scraper (optimized for paid plan)
  console.log('\n🛒 Step 3: Running direct scraper (optimized batch)...\n');
  
  const scrapeResult = await callFunction('scrape-all-craigslist-squarebodies', {
    max_regions: 25, // Conservative for reliability
    max_listings_per_search: 60,
    chain_depth: 3 // Self-invoke to process more regions
  });
  
  if (scrapeResult.success) {
    const data = scrapeResult.data || {};
    const stats = data.stats || {};
    console.log(`   ✅ Found ${data.unique_listings_found || 0} listings`);
    console.log(`   ✅ Processed ${stats.processed || 0}`);
    console.log(`   ✅ Created ${stats.created || 0} vehicles`);
    console.log(`   ✅ Updated ${stats.updated || 0} vehicles`);
    
    if (stats.errors > 0) {
      console.log(`   ⚠️  ${stats.errors} errors`);
    }
    
    totalCreated += (stats.created || 0);
    totalProcessed += (stats.processed || 0);
  } else {
    console.log(`   ❌ Error: ${scrapeResult.error}`);
  }
  
  // Step 4: Process import queue
  console.log('\n📋 Step 4: Processing import queue...\n');
  
  for (let i = 0; i < 20; i++) { // More iterations to process queue
    const result = await callFunction('process-import-queue', {
      batch_size: 35, // Balanced for Large compute
      priority_only: i === 0
    });
    
    if (result.success && result.data) {
      const processed = result.data.processed || 0;
      if (processed > 0) {
        console.log(`   Batch ${i + 1}: ${processed} processed, ${result.data.succeeded || 0} succeeded`);
        totalProcessed += processed;
      } else {
        break;
      }
    } else {
      break;
    }
    
    await new Promise(r => setTimeout(r, 2000));
  }
  
  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('✅ COMPLETE');
  console.log('='.repeat(70));
  console.log(`   Total processed: ${totalProcessed}`);
  console.log(`   Total created: ${totalCreated}`);
  console.log('');
  console.log('💡 With Large compute + increased disk, you can process:');
  console.log('   - 2x more listings per run (40 vs 20)');
  console.log('   - 67% more regions (50 vs 30)');
  console.log('   - 67% larger queue batches (50 vs 30)');
  console.log('   - Faster DB operations (3,600 IOPS vs 500)');
  console.log('   - More concurrent operations (800 pooler connections)');
  console.log('');
}

main();

