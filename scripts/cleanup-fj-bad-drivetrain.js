#!/usr/bin/env node
/**
 * Cleanup bad drivetrain data from Fantasy Junction / BaT sourced vehicles
 * Removes incorrect "4x4" / "4WD" values that were mistakenly extracted
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const FJ_ORG_ID = '1d9122ea-1aaf-46ea-81ea-5f75cb259b69';

async function cleanupBadDrivetrain() {
  console.log('🧹 Cleaning up bad drivetrain data from Fantasy Junction vehicles\n');
  
  // Get all Fantasy Junction vehicles
  const { data: orgVehicles, error: orgError } = await supabase
    .from('organization_vehicles')
    .select('vehicle_id')
    .eq('organization_id', FJ_ORG_ID);

  if (orgError) {
    console.error('❌ Error fetching organization vehicles:', orgError.message);
    process.exit(1);
  }

  if (!orgVehicles || orgVehicles.length === 0) {
    console.log('✅ No Fantasy Junction vehicles found');
    return;
  }

  const vehicleIds = orgVehicles.map(ov => ov.vehicle_id);
  console.log(`Found ${vehicleIds.length} Fantasy Junction vehicles\n`);

  // Get vehicles with drivetrain values (especially 4x4/4WD)
  const { data: vehicles, error: vehiclesError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, drivetrain, bat_auction_url, discovery_url')
    .in('id', vehicleIds)
    .not('drivetrain', 'is', null);

  if (vehiclesError) {
    console.error('❌ Error fetching vehicles:', vehiclesError.message);
    process.exit(1);
  }

  if (!vehicles || vehicles.length === 0) {
    console.log('✅ No vehicles with drivetrain data found');
    return;
  }

  console.log(`Found ${vehicles.length} vehicles with drivetrain data\n`);

  // Show summary of drivetrain values
  const drivetrainCounts = {};
  vehicles.forEach(v => {
    const d = (v.drivetrain || '').toString().trim().toUpperCase();
    drivetrainCounts[d] = (drivetrainCounts[d] || 0) + 1;
  });

  console.log('Current drivetrain values:');
  Object.entries(drivetrainCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([value, count]) => {
      console.log(`  ${value || '(empty)'}: ${count}`);
    });
  console.log('');

  // Confirm before proceeding
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('-n');
  const force = args.includes('--force') || args.includes('-f');

  if (!dryRun && !force) {
    console.log('⚠️  This will NULL out drivetrain for ALL Fantasy Junction vehicles');
    console.log('   Run with --dry-run to see what would be changed');
    console.log('   Run with --force to proceed\n');
    process.exit(0);
  }

  if (dryRun) {
    console.log('🔍 DRY RUN - No changes will be made\n');
    console.log(`Would NULL drivetrain for ${vehicles.length} vehicles:\n`);
    vehicles.slice(0, 10).forEach(v => {
      console.log(`  ${v.year || '?'} ${v.make || '?'} ${v.model || '?'}: "${v.drivetrain}" → NULL`);
    });
    if (vehicles.length > 10) {
      console.log(`  ... and ${vehicles.length - 10} more`);
    }
    console.log('');
    return;
  }

  // Update all Fantasy Junction vehicles to NULL drivetrain
  console.log(`🔄 NULLing drivetrain for ${vehicles.length} vehicles...\n`);

  const { error: updateError } = await supabase
    .from('vehicles')
    .update({ drivetrain: null })
    .in('id', vehicleIds);

  if (updateError) {
    console.error('❌ Error updating vehicles:', updateError.message);
    process.exit(1);
  }

  console.log(`✅ Successfully NULLed drivetrain for ${vehicleIds.length} Fantasy Junction vehicles\n`);
  console.log('   Badges will no longer show incorrect "4x4" values on discovery cards');
}

cleanupBadDrivetrain().catch(error => {
  console.error('❌ Fatal error:', error.message);
  if (error.stack) console.error(error.stack);
  process.exit(1);
});
