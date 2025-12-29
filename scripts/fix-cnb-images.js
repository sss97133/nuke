#!/usr/bin/env node
/**
 * Fix Cars & Bids vehicles with missing images by re-extracting from source
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY
);

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

async function getVehiclesNeedingImages() {
  // Get C&B vehicles that need images
  const { data, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url')
    .or('discovery_url.ilike.%carsandbids%,discovery_source.ilike.%carsandbids%')
    .is('primary_image_url', null);

  if (error) throw error;
  
  // Also get vehicles with external primary but no supabase images
  const { data: externalOnly } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url')
    .or('discovery_url.ilike.%carsandbids%,discovery_source.ilike.%carsandbids%')
    .not('primary_image_url', 'is', null)
    .not('primary_image_url', 'ilike', '%supabase%');

  const combined = [...(data || []), ...(externalOnly || [])];
  
  // Filter out video URLs
  return combined.filter(v => v.discovery_url && !v.discovery_url.endsWith('/video'));
}

async function extractVehicle(vehicle) {
  const url = vehicle.discovery_url;
  if (!url) return { success: false, error: 'No discovery_url' };

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/extract-premium-auction`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        urls: [url],
        download_images: true,
        force_re_extract: true,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `HTTP ${response.status}: ${text.substring(0, 200)}` };
    }

    const result = await response.json();
    return { success: true, result };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function updatePrimaryImage(vehicleId) {
  // Set primary_image_url to first supabase image
  const { data: images } = await supabase
    .from('vehicle_images')
    .select('image_url')
    .eq('vehicle_id', vehicleId)
    .ilike('image_url', '%supabase%')
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1);

  if (images && images.length > 0) {
    await supabase
      .from('vehicles')
      .update({ primary_image_url: images[0].image_url })
      .eq('id', vehicleId);
    return true;
  }
  return false;
}

async function main() {
  console.log('Finding Cars & Bids vehicles with missing images...\n');
  
  const vehicles = await getVehiclesNeedingImages();
  console.log(`Found ${vehicles.length} vehicles to fix\n`);

  if (vehicles.length === 0) {
    console.log('All Cars & Bids vehicles have images!');
    return;
  }

  let fixed = 0;
  let failed = 0;

  for (const vehicle of vehicles) {
    const name = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
    process.stdout.write(`[${fixed + failed + 1}/${vehicles.length}] ${name}... `);

    const result = await extractVehicle(vehicle);
    
    if (result.success) {
      // Update primary image
      const imageSet = await updatePrimaryImage(vehicle.id);
      if (imageSet) {
        console.log('OK - images extracted');
        fixed++;
      } else {
        console.log('EXTRACTED but no images stored');
        failed++;
      }
    } else {
      console.log(`FAILED: ${result.error}`);
      failed++;
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`\n========================================`);
  console.log(`RESULTS: ${fixed} fixed, ${failed} failed out of ${vehicles.length}`);
  console.log(`========================================\n`);
}

main().catch(console.error);

