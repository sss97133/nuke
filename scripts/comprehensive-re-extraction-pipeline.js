#!/usr/bin/env node

/**
 * Comprehensive Re-Extraction Pipeline
 * Maximizes data quality for all 6,329 incomplete profiles
 * 
 * Strategy:
 * 1. Map existing metadata (48 vehicles)
 * 2. Queue BaT extractions (49 + 786 pending)
 * 3. Queue URL-based re-extractions (898 vehicles)
 * 4. Process with highest quality DOM extraction
 * 5. Save full-res images + downscaled variants
 * 6. Extract price with all caveats (auctions, trade, OBO, etc.)
 * 7. Capture location and listing date
 */

import { createClient } from '@supabase/supabase-js';
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
  }
}

if (!SUPABASE_SERVICE_KEY) {
  console.log('❌ Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

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
      result = { message: text };
    }
    
    return { 
      success: response.ok, 
      data: result, 
      status: response.status
    };
  } catch (error) {
    return { success: false, error: error.message, status: 0 };
  }
}

async function comprehensiveReExtraction() {
  console.log('='.repeat(70));
  console.log('🚀 COMPREHENSIVE RE-EXTRACTION PIPELINE');
  console.log('='.repeat(70));
  console.log('Goal: Maximize data quality for all 6,329 incomplete profiles');
  console.log('');

  // Step 1: Map existing metadata
  console.log('📋 STEP 1: Mapping existing metadata...');
  const { data: mapResult } = await callFunction('map-metadata-to-columns', {});
  console.log(`   ${mapResult?.updated || 0} vehicles updated from metadata`);
  console.log('');

  // Step 2: Get incomplete vehicles
  console.log('📋 STEP 2: Identifying incomplete vehicles...');
  const { data: incomplete, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, color, mileage, discovery_source, discovery_url, bat_auction_url, origin_metadata')
    .eq('status', 'active')
    .or('vin.is.null,color.is.null,mileage.is.null,transmission.is.null,drivetrain.is.null,engine_size.is.null')
    .limit(10000);

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  console.log(`   Found ${incomplete?.length || 0} incomplete vehicles`);
  console.log('');

  // Step 3: Categorize and queue
  console.log('📋 STEP 3: Categorizing and queueing...');
  const categories = {
    bat: [],
    craigslist: [],
    other: [],
    noUrl: []
  };

  incomplete?.forEach(vehicle => {
    const isBat = !!(vehicle.bat_auction_url || 
      vehicle.discovery_source === 'bat' || 
      vehicle.discovery_source === 'bat_listing' || 
      vehicle.discovery_source === 'bat_profile_extraction');
    
    const isCL = vehicle.discovery_url?.includes('craigslist.org') || 
                 vehicle.discovery_source === 'craigslist_scrape';
    
    const url = vehicle.bat_auction_url || vehicle.discovery_url;
    
    if (isBat && vehicle.bat_auction_url) {
      categories.bat.push(vehicle);
    } else if (isCL && vehicle.discovery_url) {
      categories.craigslist.push(vehicle);
    } else if (url) {
      categories.other.push(vehicle);
    } else {
      categories.noUrl.push(vehicle);
    }
  });

  console.log(`   BaT: ${categories.bat.length}`);
  console.log(`   Craigslist: ${categories.craigslist.length}`);
  console.log(`   Other sources: ${categories.other.length}`);
  console.log(`   No URL: ${categories.noUrl.length}`);
  console.log('');

  // Step 4: Queue BaT extractions
  console.log('📋 STEP 4: Queueing BaT extractions...');
  let batQueued = 0;
  for (const vehicle of categories.bat.slice(0, 500)) {
    const { error: queueError } = await supabase
      .from('bat_extraction_queue')
      .insert({
        vehicle_id: vehicle.id,
        bat_auction_url: vehicle.bat_auction_url,
        status: 'pending',
        priority: 1,
        extraction_type: 'comprehensive'
      });
    
    if (!queueError || queueError.message.includes('duplicate')) {
      batQueued++;
      if (batQueued % 50 === 0) console.log(`   Queued ${batQueued} BaT extractions...`);
    }
  }
  console.log(`   ✅ Queued ${batQueued} BaT extractions`);
  console.log('');

  // Step 5: Queue Craigslist re-extractions
  console.log('📋 STEP 5: Queueing Craigslist re-extractions...');
  let clQueued = 0;
  for (const vehicle of categories.craigslist.slice(0, 500)) {
    const { error: queueError } = await supabase
      .from('import_queue')
      .insert({
        listing_url: vehicle.discovery_url,
        source_id: null,
        status: 'pending',
        priority: 1,
        vehicle_id: vehicle.id
      });
    
    if (!queueError || queueError.message.includes('duplicate')) {
      clQueued++;
      if (clQueued % 50 === 0) console.log(`   Queued ${clQueued} CL re-extractions...`);
    }
  }
  console.log(`   ✅ Queued ${clQueued} Craigslist re-extractions`);
  console.log('');

  // Step 6: Queue other sources
  console.log('📋 STEP 6: Queueing other source re-extractions...');
  let otherQueued = 0;
  for (const vehicle of categories.other.slice(0, 200)) {
    const url = vehicle.bat_auction_url || vehicle.discovery_url;
    const { error: queueError } = await supabase
      .from('import_queue')
      .insert({
        listing_url: url,
        source_id: null,
        status: 'pending',
        priority: 1,
        vehicle_id: vehicle.id
      });
    
    if (!queueError || queueError.message.includes('duplicate')) {
      otherQueued++;
      if (otherQueued % 50 === 0) console.log(`   Queued ${otherQueued} other re-extractions...`);
    }
  }
  console.log(`   ✅ Queued ${otherQueued} other source re-extractions`);
  console.log('');

  // Summary
  console.log('='.repeat(70));
  console.log('✅ PIPELINE COMPLETE');
  console.log('='.repeat(70));
  console.log(`   BaT queued: ${batQueued}`);
  console.log(`   Craigslist queued: ${clQueued}`);
  console.log(`   Other queued: ${otherQueued}`);
  console.log(`   No URL (manual entry needed): ${categories.noUrl.length}`);
  console.log('');
  console.log('Next steps:');
  console.log('1. Process bat_extraction_queue (use comprehensive-bat-extraction)');
  console.log('2. Process import_queue (use process-import-queue)');
  console.log('3. Monitor progress with: node scripts/analyze-incomplete-profiles.js');
  console.log('');
}

comprehensiveReExtraction().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});

