#!/usr/bin/env node

/**
 * Fix vehicles with contaminated identity fields from scraped listings:
 * - Clean `model` when it contains listing boilerplate (BaT, dealers, pricing, etc.)
 * - Clean `trim` when it contains listing boilerplate (common when title parsing is naive)
 * - Backfill `transmission` from origin_metadata when present (e.g. BaT imports)
 *
 * Notes:
 * - Requires SUPABASE_SERVICE_ROLE_KEY for writes
 * - Does NOT scrape/re-fetch listings; this is a safe text cleanup pass
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

function cleanModelName(model) {
  if (!model) return '';
  
  let cleaned = model.trim();
  
  // Remove pricing patterns
  cleaned = cleaned.replace(/\s*-\s*\$[\d,]+(?:\.\d{2})?/g, '');
  cleaned = cleaned.replace(/\s*\(\s*Est\.\s*payment\s*OAC[^)]*\)/gi, '');
  
  // Remove dealer info
  cleaned = cleaned.replace(/\s*\([^)]*call[^)]*\)/gi, '');
  cleaned = cleaned.replace(/\s*\([^)]*\(?\d{3}\)?\s*[\d-]+\s*\)/g, '');
  cleaned = cleaned.replace(/\s*\([A-Z][a-z]+\s*[A-Z][a-z]+(?:\s*[A-Z][a-z]+)?\)/g, '');
  
  // Remove financing text
  cleaned = cleaned.replace(/\s*\([^)]*financ[^)]*\)/gi, '');
  cleaned = cleaned.replace(/\s*\([^)]*credit[^)]*\)/gi, '');
  cleaned = cleaned.replace(/\s*\([^)]*buy\s+here[^)]*\)/gi, '');
  
  // Remove SKU/stock numbers
  cleaned = cleaned.replace(/\s*SKU\s*:\s*\w+/gi, '');
  cleaned = cleaned.replace(/\s*Stock\s*#?\s*:\s*\w+/gi, '');
  
  // Remove BaT platform text
  cleaned = cleaned.replace(/\s*on\s*BaT\s*Auctions?\s*-?\s*ending[^|]*/gi, '');
  cleaned = cleaned.replace(/\s*\(Lot\s*#?\s*[\d,]+\)/gi, '');
  cleaned = cleaned.replace(/\s*\|\s*Bring\s*a\s*Trailer/gi, '');
  cleaned = cleaned.replace(/\s*\bBaT\s*Auctions?\b/gi, '');
  cleaned = cleaned.replace(/\s*\bBring\s*a\s*Trailer\b/gi, '');
  
  // Remove common descriptors
  cleaned = cleaned.replace(/\s*\b(classic|vintage|restored|clean|mint|excellent|beautiful|collector['s]?|very\s+original|with\s+only|stunning|gorgeous|more\s+your\s+money)\b/gi, '');
  
  // Remove mileage text
  cleaned = cleaned.replace(/\s*\d+[,\s]*\d*\s*miles?/gi, '');
  cleaned = cleaned.replace(/\s*only\s+\d+/gi, '');
  
  // Remove parenthetical content
  cleaned = cleaned.replace(/\s*\([^)]{20,}\)/g, '');
  
  // Clean up multiple spaces
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  return cleaned;
}

function cleanTrimName(trim) {
  if (!trim) return null;
  const cleaned = cleanModelName(trim);
  if (!cleaned) return null;
  if (cleaned.length > 60) return null;
  return cleaned;
}

function fixMake(make, model) {
  if (make === 'This' && model.toLowerCase().includes('lincoln')) {
    return 'Lincoln';
  }
  if (make === 'El' && model.toLowerCase().includes('camino')) {
    return 'Chevrolet';
  }
  return make;
}

async function main() {
  console.log('🔧 Fixing vehicles with contaminated model/trim (and backfilling transmission when possible)...\n');
  
  // Get vehicles with bad models or bad trims
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, trim, transmission, origin_metadata')
    .eq('status', 'active')
    .eq('is_public', true)
    .or([
      'model.like.%$%',
      'model.like.%(Est.%',
      'model.like.%BUY HERE%',
      'model.like.%Call%',
      'model.like.%SKU:%',
      'model.like.%on BaT%',
      'model.like.%Lot #%',
      'model.like.%Bring a Trailer%',
      'trim.like.%on BaT%',
      'trim.like.%Lot #%',
      'trim.like.%Bring a Trailer%',
      'trim.like.%ending%',
    ].join(','))
    .limit(1000);
  
  if (error) {
    console.error('❌ Failed to fetch vehicles:', error.message);
    process.exit(1);
  }
  
  if (!vehicles || vehicles.length === 0) {
    console.log('✅ No vehicles with bad models found');
    return;
  }
  
  console.log(`📋 Found ${vehicles.length} vehicles with contaminated fields\n`);
  
  let fixed = 0;
  let failed = 0;
  
  for (const vehicle of vehicles) {
    const cleanedModel = cleanModelName(vehicle.model);
    const fixedMake = fixMake(vehicle.make, vehicle.model);
    const cleanedTrim = cleanTrimName(vehicle.trim);
    const existingTransmission = vehicle.transmission ? String(vehicle.transmission).trim() : '';
    const meta = vehicle.origin_metadata || {};
    const metaTransmission = typeof meta.extracted_transmission === 'string' ? meta.extracted_transmission.trim() : '';
    
    const shouldUpdateTransmission = !existingTransmission && metaTransmission;
    const shouldUpdateModel = cleanedModel !== (vehicle.model || '');
    const shouldUpdateMake = fixedMake !== (vehicle.make || '');
    const shouldUpdateTrim = (vehicle.trim || null) !== cleanedTrim;

    if (shouldUpdateModel || shouldUpdateMake || shouldUpdateTrim || shouldUpdateTransmission) {
      const updates = {};
      if (shouldUpdateModel) {
        updates.model = cleanedModel;
      }
      if (shouldUpdateMake) {
        updates.make = fixedMake;
      }
      if (shouldUpdateTrim) {
        updates.trim = cleanedTrim;
      }
      if (shouldUpdateTransmission) {
        updates.transmission = metaTransmission;
      }
      
      const { error: updateError } = await supabase
        .from('vehicles')
        .update(updates)
        .eq('id', vehicle.id);
      
      if (updateError) {
        console.error(`❌ Failed to fix ${vehicle.id}: ${updateError.message}`);
        failed++;
      } else {
        const trimBefore = vehicle.trim ? `"${vehicle.trim}"` : 'null';
        const trimAfter = cleanedTrim ? `"${cleanedTrim}"` : 'null';
        const txNote = shouldUpdateTransmission ? ` + transmission="${metaTransmission}"` : '';
        console.log(`✅ Fixed: ${vehicle.year} ${vehicle.make} "${vehicle.model}" → "${cleanedModel}" | trim ${trimBefore} → ${trimAfter}${txNote}`);
        fixed++;
      }
    }
  }
  
  console.log(`\n✅ Complete! Fixed ${fixed}, failed ${failed}`);
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});















