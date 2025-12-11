#!/usr/bin/env node

/**
 * Monitor Completion Progress
 * 
 * Tracks how many vehicles are "complete" (Tier 5) and reports progress
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load env
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '..', '.env.local');

try {
  const envFile = readFileSync(envPath, 'utf8');
  envFile.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  });
} catch (error) {
  // .env.local not found
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function checkProgress() {
  console.log('\n📊 Completion Progress Report\n');

  // Get active vehicles
  const { data: activeVehicles, error: activeError } = await supabase
    .from('vehicles')
    .select('id')
    .eq('status', 'active')
    .eq('is_public', true);

  if (activeError) {
    console.error('Error fetching active vehicles:', activeError);
    return;
  }

  const totalActive = activeVehicles?.length || 0;

  // Get complete vehicles (Tier 5 criteria)
  const { data: feedData, error: feedError } = await supabase.rpc('get_vehicle_feed_data');
  
  if (feedError) {
    console.error('Error fetching feed data:', feedError);
    return;
  }

  // Filter for Tier 5 (complete)
  const completeVehicles = (feedData || []).filter((v) => v.tier === 'complete');

  const completeCount = completeVehicles?.length || 0;
  const percentage = totalActive > 0 ? ((completeCount / totalActive) * 100).toFixed(1) : 0;
  const target70 = Math.ceil(totalActive * 0.7);

  console.log(`✅ Complete (Tier 5): ${completeCount} / ${totalActive} (${percentage}%)`);
  console.log(`🎯 Target (70%): ${target70} complete vehicles`);
  console.log(`📈 Progress: ${completeCount >= target70 ? '✅ REACHED' : `Need ${target70 - completeCount} more`}`);

  // Get pending vehicles stats
  const { data: pendingVehicles, error: pendingError } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .eq('status', 'pending')
    .limit(5);

  if (!pendingError && pendingVehicles) {
    console.log(`\n⏳ Pending vehicles: ${pendingVehicles.length} (showing first 5)`);
  }

  // Check what's missing for incomplete vehicles
  if (feedData) {
    const incomplete = feedData.filter((v) => v.tier !== 'complete');
    const missingImages = incomplete.filter((v) => (v.image_count || 0) < 20).length;
    const missingVIN = incomplete.filter((v) => !v.vin || v.vin.length !== 17).length;
    const missingPrice = incomplete.filter((v) => !v.asking_price && !v.current_value).length;

    console.log(`\n📋 Incomplete vehicles breakdown:`);
    console.log(`   Missing images (need 20+): ${missingImages}`);
    console.log(`   Missing VIN: ${missingVIN}`);
    console.log(`   Missing price: ${missingPrice}`);
  }
}

// Run check
checkProgress().then(() => {
  console.log('\n✅ Progress check complete\n');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});

