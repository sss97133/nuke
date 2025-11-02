/**
 * Backfill Script: Extract GPS from Images + Link to Organizations + Generate AI Work Logs
 * 
 * This script:
 * 1. Finds images without GPS data
 * 2. Downloads images and extracts EXIF GPS
 * 3. Updates vehicle_images with GPS coordinates
 * 4. Finds nearby organizations (within 100m)
 * 5. Groups images by date/location
 * 6. Calls AI to generate work logs
 * 7. Creates timeline events and links to organizations
 */

import { createClient } from '@supabase/supabase-js';
import exifr from 'exifr';
import fetch from 'node-fetch';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Helper: Reverse geocode GPS coordinates
async function reverseGeocode(lat, lon) {
  try {
    const response = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`
    );
    const data = await response.json();
    return data.locality || data.city || data.principalSubdivision || 'Unknown';
  } catch (error) {
    console.error('Reverse geocode error:', error);
    return null;
  }
}

// Step 1: Extract EXIF GPS from images
async function extractGPSFromImages(vehicleId = null) {
  console.log('🔍 Finding images without GPS data...');
  
  let query = supabase
    .from('vehicle_images')
    .select('id, vehicle_id, image_url, taken_at')
    .is('latitude', null);
  
  if (vehicleId) {
    query = query.eq('vehicle_id', vehicleId);
  }
  
  const { data: images, error } = await query.limit(500);
  
  if (error) throw error;
  
  console.log(`Found ${images.length} images without GPS`);
  
  let updated = 0;
  
  for (const image of images) {
    try {
      console.log(`Processing: ${image.image_url.slice(-40)}`);
      
      // Download image and extract EXIF
      const response = await fetch(image.image_url);
      const buffer = await response.arrayBuffer();
      
      const exif = await exifr.parse(buffer, {
        gps: true,
        pick: ['GPSLatitude', 'GPSLongitude', 'DateTimeOriginal', 'Make', 'Model']
      });
      
      if (exif && exif.latitude && exif.longitude) {
        const locationName = await reverseGeocode(exif.latitude, exif.longitude);
        const takenAt = exif.DateTimeOriginal || image.taken_at || new Date();
        
        await supabase
          .from('vehicle_images')
          .update({
            latitude: exif.latitude,
            longitude: exif.longitude,
            location_name: locationName,
            taken_at: takenAt,
            exif_data: exif,
            updated_at: new Date().toISOString()
          })
          .eq('id', image.id);
        
        console.log(`  ✅ GPS: ${exif.latitude.toFixed(5)}, ${exif.longitude.toFixed(5)} - ${locationName}`);
        updated++;
      } else {
        console.log(`  ⚠️  No GPS data in EXIF`);
      }
    } catch (error) {
      console.error(`  ❌ Error processing image:`, error.message);
    }
  }
  
  console.log(`\n✅ Updated ${updated}/${images.length} images with GPS data\n`);
  return updated;
}

// Step 2: Find organizations near GPS-tagged images
async function findNearbyOrganizations(lat, lon, radiusMeters = 100) {
  const { data: orgs, error } = await supabase
    .from('businesses')
    .select('id, business_name, latitude, longitude')
    .not('latitude', 'is', null)
    .not('longitude', 'is', null);
  
  if (error) throw error;
  
  const nearby = [];
  
  for (const org of orgs) {
    const distance = calculateDistance(lat, lon, org.latitude, org.longitude);
    if (distance <= radiusMeters) {
      nearby.push({ ...org, distance_meters: Math.round(distance) });
    }
  }
  
  return nearby.sort((a, b) => a.distance_meters - b.distance_meters);
}

// Helper: Calculate distance between two GPS points (meters)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
}

// Step 3: Generate AI work log from image batch
async function generateWorkLog(images, vehicleName) {
  console.log(`🤖 Generating AI work log for ${images.length} images...`);
  
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: `You are an expert automotive technician analyzing photos from a restoration shop.
Generate a detailed work log based on the images. Return JSON:
{
  "title": "Brief summary (e.g. Paint & Body Work)",
  "description": "Detailed description of work observed",
  "work_performed": ["Action 1", "Action 2", ...],
  "parts_identified": ["Part 1", "Part 2", ...],
  "estimated_labor_hours": 5.5,
  "condition_notes": "Overall condition assessment",
  "tags": ["tag1", "tag2"]
}`
      }, {
        role: 'user',
        content: [
          { 
            type: 'text', 
            text: `Analyze these ${images.length} photos from work on a ${vehicleName}. What work was performed?`
          },
          ...images.slice(0, 10).map(img => ({
            type: 'image_url',
            image_url: { url: img.image_url, detail: 'low' }
          }))
        ]
      }],
      max_tokens: 1000,
      response_format: { type: 'json_object' }
    })
  });
  
  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }
  
  const result = await response.json();
  const workLog = JSON.parse(result.choices[0].message.content);
  
  console.log(`  ✅ Work Log: ${workLog.title}`);
  return workLog;
}

// Step 4: Link images to organizations and create work logs
async function linkImagesToOrganizations(vehicleId = null) {
  console.log('🔗 Linking GPS-tagged images to nearby organizations...\n');
  
  let query = supabase
    .from('vehicle_images')
    .select('id, vehicle_id, image_url, latitude, longitude, taken_at')
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .order('taken_at', { ascending: true });
  
  if (vehicleId) {
    query = query.eq('vehicle_id', vehicleId);
  }
  
  const { data: images, error } = await query;
  
  if (error) throw error;
  
  console.log(`Found ${images.length} GPS-tagged images`);
  
  // Group images by vehicle, date, and location (within 50m)
  const batches = [];
  let currentBatch = null;
  
  for (const image of images) {
    const imageDate = new Date(image.taken_at).toISOString().split('T')[0];
    
    if (!currentBatch || 
        currentBatch.vehicle_id !== image.vehicle_id ||
        currentBatch.date !== imageDate ||
        calculateDistance(
          currentBatch.lat, currentBatch.lon,
          image.latitude, image.longitude
        ) > 50
    ) {
      if (currentBatch) batches.push(currentBatch);
      
      currentBatch = {
        vehicle_id: image.vehicle_id,
        date: imageDate,
        lat: image.latitude,
        lon: image.longitude,
        images: [image]
      };
    } else {
      currentBatch.images.push(image);
    }
  }
  
  if (currentBatch) batches.push(currentBatch);
  
  console.log(`\nGrouped into ${batches.length} work sessions\n`);
  
  let linked = 0;
  
  for (const batch of batches) {
    const orgs = await findNearbyOrganizations(batch.lat, batch.lon);
    
    if (orgs.length === 0) {
      console.log(`⚠️  No organizations near ${batch.date} (${batch.images.length} images)`);
      continue;
    }
    
    const org = orgs[0]; // Closest organization
    
    console.log(`\n📍 ${batch.date} - ${batch.images.length} images at ${org.business_name} (${org.distance_meters}m away)`);
    
    // Get vehicle name
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('year, make, model')
      .eq('id', batch.vehicle_id)
      .single();
    
    const vehicleName = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
    
    // Generate AI work log
    const workLog = await generateWorkLog(batch.images, vehicleName);
    
    // Create timeline event
    const { data: event, error: eventError } = await supabase
      .from('timeline_events')
      .insert({
        vehicle_id: batch.vehicle_id,
        event_type: 'work_completed',
        event_date: batch.date,
        title: workLog.title,
        description: workLog.description,
        organization_id: org.id,
        service_provider_name: org.business_name,
        labor_hours: workLog.estimated_labor_hours,
        metadata: {
          work_performed: workLog.work_performed,
          parts_identified: workLog.parts_identified,
          condition_notes: workLog.condition_notes,
          tags: workLog.tags,
          ai_generated: true,
          image_count: batch.images.length
        }
      })
      .select()
      .single();
    
    if (eventError) {
      console.error(`  ❌ Error creating timeline event:`, eventError.message);
      continue;
    }
    
    console.log(`  ✅ Created timeline event: ${event.id}`);
    linked++;
  }
  
  console.log(`\n✅ Created ${linked} work log events\n`);
  return linked;
}

// Main execution
async function main() {
  const vehicleId = process.argv[2]; // Optional: specific vehicle ID
  
  console.log('='.repeat(60));
  console.log('🚀 Image GPS Extraction & Organization Linking Backfill');
  console.log('='.repeat(60));
  console.log();
  
  try {
    // Step 1: Extract GPS from images
    const gpsUpdated = await extractGPSFromImages(vehicleId);
    
    // Step 2: Link images to organizations and generate work logs
    const eventsCreated = await linkImagesToOrganizations(vehicleId);
    
    console.log('='.repeat(60));
    console.log('✅ BACKFILL COMPLETE');
    console.log(`   - GPS extracted: ${gpsUpdated} images`);
    console.log(`   - Work logs created: ${eventsCreated} events`);
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

main();

