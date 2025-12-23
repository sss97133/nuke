#!/usr/bin/env node

/**
 * Fix Pending Profiles and Run All Scrapers
 * 
 * 1. Queues pending vehicles that aren't already queued
 * 2. Runs discovery scrapers
 * 3. Processes all queues
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  }
}

if (!SUPABASE_SERVICE_KEY) {
  console.log('❌ Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function queuePendingVehicles() {
  console.log('📋 Queuing pending vehicles...');
  
  // Get vehicles that need queuing
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, discovery_url')
    .eq('status', 'pending')
    .eq('is_public', false)
    .not('discovery_url', 'is', null)
    .not('make', 'is', null)
    .not('model', 'is', null)
    .not('year', 'is', null)
    .limit(200);
  
  if (error) {
    console.log('   ❌ Error fetching vehicles:', error.message);
    return 0;
  }
  
  if (!vehicles || vehicles.length === 0) {
    console.log('   ℹ️  No pending vehicles found');
    return 0;
  }
  
  console.log(`   Found ${vehicles.length} pending vehicles`);
  
  // Check which ones are already queued
  const { data: queuedUrls } = await supabase
    .from('import_queue')
    .select('listing_url')
    .in('status', ['pending', 'processing'])
    .in('listing_url', vehicles.map(v => v.discovery_url).filter(Boolean));
  
  const queuedSet = new Set((queuedUrls || []).map(q => q.listing_url));
  const toQueue = vehicles.filter(v => v.discovery_url && !queuedSet.has(v.discovery_url));
  
  if (toQueue.length === 0) {
    console.log('   ℹ️  All vehicles already queued');
    return 0;
  }
  
  console.log(`   Queuing ${toQueue.length} vehicles...`);
  
  // Queue them
  const queueItems = toQueue.map(v => ({
    listing_url: v.discovery_url,
    status: 'pending',
    priority: 1,
    vehicle_id: v.id
  }));
  
  const { error: insertError } = await supabase
    .from('import_queue')
    .insert(queueItems);
  
  if (insertError) {
    console.log('   ⚠️  Error queuing:', insertError.message);
    return 0;
  }
  
  console.log(`   ✅ Queued ${toQueue.length} vehicles`);
  return toQueue.length;
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
    
    return { success: response.ok, data: result, status: response.status };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('🚀 FIXING PENDING PROFILES AND RUNNING SCRAPERS');
  console.log('='.repeat(70));
  console.log('');
  
  // Step 1: Queue pending vehicles
  const queued = await queuePendingVehicles();
  if (queued > 0) {
    console.log('\n⏳ Waiting 3 seconds for queue to populate...\n');
    await new Promise(r => setTimeout(r, 3000));
  }
  
  // Step 2: Run discovery scrapers
  console.log('🔍 Step 2: Running discovery scrapers...\n');
  
  const scrapers = [
    { name: 'Discover CL Squarebodies', func: 'discover-cl-squarebodies', body: { max_regions: 20, max_listings_per_search: 50 } }
  ];
  
  for (const scraper of scrapers) {
    console.log(`   Running ${scraper.name}...`);
    const result = await callFunction(scraper.func, scraper.body);
    if (result.success) {
      console.log(`      ✅ Completed`);
    } else {
      console.log(`      ⚠️  Error: ${result.error || result.data?.error || 'Unknown'}`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  
  console.log('\n⏳ Waiting 5 seconds...\n');
  await new Promise(r => setTimeout(r, 5000));
  
  // Step 3: Process all queues
  console.log('⚡ Step 3: Processing all queues...\n');
  
  // Process CL queue
  console.log('   Processing CL queue...');
  let clTotal = 0;
  for (let i = 0; i < 10; i++) {
    const result = await callFunction('process-cl-queue', { batch_size: 20 });
    if (result.success && result.data?.processed) {
      clTotal += result.data.processed || 0;
      if (result.data.processed > 0) {
        console.log(`      Batch ${i + 1}: ${result.data.processed} processed`);
      }
    } else {
      break;
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log(`   ✅ CL: ${clTotal} processed\n`);
  
  // Process import queue
  console.log('   Processing import queue...');
  let importTotal = 0;
  let importSucceeded = 0;
  for (let i = 0; i < 20; i++) {
    const result = await callFunction('process-import-queue', {
      batch_size: 20,
      priority_only: false
    });
    
    if (result.success && result.data?.processed) {
      importTotal += result.data.processed || 0;
      importSucceeded += result.data.succeeded || 0;
      if (result.data.processed > 0) {
        console.log(`      Batch ${i + 1}: ${result.data.processed} processed, ${result.data.succeeded} succeeded`);
      }
    } else {
      break;
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log(`   ✅ Import: ${importTotal} processed, ${importSucceeded} succeeded\n`);
  
  // Process BaT queue
  console.log('   Processing BaT extraction queue...');
  let batTotal = 0;
  for (let i = 0; i < 10; i++) {
    const result = await callFunction('process-bat-extraction-queue', {
      batchSize: 10,
      maxAttempts: 3
    });
    
    if (result.success && result.data?.processed) {
      batTotal += result.data.processed || 0;
      if (result.data.processed > 0) {
        console.log(`      Batch ${i + 1}: ${result.data.processed} processed`);
      }
    } else {
      break;
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log(`   ✅ BaT: ${batTotal} processed\n`);
  
  // Summary
  console.log('='.repeat(70));
  console.log('✅ COMPLETE');
  console.log('='.repeat(70));
  console.log(`   Vehicles queued: ${queued}`);
  console.log(`   CL Queue: ${clTotal} processed`);
  console.log(`   Import Queue: ${importTotal} processed, ${importSucceeded} succeeded`);
  console.log(`   BaT Queue: ${batTotal} processed`);
  console.log('');
  console.log('💡 Monitor progress:');
  console.log('   - Extraction Monitor: /admin/extraction-monitor');
  console.log('   - Import Queue: Check import_queue table');
  console.log('');
}

main().catch(console.error);

