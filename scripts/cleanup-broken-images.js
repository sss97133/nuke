#!/usr/bin/env node
/**
 * Delete broken/irrelevant images for a vehicle
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

async function cleanupBrokenImages() {
  try {
    console.log(`Cleaning up broken images for vehicle: ${vehicleId}\n`);

    // Get all images
    const { data: images, error } = await supabase
      .from('vehicle_images')
      .select('id, image_url, is_external')
      .eq('vehicle_id', vehicleId);

    if (error) throw error;

    console.log(`Found ${images.length} total images\n`);

    // Find broken/irrelevant images
    const brokenImages = images.filter(img => {
      const url = (img.image_url || '').toLowerCase();
      return url.includes('/edit/') ||
             url.includes('width=80') ||
             url.includes('height=80') ||
             url.includes('thumb') ||
             (img.is_external && !url.includes('supabase'));
    });

    console.log(`Found ${brokenImages.length} broken/irrelevant images to delete\n`);

    if (brokenImages.length === 0) {
      console.log('✅ No broken images to clean up');
      return;
    }

    // Delete them
    const idsToDelete = brokenImages.map(img => img.id);
    const { error: deleteError } = await supabase
      .from('vehicle_images')
      .delete()
      .in('id', idsToDelete);

    if (deleteError) throw deleteError;

    console.log(`✅ Deleted ${brokenImages.length} broken images`);
    console.log(`   Remaining images: ${images.length - brokenImages.length}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

cleanupBrokenImages();

