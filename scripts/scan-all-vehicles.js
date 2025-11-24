#!/usr/bin/env node

/**
 * SCAN ALL VEHICLES - Master orchestrator
 * 
 * Uses existing batch-analyze-vehicle Edge Function to scan all images
 * across all vehicles in the database
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load environment
const possiblePaths = [
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(process.cwd(), 'nuke_frontend/.env.local'),
];

let envConfig = {};
for (const envPath of possiblePaths) {
  if (fs.existsSync(envPath)) {
    envConfig = dotenv.parse(fs.readFileSync(envPath));
    console.log(`✓ Loaded env from: ${envPath}`);
    break;
  }
}

const SUPABASE_URL = envConfig.SUPABASE_URL || envConfig.VITE_SUPABASE_URL || process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = envConfig.SUPABASE_SERVICE_ROLE_KEY || envConfig.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Configuration
const DELAY_BETWEEN_VEHICLES = 2000; // 2 seconds between vehicles
const TEST_MODE = process.argv.includes('--test');
const MAX_VEHICLES = TEST_MODE ? 3 : undefined;

let stats = {
  vehiclesProcessed: 0,
  totalImagesScanned: 0,
  totalImagesFailed: 0,
  startTime: Date.now(),
  errors: [],
  scanProgressId: null
};

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

async function updateScanProgress(updates) {
  if (!stats.scanProgressId) return;
  try {
    await supabase
      .from('ai_scan_progress')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', stats.scanProgressId);
  } catch (err) {
    console.error('Failed to update scan progress:', err.message);
  }
}

async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('🚀 COMPREHENSIVE IMAGE SCANNING - ALL VEHICLES');
  console.log('='.repeat(80));
  console.log(`Mode: ${TEST_MODE ? 'TEST (3 vehicles)' : 'FULL SCAN'}`);
  console.log(`Started: ${new Date().toLocaleString()}`);
  console.log('='.repeat(80) + '\n');

  // Create scan progress record for monitoring
  const { data: progressRecord, error: progressError } = await supabase
    .from('ai_scan_progress')
    .insert({
      scan_type: 'full_scan',
      status: 'running',
      started_at: new Date().toISOString(),
      metadata: { test_mode: TEST_MODE }
    })
    .select()
    .single();

  if (!progressError && progressRecord) {
    stats.scanProgressId = progressRecord.id;
    console.log(`📊 Monitoring at: https://n-zero.dev/admin (Progress ID: ${progressRecord.id.slice(0,8)})\n`);
  }

  // Get vehicles with unscanned images - use manual query
  let vehicles;
  try {
    const { data, error } = await supabase
      .from('vehicle_images')
      .select('vehicle_id, vehicles(id, make, model, year)')
      .is('ai_last_scanned', null)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Failed to fetch vehicles:', error);
      process.exit(1);
    }

    // Group by vehicle
    const vehicleMap = new Map();
    for (const row of data || []) {
      if (!row.vehicle_id || !row.vehicles) continue;
      if (!vehicleMap.has(row.vehicle_id)) {
        vehicleMap.set(row.vehicle_id, {
          id: row.vehicle_id,
          make: row.vehicles.make,
          model: row.vehicles.model,
          year: row.vehicles.year,
          unscanned_count: 0
        });
      }
      vehicleMap.get(row.vehicle_id).unscanned_count++;
    }

    vehicles = Array.from(vehicleMap.values()).sort((a, b) => b.unscanned_count - a.unscanned_count);
  } catch (err) {
    console.error('❌ Failed to query vehicles:', err.message);
    process.exit(1);
  }

  const totalVehicles = MAX_VEHICLES ? Math.min(vehicles.length, MAX_VEHICLES) : vehicles.length;
  
  console.log(`📊 Found ${totalVehicles} vehicles with unscanned images\n`);

  // Process each vehicle
  for (let i = 0; i < totalVehicles; i++) {
    const vehicle = vehicles[i];
    const progress = `[${i + 1}/${totalVehicles}]`;
    
    console.log(`\n${progress} Processing: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
    console.log(`   Vehicle ID: ${vehicle.id}`);
    console.log(`   Unscanned images: ${vehicle.unscanned_count || 'unknown'}`);

    try {
      // Call batch-analyze-vehicle Edge Function
      const { data, error } = await supabase.functions.invoke('batch-analyze-vehicle', {
        body: {
          vehicle_id: vehicle.id,
          force_reanalysis: false
        }
      });

      if (error) {
        throw new Error(error.message || 'Edge function error');
      }

      // Update stats
      stats.vehiclesProcessed++;
      stats.totalImagesScanned += data?.analyzed || 0;
      stats.totalImagesFailed += data?.failed || 0;

      // Update progress in database for admin monitoring
      await updateScanProgress({
        processed_images: stats.totalImagesScanned,
        failed_images: stats.totalImagesFailed,
        current_vehicle_id: vehicle.id
      });

      console.log(`   ✅ Complete: ${data?.analyzed || 0} analyzed, ${data?.skipped || 0} skipped, ${data?.failed || 0} failed`);

    } catch (err) {
      const errorMsg = err.message || 'Unknown error';
      console.error(`   ❌ Error: ${errorMsg}`);
      stats.errors.push({ vehicle: vehicle.id, error: errorMsg });
    }

    // Delay between vehicles
    if (i < totalVehicles - 1) {
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_VEHICLES));
    }

    // Progress summary every 10 vehicles
    if ((i + 1) % 10 === 0) {
      const elapsed = Date.now() - stats.startTime;
      const rate = stats.totalImagesScanned / (elapsed / 1000 / 60); // images per minute
      console.log(`\n   📈 Progress: ${stats.vehiclesProcessed} vehicles, ${stats.totalImagesScanned} images scanned (${rate.toFixed(1)}/min)`);
    }
  }

  // Process organization images
  console.log('\n\n' + '='.repeat(80));
  console.log('🏢 SCANNING ORGANIZATION IMAGES');
  console.log('='.repeat(80) + '\n');

  // Get organizations with unscanned images
  const { data: orgs, error: orgError } = await supabase
    .from('organization_images')
    .select('organization_id, organizations:businesses(id, business_name)')
    .or('ai_scanned.is.null,ai_scanned.eq.false')
    .order('created_at', { ascending: false });

  if (!orgError && orgs && orgs.length > 0) {
    // Group by organization
    const orgMap = new Map();
    for (const row of orgs) {
      if (!row.organization_id) continue;
      if (!orgMap.has(row.organization_id)) {
        orgMap.set(row.organization_id, {
          id: row.organization_id,
          name: row.organizations?.business_name || 'Unknown',
          count: 0
        });
      }
      orgMap.get(row.organization_id).count++;
    }

    const orgList = Array.from(orgMap.values());
    const totalOrgs = TEST_MODE ? Math.min(orgList.length, 3) : orgList.length;

    console.log(`📊 Found ${totalOrgs} organizations with unscanned images\n`);

    for (let i = 0; i < totalOrgs; i++) {
      const org = orgList[i];
      const progress = `[${i + 1}/${totalOrgs}]`;

      console.log(`\n${progress} Processing: ${org.name}`);
      console.log(`   Organization ID: ${org.id}`);
      console.log(`   Unscanned images: ${org.count}`);

      try {
        // Call analyze-organization-images Edge Function
        const { data, error } = await supabase.functions.invoke('analyze-organization-images', {
          body: {
            organizationId: org.id,
            batch: true
          }
        });

        if (error) {
          throw new Error(error.message || 'Edge function error');
        }

        console.log(`   ✅ Complete: Organization images analyzed`);

      } catch (err) {
        const errorMsg = err.message || 'Unknown error';
        console.error(`   ❌ Error: ${errorMsg}`);
        stats.errors.push({ organization: org.id, error: errorMsg });
      }

      // Delay between organizations
      if (i < totalOrgs - 1) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_VEHICLES));
      }
    }
  }

  // Mark scan as complete in database
  await updateScanProgress({
    status: 'completed',
    completed_at: new Date().toISOString(),
    processed_images: stats.totalImagesScanned,
    failed_images: stats.totalImagesFailed
  });

  // Final summary
  const elapsed = Date.now() - stats.startTime;
  console.log('\n\n' + '='.repeat(80));
  console.log('🏁 SCAN COMPLETE');
  console.log('='.repeat(80));
  console.log(`⏱️  Total time: ${formatDuration(elapsed)}`);
  console.log(`\n📸 Vehicle Images:`);
  console.log(`   ✅ Scanned: ${stats.totalImagesScanned}`);
  console.log(`   ❌ Failed: ${stats.totalImagesFailed}`);
  console.log(`\n🚗 Vehicles:`);
  console.log(`   Processed: ${stats.vehiclesProcessed}`);
  
  if (stats.errors.length > 0) {
    console.log(`\n❌ Errors (${stats.errors.length}):`);
    stats.errors.slice(0, 10).forEach(err => {
      console.log(`   - ${err.vehicle || err.organization}: ${err.error}`);
    });
  }
  
  console.log('='.repeat(80) + '\n');
}

main().catch(console.error);

