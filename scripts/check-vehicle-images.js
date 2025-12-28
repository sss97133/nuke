#!/usr/bin/env node
/**
 * Check images for a specific vehicle
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
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const vehicleId = process.argv[2] || '69f35ba1-00d3-4b63-8406-731d226c45e1';

async function checkVehicleImages() {
  try {
    console.log(`Checking images for vehicle: ${vehicleId}\n`);

    // Get vehicle info
    const { data: vehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .select('id, year, make, model, platform_url, discovery_url, primary_image_url')
      .eq('id', vehicleId)
      .single();

    if (vehicleError) {
      throw new Error(`Failed to fetch vehicle: ${vehicleError.message}`);
    }

    console.log(`Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
    console.log(`Platform URL: ${vehicle.platform_url || vehicle.discovery_url || 'N/A'}`);
    console.log(`Primary Image: ${vehicle.primary_image_url || 'N/A'}\n`);

    // Get all images
    const { data: images, error: imagesError } = await supabase
      .from('vehicle_images')
      .select('id, image_url, is_external, storage_path, is_primary, position, source, created_at')
      .eq('vehicle_id', vehicleId)
      .order('position', { ascending: true });

    if (imagesError) {
      throw new Error(`Failed to fetch images: ${imagesError.message}`);
    }

    console.log(`Total images: ${images.length}\n`);

    const externalImages = images.filter(img => img.is_external);
    const storedImages = images.filter(img => !img.is_external && img.storage_path);
    const brokenImages = images.filter(img => {
      const url = img.image_url || '';
      return url.includes('/edit/') || 
             url.includes('thumb') || 
             url.includes('logo') ||
             (url.includes('carsandbids.com') && (url.includes('width=80') || url.includes('height=80')));
    });

    console.log(`📊 Image Breakdown:`);
    console.log(`   External URLs: ${externalImages.length}`);
    console.log(`   Stored in Supabase: ${storedImages.length}`);
    console.log(`   Potentially broken/irrelevant: ${brokenImages.length}\n`);

    if (externalImages.length > 0) {
      console.log(`🔗 External Images (${externalImages.length}):`);
      externalImages.slice(0, 10).forEach((img, i) => {
        console.log(`   ${i + 1}. ${img.image_url?.substring(0, 80)}...`);
      });
      if (externalImages.length > 10) {
        console.log(`   ... and ${externalImages.length - 10} more`);
      }
      console.log('');
    }

    if (brokenImages.length > 0) {
      console.log(`⚠️  Potentially Broken/Irrelevant Images (${brokenImages.length}):`);
      brokenImages.slice(0, 10).forEach((img, i) => {
        console.log(`   ${i + 1}. ${img.image_url?.substring(0, 80)}...`);
        console.log(`      - is_external: ${img.is_external}, storage_path: ${img.storage_path || 'none'}`);
      });
      if (brokenImages.length > 10) {
        console.log(`   ... and ${brokenImages.length - 10} more`);
      }
      console.log('');
    }

    // Check origin_metadata for image URLs
    const { data: vehicleWithMetadata } = await supabase
      .from('vehicles')
      .select('origin_metadata')
      .eq('id', vehicleId)
      .single();

    if (vehicleWithMetadata?.origin_metadata?.images) {
      const originImages = vehicleWithMetadata.origin_metadata.images;
      console.log(`📦 Origin Metadata has ${originImages.length} image URLs stored`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkVehicleImages();
