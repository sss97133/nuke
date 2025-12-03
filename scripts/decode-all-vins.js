#!/usr/bin/env node
/**
 * Batch VIN Decoder
 * 
 * Decodes all vehicle VINs using NHTSA VPIC API
 * and stores canonical data in vin_decoded_data table
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '../nuke_frontend/.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const NHTSA_BASE = 'https://vpic.nhtsa.dot.gov/api/vehicles';

// Stats
const stats = {
  total: 0,
  decoded: 0,
  errors: 0,
  skipped: 0,
};

/**
 * Decode a single VIN using NHTSA VPIC API
 */
async function decodeVIN(vin) {
  const url = `${NHTSA_BASE}/DecodeVinValues/${encodeURIComponent(vin)}?format=json`;
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`NHTSA API error: ${response.status}`);
  }
  
  const data = await response.json();
  const results = data.Results?.[0];
  
  if (!results) {
    throw new Error('No results from NHTSA');
  }
  
  // Check for decode errors
  const errorCode = results.ErrorCode;
  if (errorCode && errorCode !== '0') {
    // Some error codes are warnings, not failures
    const criticalErrors = ['1', '3', '4', '5', '11'];
    if (criticalErrors.some(e => errorCode.includes(e))) {
      throw new Error(`NHTSA decode error: ${results.ErrorText}`);
    }
  }
  
  // Map NHTSA response to our schema
  return {
    vin: vin.toUpperCase(),
    make: results.Make || null,
    model: results.Model || null,
    year: parseInt(results.ModelYear) || null,
    trim: results.Trim || null,
    body_type: results.BodyClass || null,
    doors: parseInt(results.Doors) || null,
    engine_size: results.EngineModel || null,
    engine_cylinders: parseInt(results.EngineCylinders) || null,
    engine_displacement_liters: results.DisplacementL || null,
    fuel_type: results.FuelTypePrimary || null,
    transmission: results.TransmissionStyle || null,
    drivetrain: mapDrivetrain(results.DriveType),
    manufacturer: results.Manufacturer || null,
    plant_city: results.PlantCity || null,
    plant_country: results.PlantCountry || null,
    vehicle_type: results.VehicleType || null,
    provider: 'nhtsa',
    confidence: calculateConfidence(results),
    raw_response: results,
  };
}

/**
 * Map NHTSA drivetrain to our standard values
 */
function mapDrivetrain(nhtsa) {
  if (!nhtsa) return null;
  
  const lower = nhtsa.toLowerCase();
  if (lower.includes('4x4') || lower.includes('4wd') || lower.includes('four wheel')) return '4WD';
  if (lower.includes('awd') || lower.includes('all wheel')) return 'AWD';
  if (lower.includes('rwd') || lower.includes('rear wheel')) return 'RWD';
  if (lower.includes('fwd') || lower.includes('front wheel')) return 'FWD';
  if (lower.includes('2wd') || lower.includes('two wheel')) return '2WD';
  
  return nhtsa; // Return original if no match
}

/**
 * Calculate confidence score based on how many fields were decoded
 */
function calculateConfidence(results) {
  const criticalFields = ['Make', 'Model', 'ModelYear'];
  const importantFields = ['BodyClass', 'DriveType', 'EngineCylinders', 'TransmissionStyle'];
  
  let score = 0;
  
  // Critical fields worth 20 each
  criticalFields.forEach(f => {
    if (results[f]) score += 20;
  });
  
  // Important fields worth 10 each
  importantFields.forEach(f => {
    if (results[f]) score += 10;
  });
  
  return Math.min(100, score);
}

/**
 * Store decoded VIN data in database
 */
async function storeDecodedVIN(decoded) {
  const { error } = await supabase
    .from('vin_decoded_data')
    .upsert(decoded, { onConflict: 'vin' });
  
  if (error) {
    throw new Error(`Database error: ${error.message}`);
  }
}

/**
 * Get all VINs that need decoding
 */
async function getVINsToProcess() {
  const { data, error } = await supabase
    .from('vehicles_needing_vin_decode')
    .select('vin, decode_type')
    .order('decode_type', { ascending: false }); // Full decode first
  
  if (error) {
    throw new Error(`Error fetching VINs: ${error.message}`);
  }
  
  return data || [];
}

/**
 * Main processing function
 */
async function main() {
  console.log('🔍 VIN BATCH DECODER\n');
  console.log('='.repeat(50));
  
  // Get VINs to process
  const vins = await getVINsToProcess();
  stats.total = vins.length;
  
  console.log(`Found ${stats.total} VINs to decode\n`);
  
  if (stats.total === 0) {
    console.log('No VINs need decoding. All done!');
    return;
  }
  
  // Process each VIN
  for (let i = 0; i < vins.length; i++) {
    const { vin, decode_type } = vins[i];
    
    process.stdout.write(`[${i + 1}/${stats.total}] ${vin} (${decode_type})... `);
    
    try {
      const decoded = await decodeVIN(vin);
      await storeDecodedVIN(decoded);
      
      console.log(`✓ ${decoded.year} ${decoded.make} ${decoded.model || '(no model)'} [${decoded.drivetrain || '?'}]`);
      stats.decoded++;
      
    } catch (err) {
      console.log(`✗ ${err.message}`);
      stats.errors++;
    }
    
    // Rate limit - NHTSA recommends max 5 requests/second
    await new Promise(r => setTimeout(r, 250));
  }
  
  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('SUMMARY');
  console.log('='.repeat(50));
  console.log(`Total VINs:    ${stats.total}`);
  console.log(`Decoded:       ${stats.decoded}`);
  console.log(`Errors:        ${stats.errors}`);
  console.log('='.repeat(50));
  
  // Now show conflicts
  console.log('\n📊 Checking for data conflicts...\n');
  
  const { data: conflicts } = await supabase
    .rpc('get_vin_conflict_summary');
  
  if (conflicts) {
    console.log('Vehicles with VIN conflicts:', conflicts);
  }
}

main().catch(console.error);

