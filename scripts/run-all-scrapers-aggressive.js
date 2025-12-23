#!/usr/bin/env node

/**
 * Aggressive Scraper Runner - Runs all scrapers multiple times to fill queues
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

async function checkQueueCounts() {
  const queues = [
    { name: 'import_queue', display: 'Import Queue' },
    { name: 'craigslist_listing_queue', display: 'CL Queue' },
    { name: 'bat_extraction_queue', display: 'BaT Queue' }
  ];
  
  const counts = {};
  
  for (const queue of queues) {
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/${queue.name}?select=status&limit=10000`, {
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        const pending = data.filter(item => item.status === 'pending').length;
        const processing = data.filter(item => item.status === 'processing').length;
        const failed = data.filter(item => item.status === 'failed').length;
        counts[queue.display] = { pending, processing, failed, total: data.length };
      }
    } catch (error) {
      // Ignore
    }
  }
  
  return counts;
}

async function main() {
  console.log('='.repeat(70));
  console.log('🚀 AGGRESSIVE SCRAPER RUNNER');
  console.log('='.repeat(70));
  console.log('');
  
  // Step 1: Check initial queue status
  console.log('📊 Initial queue status:');
  let counts = await checkQueueCounts();
  Object.entries(counts).forEach(([name, stats]) => {
    console.log(`   ${name}: ${stats.pending} pending, ${stats.processing} processing, ${stats.failed} failed (${stats.total} total)`);
  });
  console.log('');
  
  // Step 2: Run discovery scrapers multiple times
  console.log('🔍 Step 1: Running discovery scrapers...\n');
  
  const discoveryRuns = 3;
  for (let i = 0; i < discoveryRuns; i++) {
    console.log(`   Run ${i + 1}/${discoveryRuns}:`);
    
    // Discover CL Squarebodies
    console.log('      Discovering CL Squarebodies...');
    const result1 = await callFunction('discover-cl-squarebodies', {
      max_regions: 15,
      max_searches_per_region: 5
    });
    if (result1.success) {
      const data = result1.data || {};
      console.log(`         ✅ Found ${data.discovered || 0} listings, added ${data.added_to_queue || 0} to queue`);
    } else {
      console.log(`         ❌ Error: ${result1.error}`);
    }
    
    await new Promise(r => setTimeout(r, 3000));
  }
  
  // Step 3: Run marketplace scrapers
  console.log('\n🛒 Step 2: Running marketplace scrapers...\n');
  
  console.log('   Scraping CL Squarebodies...');
  const clResult = await callFunction('scrape-all-craigslist-squarebodies', {
    max_regions: 10,
    max_listings: 50
  });
  if (clResult.success) {
    const data = clResult.data || {};
    console.log(`      ✅ Found ${data.found || 0} listings, created ${data.created || 0} vehicles`);
  } else {
    console.log(`      ❌ Error: ${clResult.error}`);
  }
  
  // Step 4: Queue pending vehicles
  console.log('\n📋 Step 3: Queuing pending vehicles...\n');
  
  const reExtractResult = await callFunction('re-extract-pending-vehicles', {
    batch_size: 100,
    force: false
  });
  if (reExtractResult.success) {
    const data = reExtractResult.data || {};
    console.log(`   ✅ Queued ${data.queued_import || 0} for import, ${data.queued_bat || 0} for BaT extraction`);
  } else {
    console.log(`   ❌ Error: ${reExtractResult.error}`);
  }
  
  // Step 5: Process queues multiple times
  console.log('\n⚡ Step 4: Processing queues...\n');
  
  // Process import queue
  console.log('   Processing import queue...');
  for (let i = 0; i < 10; i++) {
    const result = await callFunction('process-import-queue', {
      batch_size: 20,
      priority_only: i === 0
    });
    
    if (result.success && result.data) {
      const processed = result.data.processed || 0;
      if (processed > 0) {
        console.log(`      Batch ${i + 1}: ${processed} processed, ${result.data.succeeded || 0} succeeded`);
      } else {
        break;
      }
    } else {
      break;
    }
    
    await new Promise(r => setTimeout(r, 2000));
  }
  
  // Process CL queue (try multiple times, might be cold start issue)
  console.log('\n   Processing CL queue...');
  for (let i = 0; i < 5; i++) {
    const result = await callFunction('process-cl-queue', {
      batch_size: 10
    });
    
    if (result.success && result.data) {
      const stats = result.data.stats || {};
      const processed = stats.processed || 0;
      if (processed > 0) {
        console.log(`      Batch ${i + 1}: ${processed} processed, ${stats.created || 0} created`);
      } else {
        break;
      }
    } else {
      if (i === 0) {
        console.log(`      ⚠️  First attempt failed: ${result.error} (might be cold start)`);
      } else {
        break;
      }
    }
    
    await new Promise(r => setTimeout(r, 3000));
  }
  
  // Process BaT queue
  console.log('\n   Processing BaT queue...');
  for (let i = 0; i < 10; i++) {
    const result = await callFunction('process-bat-extraction-queue', {
      batchSize: 10,
      maxAttempts: 3
    });
    
    if (result.success && result.data) {
      const processed = result.data.processed || 0;
      if (processed > 0) {
        console.log(`      Batch ${i + 1}: ${processed} processed`);
      } else {
        break;
      }
    } else {
      break;
    }
    
    await new Promise(r => setTimeout(r, 2000));
  }
  
  // Step 6: Final queue status
  console.log('\n📊 Final queue status:');
  counts = await checkQueueCounts();
  Object.entries(counts).forEach(([name, stats]) => {
    console.log(`   ${name}: ${stats.pending} pending, ${stats.processing} processing, ${stats.failed} failed (${stats.total} total)`);
  });
  
  console.log('\n✅ Complete!\n');
}

main();

