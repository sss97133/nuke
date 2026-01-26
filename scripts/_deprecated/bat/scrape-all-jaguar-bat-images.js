import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const VEHICLE_ID = 'c1b04f00-7abf-4e1c-afd2-43fba17a6a1b';
const BAT_URL = 'https://bringatrailer.com/listing/1964-jaguar-xke-series-1-roadster-5/';

async function scrapeBATImages(batUrl) {
  console.log(`📡 Scraping all images from: ${batUrl}\n`);

  // Use the scrape-vehicle function
  const { data, error } = await supabase.functions.invoke('scrape-vehicle', {
    body: { url: batUrl }
  });

  if (error) {
    console.error('Scrape error:', error);
    throw new Error(`Scrape failed: ${error.message}`);
  }

  // Extract images from response (could be data.images or data.data.images)
  let imageUrls = data?.images || data?.data?.images || [];

  if (imageUrls.length === 0) {
    // Try alternative: use bat-scraper function
    console.log('Trying bat-scraper function...');
    const { data: batData, error: batError } = await supabase.functions.invoke('bat-scraper', {
      body: { url: batUrl }
    });

    if (batError) {
      throw new Error(`BAT scraper failed: ${batError.message}`);
    }

    imageUrls = batData?.images || [];
    
    if (imageUrls.length === 0) {
      throw new Error('No images found in BAT listing');
    }
  }

  console.log(`✅ Found ${imageUrls.length} images\n`);
  return imageUrls;
}

async function saveImage(imageUrl, index, vehicle, batUrl) {
  try {
    // Check if already exists
    const { data: existing } = await supabase
      .from('vehicle_images')
      .select('id')
      .eq('vehicle_id', VEHICLE_ID)
      .eq('image_url', imageUrl)
      .limit(1);

    if (existing && existing.length > 0) {
      console.log(`  [${index + 1}] ⏭️  Already exists`);
      return { skipped: true };
    }

    // Get a user ID (use first admin or service account)
    const { data: users } = await supabase
      .from('profiles')
      .select('id')
      .limit(1);

    const userId = users?.[0]?.id;

    // Insert image record
    const { data: insertedImage, error: insertError } = await supabase
      .from('vehicle_images')
      .insert({
        vehicle_id: VEHICLE_ID,
        image_url: imageUrl,
        user_id: userId,
        category: 'bat_listing',
        is_primary: index === 0,
        source: 'bat_listing',
        ai_scan_metadata: {
          source: 'bat_scraper',
          bat_url: batUrl,
          scraped_at: new Date().toISOString(),
          vehicle_expected: `${vehicle.year} ${vehicle.make} ${vehicle.model}`
        }
      })
      .select('id')
      .single();

    if (insertError) {
      console.error(`  [${index + 1}] ❌ Error: ${insertError.message}`);
      return { error: insertError.message };
    }

    console.log(`  [${index + 1}] ✅ Saved`);

    // Trigger validation in background
    if (insertedImage?.id) {
      supabase.functions.invoke('validate-bat-image', {
        body: {
          image_id: insertedImage.id,
          image_url: imageUrl,
          vehicle_id: VEHICLE_ID,
          expected_vehicle: {
            year: vehicle.year,
            make: vehicle.make,
            model: vehicle.model
          }
        }
      }).catch(err => {
        console.warn(`    ⚠️  Validation failed: ${err.message}`);
      });
    }

    return { success: true, id: insertedImage.id };
  } catch (error) {
    console.error(`  [${index + 1}] ❌ Error: ${error.message}`);
    return { error: error.message };
  }
}

async function main() {
  console.log('🚀 Scraping all BAT images for Jaguar XKE\n');

  // Get vehicle info
  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .eq('id', VEHICLE_ID)
    .single();

  if (vehicleError || !vehicle) {
    console.error('❌ Vehicle not found');
    process.exit(1);
  }

  console.log(`Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}\n`);
  console.log(`BAT URL: ${BAT_URL}\n`);

  // Scrape all images
  let imageUrls;
  try {
    imageUrls = await scrapeBATImages(BAT_URL);
  } catch (error) {
    console.error(`❌ Failed to scrape images: ${error.message}`);
    process.exit(1);
  }

  // Save ALL images (not just first 15)
  console.log(`\n💾 Saving ${imageUrls.length} images...\n`);

  let saved = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < imageUrls.length; i++) {
    const result = await saveImage(imageUrls[i], i, vehicle, BAT_URL);
    
    if (result.success) {
      saved++;
    } else if (result.skipped) {
      skipped++;
    } else {
      errors++;
    }

    // Small delay to avoid rate limiting
    if (i < imageUrls.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📈 RESULTS:`);
  console.log(`   ✅ Saved: ${saved}`);
  console.log(`   ⏭️  Skipped (already exist): ${skipped}`);
  console.log(`   ❌ Errors: ${errors}`);
  console.log(`   📊 Total images: ${imageUrls.length}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

main().catch(console.error);
