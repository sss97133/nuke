#!/usr/bin/env node
/**
 * Check vehicle details to see why update isn't working
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });
dotenv.config({ path: join(__dirname, '../.env.local') });

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const vehicleId = process.argv[2] || '69f35ba1-00d3-4b63-8406-731d226c45e1';

async function checkVehicleDetails() {
  try {
    const { data: vehicle, error } = await supabase
      .from('vehicles')
      .select('id, year, make, model, vin, discovery_url, platform_url, description, mileage, color, transmission, engine_size, origin_metadata')
      .eq('id', vehicleId)
      .single();

    if (error) throw error;

    console.log(`Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
    console.log(`VIN: ${vehicle.vin || 'N/A'}`);
    console.log(`Discovery URL: ${vehicle.discovery_url || 'N/A'}`);
    console.log(`Platform URL: ${vehicle.platform_url || 'N/A'}`);
    console.log(`Description length: ${vehicle.description?.length || 0}`);
    console.log(`Mileage: ${vehicle.mileage || 'N/A'}`);
    console.log(`Color: ${vehicle.color || 'N/A'}`);
    console.log(`Transmission: ${vehicle.transmission || 'N/A'}`);
    console.log(`Engine: ${vehicle.engine_size || 'N/A'}`);
    
    if (vehicle.origin_metadata) {
      const om = vehicle.origin_metadata;
      console.log(`\nOrigin Metadata:`);
      console.log(`  Images: ${Array.isArray(om.images) ? om.images.length : 0}`);
      console.log(`  Structured sections: ${Object.keys(om.structured_sections || {}).length}`);
      console.log(`  Bid history: ${Array.isArray(om.bid_history) ? om.bid_history.length : 0}`);
      console.log(`  Comments: ${Array.isArray(om.comments) ? om.comments.length : 0}`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkVehicleDetails();

