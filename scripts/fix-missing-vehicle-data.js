#!/usr/bin/env node
/**
 * Fix Missing Vehicle Data
 * 
 * Re-processes vehicles that have discovery URLs but are missing key data
 * by calling the comprehensive extraction functions
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ ERROR: SUPABASE_SERVICE_ROLE_KEY is required');
  console.log('\nTo fix this:');
  console.log('1. Get your service role key from: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/settings/api');
  console.log('2. Run: SUPABASE_SERVICE_ROLE_KEY=your-key node scripts/fix-missing-vehicle-data.js');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

console.log('═'.repeat(70));
console.log('🔧 FIXING MISSING VEHICLE DATA');
console.log('═'.repeat(70) + '\n');

async function getVehiclesNeedingData() {
  // Get vehicles with URLs but missing key data
  const { data, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, vin, mileage, color, engine_size, transmission')
    .not('discovery_url', 'is', null)
    .or('vin.is.null,mileage.is.null,color.is.null')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('Error fetching vehicles:', error.message);
    return [];
  }

  return data || [];
}

async function processBATVehicle(vehicle) {
  console.log(`\n🔄 Processing BAT: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  console.log(`   URL: ${vehicle.discovery_url.substring(0, 60)}...`);

  try {
    const { data, error } = await supabase.functions.invoke('comprehensive-bat-extraction', {
      body: {
        batUrl: vehicle.discovery_url,
        vehicleId: vehicle.id
      }
    });

    if (error) {
      console.log(`   ❌ Error: ${error.message}`);
      return { success: false, error: error.message };
    }

    if (data?.success) {
      const extracted = data.data || {};
      const updated = [];
      
      if (extracted.vin && !vehicle.vin) updated.push('VIN');
      if (extracted.mileage && !vehicle.mileage) updated.push('mileage');
      if (extracted.color && !vehicle.color) updated.push('color');
      if (extracted.engine && !vehicle.engine_size) updated.push('engine');
      if (extracted.transmission && !vehicle.transmission) updated.push('transmission');
      if (extracted.sale_price) updated.push('price');

      console.log(`   ✅ Extracted: ${updated.join(', ') || 'validation only'}`);
      return { success: true, updated };
    } else {
      console.log(`   ⚠️ Partial success: ${JSON.stringify(data).substring(0, 100)}`);
      return { success: false };
    }
  } catch (e) {
    console.log(`   ❌ Exception: ${e.message}`);
    return { success: false, error: e.message };
  }
}

async function processGenericVehicle(vehicle) {
  console.log(`\n🔄 Processing: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  console.log(`   URL: ${vehicle.discovery_url.substring(0, 60)}...`);

  try {
    // First, scrape fresh data
    const { data: scrapeData, error: scrapeError } = await supabase.functions.invoke('scrape-vehicle', {
      body: { url: vehicle.discovery_url }
    });

    if (scrapeError) {
      console.log(`   ❌ Scrape error: ${scrapeError.message}`);
      return { success: false, error: scrapeError.message };
    }

    // Then use AI to extract structured data
    const { data: aiData, error: aiError } = await supabase.functions.invoke('extract-vehicle-data-ai', {
      body: {
        url: vehicle.discovery_url,
        html: scrapeData?.description || '',
        textContent: `${scrapeData?.title || ''} ${scrapeData?.description || ''}`
      }
    });

    if (aiError) {
      console.log(`   ⚠️ AI extraction error: ${aiError.message}`);
    }

    // Combine data from both sources
    const extracted = {
      ...(scrapeData || {}),
      ...(aiData?.data || {})
    };

    // Update vehicle with extracted data
    const updates = {};
    if (extracted.vin && !vehicle.vin) updates.vin = extracted.vin;
    if (extracted.mileage && !vehicle.mileage) updates.mileage = parseInt(String(extracted.mileage).replace(/\D/g, ''));
    if (extracted.color && !vehicle.color) updates.color = extracted.color;
    if (extracted.engine_size && !vehicle.engine_size) updates.engine_size = extracted.engine_size;
    if (extracted.transmission && !vehicle.transmission) updates.transmission = extracted.transmission;

    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await supabase
        .from('vehicles')
        .update(updates)
        .eq('id', vehicle.id);

      if (updateError) {
        console.log(`   ❌ Update error: ${updateError.message}`);
        return { success: false, error: updateError.message };
      }

      console.log(`   ✅ Updated: ${Object.keys(updates).join(', ')}`);
      return { success: true, updated: Object.keys(updates) };
    } else {
      console.log(`   ℹ️ No new data extracted`);
      return { success: true, updated: [] };
    }
  } catch (e) {
    console.log(`   ❌ Exception: ${e.message}`);
    return { success: false, error: e.message };
  }
}

async function main() {
  const vehicles = await getVehiclesNeedingData();
  
  if (vehicles.length === 0) {
    console.log('✅ All vehicles with URLs have complete data!');
    return;
  }

  // Categorize by source
  const batVehicles = vehicles.filter(v => v.discovery_url?.includes('bringatrailer'));
  const clVehicles = vehicles.filter(v => v.discovery_url?.includes('craigslist'));
  const kslVehicles = vehicles.filter(v => v.discovery_url?.includes('ksl.com'));
  const otherVehicles = vehicles.filter(v => 
    !v.discovery_url?.includes('bringatrailer') && 
    !v.discovery_url?.includes('craigslist') &&
    !v.discovery_url?.includes('ksl.com')
  );

  console.log(`Found ${vehicles.length} vehicles needing data:`);
  console.log(`  Bring a Trailer: ${batVehicles.length}`);
  console.log(`  Craigslist: ${clVehicles.length}`);
  console.log(`  KSL: ${kslVehicles.length}`);
  console.log(`  Other: ${otherVehicles.length}`);

  const stats = { processed: 0, success: 0, failed: 0 };

  // Process BAT vehicles first (most likely to have good data)
  for (const vehicle of batVehicles.slice(0, 10)) {
    const result = await processBATVehicle(vehicle);
    stats.processed++;
    if (result.success) stats.success++;
    else stats.failed++;
    
    // Rate limit
    await new Promise(r => setTimeout(r, 3000));
  }

  // Process Craigslist vehicles
  for (const vehicle of clVehicles.slice(0, 5)) {
    const result = await processGenericVehicle(vehicle);
    stats.processed++;
    if (result.success) stats.success++;
    else stats.failed++;
    
    await new Promise(r => setTimeout(r, 3000));
  }

  // Process other vehicles
  for (const vehicle of [...kslVehicles, ...otherVehicles].slice(0, 5)) {
    const result = await processGenericVehicle(vehicle);
    stats.processed++;
    if (result.success) stats.success++;
    else stats.failed++;
    
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log('\n' + '═'.repeat(70));
  console.log('📊 RESULTS');
  console.log('═'.repeat(70));
  console.log(`  Processed: ${stats.processed}`);
  console.log(`  Success: ${stats.success}`);
  console.log(`  Failed: ${stats.failed}`);
  console.log(`  Remaining: ${vehicles.length - stats.processed}`);
  console.log('\n✅ Done!\n');
}

main().catch(console.error);
