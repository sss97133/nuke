#!/usr/bin/env node
/**
 * Analyze specific SPID sheet image
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const imageId = '76d85617-e852-4b74-8e71-d82eb243ff34';
const imageUrl = 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/3f1791fe-4fe2-4994-b6fe-b137ffa57370/eafcc713-3f9a-4535-9cb2-764c76ad90f7.jpeg';
const vehicleId = '3f1791fe-4fe2-4994-b6fe-b137ffa57370';

console.log('=' .repeat(60));
console.log('ANALYZING SPID SHEET IMAGE');
console.log('='.repeat(60));
console.log();
console.log('Image ID:', imageId);
console.log('Vehicle ID:', vehicleId);
console.log();
console.log('Triggering AI analysis...');

supabase.functions.invoke('analyze-image', {
  body: {
    image_url: imageUrl,
    vehicle_id: vehicleId,
    image_id: imageId
  }
}).then(async ({ data, error }) => {
  if (error) {
    console.error('\n❌ Error:', error.message);
    console.error(JSON.stringify(error, null, 2));
    process.exit(1);
  }
  
  console.log('\n✅ Analysis complete!');
  console.log('\nResponse:', JSON.stringify(data, null, 2));
  
  // Check if SPID was saved to database
  console.log('\nChecking vehicle_spid_data table...');
  const { data: spidData } = await supabase
    .from('vehicle_spid_data')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .single();
    
  if (spidData) {
    console.log('\n🎯 SPID DATA SAVED:');
    console.log('VIN:', spidData.vin);
    console.log('Model Code:', spidData.model_code);
    console.log('Paint:', spidData.paint_code_exterior);
    console.log('RPO Codes:', spidData.rpo_codes);
    console.log('Engine:', spidData.engine_code);
    console.log('Transmission:', spidData.transmission_code);
  } else {
    console.log('\n⚠ No SPID data saved to table');
  }
  
  process.exit(0);
}).catch(err => {
  console.error('\n❌ Request failed:', err.message);
  process.exit(1);
});

