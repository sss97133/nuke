#!/usr/bin/env node
/**
 * Backfill Missing External Listings
 * 
 * Finds vehicles that have discovery_urls from auction platforms but are missing
 * external_listings records. Creates the external_listings records, then syncs them
 * to get current status (sold/ended/active).
 * 
 * Usage:
 *   node scripts/backfill-missing-external-listings.js [vehicle_id]
 *   node scripts/backfill-missing-external-listings.js --all
 *   node scripts/backfill-missing-external-listings.js --platform carsandbids
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

function detectPlatform(url) {
  if (!url) return { platform: null, listingId: null };

  // BaT
  if (url.includes('bringatrailer.com')) {
    const match = url.match(/bringatrailer\.com\/listing\/([^\/]+)/);
    return { platform: 'bat', listingId: match ? match[1] : null };
  }

  // Cars & Bids
  if (url.includes('carsandbids.com')) {
    const match = url.match(/carsandbids\.com\/auctions\/([^\/]+)/);
    return { platform: 'cars_and_bids', listingId: match ? match[1] : null };
  }

  // Mecum
  if (url.includes('mecum.com')) {
    const match = url.match(/mecum\.com\/lots\/([^\/]+)/);
    return { platform: 'mecum', listingId: match ? match[1] : null };
  }

  // Barrett-Jackson
  if (url.includes('barrett-jackson.com')) {
    const match = url.match(/barrett-jackson\.com\/Events\/Event\/Details\/[^-]+-(\d+)/);
    return { platform: 'barrett-jackson', listingId: match ? match[1] : null };
  }

  return { platform: null, listingId: null };
}

async function createExternalListing(vehicle) {
  if (!vehicle.discovery_url) {
    return { success: false, error: 'No discovery_url' };
  }

  const { platform, listingId } = detectPlatform(vehicle.discovery_url);
  if (!platform) {
    return { success: false, error: 'Unsupported platform' };
  }

  // Check if listing already exists
  const { data: existing } = await supabase
    .from('external_listings')
    .select('id')
    .eq('vehicle_id', vehicle.id)
    .eq('platform', platform)
    .limit(1)
    .maybeSingle();

  if (existing) {
    return { success: true, listingId: existing.id };
  }

  // Create new external_listings record
  // Note: There may be a trigger error about create_auction_timeline_event,
  // but the insert should still succeed. We'll check for the listing after.
  const { data: newListing, error } = await supabase
    .from('external_listings')
    .insert({
      vehicle_id: vehicle.id,
      platform: platform,
      listing_url: vehicle.discovery_url,
      listing_id: listingId,
      listing_status: 'active', // Will be updated by sync
      organization_id: null, // Can be linked later if needed
      metadata: {
        source: 'backfill_script',
        created_at: new Date().toISOString(),
      },
    })
    .select('id')
    .single();

  // If insert failed, check if it's because listing already exists (conflict)
  if (error) {
    // Check if listing was actually created despite the error
    const { data: existing } = await supabase
      .from('external_listings')
      .select('id')
      .eq('vehicle_id', vehicle.id)
      .eq('platform', platform)
      .limit(1)
      .maybeSingle();

    if (existing) {
      // Listing exists, trigger error was non-fatal
      return { success: true, listingId: existing.id };
    }

    // Real error
    return { success: false, error: error.message };
  }

  return { success: true, listingId: newListing.id };
}

async function syncListing(listingId, platform) {
  const functionName = platform === 'bat' 
    ? 'sync-bat-listing'
    : platform === 'cars_and_bids' || platform === 'carsandbids'
    ? 'sync-cars-and-bids-listing'
    : null;

  if (!functionName) {
    return { success: false, error: `No sync function for platform: ${platform}` };
  }

  try {
    const { data, error } = await supabase.functions.invoke(functionName, {
      body: { externalListingId: listingId },
    });

    if (error) {
      return { success: false, error: error.message };
    }

      const result = data;
    return { 
      success: result.success || false, 
      status: result.listing?.status || result.status 
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function processVehicle(vehicleId) {
  console.log(`\nProcessing vehicle: ${vehicleId}`);

  const { data: vehicle, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, discovery_source, sale_status')
    .eq('id', vehicleId)
    .single();

  if (error || !vehicle) {
    console.error(`  ❌ Vehicle not found: ${error ? error.message : 'Unknown error'}`);
    return;
  }

  console.log(`  Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  console.log(`  URL: ${vehicle.discovery_url}`);
  console.log(`  Current status: ${vehicle.sale_status || 'null'}`);

  // Create external_listings if missing
  const createResult = await createExternalListing(vehicle);
  if (!createResult.success) {
    console.error(`  ❌ Failed to create listing: ${createResult.error}`);
    return;
  }

  if (!createResult.listingId) {
    console.log(`  ⏭️  Listing already exists`);
    return;
  }

  console.log(`  ✅ Created external_listings: ${createResult.listingId}`);

  // Sync the listing to get current status
  const { platform } = detectPlatform(vehicle.discovery_url || '');
  if (platform && createResult.listingId) {
    console.log(`  🔄 Syncing listing...`);
    const syncResult = await syncListing(createResult.listingId, platform);
    
    if (syncResult.success) {
      console.log(`  ✅ Synced - Status: ${syncResult.status}`);
      
      // Check if vehicle was updated
      const { data: updated } = await supabase
        .from('vehicles')
        .select('sale_status, sale_price, sale_date')
        .eq('id', vehicleId)
        .single();

      if (updated) {
        console.log(`  📊 Vehicle updated:`);
        console.log(`     Status: ${updated.sale_status || 'null'}`);
        console.log(`     Price: ${updated.sale_price ? `$${updated.sale_price.toLocaleString()}` : 'null'}`);
        console.log(`     Date: ${updated.sale_date || 'null'}`);
      }
    } else {
      console.error(`  ⚠️  Sync failed: ${syncResult.error}`);
    }
  }
}

async function processAll(platformFilter) {
  console.log('Finding vehicles missing external_listings...\n');

  let query = supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, discovery_source, sale_status')
    .not('discovery_url', 'is', null)
    .or('discovery_url.ilike.%bringatrailer.com%,discovery_url.ilike.%carsandbids.com%,discovery_url.ilike.%mecum.com%,discovery_url.ilike.%barrett-jackson.com%');

  if (platformFilter) {
    const platformMap = {
      bat: 'bringatrailer.com',
      carsandbids: 'carsandbids.com',
      mecum: 'mecum.com',
      'barrett-jackson': 'barrett-jackson.com',
    };
    const urlPattern = platformMap[platformFilter];
    if (urlPattern) {
      query = query.ilike('discovery_url', `%${urlPattern}%`);
    }
  }

  const { data: vehicles, error } = await query;

  if (error) {
    console.error('Error fetching vehicles:', error);
    return;
  }

  if (!vehicles || vehicles.length === 0) {
    console.log('No vehicles found');
    return;
  }

  console.log(`Found ${vehicles.length} vehicles to process\n`);

  // Check which ones are missing external_listings
  const vehiclesToProcess = [];
  for (const vehicle of vehicles) {
    const { platform } = detectPlatform(vehicle.discovery_url || '');
    if (!platform) continue;

    const { data: existing } = await supabase
      .from('external_listings')
      .select('id')
      .eq('vehicle_id', vehicle.id)
      .eq('platform', platform)
      .limit(1)
      .maybeSingle();

    if (!existing) {
      vehiclesToProcess.push(vehicle);
    }
  }

  console.log(`${vehiclesToProcess.length} vehicles need external_listings created\n`);

  // Process in batches
  const batchSize = 10;
  for (let i = 0; i < vehiclesToProcess.length; i += batchSize) {
    const batch = vehiclesToProcess.slice(i, i + batchSize);
    console.log(`\nProcessing batch ${Math.floor(i / batchSize) + 1} (${i + 1}-${Math.min(i + batchSize, vehiclesToProcess.length)} of ${vehiclesToProcess.length})`);

    await Promise.all(
      batch.map(vehicle => processVehicle(vehicle.id))
    );

    // Small delay between batches
    if (i + batchSize < vehiclesToProcess.length) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log(`\n✅ Completed processing ${vehiclesToProcess.length} vehicles`);
}

async function main() {
  const args = process.argv.slice(2);
  const vehicleId = args.find(arg => !arg.startsWith('--'));
  const allFlag = args.includes('--all');
  const platformFlag = args.find(arg => arg.startsWith('--platform='));
  const platform = platformFlag ? platformFlag.split('=')[1] : undefined;

  if (vehicleId && !allFlag) {
    await processVehicle(vehicleId);
  } else {
    await processAll(platform);
  }
}

main().catch(console.error);

