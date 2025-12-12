#!/usr/bin/env node

/**
 * Fix all vehicles with bad model names
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
  console.log('🔧 Fixing all vehicles with bad model names...\n');
  
  // Get vehicles with bad models
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .eq('status', 'active')
    .eq('is_public', true)
    .or('model.like.%$%,model.like.%(Est.%,model.like.%BUY HERE%,model.like.%Call%,model.like.%SKU:%,model.like.%on BaT%,model.like.%Lot #%')
    .limit(500);
  
  if (error) {
    console.error('❌ Failed to fetch vehicles:', error.message);
    process.exit(1);
  }
  
  if (!vehicles || vehicles.length === 0) {
    console.log('✅ No vehicles with bad models found');
    return;
  }
  
  console.log(`📋 Found ${vehicles.length} vehicles with bad models\n`);
  
  let fixed = 0;
  let failed = 0;
  
  for (const vehicle of vehicles) {
    const cleanedModel = cleanModelName(vehicle.model);
    const fixedMake = fixMake(vehicle.make, vehicle.model);
    
    if (cleanedModel !== vehicle.model || fixedMake !== vehicle.make) {
      const updates = {};
      if (cleanedModel !== vehicle.model) {
        updates.model = cleanedModel;
      }
      if (fixedMake !== vehicle.make) {
        updates.make = fixedMake;
      }
      
      const { error: updateError } = await supabase
        .from('vehicles')
        .update(updates)
        .eq('id', vehicle.id);
      
      if (updateError) {
        console.error(`❌ Failed to fix ${vehicle.id}: ${updateError.message}`);
        failed++;
      } else {
        console.log(`✅ Fixed: ${vehicle.year} ${vehicle.make} "${vehicle.model}" → "${cleanedModel}"`);
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













