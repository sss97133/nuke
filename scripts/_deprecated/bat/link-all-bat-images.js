/**
 * LINK ALL BAT IMAGES VIA EDGE FUNCTION
 * Calls the edge function for each vehicle without images
 */

import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const VIVA_ORG_ID = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf';

console.log('📸 LINKING ALL BAT IMAGES VIA EDGE FUNCTION...\n');

// Get vehicles without images
const { data: vehicles } = await supabase
  .from('organization_vehicles')
  .select('vehicle_id, vehicles!inner(id, year, make, model)')
  .eq('organization_id', VIVA_ORG_ID);

const needImages = [];
for (const v of vehicles || []) {
  const { count } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact', head: true })
    .eq('vehicle_id', v.vehicle_id);
  
  if (count === 0) {
    needImages.push(v);
  }
}

console.log(`🚗 Found ${needImages.length} vehicles without images\n`);

let linked = 0;
let errors = 0;

for (let i = 0; i < needImages.length; i++) {
  const v = needImages[i];
  const display = `${v.vehicles.year} ${v.vehicles.make} ${v.vehicles.model}`;
  
  process.stdout.write(`[${i + 1}/${needImages.length}] ${display}... `);
  
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/link-bat-images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`
      },
      body: JSON.stringify({ vehicle_id: v.vehicle_id })
    });

    const result = await response.json();
    
    if (result.error) {
      console.log(`❌ ${result.error}`);
      errors++;
    } else if (result.images_linked) {
      console.log(`✅ ${result.images_linked} images`);
      linked++;
    } else {
      console.log(`⚠️  ${result.message || 'Unknown'}`);
    }
    
    // Rate limit
    await new Promise(r => setTimeout(r, 2000));
    
  } catch (error) {
    console.log(`❌ ${error.message}`);
    errors++;
  }
}

console.log(`\n✅ Linked images for ${linked} vehicles | Errors: ${errors}`);

