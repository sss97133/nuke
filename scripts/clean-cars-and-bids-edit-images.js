#!/usr/bin/env node

/**
 * CLEAN CARS & BIDS EDIT IMAGES
 * 
 * Removes all false flag images with (edit) patterns from Cars & Bids vehicles
 * Then optionally re-extracts to get valid images
 * 
 * Usage: 
 *   node scripts/clean-cars-and-bids-edit-images.js [--re-extract]
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/extract-premium-auction`;

async function cleanEditImages(reExtract = false) {
  console.log('\n🧹 Cleaning edit images from Cars & Bids vehicles...\n');
  
  // Find all Cars & Bids vehicles
  const { data: vehicles, error: vehiclesError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url')
    .or('discovery_url.ilike.%carsandbids.com%,origin_metadata->>source.ilike.%cars%bid%')
    .limit(500);
  
  if (vehiclesError) {
    console.error('Error finding vehicles:', vehiclesError);
    process.exit(1);
  }
  
  console.log(`Found ${vehicles.length} Cars & Bids vehicles to check\n`);
  
  let totalDeleted = 0;
  let vehiclesCleaned = 0;
  const vehiclesToReExtract = [];
  
  for (const vehicle of vehicles) {
    // Get all images for this vehicle
    const { data: images, error: imagesError } = await supabase
      .from('vehicle_images')
      .select('id, image_url')
      .eq('vehicle_id', vehicle.id);
    
    if (imagesError) {
      console.warn(`⚠️ Error fetching images for ${vehicle.id}:`, imagesError.message);
      continue;
    }
    
    if (!images || images.length === 0) continue;
    
    // Find edit images
    const editImages = images.filter(img => {
      const lower = (img.image_url || '').toLowerCase();
      return lower.includes('(edit)') || lower.includes('-(edit)') || 
             lower.match(/[\.\-]edit\)/i) || lower.match(/\(edit[\.\-]/i);
    });
    
    if (editImages.length > 0) {
      const idsToDelete = editImages.map(img => img.id);
      
      const { error: deleteError } = await supabase
        .from('vehicle_images')
        .delete()
        .in('id', idsToDelete);
      
      if (deleteError) {
        console.warn(`⚠️ Error deleting images for ${vehicle.id}:`, deleteError.message);
        continue;
      }
      
      totalDeleted += editImages.length;
      vehiclesCleaned++;
      
      if (vehicle.discovery_url && vehicle.discovery_url.includes('carsandbids.com')) {
        vehiclesToReExtract.push({
          id: vehicle.id,
          url: vehicle.discovery_url,
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
        });
      }
      
      console.log(`✓ Cleaned ${editImages.length} edit images from ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}`);
    }
  }
  
  console.log(`\n✅ Cleanup complete!`);
  console.log(`   Vehicles cleaned: ${vehiclesCleaned}`);
  console.log(`   Edit images deleted: ${totalDeleted}\n`);
  
  if (reExtract && vehiclesToReExtract.length > 0) {
    console.log(`\n🔄 Re-extracting ${vehiclesToReExtract.length} vehicles to find valid images...\n`);
    
    for (let i = 0; i < vehiclesToReExtract.length; i++) {
      const v = vehiclesToReExtract[i];
      console.log(`[${i + 1}/${vehiclesToReExtract.length}] Re-extracting: ${v.year || '?'} ${v.make || '?'} ${v.model || '?'}`);
      
      try {
        const response = await fetch(EDGE_FUNCTION_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: v.url,
            site_type: 'carsandbids',
            max_vehicles: 1,
            debug: false,
            download_images: false,
          }),
        });
        
        if (response.ok) {
          const result = await response.json();
          console.log(`   ✅ Updated: ${result.vehicles_updated || 0} vehicles`);
        } else {
          console.warn(`   ⚠️ Failed: ${response.status}`);
        }
      } catch (error) {
        console.warn(`   ⚠️ Error: ${error.message}`);
      }
      
      // Rate limiting
      if (i < vehiclesToReExtract.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    console.log(`\n✅ Re-extraction complete!`);
  } else if (vehiclesToReExtract.length > 0) {
    console.log(`\n💡 To re-extract valid images, run:`);
    console.log(`   node scripts/clean-cars-and-bids-edit-images.js --re-extract`);
  }
}

const reExtract = process.argv.includes('--re-extract');
cleanEditImages(reExtract);

