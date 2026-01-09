#!/usr/bin/env node
/**
 * RESTORE BaT COMMENTS
 * 
 * Re-extracts BaT comments for all vehicles that have BaT URLs
 * This restores comments that were deleted by the migration
 * 
 * Usage:
 *   node scripts/restore-bat-comments.js [batch_size] [start_from]
 * 
 * Examples:
 *   node scripts/restore-bat-comments.js 50    # Process 50 vehicles
 *   node scripts/restore-bat-comments.js 50 50 # Resume from vehicle 50
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
let supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

// Try loading from .env file in root
const envFile = path.join(__dirname, '..', '.env');
if (!supabaseKey && fs.existsSync(envFile)) {
  const envContent = fs.readFileSync(envFile, 'utf-8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^["']|["']$/g, '');
      if (key === 'VITE_SUPABASE_URL' || key === 'SUPABASE_URL') {
        supabaseUrl = value;
      } else if (key === 'SUPABASE_SERVICE_ROLE_KEY' || key === 'SERVICE_ROLE_KEY') {
        supabaseKey = value;
      }
    }
  });
}

// Try loading from nuke_frontend/.env.local (common location)
const envLocalPath = path.join(__dirname, '..', 'nuke_frontend', '.env.local');
if (!supabaseKey && fs.existsSync(envLocalPath)) {
  const envContent = fs.readFileSync(envLocalPath, 'utf8');
  const lines = envContent.split('\n');
  for (const line of lines) {
    if (line.startsWith('SUPABASE_SERVICE_ROLE_KEY=') || line.startsWith('SERVICE_ROLE_KEY=')) {
      supabaseKey = line.split('=')[1]?.trim().replace(/^["']|["']$/g, '');
      break;
    }
    if ((line.startsWith('VITE_SUPABASE_URL=') || line.startsWith('SUPABASE_URL=')) && !supabaseUrl.includes('qkgaybvrernstplzjaam')) {
      supabaseUrl = line.split('=')[1]?.trim().replace(/^["']|["']$/g, '');
    }
  }
}

if (!supabaseKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Checkpoint file to track progress
const CHECKPOINT_FILE = path.join(__dirname, 'restore-bat-comments-checkpoint.json');

function loadCheckpoint() {
  if (fs.existsSync(CHECKPOINT_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'));
    } catch (e) {
      console.warn('⚠️  Could not load checkpoint, starting fresh');
    }
  }
  return { processed: [], lastIndex: 0 };
}

function saveCheckpoint(checkpoint) {
  const data = {
    processed: checkpoint.processed,
    lastIndex: checkpoint.lastIndex,
    timestamp: new Date().toISOString(),
  };
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(data, null, 2));
}

async function ensureAuctionEvent(vehicleId, batUrl) {
  // Check if auction_event exists
  const { data: existingEvent } = await supabase
    .from('auction_events')
    .select('id')
    .eq('vehicle_id', vehicleId)
    .eq('source', 'bat')
    .eq('source_url', batUrl)
    .maybeSingle();

  if (existingEvent) {
    return existingEvent.id;
  }

  // Create auction_event if it doesn't exist
  // Valid outcome values: sold, reserve_not_met, no_sale, bid_to, cancelled, relisted, pending
  // Use 'bid_to' as default for ended auctions (will be updated if we find sale_price)
  const { data: newEvent, error: eventError } = await supabase
    .from('auction_events')
    .insert({
      vehicle_id: vehicleId,
      source: 'bat',
      source_url: batUrl,
      outcome: 'bid_to', // Default for ended auctions, will be updated if sale_price found
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (eventError) {
    console.warn(`   ⚠️  Failed to create auction_event: ${eventError.message}`);
    return null;
  }

  return newEvent?.id;
}

async function extractComments(vehicleId, auctionEventId, batUrl) {
  try {
    const { data: extractData, error: extractError } = await supabase.functions.invoke('extract-auction-comments', {
      body: {
        auction_url: batUrl,
        auction_event_id: auctionEventId,
        vehicle_id: vehicleId,
      },
    });

    if (extractError) {
      return { success: false, error: extractError.message };
    }

    const commentsExtracted = extractData?.comments_extracted || 0;
    return { success: true, commentsExtracted };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function restoreCommentsForVehicle(vehicle, index, total) {
  const batUrl = vehicle.discovery_url || vehicle.bat_auction_url;
  
  if (!batUrl || !batUrl.includes('bringatrailer.com')) {
    return { skipped: true, reason: 'no_bat_url' };
  }

  console.log(`\n[${index}/${total}] 🚗 ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  console.log(`   ID: ${vehicle.id}`);
  console.log(`   URL: ${batUrl}`);

  // Step 1: Ensure auction_event exists
  const auctionEventId = await ensureAuctionEvent(vehicle.id, batUrl);
  if (!auctionEventId) {
    return { success: false, error: 'Failed to create/get auction_event' };
  }

  // Step 2: Extract comments
  console.log(`   📝 Extracting comments...`);
  const result = await extractComments(vehicle.id, auctionEventId, batUrl);

  if (result.success) {
    console.log(`   ✅ Extracted ${result.commentsExtracted} comments`);
    return { success: true, commentsExtracted: result.commentsExtracted };
  } else {
    console.log(`   ❌ Failed: ${result.error}`);
    return { success: false, error: result.error };
  }
}

async function main() {
  const batchSize = parseInt(process.argv[2] || '50'); // Default 50 vehicles per run
  const startFrom = parseInt(process.argv[3] || '0'); // Start from this index
  
  console.log('🔄 RESTORING BaT COMMENTS');
  console.log('==========================\n');
  console.log(`📦 Batch size: ${batchSize} vehicles`);
  console.log(`📍 Starting from index: ${startFrom}\n`);

  // Load checkpoint
  const checkpoint = loadCheckpoint();
  const processed = new Set(checkpoint.processed || []);
  const actualStartFrom = startFrom > 0 ? startFrom : checkpoint.lastIndex;
  
  console.log(`📋 Checkpoint: ${processed.size} vehicles already processed`);
  if (actualStartFrom > 0) {
    console.log(`   Resuming from index ${actualStartFrom}\n`);
  }

  // Get all vehicles with BaT URLs
  console.log('📋 Finding vehicles with BaT URLs...');
  const { data: vehicles, error: vehiclesError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, bat_auction_url')
    .or('discovery_url.ilike.%bringatrailer.com%,bat_auction_url.ilike.%bringatrailer.com%')
    .order('created_at', { ascending: false }); // Consistent ordering

  if (vehiclesError) {
    console.error('❌ Failed to fetch vehicles:', vehiclesError.message);
    process.exit(1);
  }

  if (!vehicles || vehicles.length === 0) {
    console.log('✅ No vehicles with BaT URLs found');
    return;
  }

  console.log(`✅ Found ${vehicles.length} total vehicles with BaT URLs\n`);

  // Filter to unprocessed vehicles starting from checkpoint
  const vehiclesToProcess = vehicles
    .slice(actualStartFrom, actualStartFrom + batchSize)
    .filter(v => !processed.has(v.id));

  if (vehiclesToProcess.length === 0) {
    console.log('✅ No vehicles to process in this batch (all already processed)');
    console.log(`   Run with: node scripts/restore-bat-comments.js ${batchSize} ${actualStartFrom + batchSize}`);
    return;
  }

  console.log(`📦 Processing ${vehiclesToProcess.length} vehicles (${actualStartFrom} to ${actualStartFrom + vehiclesToProcess.length - 1})...\n`);

  let successCount = 0;
  let failCount = 0;
  let skipCount = 0;
  let totalComments = 0;
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 10; // Stop after 10 failures in a row (more resilient)

  for (let i = 0; i < vehiclesToProcess.length; i++) {
    const vehicle = vehiclesToProcess[i];
    const globalIndex = actualStartFrom + i;
    
    const result = await restoreCommentsForVehicle(vehicle, globalIndex + 1, vehicles.length);
    
    // Mark as processed regardless of outcome
    processed.add(vehicle.id);
    
    if (result.skipped) {
      skipCount++;
      consecutiveFailures = 0;
    } else if (result.success) {
      successCount++;
      totalComments += result.commentsExtracted || 0;
      consecutiveFailures = 0;
    } else {
      failCount++;
      consecutiveFailures++;
      
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.error(`\n❌ STOPPING: ${consecutiveFailures} consecutive failures detected`);
        console.error(`   Last error: ${result.error}`);
        break;
      }
    }

    // Save checkpoint after each vehicle
    saveCheckpoint({
      processed: Array.from(processed),
      lastIndex: globalIndex + 1,
    });

    // Small delay between vehicles (rate limiting)
    if (i < vehiclesToProcess.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // Increased to 2s to avoid rate limits
    }
  }

  console.log('\n\n📊 BATCH SUMMARY');
  console.log('================');
  console.log(`✅ Success: ${successCount} vehicles`);
  console.log(`❌ Failed: ${failCount} vehicles`);
  console.log(`⏭️  Skipped: ${skipCount} vehicles`);
  console.log(`📝 Comments extracted this batch: ${totalComments}`);
  console.log(`\n📋 Total processed: ${processed.size} vehicles`);
  
  const nextIndex = actualStartFrom + vehiclesToProcess.length;
  if (nextIndex < vehicles.length) {
    console.log(`\n▶️  Next batch: node scripts/restore-bat-comments.js ${batchSize} ${nextIndex}`);
  } else {
    console.log(`\n✅ All vehicles processed!`);
    // Optionally delete checkpoint file
    if (fs.existsSync(CHECKPOINT_FILE)) {
      console.log(`   Checkpoint file: ${CHECKPOINT_FILE}`);
    }
  }
}

main().catch(console.error);
