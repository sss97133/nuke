#!/usr/bin/env node

/**
 * Map existing origin_metadata to vehicle columns
 * For vehicles that have data in metadata but not in columns
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

function extractFromMetadata(metadata, vehicle) {
  const updates = {};
  const metadataKeys = Object.keys(metadata || {});
  
  // Try to extract color
  if (!vehicle.color) {
    const colorKeys = ['color', 'exterior_color', 'paint', 'paint_color'];
    for (const key of colorKeys) {
      if (metadata[key]) {
        updates.color = String(metadata[key]).trim();
        break;
      }
    }
  }
  
  // Try to extract mileage
  if (!vehicle.mileage) {
    const mileageKeys = ['mileage', 'odometer', 'miles', 'odometer_reading'];
    for (const key of mileageKeys) {
      const value = metadata[key];
      if (value) {
        const num = typeof value === 'string' ? parseInt(value.replace(/[^0-9]/g, '')) : value;
        if (num && num > 0 && num < 10000000) {
          updates.mileage = num;
          break;
        }
      }
    }
  }
  
  // Try to extract transmission
  if (!vehicle.transmission) {
    const transKeys = ['transmission', 'trans', 'transmission_type'];
    for (const key of transKeys) {
      if (metadata[key]) {
        updates.transmission = String(metadata[key]).trim();
        break;
      }
    }
  }
  
  // Try to extract drivetrain
  if (!vehicle.drivetrain) {
    const driveKeys = ['drivetrain', 'drive', 'drive_type', 'drive_train'];
    for (const key of driveKeys) {
      if (metadata[key]) {
        updates.drivetrain = String(metadata[key]).trim();
        break;
      }
    }
  }
  
  // Try to extract engine
  if (!vehicle.engine_size) {
    const engineKeys = ['engine', 'engine_size', 'engine_type', 'motor'];
    for (const key of engineKeys) {
      if (metadata[key]) {
        updates.engine_size = String(metadata[key]).trim();
        break;
      }
    }
  }
  
  return updates;
}

async function mapMetadataToColumns() {
  console.log('='.repeat(70));
  console.log('🗺️  MAPPING METADATA TO COLUMNS');
  console.log('='.repeat(70));
  console.log('');

  // Find vehicles with metadata but missing fields
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, color, mileage, transmission, drivetrain, engine_size, origin_metadata')
    .eq('status', 'active')
    .not('origin_metadata', 'is', null)
    .or('vin.is.null,color.is.null,mileage.is.null,transmission.is.null,drivetrain.is.null,engine_size.is.null')
    .limit(1000);

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  console.log(`Found ${vehicles?.length || 0} vehicles with metadata to check\n`);

  const results = {
    mapped: 0,
    updated: 0,
    skipped: 0,
    errors: []
  };

  for (const vehicle of vehicles || []) {
    try {
      const metadata = vehicle.origin_metadata || {};
      const updates = extractFromMetadata(metadata, vehicle);
      
      if (Object.keys(updates).length === 0) {
        results.skipped++;
        continue;
      }
      
      results.mapped++;
      
      // Update vehicle
      const { error: updateError } = await supabase
        .from('vehicles')
        .update(updates)
        .eq('id', vehicle.id);
      
      if (updateError) {
        results.errors.push(`${vehicle.id}: ${updateError.message}`);
      } else {
        results.updated++;
        console.log(`✅ ${vehicle.year} ${vehicle.make} ${vehicle.model}: Mapped ${Object.keys(updates).join(', ')}`);
      }
    } catch (error) {
      results.errors.push(`${vehicle.id}: ${error.message}`);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('📊 RESULTS:');
  console.log('='.repeat(70));
  console.log(`   Mapped: ${results.mapped}`);
  console.log(`   Updated: ${results.updated}`);
  console.log(`   Skipped: ${results.skipped}`);
  console.log(`   Errors: ${results.errors.length}`);
  
  if (results.errors.length > 0) {
    console.log('\n   First 5 errors:');
    results.errors.slice(0, 5).forEach(err => console.log(`     - ${err}`));
  }
  
  console.log('');
}

mapMetadataToColumns().then(() => {
  console.log('✅ Mapping complete');
  process.exit(0);
}).catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});

