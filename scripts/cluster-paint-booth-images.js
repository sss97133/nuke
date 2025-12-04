#!/usr/bin/env node
/**
 * Cluster Paint Booth Images by GPS
 * Groups images taken at Taylor Customs paint booth
 * Attributes work to Taylor, documentation to Skylar
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Haversine formula for distance between GPS coordinates
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c; // Distance in meters
}

async function main() {
  const vehicleId = '5a1deb95-4b67-4cc3-9575-23bb5b180693';
  
  console.log('🎨 Clustering Paint Booth Images by GPS\n');
  
  // 1. Get all images with GPS for this vehicle
  const { data: images } = await supabase
    .from('vehicle_images')
    .select('id, file_name, latitude, longitude, taken_at, category')
    .eq('vehicle_id', vehicleId)
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .order('taken_at');
  
  if (!images || images.length === 0) {
    console.log('❌ No images with GPS found');
    return;
  }
  
  console.log(`📍 Found ${images.length} images with GPS\n`);
  
  // 2. Cluster by location (within 20 meters = same location)
  const CLUSTER_RADIUS = 20; // meters
  const clusters = [];
  const assigned = new Set();
  
  for (const img of images) {
    if (assigned.has(img.id)) continue;
    
    const cluster = {
      centerLat: img.latitude,
      centerLng: img.longitude,
      images: [img],
      firstDate: img.taken_at,
      lastDate: img.taken_at
    };
    
    assigned.add(img.id);
    
    // Find all other images within radius
    for (const other of images) {
      if (assigned.has(other.id)) continue;
      
      const distance = calculateDistance(
        img.latitude, img.longitude,
        other.latitude, other.longitude
      );
      
      if (distance <= CLUSTER_RADIUS) {
        cluster.images.push(other);
        assigned.add(other.id);
        
        // Update date range
        if (new Date(other.taken_at) < new Date(cluster.firstDate)) {
          cluster.firstDate = other.taken_at;
        }
        if (new Date(other.taken_at) > new Date(cluster.lastDate)) {
          cluster.lastDate = other.taken_at;
        }
      }
    }
    
    clusters.push(cluster);
  }
  
  console.log(`📊 Found ${clusters.length} location clusters:\n`);
  
  // 3. Display clusters and find paint booth
  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    
    // Reverse geocode
    const address = await reverseGeocode(cluster.centerLat, cluster.centerLng);
    
    console.log(`\n🗺️  Cluster ${i + 1}: ${cluster.images.length} photos`);
    console.log(`   Location: ${address}`);
    console.log(`   GPS: ${cluster.centerLat.toFixed(6)}, ${cluster.centerLng.toFixed(6)}`);
    console.log(`   Date range: ${new Date(cluster.firstDate).toLocaleDateString()} - ${new Date(cluster.lastDate).toLocaleDateString()}`);
    
    // Find nearby organizations
    const { data: nearbyOrgs } = await supabase.rpc('find_gps_organization_matches', {
      p_vehicle_id: vehicleId,
      p_max_distance_meters: 100
    });
    
    if (nearbyOrgs && nearbyOrgs.length > 0) {
      console.log(`   \n   Nearby organizations:`);
      nearbyOrgs.forEach(org => {
        console.log(`   - ${org.organization_name}: ${Math.round(org.distance_meters)}m away (${Math.round(org.confidence_score)}% confidence)`);
      });
      
      // If Taylor Customs is nearby, this is the paint booth!
      const taylor = nearbyOrgs.find(org => org.organization_name.includes('Taylor'));
      if (taylor) {
        console.log(`\n   🎨 PAINT BOOTH DETECTED!`);
        console.log(`   This is Taylor Customs' location`);
        console.log(`   Recommendation: Tag all ${cluster.images.length} images as "paint_booth_work"`);
      }
    }
  }
  
  console.log('\n\n💡 RECOMMENDATION:\n');
  console.log('For paint booth images, create work order with:');
  console.log('- Primary Organization: Taylor Customs (performer)');
  console.log('- Secondary Organization: Skylar Williams (lead contractor/documenter)');
  console.log('- Attribution: Work to Taylor, documentation credit to Skylar');
}

async function reverseGeocode(lat, lng) {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { 'User-Agent': 'Nuke Platform GPS Clustering' } }
    );
    const data = await response.json();
    return data.display_name || `${lat}, ${lng}`;
  } catch (error) {
    return `${lat}, ${lng}`;
  }
}

main().catch(console.error);

