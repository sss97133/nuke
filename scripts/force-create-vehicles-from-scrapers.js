#!/usr/bin/env node

/**
 * Force Create Vehicles from Scrapers
 * 
 * This script runs scrapers and ensures vehicles are actually created,
 * even if they're duplicates. It will update existing vehicles with new data.
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

async function checkVehicleCount() {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/vehicles?select=id&limit=1`, {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      }
    });
    
    if (response.ok) {
      const countHeader = response.headers.get('content-range');
      if (countHeader) {
        const match = countHeader.match(/\/(\d+)/);
        return match ? parseInt(match[1]) : 0;
      }
    }
    
    // Fallback: count query
    const countResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/count_vehicles`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
    
    return 0;
  } catch (error) {
    return 0;
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('🚀 FORCE CREATE VEHICLES FROM SCRAPERS');
  console.log('='.repeat(70));
  console.log('');
  
  // Get initial vehicle count
  console.log('📊 Checking current vehicle count...');
  const initialCount = await checkVehicleCount();
  console.log(`   Current vehicles: ${initialCount}`);
  console.log('');
  
  // Step 1: Run discovery to find NEW listings
  console.log('🔍 Step 1: Discovering NEW listings...\n');
  
  const discoverResult = await callFunction('discover-cl-squarebodies', {
    max_regions: 20,
    max_searches_per_region: 10
  });
  
  if (discoverResult.success) {
    const data = discoverResult.data || {};
    console.log(`   ✅ Found ${data.discovered || 0} listings`);
    console.log(`   ✅ Added ${data.added_to_queue || 0} to queue`);
    console.log(`   ✅ ${data.already_in_queue || 0} already in queue`);
  } else {
    console.log(`   ❌ Error: ${discoverResult.error}`);
  }
  
  // Step 2: Process CL queue to create vehicles
  console.log('\n⚡ Step 2: Processing CL queue to create vehicles...\n');
  
  let totalCreated = 0;
  let totalProcessed = 0;
  
  for (let i = 0; i < 20; i++) {
    const result = await callFunction('process-cl-queue', {
      batch_size: 15
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
        // Try again after a delay (might be cold start)
        await new Promise(r => setTimeout(r, 5000));
        continue;
      } else {
        break;
      }
    }
    
    await new Promise(r => setTimeout(r, 3000));
  }
  
  // Step 3: Run direct scraper (bypasses queue)
  console.log('\n🛒 Step 3: Running direct scraper (bypasses queue)...\n');
  
  const scrapeResult = await callFunction('scrape-all-craigslist-squarebodies', {
    max_regions: 15,
    max_listings: 50
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
      if (data.debug?.first_error) {
        console.log(`   First error: ${JSON.stringify(data.debug.first_error, null, 2)}`);
      }
    }
    
    totalCreated += (stats.created || 0);
    totalProcessed += (stats.processed || 0);
  } else {
    console.log(`   ❌ Error: ${scrapeResult.error}`);
  }
  
  // Step 4: Process import queue
  console.log('\n📋 Step 4: Processing import queue...\n');
  
  for (let i = 0; i < 10; i++) {
    const result = await callFunction('process-import-queue', {
      batch_size: 20,
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
  
  // Step 5: Process BaT queue
  console.log('\n🏁 Step 5: Processing BaT queue...\n');
  
  for (let i = 0; i < 10; i++) {
    const result = await callFunction('process-bat-extraction-queue', {
      batchSize: 10,
      maxAttempts: 3
    });
    
    if (result.success && result.data) {
      const processed = result.data.processed || 0;
      if (processed > 0) {
        console.log(`   Batch ${i + 1}: ${processed} processed`);
      } else {
        break;
      }
    } else {
      break;
    }
    
    await new Promise(r => setTimeout(r, 2000));
  }
  
  // Final count
  console.log('\n📊 Final Results:\n');
  const finalCount = await checkVehicleCount();
  const newVehicles = finalCount - initialCount;
  
  console.log(`   Vehicles before: ${initialCount}`);
  console.log(`   Vehicles after: ${finalCount}`);
  console.log(`   New vehicles created: ${newVehicles}`);
  console.log(`   Total processed: ${totalProcessed}`);
  console.log(`   Total created (from stats): ${totalCreated}`);
  console.log('');
  
  if (newVehicles > 0) {
    console.log('✅ SUCCESS: Vehicles are being created!');
  } else if (totalCreated > 0) {
    console.log('⚠️  WARNING: Stats show vehicles created but count unchanged - might be duplicates');
  } else {
    console.log('❌ ISSUE: No vehicles created. Check:');
    console.log('   1. Are there new listings to scrape?');
    console.log('   2. Are all listings duplicates?');
    console.log('   3. Check scraper logs for errors');
  }
  
  console.log('');
}

main();

