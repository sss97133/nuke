/**
 * Quick fix script to import images and create timeline events for vehicle 5bc71f2b-7b6d-4071-9b8c-59fd1c71742c
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials (need SERVICE_ROLE_KEY to bypass RLS)');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const VEHICLE_ID = '5bc71f2b-7b6d-4071-9b8c-59fd1c71742c';
const IMPORT_USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4'; // From console logs

async function fixVehicle() {
  console.log('🔧 Fixing vehicle:', VEHICLE_ID);
  
  // Get vehicle
  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .select('id, discovery_url, origin_metadata')
    .eq('id', VEHICLE_ID)
    .single();
  
  if (vehicleError || !vehicle) {
    console.error('❌ Vehicle not found:', vehicleError);
    return;
  }
  
  const listingUrl = vehicle.discovery_url || vehicle.origin_metadata?.listing_url;
  if (!listingUrl) {
    console.error('❌ No Craigslist URL found');
    return;
  }
  
  console.log('📋 Listing URL:', listingUrl);
  
  // Scrape listing
  console.log('🔍 Scraping listing...');
  const { data: scrapeResult, error: scrapeError } = await supabase.functions.invoke('scrape-vehicle', {
    body: { url: listingUrl }
  });
  
  if (scrapeError || !scrapeResult?.success) {
    console.error('❌ Scraping failed:', scrapeError || scrapeResult);
    return;
  }
  
  const scrapedData = scrapeResult.data;
  console.log('✅ Scraped data:', {
    year: scrapedData.year,
    make: scrapedData.make,
    model: scrapedData.model,
    images: scrapedData.images?.length || 0
  });
  
  // Create timeline event if missing
  const { data: existingEvents } = await supabase
    .from('timeline_events')
    .select('id')
    .eq('vehicle_id', VEHICLE_ID)
    .eq('event_type', 'discovery')
    .limit(1);
  
  if (!existingEvents || existingEvents.length === 0) {
    console.log('📅 Creating timeline event...');
    const { error: timelineError } = await supabase.from('timeline_events').insert({
      vehicle_id: VEHICLE_ID,
      event_type: 'discovery',
      event_date: new Date().toISOString(),
      title: `Discovered via Craigslist listing`,
      description: `Discovered via Craigslist listing`,
      source: 'craigslist_scrape',
      metadata: {
        discovery_url: listingUrl,
        discovery_source: 'craigslist_scrape',
        automated: true,
        asking_price: scrapedData.asking_price || scrapedData.price,
        listing_title: scrapedData.title
      }
    });
    
    if (timelineError) {
      console.error('❌ Timeline event failed:', timelineError);
    } else {
      console.log('✅ Timeline event created');
    }
  } else {
    console.log('✅ Timeline event already exists');
  }
  
  // Check existing images
  const { data: existingImages } = await supabase
    .from('vehicle_images')
    .select('id')
    .eq('vehicle_id', VEHICLE_ID);
  
  if (existingImages && existingImages.length > 0) {
    console.log(`✅ Already has ${existingImages.length} images`);
    return;
  }
  
  // Import images
  if (scrapedData.images && Array.isArray(scrapedData.images) && scrapedData.images.length > 0) {
    console.log(`📸 Importing ALL ${scrapedData.images.length} images...`);
    
    for (let i = 0; i < scrapedData.images.length; i++) {
      const imageUrl = scrapedData.images[i];
      if (!imageUrl || typeof imageUrl !== 'string') continue;
      
      try {
        const fullSizeUrl = imageUrl.replace('_600x450.jpg', '_1200x900.jpg').replace('_300x300.jpg', '_1200x900.jpg');
        console.log(`📥 Downloading image ${i + 1}: ${fullSizeUrl.substring(0, 60)}...`);
        
        const response = await fetch(fullSizeUrl);
        if (!response.ok) {
          console.warn(`⚠️ Failed to download: ${response.statusText}`);
          continue;
        }
        
        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        
        // Upload to storage
        const timestamp = Date.now();
        const filename = `craigslist_${timestamp}_${i}.jpg`;
        const storagePath = `${VEHICLE_ID}/${filename}`;
        
        const { error: uploadError } = await supabase.storage
          .from('vehicle-images')
          .upload(storagePath, uint8Array, {
            contentType: 'image/jpeg',
            cacheControl: '3600',
            upsert: false
          });
        
        if (uploadError) {
          console.error(`❌ Upload failed: ${uploadError.message}`);
          continue;
        }
        
        const { data: { publicUrl } } = supabase.storage
          .from('vehicle-images')
          .getPublicUrl(storagePath);
        
        // Create image record
        const { error: imageError } = await supabase
          .from('vehicle_images')
          .insert({
            vehicle_id: VEHICLE_ID,
            image_url: publicUrl,
            user_id: IMPORT_USER_ID,
            is_primary: i === 0,
            source: 'craigslist_scrape',
            taken_at: scrapedData.posted_date ? new Date(scrapedData.posted_date).toISOString() : new Date().toISOString(),
            exif_data: {
              source_url: imageUrl,
              discovery_url: listingUrl,
              imported_by_user_id: IMPORT_USER_ID,
              imported_at: new Date().toISOString(),
              attribution_note: 'Photographer unknown - images from Craigslist listing.',
              claimable: true
            }
          });
        
        if (imageError) {
          console.error(`❌ Image record failed: ${imageError.message}`);
        } else {
          console.log(`✅ Imported image ${i + 1}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 300));
        
      } catch (err) {
        console.error(`❌ Error importing image ${i + 1}:`, err.message);
      }
    }
    
    console.log('✅ Image import complete');
  } else {
    console.log('⚠️ No images found in scraped data');
  }
  
  // Trigger AI analysis
  console.log('🤖 Triggering AI analysis...');
  supabase.functions.invoke('vehicle-expert-agent', {
    body: { vehicleId: VEHICLE_ID }
  }).then(() => {
    console.log('✅ AI analysis triggered');
  }).catch(err => {
    console.warn('⚠️ AI analysis failed:', err.message);
  });
}

fixVehicle().catch(console.error);

