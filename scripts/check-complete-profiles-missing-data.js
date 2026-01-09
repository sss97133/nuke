#!/usr/bin/env node
/**
 * Check Missing Data in Complete Profiles
 * Queries vehicles from complete queue items and shows what's missing
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczODM2OTAyMSwiZXhwIjoyMDUzOTQ1MDIxfQ.NEbqSnSamR5f7Fqon25ierv5yJgdDy_o2nrixOej_Xg';

async function checkMissingData() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('   Missing Profile Data Check');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');

  try {
    // Get complete queue items
    const queueResponse = await fetch(`${SUPABASE_URL}/rest/v1/bat_extraction_queue?select=vehicle_id,bat_url&status=eq.complete&limit=50`, {
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY
      }
    });

    if (!queueResponse.ok) {
      throw new Error(`Failed to fetch queue: ${queueResponse.status}`);
    }

    const queueItems = await queueResponse.json();
    
    if (queueItems.length === 0) {
      console.log('❌ No complete profiles found');
      return;
    }

    console.log(`📊 Found ${queueItems.length} complete profiles\n`);

    // Debug: Check first item structure
    if (queueItems.length > 0) {
      console.log('Sample queue item:', JSON.stringify(queueItems[0], null, 2));
      console.log('');
    }

    // Get vehicle IDs
    const vehicleIds = queueItems.map(item => item.vehicle_id).filter(Boolean);

    if (vehicleIds.length === 0) {
      console.log('❌ No vehicle IDs found in complete queue');
      console.log('Sample items:', queueItems.slice(0, 3).map(item => ({
        vehicle_id: item.vehicle_id,
        bat_url: item.bat_url
      })));
      return;
    }

    console.log(`📋 Checking ${vehicleIds.length} vehicles...\n`);

    // Get vehicles data - query one at a time to avoid URL length issues
    const vehicles = [];
    const vehicleMap = new Map();
    
    for (const vid of vehicleIds.slice(0, 30)) {
      const vehiclesResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/vehicles?id=eq.${vid}&select=id,year,make,model,vin,mileage,color,transmission,engine_size`,
        {
          headers: {
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'apikey': SERVICE_KEY
          }
        }
      );

      if (vehiclesResponse.ok) {
        try {
          const batchVehicles = await vehiclesResponse.json();
          if (batchVehicles && Array.isArray(batchVehicles) && batchVehicles.length > 0) {
            vehicles.push(batchVehicles[0]);
            vehicleMap.set(vid, batchVehicles[0]);
          } else if (batchVehicles && !Array.isArray(batchVehicles)) {
            // Single object response
            vehicles.push(batchVehicles);
            vehicleMap.set(vid, batchVehicles);
          }
        } catch (parseError) {
          console.error(`Error parsing vehicle ${vid}:`, parseError.message);
        }
      } else {
        const errorText = await vehiclesResponse.text();
        console.error(`Failed to fetch vehicle ${vid}: ${vehiclesResponse.status} - ${errorText.substring(0, 100)}`);
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // Get image counts
    const imageCounts = {};
    for (const vid of vehicleIds.slice(0, 30)) {
      const imagesResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/vehicle_images?select=id&vehicle_id=eq.${vid}&limit=1`,
        {
          headers: {
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'apikey': SERVICE_KEY,
            'Range': '0-0'
          }
        }
      );
      
      if (imagesResponse.ok) {
        const header = imagesResponse.headers.get('content-range');
        if (header && header.includes('/')) {
          const count = parseInt(header.split('/')[1]) || 0;
          imageCounts[vid] = count;
        } else {
          // Fallback: count actual results
          const images = await imagesResponse.json();
          imageCounts[vid] = images ? images.length : 0;
        }
      } else {
        imageCounts[vid] = 0;
      }
      
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // Analyze missing data
    const stats = {
      total: vehicles.length,
      missing_vin: 0,
      missing_mileage: 0,
      missing_color: 0,
      missing_transmission: 0,
      missing_engine: 0,
      no_images: 0,
      few_images: 0
    };

    console.log('📋 Profile Details (First 20):\n');

    vehicles.slice(0, 20).forEach(v => {
      const hasVin = v.vin && v.vin !== '';
      const hasMileage = v.mileage !== null && v.mileage !== undefined;
      const hasColor = v.color && v.color !== '';
      const hasTransmission = v.transmission && v.transmission !== '';
      const hasEngine = v.engine_size && v.engine_size !== '';
      const imageCount = imageCounts[v.id] || 0;
      const hasImages = imageCount > 0;

      if (!hasVin) stats.missing_vin++;
      if (!hasMileage) stats.missing_mileage++;
      if (!hasColor) stats.missing_color++;
      if (!hasTransmission) stats.missing_transmission++;
      if (!hasEngine) stats.missing_engine++;
      if (!hasImages) stats.no_images++;
      else if (imageCount < 10) stats.few_images++;

      const missing = [];
      if (!hasVin) missing.push('VIN');
      if (!hasMileage) missing.push('Mileage');
      if (!hasColor) missing.push('Color');
      if (!hasTransmission) missing.push('Transmission');
      if (!hasEngine) missing.push('Engine');
      if (!hasImages) missing.push('Images');
      else if (imageCount < 10) missing.push(`Only ${imageCount} images`);

      console.log(`${v.year || '?'} ${v.make || '?'} ${v.model || '?'}`);
      console.log(`  ID: ${v.id.substring(0, 8)}...`);
      console.log(`  ${hasVin ? '✅' : '❌'} VIN: ${v.vin || 'MISSING'}`);
      console.log(`  ${hasMileage ? '✅' : '❌'} Mileage: ${v.mileage || 'MISSING'}`);
      console.log(`  ${hasColor ? '✅' : '❌'} Color: ${v.color || 'MISSING'}`);
      console.log(`  ${hasTransmission ? '✅' : '❌'} Transmission: ${v.transmission || 'MISSING'}`);
      console.log(`  ${hasEngine ? '✅' : '❌'} Engine: ${v.engine_size || 'MISSING'}`);
      console.log(`  ${hasImages ? (imageCount >= 10 ? '✅' : '⚠️') : '❌'} Images: ${imageCount}`);
      if (missing.length > 0) {
        console.log(`  ⚠️  Missing: ${missing.join(', ')}`);
      }
      console.log('');
    });

    // Summary
    console.log('═══════════════════════════════════════════════════════');
    console.log('   Missing Data Summary');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`Total profiles checked: ${stats.total}`);
    console.log(`Missing VIN: ${stats.missing_vin} (${Math.round(stats.missing_vin * 100 / stats.total)}%)`);
    console.log(`Missing Mileage: ${stats.missing_mileage} (${Math.round(stats.missing_mileage * 100 / stats.total)}%)`);
    console.log(`Missing Color: ${stats.missing_color} (${Math.round(stats.missing_color * 100 / stats.total)}%)`);
    console.log(`Missing Transmission: ${stats.missing_transmission} (${Math.round(stats.missing_transmission * 100 / stats.total)}%)`);
    console.log(`Missing Engine: ${stats.missing_engine} (${Math.round(stats.missing_engine * 100 / stats.total)}%)`);
    console.log(`No Images: ${stats.no_images} (${Math.round(stats.no_images * 100 / stats.total)}%)`);
    console.log(`Few Images (<10): ${stats.few_images} (${Math.round(stats.few_images * 100 / stats.total)}%)`);
    console.log('');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkMissingData();

