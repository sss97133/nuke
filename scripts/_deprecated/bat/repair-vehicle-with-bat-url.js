#!/usr/bin/env node

/**
 * Quick repair script - extracts all BaT data for a vehicle when you have the BaT URL
 * Usage: node scripts/repair-vehicle-with-bat-url.js <vehicle_id> <bat_url>
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load env
const envPaths = [
  join(__dirname, '..', 'nuke_frontend', '.env.local'),
  join(__dirname, '..', '.env.local'),
];

for (const envPath of envPaths) {
  try {
    const envFile = readFileSync(envPath, 'utf8');
    envFile.split('\n').forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
      }
    });
    break;
  } catch (error) {
    // Try next path
  }
}

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.error('SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY not set');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const vehicleId = process.argv[2];
  const batUrl = process.argv[3];

  if (!vehicleId || !batUrl) {
    console.error('Usage: node scripts/repair-vehicle-with-bat-url.js <vehicle_id> <bat_url>');
    process.exit(1);
  }

  console.log(`Repairing vehicle ${vehicleId} with BaT URL: ${batUrl}\n`);

  // Verify vehicle exists
  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .eq('id', vehicleId)
    .single();

  if (vehicleError || !vehicle) {
    console.error('❌ Vehicle not found:', vehicleError?.message);
    process.exit(1);
  }

  console.log(`Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);

  // Step 0: Ensure URL-based extractors target THIS vehicle row
  console.log(`\nStep 0: Attaching BaT URL to this vehicle...`);
  try {
    const { error: attachErr } = await supabase
      .from('vehicles')
      .update({
        discovery_url: batUrl,
        listing_url: batUrl,
        bat_auction_url: batUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', vehicleId);
    if (attachErr) {
      console.warn('Could not attach URL (non-fatal):', attachErr.message);
    }
  } catch (error) {
    console.warn('Could not attach URL (non-fatal):', error.message);
  }

  // Step 1: Core extraction (approved)
  console.log(`\nStep 1: Extracting core data (VIN/specs/images/auction metadata)...`);
  try {
    const { data: extractData, error: extractError } = await supabase.functions.invoke('extract-bat-core', {
      body: { url: batUrl, vehicle_id: vehicleId, prefer_snapshot: true }
    });

    if (extractError) {
      console.error('Core extraction error:', extractError);
    } else if (extractData?.success) {
      console.log('Core extraction completed');
      const extractedVehicleId = extractData?.created_vehicle_ids?.[0] || extractData?.updated_vehicle_ids?.[0] || null;
      if (extractedVehicleId && extractedVehicleId !== vehicleId) {
        console.warn(`Note: extractor updated/created a different vehicle_id: ${extractedVehicleId}`);
      }
    } else {
      console.warn('Core extraction returned:', extractData);
    }
  } catch (error) {
    console.error('Error extracting core data:', error.message);
  }

  // Step 2: Comments/bids (approved, best-effort)
  console.log(`\nStep 2: Extracting comments and bids (best-effort)...`);
  try {
    const { data: commentsData, error: commentsError } = await supabase.functions.invoke('extract-auction-comments', {
      body: { auction_url: batUrl, vehicle_id: vehicleId }
    });

    if (commentsError) {
      console.warn('Comments/bids extraction error (non-fatal):', commentsError.message || commentsError);
    } else {
      console.log('Comments/bids step returned:', {
        comments_extracted: commentsData?.comments_extracted ?? commentsData?.comments ?? null,
        bids_extracted: commentsData?.bids_extracted ?? commentsData?.bids ?? null,
      });
    }
  } catch (error) {
    console.warn('Comments/bids extraction failed (non-fatal):', error.message);
  }

  // Step 3: Verify the data
  console.log(`\nStep 3: Verifying extracted data...`);
  const { data: updatedVehicle, error: verifyError } = await supabase
    .from('vehicles')
    .select(`
      *,
      vehicle_images(count),
      timeline_events(count)
    `)
    .eq('id', vehicleId)
    .single();

  if (!verifyError && updatedVehicle) {
    console.log('\nFinal vehicle data:');
    console.log(`   BaT URL: ${updatedVehicle.bat_auction_url || 'None'}`);
    console.log(`   VIN: ${updatedVehicle.vin || 'None'}`);
    console.log(`   Mileage: ${updatedVehicle.mileage || 'None'}`);
    console.log(`   Engine: ${updatedVehicle.engine_size || 'None'}`);
    console.log(`   Transmission: ${updatedVehicle.transmission || 'None'}`);
    console.log(`   Color: ${updatedVehicle.color || 'None'}`);
    console.log(`   Sale Price: ${updatedVehicle.sale_price ? `$${updatedVehicle.sale_price.toLocaleString()}` : 'None'}`);
    console.log(`   Bid Count: ${updatedVehicle.bat_bids || 'None'}`);
    console.log(`   Comment Count: ${updatedVehicle.bat_comments || 'None'}`);
    console.log(`   Images: ${updatedVehicle.vehicle_images?.[0]?.count || 0}`);
    console.log(`   Timeline Events: ${updatedVehicle.timeline_events?.[0]?.count || 0}`);
    console.log(`   Description: ${updatedVehicle.description ? `${updatedVehicle.description.substring(0, 100)}...` : 'None'}`);
  } else {
    console.error('Error verifying data:', verifyError?.message);
  }

  console.log('\nRepair complete');
}

main().catch(console.error);

