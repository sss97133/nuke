#!/usr/bin/env node
/**
 * Mark Vehicles as Sold
 * 
 * Manually mark vehicles as sold in the database. Can also sync sold status
 * from organization_vehicles or vehicle_listings to the vehicles table.
 * 
 * Usage:
 *   node scripts/mark-vehicles-sold.js [vehicle_id] [--sale-price=65000] [--sale-date=2024-01-15]
 *   node scripts/mark-vehicles-sold.js --sync-from-org-vehicles
 *   node scripts/mark-vehicles-sold.js --sync-from-listings
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

/**
 * Mark a single vehicle as sold
 */
async function markVehicleSold(vehicleId, options = {}) {
  const { salePrice, saleDate } = options;

  console.log(`\nMarking vehicle ${vehicleId} as sold...`);

  // Get current vehicle data
  const { data: vehicle, error: fetchError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, sale_status, sale_price, sale_date')
    .eq('id', vehicleId)
    .single();

  if (fetchError || !vehicle) {
    console.error(`  ❌ Vehicle not found: ${fetchError ? fetchError.message : 'Unknown error'}`);
    return { success: false, error: fetchError?.message };
  }

  console.log(`  Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  console.log(`  Current status: ${vehicle.sale_status || 'null'}`);

  // Prepare update data
  const updateData = {
    sale_status: 'sold',
    updated_at: new Date().toISOString(),
  };

  if (salePrice !== undefined) {
    updateData.sale_price = salePrice;
  } else if (vehicle.sale_price) {
    // Keep existing sale_price if not provided
    updateData.sale_price = vehicle.sale_price;
  }

  if (saleDate) {
    updateData.sale_date = saleDate;
  } else if (vehicle.sale_date) {
    // Keep existing sale_date if not provided
    updateData.sale_date = vehicle.sale_date;
  }

  // Update vehicle
  const { data: updated, error: updateError } = await supabase
    .from('vehicles')
    .update(updateData)
    .eq('id', vehicleId)
    .select('id, sale_status, sale_price, sale_date')
    .single();

  if (updateError) {
    console.error(`  ❌ Failed to update: ${updateError.message}`);
    return { success: false, error: updateError.message };
  }

  console.log(`  ✅ Updated vehicle:`);
  console.log(`     Status: ${updated.sale_status}`);
  console.log(`     Price: ${updated.sale_price ? `$${updated.sale_price.toLocaleString()}` : 'null'}`);
  console.log(`     Date: ${updated.sale_date || 'null'}`);

  return { success: true, data: updated };
}

/**
 * Sync sold status from organization_vehicles to vehicles table
 */
async function syncFromOrganizationVehicles() {
  console.log('\nSyncing sold status from organization_vehicles to vehicles...\n');

  // Find vehicles where organization_vehicles says sold but vehicles doesn't
  const { data: soldOrgVehicles, error } = await supabase
    .from('organization_vehicles')
    .select(`
      vehicle_id,
      listing_status,
      sale_date,
      sale_price,
      vehicles!inner(id, year, make, model, sale_status)
    `)
    .eq('listing_status', 'sold')
    .or('vehicles.sale_status.is.null,vehicles.sale_status.neq.sold');

  if (error) {
    console.error('Error fetching organization_vehicles:', error);
    return;
  }

  if (!soldOrgVehicles || soldOrgVehicles.length === 0) {
    console.log('No vehicles found that need syncing');
    return;
  }

  console.log(`Found ${soldOrgVehicles.length} vehicles to sync\n`);

  let updatedCount = 0;
  for (const orgVehicle of soldOrgVehicles) {
    const vehicle = orgVehicle.vehicles;
    console.log(`Processing: ${vehicle.year} ${vehicle.make} ${vehicle.model} (${vehicle.id})`);

    const updateData = {
      sale_status: 'sold',
      updated_at: new Date().toISOString(),
    };

    if (orgVehicle.sale_price) {
      updateData.sale_price = orgVehicle.sale_price;
    }

    if (orgVehicle.sale_date) {
      updateData.sale_date = orgVehicle.sale_date;
    }

    const { error: updateError } = await supabase
      .from('vehicles')
      .update(updateData)
      .eq('id', vehicle.id);

    if (updateError) {
      console.error(`  ❌ Failed: ${updateError.message}`);
    } else {
      console.log(`  ✅ Updated`);
      updatedCount++;
    }
  }

  console.log(`\n✅ Synced ${updatedCount} of ${soldOrgVehicles.length} vehicles`);
}

/**
 * Sync sold status from vehicle_listings to vehicles table
 */
async function syncFromVehicleListings() {
  console.log('\nSyncing sold status from vehicle_listings to vehicles...\n');

  const { data: soldListings, error } = await supabase
    .from('vehicle_listings')
    .select(`
      vehicle_id,
      status,
      sold_at,
      sold_price_cents,
      vehicles!inner(id, year, make, model, sale_status)
    `)
    .eq('status', 'sold')
    .or('vehicles.sale_status.is.null,vehicles.sale_status.neq.sold');

  if (error) {
    console.error('Error fetching vehicle_listings:', error);
    return;
  }

  if (!soldListings || soldListings.length === 0) {
    console.log('No vehicles found that need syncing');
    return;
  }

  console.log(`Found ${soldListings.length} vehicles to sync\n`);

  let updatedCount = 0;
  for (const listing of soldListings) {
    const vehicle = listing.vehicles;
    console.log(`Processing: ${vehicle.year} ${vehicle.make} ${vehicle.model} (${vehicle.id})`);

    const updateData = {
      sale_status: 'sold',
      updated_at: new Date().toISOString(),
    };

    if (listing.sold_price_cents) {
      updateData.sale_price = listing.sold_price_cents / 100; // Convert cents to dollars
    }

    if (listing.sold_at) {
      updateData.sale_date = listing.sold_at.split('T')[0]; // Extract date part
    }

    const { error: updateError } = await supabase
      .from('vehicles')
      .update(updateData)
      .eq('id', vehicle.id);

    if (updateError) {
      console.error(`  ❌ Failed: ${updateError.message}`);
    } else {
      console.log(`  ✅ Updated`);
      updatedCount++;
    }
  }

  console.log(`\n✅ Synced ${updatedCount} of ${soldListings.length} vehicles`);
}

async function main() {
  const args = process.argv.slice(2);
  const vehicleId = args.find(arg => !arg.startsWith('--'));
  const syncOrgFlag = args.includes('--sync-from-org-vehicles');
  const syncListingsFlag = args.includes('--sync-from-listings');
  
  // Parse options
  const salePriceArg = args.find(arg => arg.startsWith('--sale-price='));
  const saleDateArg = args.find(arg => arg.startsWith('--sale-date='));
  
  const salePrice = salePriceArg ? parseFloat(salePriceArg.split('=')[1]) : undefined;
  const saleDate = saleDateArg ? saleDateArg.split('=')[1] : undefined;

  if (syncOrgFlag) {
    await syncFromOrganizationVehicles();
  } else if (syncListingsFlag) {
    await syncFromVehicleListings();
  } else if (vehicleId) {
    await markVehicleSold(vehicleId, { salePrice, saleDate });
  } else {
    console.error('Usage:');
    console.error('  node scripts/mark-vehicles-sold.js [vehicle_id] [--sale-price=65000] [--sale-date=2024-01-15]');
    console.error('  node scripts/mark-vehicles-sold.js --sync-from-org-vehicles');
    console.error('  node scripts/mark-vehicles-sold.js --sync-from-listings');
    process.exit(1);
  }
}

main().catch(console.error);

