#!/usr/bin/env node

/**
 * Re-scrape BaT Vehicle
 * 
 * Re-scrapes a specific BaT vehicle to extract all missing data
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

async function reScrapeVehicle(vehicleId) {
  console.log(`\n🔍 Re-scraping vehicle ${vehicleId}...`);

  // Get vehicle
  const { data: vehicle, error: fetchError } = await supabase
    .from('vehicles')
    .select('id, discovery_url, year, make, model')
    .eq('id', vehicleId)
    .single();

  if (fetchError || !vehicle) {
    console.error(`❌ Vehicle not found: ${fetchError?.message}`);
    return;
  }

  if (!vehicle.discovery_url) {
    console.error(`❌ No discovery_url for vehicle`);
    return;
  }

  console.log(`   URL: ${vehicle.discovery_url}`);
  console.log(`   Current: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);

  // Use AI extraction for comprehensive data extraction
  console.log(`\n   🤖 Using AI extraction...`);
  const { data: aiData, error: aiError } = await supabase.functions.invoke('extract-vehicle-data-ai', {
    body: { url: vehicle.discovery_url }
  });

  if (aiError || !aiData?.success) {
    console.error(`   ❌ AI extraction failed: ${aiError?.message || 'Unknown error'}`);
    return;
  }

  const extracted = aiData.data;
  console.log(`   ✅ AI extraction complete`);
  console.log(`      - Description: ${extracted.description ? extracted.description.substring(0, 100) + '...' : 'MISSING'}`);
  console.log(`      - Mileage: ${extracted.mileage || 'MISSING'}`);
  console.log(`      - Price: ${extracted.asking_price ? '$' + extracted.asking_price.toLocaleString() : 'MISSING'}`);
  console.log(`      - Color: ${extracted.color || extracted.exterior_color || 'MISSING'}`);
  console.log(`      - Engine: ${extracted.engine || extracted.engine_type || 'MISSING'}`);
  console.log(`      - Transmission: ${extracted.transmission || 'MISSING'}`);
  console.log(`      - VIN: ${extracted.vin || 'MISSING'}`);
  console.log(`      - Images: ${extracted.images?.length || 0}`);

  // Update vehicle with all extracted data
  const updates = {};
  
  if (extracted.description && extracted.description.length > 10) {
    updates.description = extracted.description;
  }
  if (extracted.mileage) {
    updates.mileage = extracted.mileage;
  }
  if (extracted.asking_price && extracted.asking_price > 100) {
    updates.asking_price = extracted.asking_price;
  }
  if (extracted.color || extracted.exterior_color) {
    updates.color = extracted.color || extracted.exterior_color;
  }
  if (extracted.engine || extracted.engine_type) {
    updates.engine_type = extracted.engine || extracted.engine_type;
  }
  if (extracted.transmission) {
    updates.transmission = extracted.transmission;
  }
  if (extracted.vin && extracted.vin.length === 17) {
    updates.vin = extracted.vin;
  }
  if (extracted.location) {
    updates.location = extracted.location;
  }
  if (extracted.drivetrain) {
    updates.drivetrain = extracted.drivetrain;
  }

  if (Object.keys(updates).length > 0) {
    console.log(`\n   💾 Updating vehicle with ${Object.keys(updates).length} fields...`);
    const { error: updateError } = await supabase
      .from('vehicles')
      .update(updates)
      .eq('id', vehicleId);

    if (updateError) {
      console.error(`   ❌ Update failed: ${updateError.message}`);
      return;
    }
    console.log(`   ✅ Vehicle updated!`);
  } else {
    console.log(`   ⚠️  No new data to update`);
  }

  // Backfill images if available
  if (extracted.images && extracted.images.length > 0) {
    console.log(`\n   🖼️  Backfilling ${extracted.images.length} images...`);
    const { data: backfillResult, error: backfillError } = await supabase.functions.invoke('backfill-images', {
      body: {
        vehicle_id: vehicleId,
        image_urls: extracted.images.slice(0, 20), // Limit to 20
        source: 'ai_re_scrape',
        run_analysis: false
      }
    });

    if (backfillError) {
      console.error(`   ❌ Image backfill failed: ${backfillError.message}`);
    } else {
      console.log(`   ✅ Images backfilled: ${backfillResult?.uploaded || 0} uploaded`);
    }
  }

  // Validate and activate if ready
  console.log(`\n   🔍 Validating vehicle...`);
  const { data: validation, error: validationError } = await supabase.rpc(
    'validate_vehicle_before_public',
    { p_vehicle_id: vehicleId }
  );

  if (validationError) {
    console.error(`   ❌ Validation error: ${validationError.message}`);
    return;
  }

  if (validation && validation.can_go_live) {
    const { error: activateError } = await supabase
      .from('vehicles')
      .update({ status: 'active', is_public: true })
      .eq('id', vehicleId);

    if (activateError) {
      console.error(`   ❌ Activation failed: ${activateError.message}`);
    } else {
      console.log(`   🎉 VEHICLE ACTIVATED! (Score: ${validation.quality_score})`);
    }
  } else {
    console.log(`   ⚠️  Not ready: ${validation?.recommendation || 'Unknown'}`);
    if (validation?.issues) {
      const criticalIssues = validation.issues.filter((i) => i.type === 'error');
      if (criticalIssues.length > 0) {
        console.log(`      Critical: ${criticalIssues.map((i) => i.message).join(', ')}`);
      }
    }
  }
}

async function main() {
  const vehicleId = process.argv[2];

  if (!vehicleId) {
    console.error('Usage: node re-scrape-bat-vehicle.js <vehicle_id>');
    console.error('Example: node re-scrape-bat-vehicle.js 1a693ca9-7de7-420e-acc5-4f922ffcb383');
    process.exit(1);
  }

  await reScrapeVehicle(vehicleId);
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

