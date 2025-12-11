#!/usr/bin/env node
/**
 * Comprehensive Data Extraction Trigger Script
 * 
 * This script analyzes current vehicle data status and triggers
 * all available extraction processes to fill in missing data.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

// Use service role key if available (for edge function calls)
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 
                              process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);

console.log('═'.repeat(70));
console.log('🚀 COMPREHENSIVE DATA EXTRACTION TRIGGER');
console.log('═'.repeat(70));
console.log(`Using ${SUPABASE_SERVICE_KEY ? 'SERVICE ROLE KEY' : 'ANON KEY (limited access)'}`);
console.log('');

// Step 1: Analyze current data status
async function analyzeDataStatus() {
  console.log('📊 STEP 1: ANALYZING CURRENT DATA STATUS\n');

  // Get vehicle counts by completeness
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, mileage, color, engine_size, transmission, discovery_source, discovery_url, sale_price, asking_price, status, is_public')
    .limit(1000);

  if (error) {
    console.error('Error fetching vehicles:', error.message);
    return null;
  }

  const stats = {
    total: vehicles.length,
    withVin: vehicles.filter(v => v.vin).length,
    withMileage: vehicles.filter(v => v.mileage).length,
    withColor: vehicles.filter(v => v.color).length,
    withEngine: vehicles.filter(v => v.engine_size).length,
    withTransmission: vehicles.filter(v => v.transmission).length,
    withPrice: vehicles.filter(v => v.sale_price || v.asking_price).length,
    withDiscoveryUrl: vehicles.filter(v => v.discovery_url).length,
    pending: vehicles.filter(v => v.status === 'pending').length,
    active: vehicles.filter(v => v.status === 'active').length,
    public: vehicles.filter(v => v.is_public).length,
    bySource: {}
  };

  // Count by discovery source
  vehicles.forEach(v => {
    const source = v.discovery_source || 'unknown';
    stats.bySource[source] = (stats.bySource[source] || 0) + 1;
  });

  console.log('Vehicle Overview:');
  console.log(`  Total Vehicles: ${stats.total}`);
  console.log(`  Active: ${stats.active} | Pending: ${stats.pending}`);
  console.log(`  Public: ${stats.public}`);
  console.log('');
  console.log('Data Completeness:');
  console.log(`  With VIN:          ${stats.withVin}/${stats.total} (${(stats.withVin/stats.total*100).toFixed(1)}%)`);
  console.log(`  With Mileage:      ${stats.withMileage}/${stats.total} (${(stats.withMileage/stats.total*100).toFixed(1)}%)`);
  console.log(`  With Color:        ${stats.withColor}/${stats.total} (${(stats.withColor/stats.total*100).toFixed(1)}%)`);
  console.log(`  With Engine:       ${stats.withEngine}/${stats.total} (${(stats.withEngine/stats.total*100).toFixed(1)}%)`);
  console.log(`  With Transmission: ${stats.withTransmission}/${stats.total} (${(stats.withTransmission/stats.total*100).toFixed(1)}%)`);
  console.log(`  With Price:        ${stats.withPrice}/${stats.total} (${(stats.withPrice/stats.total*100).toFixed(1)}%)`);
  console.log(`  With Discovery URL: ${stats.withDiscoveryUrl}/${stats.total} (${(stats.withDiscoveryUrl/stats.total*100).toFixed(1)}%)`);
  console.log('');
  console.log('By Source:');
  Object.entries(stats.bySource).sort((a, b) => b[1] - a[1]).forEach(([source, count]) => {
    console.log(`  ${source}: ${count}`);
  });

  return { vehicles, stats };
}

// Step 2: Analyze image processing status
async function analyzeImageStatus() {
  console.log('\n📸 STEP 2: ANALYZING IMAGE PROCESSING STATUS\n');

  const { data: images, error } = await supabase
    .from('vehicle_images')
    .select('id, vehicle_id, ai_scan_metadata, category, angle')
    .limit(5000);

  if (error) {
    console.error('Error fetching images:', error.message);
    return null;
  }

  const stats = {
    total: images.length,
    analyzed: images.filter(i => i.ai_scan_metadata).length,
    withCategory: images.filter(i => i.category).length,
    withAngle: images.filter(i => i.angle).length,
    needsAnalysis: images.filter(i => !i.ai_scan_metadata).length
  };

  console.log('Image Processing Status:');
  console.log(`  Total Images: ${stats.total}`);
  console.log(`  Analyzed: ${stats.analyzed} (${(stats.analyzed/stats.total*100).toFixed(1)}%)`);
  console.log(`  With Category: ${stats.withCategory}`);
  console.log(`  With Angle: ${stats.withAngle}`);
  console.log(`  Needs Analysis: ${stats.needsAnalysis}`);

  return stats;
}

// Step 3: Find vehicles that can be re-scraped
async function findRescrapeableVehicles() {
  console.log('\n🔍 STEP 3: FINDING VEHICLES THAT CAN BE RE-SCRAPED\n');

  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, vin, mileage, color, engine_size')
    .not('discovery_url', 'is', null)
    .or('vin.is.null,mileage.is.null,color.is.null')
    .limit(50);

  if (error) {
    console.error('Error:', error.message);
    return [];
  }

  console.log(`Found ${vehicles.length} vehicles with discovery URLs that need more data:`);
  
  const batVehicles = vehicles.filter(v => v.discovery_url?.includes('bringatrailer'));
  const clVehicles = vehicles.filter(v => v.discovery_url?.includes('craigslist'));
  const kslVehicles = vehicles.filter(v => v.discovery_url?.includes('ksl.com'));
  const otherVehicles = vehicles.filter(v => 
    !v.discovery_url?.includes('bringatrailer') && 
    !v.discovery_url?.includes('craigslist') &&
    !v.discovery_url?.includes('ksl.com')
  );

  console.log(`  Bring a Trailer: ${batVehicles.length}`);
  console.log(`  Craigslist: ${clVehicles.length}`);
  console.log(`  KSL: ${kslVehicles.length}`);
  console.log(`  Other: ${otherVehicles.length}`);

  return { batVehicles, clVehicles, kslVehicles, otherVehicles, all: vehicles };
}

// Step 4: Trigger extraction for BAT vehicles
async function triggerBATExtraction(vehicles) {
  if (!SUPABASE_SERVICE_KEY) {
    console.log('\n⚠️  STEP 4: BAT EXTRACTION (Skipped - needs service role key)');
    return;
  }

  console.log(`\n🔧 STEP 4: TRIGGERING BAT EXTRACTION FOR ${vehicles.length} VEHICLES\n`);

  let processed = 0;
  let success = 0;
  let failed = 0;

  for (const vehicle of vehicles.slice(0, 10)) { // Process first 10
    processed++;
    console.log(`[${processed}/${Math.min(vehicles.length, 10)}] ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
    
    try {
      const { data, error } = await supabase.functions.invoke('comprehensive-bat-extraction', {
        body: { 
          batUrl: vehicle.discovery_url,
          vehicleId: vehicle.id
        }
      });

      if (error) {
        console.log(`  ❌ Failed: ${error.message}`);
        failed++;
      } else if (data?.success) {
        console.log(`  ✅ Success - VIN: ${data.data?.vin || 'N/A'}, Price: $${data.data?.sale_price || 'N/A'}`);
        success++;
      } else {
        console.log(`  ⚠️  Partial: ${JSON.stringify(data).substring(0, 100)}`);
        failed++;
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      console.log(`  ❌ Error: ${e.message}`);
      failed++;
    }
  }

  console.log(`\nBAT Extraction Results: ${success} success, ${failed} failed`);
}

// Step 5: Trigger AI extraction for vehicles with URLs
async function triggerAIExtraction(vehicles) {
  if (!SUPABASE_SERVICE_KEY) {
    console.log('\n⚠️  STEP 5: AI EXTRACTION (Skipped - needs service role key)');
    return;
  }

  console.log(`\n🤖 STEP 5: TRIGGERING AI EXTRACTION FOR ${vehicles.length} VEHICLES\n`);

  let processed = 0;
  let success = 0;
  let failed = 0;

  for (const vehicle of vehicles.slice(0, 10)) {
    processed++;
    console.log(`[${processed}/${Math.min(vehicles.length, 10)}] ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
    
    try {
      const { data, error } = await supabase.functions.invoke('extract-vehicle-data-ai', {
        body: { url: vehicle.discovery_url }
      });

      if (error) {
        console.log(`  ❌ Failed: ${error.message}`);
        failed++;
        continue;
      }

      if (data?.success && data?.data) {
        const extracted = data.data;
        const updates = {};

        if (!vehicle.vin && extracted.vin) updates.vin = extracted.vin;
        if (!vehicle.mileage && extracted.mileage) updates.mileage = extracted.mileage;
        if (!vehicle.color && extracted.color) updates.color = extracted.color;

        if (Object.keys(updates).length > 0) {
          const { error: updateError } = await supabase
            .from('vehicles')
            .update(updates)
            .eq('id', vehicle.id);

          if (!updateError) {
            console.log(`  ✅ Updated: ${Object.keys(updates).join(', ')}`);
            success++;
          } else {
            console.log(`  ⚠️  Extracted but update failed: ${updateError.message}`);
          }
        } else {
          console.log(`  ℹ️  No new data to update`);
        }
      }

      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      console.log(`  ❌ Error: ${e.message}`);
      failed++;
    }
  }

  console.log(`\nAI Extraction Results: ${success} updated, ${failed} failed`);
}

// Step 6: Trigger image analysis
async function triggerImageAnalysis() {
  if (!SUPABASE_SERVICE_KEY) {
    console.log('\n⚠️  STEP 6: IMAGE ANALYSIS (Skipped - needs service role key)');
    return;
  }

  console.log('\n🖼️  STEP 6: TRIGGERING IMAGE ANALYSIS\n');

  // Get unanalyzed images
  const { data: images, error } = await supabase
    .from('vehicle_images')
    .select('id, image_url, vehicle_id')
    .is('ai_scan_metadata', null)
    .limit(20);

  if (error) {
    console.error('Error fetching images:', error.message);
    return;
  }

  console.log(`Found ${images.length} unanalyzed images, processing first 10...`);

  let processed = 0;
  let success = 0;

  for (const image of images.slice(0, 10)) {
    processed++;
    console.log(`[${processed}/10] Image ${image.id.substring(0, 8)}...`);

    try {
      const { data, error: analyzeError } = await supabase.functions.invoke('analyze-image-tier1', {
        body: {
          image_url: image.image_url,
          vehicle_id: image.vehicle_id,
          image_id: image.id
        }
      });

      if (analyzeError) {
        console.log(`  ❌ Failed: ${analyzeError.message}`);
      } else {
        console.log(`  ✅ Analyzed - ${data?.angle || 'unknown'}, ${data?.category || 'unknown'}`);
        success++;
      }

      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {
      console.log(`  ❌ Error: ${e.message}`);
    }
  }

  console.log(`\nImage Analysis: ${success}/${processed} completed`);
}

// Step 7: Trigger normalization for scraped vehicles
async function triggerNormalization() {
  if (!SUPABASE_SERVICE_KEY) {
    console.log('\n⚠️  STEP 7: VEHICLE NORMALIZATION (Skipped - needs service role key)');
    return;
  }

  console.log('\n📐 STEP 7: TRIGGERING VEHICLE NORMALIZATION\n');

  try {
    const { data, error } = await supabase.functions.invoke('normalize-all-vehicles', {
      body: { limit: 50 }
    });

    if (error) {
      console.log(`❌ Normalization failed: ${error.message}`);
    } else {
      console.log(`✅ Normalization triggered: ${JSON.stringify(data).substring(0, 200)}`);
    }
  } catch (e) {
    console.log(`❌ Error: ${e.message}`);
  }
}

// Step 8: Summary and recommendations
function printSummary(dataStatus, imageStatus, rescrapeableVehicles) {
  console.log('\n' + '═'.repeat(70));
  console.log('📋 SUMMARY AND RECOMMENDATIONS');
  console.log('═'.repeat(70) + '\n');

  if (dataStatus) {
    const missingFields = [];
    if (dataStatus.stats.withVin < dataStatus.stats.total * 0.5) missingFields.push('VIN');
    if (dataStatus.stats.withMileage < dataStatus.stats.total * 0.5) missingFields.push('Mileage');
    if (dataStatus.stats.withColor < dataStatus.stats.total * 0.5) missingFields.push('Color');
    if (dataStatus.stats.withEngine < dataStatus.stats.total * 0.5) missingFields.push('Engine');

    if (missingFields.length > 0) {
      console.log(`⚠️  Fields needing attention: ${missingFields.join(', ')}`);
    }
  }

  if (imageStatus && imageStatus.needsAnalysis > 0) {
    console.log(`📸 ${imageStatus.needsAnalysis} images need AI analysis`);
  }

  if (rescrapeableVehicles && rescrapeableVehicles.all?.length > 0) {
    console.log(`🔄 ${rescrapeableVehicles.all.length} vehicles can be re-scraped for more data`);
  }

  if (!SUPABASE_SERVICE_KEY) {
    console.log('\n🔑 TO ENABLE FULL EXTRACTION:');
    console.log('   Set SUPABASE_SERVICE_ROLE_KEY environment variable');
    console.log('   Then run: node scripts/trigger-all-extraction.js');
    console.log('\n   Or trigger via GitHub Actions:');
    console.log('   Go to: https://github.com/sss97133/nuke/actions');
    console.log('   Click "BAT Scrape" → "Run workflow"');
  }

  console.log('\n✅ Analysis complete!\n');
}

// Main execution
async function main() {
  try {
    const dataStatus = await analyzeDataStatus();
    const imageStatus = await analyzeImageStatus();
    const rescrapeableVehicles = await findRescrapeableVehicles();

    if (SUPABASE_SERVICE_KEY) {
      // Trigger extractions
      if (rescrapeableVehicles.batVehicles?.length > 0) {
        await triggerBATExtraction(rescrapeableVehicles.batVehicles);
      }

      if (rescrapeableVehicles.otherVehicles?.length > 0) {
        await triggerAIExtraction(rescrapeableVehicles.otherVehicles);
      }

      await triggerImageAnalysis();
      await triggerNormalization();
    }

    printSummary(dataStatus, imageStatus, rescrapeableVehicles);

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }
}

main();
