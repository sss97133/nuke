#!/usr/bin/env node
/**
 * Re-extract VIN/chassis number from a BaT vehicle listing
 * Updates the vehicle record with chassis number for vintage vehicles
 * 
 * Usage: node scripts/re-extract-vehicle-vin.js <vehicle_id>
 * Example: node scripts/re-extract-vehicle-vin.js 4e52a421-11b8-4c22-8172-254d9d14371c
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load env
const envPath = join(__dirname, '..', 'nuke_frontend', '.env.local');
let env = {};
try {
  const envFile = readFileSync(envPath, 'utf8');
  envFile.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  });
} catch (e) {
  console.warn('⚠️  Could not read .env.local, using environment variables');
}

const supabaseUrl = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

function extractVinFromBatHtml(html) {
  const h = String(html || "");
  
  // Look for Chassis numbers (vintage vehicles) - 4-16 characters
  const chassisPatterns = [
    // BaT essentials format: "<li>Chassis: 70077</li>" or "<li>Chassis: <a>70077</a></li>"
    /<li[^>]*>\s*Chassis:\s*<a[^>]*>([A-HJ-NPR-Z0-9]{4,16})<\/a>\s*<\/li>/i,
    /<li[^>]*>\s*Chassis:\s*([A-HJ-NPR-Z0-9]{4,16})\s*<\/li>/i,
    // Pattern: "chassis 70077" (in text)
    /\bchassis[:\s]+([A-HJ-NPR-Z0-9]{4,16})\b/i,
    // Pattern: "Chassis No: 70077" or "Chassis Number: 70077"
    /(?:chassis|chassis\s*no|chassis\s*number)[:\s]+([A-HJ-NPR-Z0-9]{4,16})\b/i,
  ];
  
  for (const pattern of chassisPatterns) {
    const match = h.match(pattern);
    if (match?.[1]) {
      const chassis = match[1].toUpperCase().trim();
      // Validate: 4-16 chars, no I, O, Q
      if (chassis.length >= 4 && chassis.length <= 16 && /^[A-HJ-NPR-Z0-9]{4,16}$/.test(chassis)) {
        return chassis;
      }
    }
  }
  
  // Also check for modern VINs (17 characters)
  const vinPatterns = [
    /(?:vin|vehicle\s*identification)[:\s#]+([A-HJ-NPR-Z0-9]{17})\b/i,
    /\bvin[:\s#]+([A-HJ-NPR-Z0-9]{17})\b/i,
  ];
  
  for (const pattern of vinPatterns) {
    const match = h.match(pattern);
    if (match?.[1]) {
      const vin = match[1].toUpperCase().trim();
      if (vin.length === 17 && /^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
        return vin;
      }
    }
  }
  
  return null;
}

async function main() {
  const vehicleId = process.argv[2];

  if (!vehicleId) {
    console.error('❌ Missing vehicle_id argument');
    console.error('');
    console.error('Usage: node scripts/re-extract-vehicle-vin.js <vehicle_id>');
    console.error('Example: node scripts/re-extract-vehicle-vin.js 4e52a421-11b8-4c22-8172-254d9d14371c');
    process.exit(1);
  }

  console.log(`🎯 Re-extracting VIN/Chassis for vehicle: ${vehicleId}\n`);

  try {
    // Get vehicle info
    const { data: vehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .select('id, year, make, model, vin, bat_auction_url, discovery_url')
      .eq('id', vehicleId)
      .single();

    if (vehicleError || !vehicle) {
      console.error(`❌ Vehicle not found: ${vehicleError?.message || 'not found'}`);
      process.exit(1);
    }

    console.log(`Vehicle: ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}`);
    console.log(`Current VIN: ${vehicle.vin || 'NULL'}\n`);

    const batUrl = vehicle.bat_auction_url || vehicle.discovery_url;
    if (!batUrl || !batUrl.includes('bringatrailer.com')) {
      console.error('❌ Vehicle does not have a BaT URL');
      process.exit(1);
    }

    console.log(`Fetching BaT page: ${batUrl}\n`);

    // Fetch the BaT page
    const response = await fetch(batUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      console.error(`❌ Failed to fetch BaT page: HTTP ${response.status}`);
      process.exit(1);
    }

    const html = await response.text();
    console.log(`✅ Fetched HTML (${html.length} chars)\n`);

    // Extract VIN/chassis
    const vinOrChassis = extractVinFromBatHtml(html);

    if (!vinOrChassis) {
      console.log('⚠️  No VIN or chassis number found in HTML');
      console.log('   (This is normal for some vintage vehicles or incomplete listings)\n');
      process.exit(0);
    }

    console.log(`✅ Found ${vinOrChassis.length === 17 ? 'VIN' : 'chassis number'}: ${vinOrChassis}\n`);

    // Update vehicle
    const { error: updateError } = await supabase
      .from('vehicles')
      .update({ vin: vinOrChassis, updated_at: new Date().toISOString() })
      .eq('id', vehicleId);

    if (updateError) {
      console.error(`❌ Failed to update vehicle: ${updateError.message}`);
      process.exit(1);
    }

    console.log(`✅ Successfully updated vehicle with ${vinOrChassis.length === 17 ? 'VIN' : 'chassis number'}: ${vinOrChassis}`);
    process.exit(0);
  } catch (err) {
    console.error(`\n❌ Failed: ${err.message}`);
    process.exit(1);
  }
}

main().catch(console.error);

