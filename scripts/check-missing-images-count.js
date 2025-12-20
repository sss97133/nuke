#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

console.log('📊 Counting vehicles with missing images...\n');

// Count vehicles with zero images (excluding documents)
const { data: vehiclesWithNoImages, error: error1 } = await supabase
  .rpc('exec_sql', {
    query: `
      SELECT 
        COUNT(*) as total_vehicles,
        COUNT(CASE WHEN image_count = 0 THEN 1 END) as vehicles_with_zero_images,
        COUNT(CASE WHEN image_count > 0 AND image_count < 5 THEN 1 END) as vehicles_with_few_images,
        COUNT(CASE WHEN image_count >= 5 THEN 1 END) as vehicles_with_many_images,
        SUM(image_count) as total_images,
        AVG(image_count) as avg_images_per_vehicle
      FROM (
        SELECT 
          v.id,
          COUNT(vi.id) FILTER (WHERE vi.is_document IS NULL OR vi.is_document = false) as image_count
        FROM vehicles v
        LEFT JOIN vehicle_images vi ON vi.vehicle_id = v.id
        GROUP BY v.id
      ) stats
    `
  });

if (error1) {
  // Fallback: use direct query
  const { data: allVehicles } = await supabase
    .from('vehicles')
    .select('id', { count: 'exact', head: true });
  
  // Get total vehicle count
  const { count: totalVehicles } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true });
  
  // Get total image count
  const { count: totalImages } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact', head: true })
    .or('is_document.is.null,is_document.eq.false');
  
  // Get count of unique vehicles with images (using a more efficient approach)
  // We'll calculate this from the breakdown below instead
  
  // Get breakdown by image count
  const { data: breakdown } = await supabase
    .from('vehicles')
    .select(`
      id,
      vehicle_images!inner(count)
    `)
    .or('vehicle_images.is_document.is.null,vehicle_images.is_document.eq.false');
  
  // More detailed breakdown
  const { data: vehicles } = await supabase
    .from('vehicles')
    .select(`
      id,
      year,
      make,
      model,
      listing_url
    `, { count: 'exact' });
  
  if (vehicles) {
    const vehiclesWithImageCounts = await Promise.all(
      vehicles.map(async (v) => {
        const { count } = await supabase
          .from('vehicle_images')
          .select('*', { count: 'exact', head: true })
          .eq('vehicle_id', v.id)
          .or('is_document.is.null,is_document.eq.false');
        return { ...v, image_count: count || 0 };
      })
    );
    
    const zeroImages = vehiclesWithImageCounts.filter(v => v.image_count === 0);
    const fewImages = vehiclesWithImageCounts.filter(v => v.image_count > 0 && v.image_count < 5);
    const manyImages = vehiclesWithImageCounts.filter(v => v.image_count >= 5);
    const vehiclesWithImages = vehiclesWithImageCounts.filter(v => v.image_count > 0).length;
    
    console.log(`\n📊 Breakdown:`);
    console.log(`   Total vehicles: ${vehiclesWithImageCounts.length}`);
    console.log(`   Vehicles with images: ${vehiclesWithImages}`);
    console.log(`   Vehicles with NO images: ${zeroImages.length}`);
    console.log(`   Vehicles with 1-4 images: ${fewImages.length}`);
    console.log(`   Vehicles with 5+ images: ${manyImages.length}`);
    console.log(`   Total images: ${totalImages || 0}`);
    
    if (zeroImages.length > 0) {
      console.log(`\n🔴 Sample vehicles with NO images (first 10):`);
      zeroImages.slice(0, 10).forEach(v => {
        console.log(`   - ${v.year || '?'} ${v.make || '?'} ${v.model || '?'} (${v.id.substring(0, 8)}...)`);
        if (v.listing_url) console.log(`     URL: ${v.listing_url}`);
      });
    }
  }
} else {
  console.log('📈 Image Statistics:');
  console.log(vehiclesWithNoImages);
}

// Check for specific URLs mentioned
console.log('\n🔍 Checking specific URLs...');
const specificUrls = [
  'https://www.lartdelautomobile.com/fiche/porsche-911-2-0l-1965',
  'https://n-zero.dev/vehicle/5d851064-9b85-4fc3-a61a-7edc3f9996d7'
];

for (const url of specificUrls) {
  let vehicle;
  
  // Try listing_url first
  const { data: v1 } = await supabase
    .from('vehicles')
    .select('id, year, make, model, listing_url, discovery_url')
    .eq('listing_url', url)
    .maybeSingle();
  
  if (v1) {
    vehicle = v1;
  } else {
    // Try discovery_url
    const { data: v2 } = await supabase
      .from('vehicles')
      .select('id, year, make, model, listing_url, discovery_url')
      .eq('discovery_url', url)
      .maybeSingle();
    vehicle = v2;
  }
  
  // Also try extracting ID from n-zero.dev URLs
  if (!vehicle && url.includes('n-zero.dev/vehicle/')) {
    const vehicleId = url.split('/vehicle/')[1]?.split('?')[0];
    if (vehicleId) {
      const { data: v3 } = await supabase
        .from('vehicles')
        .select('id, year, make, model, listing_url, discovery_url')
        .eq('id', vehicleId)
        .maybeSingle();
      vehicle = v3;
    }
  }
  
  if (vehicle) {
    const { count } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', vehicle.id)
      .or('is_document.is.null,is_document.eq.false');
    
    console.log(`\n   ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}: ${count || 0} images`);
    console.log(`   ID: ${vehicle.id}`);
    console.log(`   Listing URL: ${vehicle.listing_url || 'N/A'}`);
    console.log(`   Discovery URL: ${vehicle.discovery_url || 'N/A'}`);
  } else {
    console.log(`\n   URL not found in database: ${url}`);
  }
}
