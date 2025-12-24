#!/usr/bin/env node

/**
 * Analyze incomplete vehicle profiles
 * Determines if data exists in metadata that can be mapped vs needs re-extraction
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

async function analyzeIncompleteProfiles() {
  console.log('='.repeat(70));
  console.log('📊 INCOMPLETE PROFILE ANALYSIS');
  console.log('='.repeat(70));
  console.log('');

  // Get incomplete profiles
  const { data: incomplete, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, color, mileage, transmission, drivetrain, engine_size, discovery_source, discovery_url, bat_auction_url, origin_metadata')
    .eq('status', 'active')
    .or('vin.is.null,color.is.null,mileage.is.null,transmission.is.null,drivetrain.is.null,engine_size.is.null')
    .limit(1000);

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  console.log(`Found ${incomplete?.length || 0} incomplete profiles (sampling first 1000)\n`);

  // Categorize
  const categories = {
    hasMetadataCanMap: [],
    hasUrlNeedsExtraction: [],
    noUrlNoMetadata: [],
    batNeedsExtraction: []
  };

  incomplete?.forEach(vehicle => {
    const missing = [];
    if (!vehicle.vin) missing.push('vin');
    if (!vehicle.color) missing.push('color');
    if (!vehicle.mileage) missing.push('mileage');
    if (!vehicle.transmission) missing.push('transmission');
    if (!vehicle.drivetrain) missing.push('drivetrain');
    if (!vehicle.engine_size) missing.push('engine_size');

    const metadata = vehicle.origin_metadata || {};
    const hasMetadata = metadata && Object.keys(metadata).length > 0;
    const hasUrl = !!(vehicle.discovery_url || vehicle.bat_auction_url);
    const isBat = !!(vehicle.bat_auction_url || vehicle.discovery_source === 'bat' || vehicle.discovery_source === 'bat_listing' || vehicle.discovery_source === 'bat_profile_extraction');

    // Check if metadata has mappable data
    const metadataKeys = Object.keys(metadata);
    const hasMappableData = metadataKeys.some(key => 
      key.includes('color') || 
      key.includes('mileage') || 
      key.includes('transmission') || 
      key.includes('drivetrain') || 
      key.includes('engine') ||
      key.includes('vin') ||
      key.includes('price')
    );

    if (isBat && hasUrl) {
      categories.batNeedsExtraction.push({ vehicle, missing, metadataKeys });
    } else if (hasMetadata && hasMappableData) {
      categories.hasMetadataCanMap.push({ vehicle, missing, metadataKeys, metadata });
    } else if (hasUrl) {
      categories.hasUrlNeedsExtraction.push({ vehicle, missing, metadataKeys });
    } else {
      categories.noUrlNoMetadata.push({ vehicle, missing });
    }
  });

  // Summary
  console.log('📋 CATEGORIZATION:');
  console.log(`   ✅ Has metadata that can be mapped: ${categories.hasMetadataCanMap.length}`);
  console.log(`   🔄 Has URL, needs re-extraction: ${categories.hasUrlNeedsExtraction.length}`);
  console.log(`   🎯 BaT vehicles needing extraction: ${categories.batNeedsExtraction.length}`);
  console.log(`   ❌ No URL, no metadata: ${categories.noUrlNoMetadata.length}`);
  console.log('');

  // Show samples
  if (categories.hasMetadataCanMap.length > 0) {
    console.log('✅ SAMPLE: Vehicles with mappable metadata:');
    categories.hasMetadataCanMap.slice(0, 3).forEach(({ vehicle, missing, metadataKeys }) => {
      console.log(`   ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
      console.log(`      Missing: ${missing.join(', ')}`);
      console.log(`      Metadata keys: ${metadataKeys.slice(0, 5).join(', ')}${metadataKeys.length > 5 ? '...' : ''}`);
      console.log('');
    });
  }

  if (categories.batNeedsExtraction.length > 0) {
    console.log('🎯 SAMPLE: BaT vehicles needing extraction:');
    categories.batNeedsExtraction.slice(0, 3).forEach(({ vehicle, missing }) => {
      console.log(`   ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
      console.log(`      Missing: ${missing.join(', ')}`);
      console.log(`      BaT URL: ${vehicle.bat_auction_url || vehicle.discovery_url}`);
      console.log('');
    });
  }

  // Check BaT extraction queue
  const { count: batQueueCount } = await supabase
    .from('bat_extraction_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');

  console.log(`\n📋 BaT EXTRACTION QUEUE: ${batQueueCount || 0} pending extractions`);

  // Recommendations
  console.log('\n' + '='.repeat(70));
  console.log('💡 RECOMMENDATIONS:');
  console.log('='.repeat(70));
  console.log('');
  
  if (categories.hasMetadataCanMap.length > 0) {
    console.log(`1. MAP EXISTING DATA (${categories.hasMetadataCanMap.length} vehicles):`);
    console.log('   - Create mapping function to extract data from origin_metadata');
    console.log('   - Map to direct columns (color, mileage, transmission, etc.)');
    console.log('   - No re-extraction needed - data already captured');
    console.log('');
  }

  if (categories.batNeedsExtraction.length > 0) {
    console.log(`2. QUEUE BaT EXTRACTIONS (${categories.batNeedsExtraction.length} vehicles):`);
    console.log('   - Use re-extract-pending-vehicles function');
    console.log('   - Or process bat_extraction_queue');
    console.log('   - Data needs to be re-extracted from BaT URLs');
    console.log('');
  }

  if (categories.hasUrlNeedsExtraction.length > 0) {
    console.log(`3. RE-EXTRACT FROM URLS (${categories.hasUrlNeedsExtraction.length} vehicles):`);
    console.log('   - Queue in import_queue for re-processing');
    console.log('   - Or trigger appropriate scraper/extractor');
    console.log('');
  }

  if (categories.noUrlNoMetadata.length > 0) {
    console.log(`4. MANUAL ENTRY NEEDED (${categories.noUrlNoMetadata.length} vehicles):`);
    console.log('   - No source URL or metadata available');
    console.log('   - Requires manual data entry or user input');
    console.log('');
  }

  return {
    total: incomplete?.length || 0,
    categories,
    batQueueCount: batQueueCount || 0
  };
}

analyzeIncompleteProfiles().then(result => {
  console.log('\n✅ Analysis complete');
  process.exit(0);
}).catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});

