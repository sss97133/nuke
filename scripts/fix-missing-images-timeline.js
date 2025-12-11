#!/usr/bin/env node

/**
 * Fix Missing Images and Timeline Events
 * 
 * Backfills images and timeline events for vehicles that are missing them
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
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

async function fixVehicle(vehicle) {
  console.log(`\n🔧 Fixing: ${vehicle.year} ${vehicle.make} ${vehicle.model} (${vehicle.id.substring(0, 8)})`);
  
  const fixes = {
    images: false,
    timeline: false
  };

  // Check images
  const { data: images, error: imagesError } = await supabase
    .from('vehicle_images')
    .select('id')
    .eq('vehicle_id', vehicle.id)
    .limit(1);

  if (imagesError) {
    console.error(`  ❌ Error checking images: ${imagesError.message}`);
    return fixes;
  }

  // Check timeline
  const { data: events, error: eventsError } = await supabase
    .from('timeline_events')
    .select('id')
    .eq('vehicle_id', vehicle.id)
    .limit(1);

  if (eventsError) {
    console.error(`  ❌ Error checking timeline: ${eventsError.message}`);
    return fixes;
  }

  // Fix images if missing
  if (!images || images.length === 0) {
    console.log(`  🖼️  No images found, backfilling...`);
    if (vehicle.discovery_url) {
      try {
        // Try to get images from the listing
        const { data: scrapeData, error: scrapeError } = await supabase.functions.invoke('simple-scraper', {
          body: { url: vehicle.discovery_url }
        });

        if (!scrapeError && scrapeData?.success && scrapeData.data?.images && scrapeData.data.images.length > 0) {
          console.log(`    Found ${scrapeData.data.images.length} images in listing`);
          
          const { data: backfillResult, error: backfillError } = await supabase.functions.invoke('backfill-images', {
            body: {
              vehicle_id: vehicle.id,
              image_urls: scrapeData.data.images,
              source: 'backfill_fix',
              run_analysis: false
            }
          });

          if (!backfillError && backfillResult?.uploaded) {
            console.log(`    ✅ Backfilled ${backfillResult.uploaded} images`);
            fixes.images = true;
          } else {
            console.log(`    ⚠️  Image backfill failed: ${backfillError?.message || 'Unknown'}`);
          }
        } else {
          console.log(`    ⚠️  No images found in listing`);
        }
      } catch (err) {
        console.error(`    ❌ Error backfilling images: ${err.message}`);
      }
    } else {
      console.log(`    ⚠️  No discovery URL to backfill from`);
    }
  } else {
    console.log(`  ✅ Has ${images.length} images`);
  }

  // Fix timeline if missing
  if (!events || events.length === 0) {
    console.log(`  📅 No timeline events found, creating...`);
    try {
      const source = vehicle.discovery_url?.includes('craigslist') ? 'craigslist' :
                     vehicle.discovery_url?.includes('bringatrailer') ? 'bring_a_trailer' :
                     vehicle.discovery_url?.includes('hemmings') ? 'hemmings' :
                     'automated_import';

      const { error: timelineError } = await supabase
        .from('timeline_events')
        .insert({
          vehicle_id: vehicle.id,
          event_type: 'auction_listed',
          event_date: vehicle.created_at ? vehicle.created_at.split('T')[0] : new Date().toISOString().split('T')[0],
          title: 'Listed for Sale',
          description: vehicle.discovery_url 
            ? `Listed on ${new URL(vehicle.discovery_url).hostname}`
            : 'Vehicle discovered',
          source: source,
          metadata: {
            source_url: vehicle.discovery_url,
            price: vehicle.asking_price,
            discovery: true
          }
        });

      if (timelineError) {
        console.error(`    ❌ Timeline creation failed: ${timelineError.message}`);
      } else {
        console.log(`    ✅ Created timeline event`);
        fixes.timeline = true;
      }
    } catch (err) {
      console.error(`    ❌ Error creating timeline: ${err.message}`);
    }
  } else {
    console.log(`  ✅ Has timeline events`);
  }

  return fixes;
}

async function main() {
  const vehicleId = process.argv[2];
  const batchSize = parseInt(process.argv[2]) || 20;

  console.log('🔧 Fixing Missing Images and Timeline Events\n');

  let query = supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, asking_price, created_at')
    .not('discovery_url', 'is', null);

  if (vehicleId && vehicleId.length === 36) {
    // It's a UUID
    query = query.eq('id', vehicleId);
  } else {
    // Get vehicles missing images or timeline
    query = query.limit(batchSize);
  }

  const { data: vehicles, error } = await query;

  if (error) {
    console.error('❌ Failed to fetch vehicles:', error.message);
    process.exit(1);
  }

  if (!vehicles || vehicles.length === 0) {
    console.log('✅ No vehicles to fix');
    return;
  }

  console.log(`📋 Processing ${vehicles.length} vehicles...\n`);

  const results = {
    processed: 0,
    images_fixed: 0,
    timeline_fixed: 0
  };

  for (const vehicle of vehicles) {
    // Check if actually needs fixing
    const { data: images } = await supabase
      .from('vehicle_images')
      .select('id')
      .eq('vehicle_id', vehicle.id)
      .limit(1);

    const { data: events } = await supabase
      .from('timeline_events')
      .select('id')
      .eq('vehicle_id', vehicle.id)
      .limit(1);

    if ((!images || images.length === 0) || (!events || events.length === 0)) {
      const fixes = await fixVehicle(vehicle);
      results.processed++;
      if (fixes.images) results.images_fixed++;
      if (fixes.timeline) results.timeline_fixed++;
      
      // Small delay
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log(`\n✅ Complete!`);
  console.log(`   Processed: ${results.processed}`);
  console.log(`   Images fixed: ${results.images_fixed}`);
  console.log(`   Timeline fixed: ${results.timeline_fixed}`);
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

