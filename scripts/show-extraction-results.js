#!/usr/bin/env node
/**
 * Show clear before/after extraction results
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });
dotenv.config({ path: join(__dirname, '../.env.local') });

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);
const vehicleId = process.argv[2] || '69f35ba1-00d3-4b63-8406-731d226c45e1';

async function showResults() {
  const { data: vehicle, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, mileage, color, transmission, engine_size, drivetrain, description, origin_metadata, updated_at')
    .eq('id', vehicleId)
    .single();

  if (error) {
    console.error('❌ Error:', error.message);
    return;
  }

  console.log('\n📊 CURRENT VEHICLE DATA:\n');
  console.log(`Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  console.log(`Last Updated: ${vehicle.updated_at}`);
  console.log('\n🔍 MISSING FIELDS (what LLM should extract):');
  console.log(`   VIN: ${vehicle.vin || '❌ MISSING'}`);
  console.log(`   Mileage: ${vehicle.mileage || '❌ MISSING'}`);
  console.log(`   Color: ${vehicle.color || '❌ MISSING'}`);
  console.log(`   Transmission: ${vehicle.transmission || '❌ MISSING'}`);
  console.log(`   Engine: ${vehicle.engine_size || '❌ MISSING'}`);
  console.log(`   Drivetrain: ${vehicle.drivetrain || '❌ MISSING'}`);
  
  if (vehicle.origin_metadata) {
    const om = vehicle.origin_metadata;
    console.log('\n📦 ORIGIN METADATA:');
    console.log(`   Images: ${Array.isArray(om.images) ? om.images.length : 0}`);
    console.log(`   Structured sections: ${Object.keys(om.structured_sections || {}).length}`);
    if (om.structured_sections) {
      const sections = Object.keys(om.structured_sections);
      if (sections.length > 0) {
        console.log(`   Sections: ${sections.join(', ')}`);
      }
    }
  }
  
  console.log('\n💡 WHAT LLM EXTRACTION DOES:');
  console.log('   - Analyzes HTML to find missing fields');
  console.log('   - Extracts: mileage, color, transmission, engine_size, vin');
  console.log('   - Only runs if fields are missing (to save cost)');
  console.log('   - Uses gpt-4o-mini (cheap, ~$0.01 per extraction)');
  console.log('\n');
}

showResults();

