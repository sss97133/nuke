#!/usr/bin/env node

/**
 * Fix all vehicles with bad make names
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

function fixMake(make, model, title) {
  const makeLower = make.toLowerCase();
  const modelLower = model?.toLowerCase() || '';
  const titleLower = title?.toLowerCase() || '';
  
  // Fix "This" make
  if (makeLower === 'this' && (titleLower.includes('lincoln') || modelLower.includes('lincoln'))) {
    return 'Lincoln';
  }
  
  // Fix "El" make (El Camino)
  if (makeLower === 'el' && (modelLower.includes('camino') || titleLower.includes('camino'))) {
    return 'Chevrolet';
  }
  
  // Fix mileage descriptors as make
  if (makeLower.match(/^\d+k-?mile$/)) {
    // Extract from title
    const yearMatch = title?.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
      const afterYear = title.substring(title.indexOf(yearMatch[0]) + 4).trim();
      const knownMakes = ['chevrolet', 'chevy', 'ford', 'gmc', 'dodge', 'ram', 'toyota', 'honda', 'nissan', 'bmw', 'mercedes', 'benz', 'audi', 'volkswagen', 'vw', 'porsche', 'jaguar', 'cadillac', 'buick', 'pontiac', 'lincoln', 'chrysler', 'lexus', 'acura', 'infiniti', 'mazda', 'subaru', 'mitsubishi', 'hyundai', 'kia', 'volvo', 'tesla', 'genesis', 'alfa', 'romeo', 'fiat', 'mini', 'ferrari', 'lamborghini', 'mclaren', 'aston', 'martin', 'bentley', 'rolls', 'royce', 'datsun', 'mercury', 'jeep', 'suzuki'];
      const afterYearLower = afterYear.toLowerCase();
      for (const knownMake of knownMakes) {
        if (afterYearLower.startsWith(knownMake + ' ')) {
          return knownMake === 'chevy' ? 'Chevrolet' : knownMake === 'vw' ? 'Volkswagen' : knownMake.charAt(0).toUpperCase() + knownMake.slice(1);
        }
      }
    }
  }
  
  // Fix "Original-owner", "Single-family-owned" etc.
  if (makeLower.includes('owner') || makeLower.includes('owned')) {
    const yearMatch = title?.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
      const afterYear = title.substring(title.indexOf(yearMatch[0]) + 4).trim();
      const knownMakes = ['chevrolet', 'chevy', 'ford', 'gmc', 'dodge', 'ram', 'toyota', 'honda', 'nissan', 'bmw', 'mercedes', 'benz', 'audi', 'volkswagen', 'vw', 'porsche', 'jaguar', 'cadillac', 'buick', 'pontiac', 'lincoln', 'chrysler', 'lexus', 'acura', 'infiniti', 'mazda', 'subaru', 'mitsubishi', 'hyundai', 'kia', 'volvo', 'tesla', 'genesis', 'alfa', 'romeo', 'fiat', 'mini', 'ferrari', 'lamborghini', 'mclaren', 'aston', 'martin', 'bentley', 'rolls', 'royce', 'datsun', 'mercury', 'jeep', 'suzuki'];
      const afterYearLower = afterYear.toLowerCase();
      for (const knownMake of knownMakes) {
        if (afterYearLower.startsWith(knownMake + ' ')) {
          return knownMake === 'chevy' ? 'Chevrolet' : knownMake === 'vw' ? 'Volkswagen' : knownMake.charAt(0).toUpperCase() + knownMake.slice(1);
        }
      }
    }
  }
  
  // Fix color as make
  const colors = ['red', 'black', 'white', 'blue', 'green', 'yellow', 'gray', 'grey', 'silver'];
  if (colors.includes(makeLower)) {
    const yearMatch = title?.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
      const afterYear = title.substring(title.indexOf(yearMatch[0]) + 4).trim();
      const knownMakes = ['chevrolet', 'chevy', 'ford', 'gmc', 'dodge', 'ram', 'toyota', 'honda', 'nissan', 'bmw', 'mercedes', 'benz', 'audi', 'volkswagen', 'vw', 'porsche', 'jaguar', 'cadillac', 'buick', 'pontiac', 'lincoln', 'chrysler', 'lexus', 'acura', 'infiniti', 'mazda', 'subaru', 'mitsubishi', 'hyundai', 'kia', 'volvo', 'tesla', 'genesis', 'alfa', 'romeo', 'fiat', 'mini', 'ferrari', 'lamborghini', 'mclaren', 'aston', 'martin', 'bentley', 'rolls', 'royce', 'datsun', 'mercury', 'jeep', 'suzuki'];
      const afterYearLower = afterYear.toLowerCase();
      for (const knownMake of knownMakes) {
        if (afterYearLower.startsWith(knownMake + ' ')) {
          return knownMake === 'chevy' ? 'Chevrolet' : knownMake === 'vw' ? 'Volkswagen' : knownMake.charAt(0).toUpperCase() + knownMake.slice(1);
        }
      }
    }
  }
  
  return make;
}

async function main() {
  console.log('🔧 Fixing all vehicles with bad make names...\n');
  
  // Get vehicles with bad makes
  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url')
    .eq('status', 'active')
    .eq('is_public', true)
    .in('make', ['This', 'El', 'Red', 'Beautiful', 'Supercharged', 'All', '6k-mile', '10k-mile', '18k-mile', '47k-mile', 'Original-owner', 'Single-family-owned', '20-years-owned', '502-powered'])
    .limit(500);
  
  if (error) {
    console.error('❌ Failed to fetch vehicles:', error.message);
    process.exit(1);
  }
  
  if (!vehicles || vehicles.length === 0) {
    console.log('✅ No vehicles with bad makes found');
    return;
  }
  
  console.log(`📋 Found ${vehicles.length} vehicles with bad makes\n`);
  
  let fixed = 0;
  let failed = 0;
  
  for (const vehicle of vehicles) {
    const fixedMake = fixMake(vehicle.make, vehicle.model, vehicle.discovery_url);
    
    if (fixedMake !== vehicle.make) {
      const { error: updateError } = await supabase
        .from('vehicles')
        .update({ make: fixedMake })
        .eq('id', vehicle.id);
      
      if (updateError) {
        console.error(`❌ Failed to fix ${vehicle.id}: ${updateError.message}`);
        failed++;
      } else {
        console.log(`✅ Fixed: ${vehicle.year} "${vehicle.make}" → "${fixedMake}" ${vehicle.model}`);
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















