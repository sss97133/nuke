#!/usr/bin/env node
/**
 * Link Vehicles and Images to Viva Performance
 * Auto-discovers all vehicle images taken at GPS location
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const VIVA_ID = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf';
const VIVA_LAT = 35.97266600;
const VIVA_LON = -114.85595000;
const RADIUS_METERS = 200; // 200m radius around shop (covers full property)

async function linkVehiclesToViva() {
  console.log('🔍 Finding all vehicle images near Viva! Las Vegas Autos...');
  console.log(`📍 Location: ${VIVA_LAT}, ${VIVA_LON}`);
  console.log(`📏 Radius: ${RADIUS_METERS}m\n`);

  // Find all vehicle images with GPS data near Viva
  const { data: images, error } = await supabase
    .from('vehicle_images')
    .select('id, vehicle_id, image_url, latitude, longitude, taken_at, vehicles(year, make, model)')
    .not('latitude', 'is', null)
    .not('longitude', 'is', null);

  if (error) {
    console.error('Error fetching images:', error);
    return;
  }

  console.log(`✅ Found ${images.length} images with GPS data\n`);

  // Calculate distance and filter
  const nearbyImages = images.filter(img => {
    const distance = calculateDistance(
      VIVA_LAT, VIVA_LON,
      parseFloat(img.latitude), parseFloat(img.longitude)
    );
    return distance <= RADIUS_METERS;
  });

  console.log(`📍 Found ${nearbyImages.length} images within ${RADIUS_METERS}m of Viva\n`);

  if (nearbyImages.length === 0) {
    console.log('No images found nearby. Done.');
    return;
  }

  // Group by vehicle
  const vehicleMap = new Map();
  for (const img of nearbyImages) {
    if (!vehicleMap.has(img.vehicle_id)) {
      vehicleMap.set(img.vehicle_id, {
        vehicle_id: img.vehicle_id,
        vehicle_name: `${img.vehicles.year} ${img.vehicles.make} ${img.vehicles.model}`,
        images: []
      });
    }
    vehicleMap.get(img.vehicle_id).images.push(img);
  }

  console.log(`🚗 Found ${vehicleMap.size} unique vehicles (GPS-confirmed):\n`);
  
  for (const [vId, vData] of vehicleMap) {
    console.log(`  • ${vData.vehicle_name}: ${vData.images.length} GPS photos`);
  }
  console.log('');

  // Now get ALL images for these vehicles (including non-GPS)
  console.log('📸 Fetching ALL images for confirmed vehicles (including non-GPS)...\n');
  
  const vehicleIds = Array.from(vehicleMap.keys());
  const { data: allImages } = await supabase
    .from('vehicle_images')
    .select('id, vehicle_id, image_url, taken_at, latitude')
    .in('vehicle_id', vehicleIds)
    .order('taken_at', { ascending: true });

  // Update vehicle map with ALL images
  for (const img of allImages || []) {
    const vData = vehicleMap.get(img.vehicle_id);
    if (vData) {
      // Check if image already in list
      if (!vData.images.some(existingImg => existingImg.id === img.id)) {
        vData.images.push(img);
      }
    }
  }

  console.log('📊 Updated vehicle counts (GPS + non-GPS):\n');
  for (const [vId, vData] of vehicleMap) {
    console.log(`  • ${vData.vehicle_name}: ${vData.images.length} total photos`);
  }
  console.log('');

  // Link vehicles to org
  for (const [vId, vData] of vehicleMap) {
    console.log(`🔗 Linking ${vData.vehicle_name} to Viva...`);
    
    // Check if already linked
    const { data: existing } = await supabase
      .from('organization_vehicles')
      .select('id')
      .eq('organization_id', VIVA_ID)
      .eq('vehicle_id', vId)
      .single();

    if (!existing) {
      // Insert into organization_vehicles
      const { error: linkError } = await supabase
        .from('organization_vehicles')
        .insert({
          organization_id: VIVA_ID,
          vehicle_id: vId,
          relationship_type: 'work_location',
          status: 'active',
          notes: `Auto-linked via GPS: ${vData.images.length} photos taken at location`
        });

      if (linkError) {
        console.error(`  ❌ Error linking vehicle:`, linkError.message);
      } else {
        console.log(`  ✅ Linked to organization_vehicles`);
      }
    } else {
      console.log(`  ⏭  Already linked`);
    }

    // Create timeline events for each image batch
    // Group images by date
    const imagesByDate = new Map();
    for (const img of vData.images) {
      if (!img.taken_at) continue; // Skip images without date
      const dateKey = img.taken_at.split('T')[0];
      if (!imagesByDate.has(dateKey)) {
        imagesByDate.set(dateKey, []);
      }
      imagesByDate.get(dateKey).push(img);
    }

    for (const [date, imgs] of imagesByDate) {
      console.log(`  📅 Creating timeline event for ${date} (${imgs.length} photos)`);
      
      // Check if event already exists for this date/vehicle
      const { data: existingEvent } = await supabase
        .from('business_timeline_events')
        .select('id')
        .eq('business_id', VIVA_ID)
        .eq('event_date', date)
        .contains('metadata', { vehicle_id: vId })
        .single();

      if (!existingEvent) {
        const { error: eventError } = await supabase
          .from('business_timeline_events')
          .insert({
            business_id: VIVA_ID,
            event_type: 'other',
            event_category: 'other',
            event_date: date,
            title: `${vData.vehicle_name} - ${imgs.length} Photos`,
            description: `Vehicle photos uploaded (GPS-linked to location)`,
            image_urls: imgs.map(i => i.image_url),
            metadata: {
              vehicle_id: vId,
              vehicle_name: vData.vehicle_name,
              gps_linked: true,
              image_count: imgs.length
            }
          });

        if (eventError) {
          console.error(`  ❌ Error creating timeline event:`, eventError.message);
        } else {
          console.log(`  ✅ Timeline event created`);
        }
      } else {
        console.log(`  ⏭  Event already exists for ${date}`);
      }
    }
  }

  console.log('\n🎉 Auto-linking complete!');
  console.log(`\n📊 Summary:`);
  console.log(`  • ${vehicleMap.size} vehicles linked`);
  console.log(`  • ${nearbyImages.length} images connected`);
  console.log(`  • Check: https://n-zero.dev/org/${VIVA_ID}`);
}

// Haversine distance formula (meters)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

linkVehiclesToViva().catch(console.error);

