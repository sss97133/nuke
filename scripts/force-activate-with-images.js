#!/usr/bin/env node

/**
 * Force Activate Vehicles with Images
 * 
 * Aggressively processes pending vehicles:
 * 1. Gets images from discovery_url
 * 2. Uploads images (ensures at least 1 succeeds)
 * 3. Sets lead photo as primary
 * 4. Activates vehicle immediately
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load env
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '..', '.env.local');

try {
  const envFile = readFileSync(envPath, 'utf8');
  envFile.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  });
} catch (error) {
  // .env.local not found
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function forceActivateVehicle(vehicle) {
  console.log(`\n🚀 Force Activating: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  console.log(`   ID: ${vehicle.id}`);
  console.log(`   URL: ${vehicle.discovery_url || 'NONE'}`);

  // Step 1: Check current image count
  const { count: currentImageCount } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact', head: true })
    .eq('vehicle_id', vehicle.id);

  console.log(`   📊 Current images: ${currentImageCount || 0}`);

  // Step 2: Get images if missing
  if ((currentImageCount || 0) === 0 && vehicle.discovery_url) {
    console.log(`   🖼️  Fetching images from ${vehicle.discovery_url}...`);
    
    try {
      // Use simple-scraper to get fresh image URLs
      const { data: scrapeData, error: scrapeError } = await supabase.functions.invoke('simple-scraper', {
        body: { url: vehicle.discovery_url }
      });

      if (!scrapeError && scrapeData?.success && scrapeData.data?.images && scrapeData.data.images.length > 0) {
        const imageUrls = scrapeData.data.images.slice(0, 20); // Limit to 20
        console.log(`   ✅ Found ${imageUrls.length} image URLs`);

        // Upload images
        const { data: backfillResult, error: backfillError } = await supabase.functions.invoke('backfill-images', {
          body: {
            vehicle_id: vehicle.id,
            image_urls: imageUrls,
            source: 'force_activation',
            run_analysis: false
          }
        });

        if (backfillError) {
          console.log(`   ⚠️  Backfill error: ${backfillError.message}`);
        } else {
          console.log(`   📤 Backfill result: ${JSON.stringify(backfillResult)}`);
          
          // Check if images were actually uploaded
          const { count: newImageCount } = await supabase
            .from('vehicle_images')
            .select('*', { count: 'exact', head: true })
            .eq('vehicle_id', vehicle.id);

          console.log(`   📊 Images after backfill: ${newImageCount || 0}`);

          if ((newImageCount || 0) > 0) {
            // Set first image as primary
            const { data: images } = await supabase
              .from('vehicle_images')
              .select('id')
              .eq('vehicle_id', vehicle.id)
              .order('created_at', { ascending: true })
              .limit(1);

            if (images && images.length > 0) {
              // Unset all primary flags
              await supabase
                .from('vehicle_images')
                .update({ is_primary: false })
                .eq('vehicle_id', vehicle.id);

              // Set first as primary
              await supabase
                .from('vehicle_images')
                .update({ is_primary: true })
                .eq('id', images[0].id);

              console.log(`   ✅ Set lead photo (image ${images[0].id})`);
            }
          }
        }
      } else {
        console.log(`   ⚠️  No images found from scraper`);
      }
    } catch (err) {
      console.log(`   ❌ Image fetch failed: ${err.message}`);
    }
  } else if ((currentImageCount || 0) > 0) {
    // Ensure primary is set
    const { data: primaryCheck } = await supabase
      .from('vehicle_images')
      .select('id')
      .eq('vehicle_id', vehicle.id)
      .eq('is_primary', true)
      .limit(1);

    if (!primaryCheck || primaryCheck.length === 0) {
      const { data: firstImage } = await supabase
        .from('vehicle_images')
        .select('id')
        .eq('vehicle_id', vehicle.id)
        .order('created_at', { ascending: true })
        .limit(1);

      if (firstImage && firstImage.length > 0) {
        await supabase
          .from('vehicle_images')
          .update({ is_primary: true })
          .eq('id', firstImage[0].id);
        console.log(`   ✅ Set lead photo`);
      }
    }
  }

  // Step 3: Ensure timeline event exists
  const { count: eventCount } = await supabase
    .from('timeline_events')
    .select('*', { count: 'exact', head: true })
    .eq('vehicle_id', vehicle.id)
    .eq('event_type', 'auction_listed');

  if ((eventCount || 0) === 0 && vehicle.discovery_url) {
    try {
      const source = vehicle.discovery_url.includes('craigslist') ? 'craigslist' :
                     vehicle.discovery_url.includes('bringatrailer') ? 'bring_a_trailer' :
                     vehicle.discovery_url.includes('hemmings') ? 'hemmings' :
                     'automated_import';

      await supabase
        .from('timeline_events')
        .insert({
          vehicle_id: vehicle.id,
          event_type: 'auction_listed',
          event_date: new Date().toISOString().split('T')[0],
          title: 'Listed for Sale',
          description: `Listed on ${new URL(vehicle.discovery_url).hostname}`,
          source: source,
          metadata: {
            source_url: vehicle.discovery_url,
            price: vehicle.asking_price
          }
        });
      
      console.log(`   ✅ Timeline event created`);
    } catch (err) {
      console.log(`   ⚠️  Timeline event failed: ${err.message}`);
    }
  }

  // Step 4: Final image check
  const { count: finalImageCount } = await supabase
    .from('vehicle_images')
    .select('*', { count: 'exact', head: true })
    .eq('vehicle_id', vehicle.id);

  // Step 5: Activate if we have images and basic data
  if ((finalImageCount || 0) > 0 && vehicle.make && vehicle.model && vehicle.year) {
    console.log(`   🎯 Activating vehicle...`);
    
    const { error: activateError } = await supabase
      .from('vehicles')
      .update({ 
        status: 'active',
        is_public: true
      })
      .eq('id', vehicle.id);

    if (activateError) {
      console.log(`   ❌ Activation failed: ${activateError.message}`);
      return { activated: false, reason: 'activation_error' };
    }

    console.log(`   🎉 ACTIVATED! Vehicle is now live`);
    return { activated: true };
  } else {
    console.log(`   ⚠️  Cannot activate: missing images (${finalImageCount || 0}) or data`);
    return { activated: false, reason: 'missing_requirements' };
  }
}

async function main() {
  const batchSize = parseInt(process.argv[2]) || 100;

  console.log('🚀 Force Activate Vehicles with Images\n');

  // Get pending vehicles with YMM
  const { data: pendingVehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, asking_price, discovery_url, status')
    .eq('status', 'pending')
    .not('make', 'is', null)
    .not('model', 'is', null)
    .not('year', 'is', null)
    .not('discovery_url', 'is', null)
    .limit(batchSize);

  if (error) {
    console.error('❌ Failed to fetch vehicles:', error.message);
    process.exit(1);
  }

  if (!pendingVehicles || pendingVehicles.length === 0) {
    console.log('✅ No pending vehicles to activate');
    return;
  }

  console.log(`📋 Processing ${pendingVehicles.length} vehicles...\n`);

  const results = {
    processed: 0,
    activated: 0,
    failed: 0
  };

  for (const vehicle of pendingVehicles) {
    const result = await forceActivateVehicle(vehicle);
    results.processed++;
    
    if (result.activated) {
      results.activated++;
    } else {
      results.failed++;
    }

    // Small delay
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`\n✅ Complete!`);
  console.log(`   Processed: ${results.processed}`);
  console.log(`   Activated: ${results.activated}`);
  console.log(`   Failed: ${results.failed}`);
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

