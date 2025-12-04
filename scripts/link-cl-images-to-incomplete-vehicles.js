/**
 * Link Craigslist Images to Incomplete Vehicle Profiles
 * Scrapes CL listings and links images to vehicles
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false }
});

const vehicles = [
  { id: '18377b38-4232-4549-ba36-acce06b7f67e', name: '1970 Plymouth Roadrunner' },
  { id: '7227bfd4-36a1-4122-9d24-cbcfc7f74362', name: '1990 Chevrolet Camaro' },
  { id: '69571d27-d590-432f-abf6-f78e2885b401', name: '1989 Chevrolet Truck' },
  { id: 'cc6a87d7-4fe7-4af2-9852-7d42397a0199', name: '1989 Chevrolet Truck' },
  { id: '3faa29a9-5f27-46de-83a1-9bce2b7fec6d', name: '1988 GMC Truck' },
  { id: '83e27461-51f7-49ef-b9a6-b43fb3777068', name: '1983 Chevrolet Truck' },
  { id: 'e7f4bda0-1dbd-4552-b551-4ccf025ea437', name: '1981 Chevrolet Truck' }
];

function upgradeCraigslistImageUrl(url) {
  if (url.includes('_50x50c.jpg') || url.includes('_300x300.jpg')) {
    return url.replace(/_50x50c\.jpg|_300x300\.jpg/g, '_1200x900.jpg');
  }
  if (url.includes('_600x450.jpg')) {
    return url.replace('_600x450.jpg', '_1200x900.jpg');
  }
  return url;
}

async function processVehicle(vehicle) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Processing: ${vehicle.name}`);
  console.log(`Vehicle ID: ${vehicle.id}`);
  console.log(`${'='.repeat(60)}`);

  // Get vehicle data
  const { data: vehicleData, error: vehicleError } = await supabase
    .from('vehicles')
    .select('id, discovery_url, origin_metadata, uploaded_by')
    .eq('id', vehicle.id)
    .single();

  if (vehicleError || !vehicleData) {
    console.log(`❌ Vehicle not found: ${vehicleError?.message}`);
    return { success: false, reason: 'not_found' };
  }

  // Get listing URL
  const listingUrl = vehicleData.discovery_url || vehicleData.origin_metadata?.listing_url;
  
  if (!listingUrl || !listingUrl.includes('craigslist')) {
    console.log(`⏭️  No Craigslist URL found`);
    return { success: false, reason: 'no_url' };
  }

  console.log(`📋 Listing URL: ${listingUrl}`);

  // Check if images already exist
  const { data: existingImages } = await supabase
    .from('vehicle_images')
    .select('id')
    .eq('vehicle_id', vehicle.id);

  if (existingImages && existingImages.length > 0) {
    console.log(`✅ Already has ${existingImages.length} image(s), skipping`);
    return { success: true, reason: 'already_has_images' };
  }

  // Scrape listing
  console.log(`🔍 Scraping listing...`);
  const { data: scrapeData, error: scrapeError } = await supabase.functions.invoke('scrape-vehicle', {
    body: { url: listingUrl }
  });

  if (scrapeError || !scrapeData?.success) {
    console.log(`❌ Failed to scrape: ${scrapeError?.message || 'Unknown error'}`);
    return { success: false, reason: 'scrape_failed' };
  }

  const images = scrapeData.data?.images || [];
  if (images.length === 0) {
    console.log(`⏭️  No images found in listing`);
    return { success: false, reason: 'no_images' };
  }

  console.log(`✅ Found ${images.length} image(s)`);

  // Link images
  let linked = 0;
  for (let i = 0; i < images.length; i++) {
    const imageUrl = upgradeCraigslistImageUrl(images[i]);
    
    const { error: insertError } = await supabase
      .from('vehicle_images')
      .insert({
        vehicle_id: vehicle.id,
        user_id: vehicleData.uploaded_by,
        image_url: imageUrl,
        thumbnail_url: imageUrl,
        medium_url: imageUrl,
        large_url: imageUrl,
        organization_status: 'organized',
        organized_at: new Date().toISOString(),
        is_primary: i === 0,
        source: 'craigslist_scrape',
        source_url: listingUrl
      });

    if (insertError) {
      console.log(`⚠️  Failed to link image ${i + 1}: ${insertError.message}`);
    } else {
      linked++;
      console.log(`✅ Linked image ${i + 1}/${images.length}`);
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log(`✅ Linked ${linked}/${images.length} images`);
  return { success: true, linked };
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔗 Linking Craigslist Images to Vehicles');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const results = {
    success: 0,
    skipped: 0,
    failed: 0
  };

  for (const vehicle of vehicles) {
    const result = await processVehicle(vehicle);
    
    if (result.success) {
      results.success++;
    } else if (result.reason === 'already_has_images' || result.reason === 'no_url') {
      results.skipped++;
    } else {
      results.failed++;
    }

    // Wait between vehicles
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📊 Results:`);
  console.log(`   ✅ Success: ${results.success}`);
  console.log(`   ⏭️  Skipped: ${results.skipped}`);
  console.log(`   ❌ Failed: ${results.failed}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

main().catch(console.error);

