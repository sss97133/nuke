#!/usr/bin/env node
/**
 * Quick script to check how many vehicles have "Unknown" make/model
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

async function checkUnknownVehicles() {
  console.log('🔍 Checking for vehicles with "Unknown" make or model...\n');
  
  // Count vehicles with "Unknown" make or model
  const { count: totalUnknown, error: countError } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .or('make.eq.Unknown,model.eq.Unknown');
  
  if (countError) {
    console.error('❌ Error counting vehicles:', countError);
    return;
  }
  
  // Count vehicles with "Unknown" make/model that have BaT URLs
  const { count: batUnknown, error: batCountError } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .or('make.eq.Unknown,model.eq.Unknown')
    .or('discovery_url.ilike.%bringatrailer.com/listing/%,bat_auction_url.ilike.%bringatrailer.com/listing/%');
  
  if (batCountError) {
    console.error('❌ Error counting BaT vehicles:', batCountError);
    return;
  }
  
  // Get sample of remaining vehicles
  const { data: sample, error: sampleError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, bat_auction_url')
    .or('make.eq.Unknown,model.eq.Unknown')
    .limit(10);
  
  if (sampleError) {
    console.error('❌ Error fetching sample:', sampleError);
    return;
  }
  
  console.log('📊 Results:');
  console.log(`  Total vehicles with "Unknown" make/model: ${totalUnknown || 0}`);
  console.log(`  BaT vehicles with "Unknown" make/model: ${batUnknown || 0}`);
  console.log(`\n  Sample of remaining vehicles:`);
  
  if (sample && sample.length > 0) {
    sample.forEach(v => {
      const url = v.discovery_url || v.bat_auction_url || 'No URL';
      console.log(`    - ${v.id.slice(0, 8)}... ${v.year || '?'} ${v.make || '?'} ${v.model || '?'} | ${url.substring(0, 60)}...`);
    });
  } else {
    console.log('    ✅ No vehicles with "Unknown" make/model found!');
  }
}

checkUnknownVehicles().catch(console.error);

