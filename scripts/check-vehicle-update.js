#!/usr/bin/env node
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

async function checkUpdate() {
  const { data, error } = await supabase
    .from('vehicles')
    .select('id, updated_at, origin_metadata, description, mileage, color, transmission, engine_size')
    .eq('id', vehicleId)
    .single();

  if (error) {
    console.error('Error:', error.message);
    return;
  }

  console.log(`Vehicle ID: ${data.id}`);
  console.log(`Last Updated: ${data.updated_at}`);
  console.log(`Description length: ${data.description?.length || 0}`);
  console.log(`Mileage: ${data.mileage || 'N/A'}`);
  console.log(`Color: ${data.color || 'N/A'}`);
  console.log(`Transmission: ${data.transmission || 'N/A'}`);
  console.log(`Engine: ${data.engine_size || 'N/A'}`);
  
  if (data.origin_metadata) {
    const om = data.origin_metadata;
    console.log(`\nOrigin Metadata:`);
    console.log(`  Images: ${Array.isArray(om.images) ? om.images.length : 0}`);
    console.log(`  Structured sections: ${Object.keys(om.structured_sections || {}).length}`);
    if (om.last_updated) {
      console.log(`  Last updated (metadata): ${om.last_updated}`);
    }
  }
}

checkUpdate();

