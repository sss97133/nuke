#!/usr/bin/env node
/**
 * Check why vehicles are failing validation
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY required in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});

async function checkValidation() {
  console.log('🔍 CHECKING VEHICLE VALIDATION\n');
  console.log('='.repeat(60));
  console.log('');

  // Get vehicles that are not public
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, is_public, status, created_at')
    .eq('is_public', false)
    .neq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  console.log(`Found ${vehicles?.length || 0} vehicles that are not public\n`);

  for (const vehicle of vehicles || []) {
    console.log(`\n📋 ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
    console.log(`   ID: ${vehicle.id}`);
    console.log(`   Status: ${vehicle.status}`);
    console.log(`   Created: ${new Date(vehicle.created_at).toLocaleString()}`);

    // Check validation
    const { data: validation, error: valError } = await supabase.rpc(
      'validate_vehicle_before_public',
      { p_vehicle_id: vehicle.id }
    );

    if (valError) {
      console.log(`   ❌ Validation error: ${valError.message}`);
    } else {
      console.log(`   Validation:`);
      console.log(`     Can go live: ${validation?.can_go_live ? '✅' : '❌'}`);
      console.log(`     Quality score: ${validation?.quality_score || 0}`);
      console.log(`     Image count: ${validation?.image_count || 0}`);
      console.log(`     Issues: ${validation?.issues?.length || 0}`);
      if (validation?.issues && validation.issues.length > 0) {
        validation.issues.forEach((issue) => {
          console.log(`       - ${issue.type}: ${issue.message}`);
        });
      }
      console.log(`     Recommendation: ${validation?.recommendation || 'none'}`);
    }

    // Check images
    const { count: imageCount } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', vehicle.id);

    console.log(`   Images: ${imageCount || 0}`);
    console.log(`   VIN: ${vehicle.vin || 'MISSING'}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  
  // Count by issue type
  let totalChecked = 0;
  let canGoLive = 0;
  let missingImages = 0;
  let missingVin = 0;
  let lowQuality = 0;

  for (const vehicle of vehicles || []) {
    totalChecked++;
    const { data: validation } = await supabase.rpc(
      'validate_vehicle_before_public',
      { p_vehicle_id: vehicle.id }
    );

    if (validation?.can_go_live) {
      canGoLive++;
    } else {
      if (validation?.image_count === 0) missingImages++;
      if (!vehicle.vin || vehicle.vin.length < 10) missingVin++;
      if (validation?.quality_score < 60) lowQuality++;
    }
  }

  console.log(`Total checked: ${totalChecked}`);
  console.log(`Can go live: ${canGoLive}`);
  console.log(`Missing images: ${missingImages}`);
  console.log(`Missing VIN: ${missingVin}`);
  console.log(`Low quality score: ${lowQuality}`);
}

checkValidation().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});

