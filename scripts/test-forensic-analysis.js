/**
 * Test Forensic Analysis on Taylor Customs Images
 * 
 * This script triggers the forensic receipt generation for images
 * associated with Taylor Customs vehicles.
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseServiceKey) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const TAYLOR_CUSTOMS_ID = '66352790-b70e-4de8-bfb1-006b91fa556f';

async function main() {
  console.log('🔬 Forensic Analysis Test for Taylor Customs');
  console.log('=========================================\n');
  
  // 1. Get vehicles linked to Taylor Customs
  const { data: orgVehicles, error: orgError } = await supabase
    .from('organization_vehicles')
    .select(`
      vehicle_id,
      relationship_type,
      vehicles (
        id, year, make, model
      )
    `)
    .eq('organization_id', TAYLOR_CUSTOMS_ID)
    .in('relationship_type', ['service_provider', 'work_location']);
  
  if (orgError) {
    console.error('Failed to fetch org vehicles:', orgError);
    return;
  }
  
  console.log(`Found ${orgVehicles.length} service vehicles:\n`);
  
  for (const ov of orgVehicles) {
    const vehicle = ov.vehicles;
    console.log(`  ${vehicle.year} ${vehicle.make} ${vehicle.model} (${ov.relationship_type})`);
  }
  
  console.log('\n');
  
  // 2. For each vehicle, get images and group by date
  for (const ov of orgVehicles) {
    const vehicleId = ov.vehicle_id;
    const vehicle = ov.vehicles;
    const vehicleName = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
    
    console.log(`\n🚗 Processing: ${vehicleName}`);
    console.log('─'.repeat(50));
    
    // Get images with GPS and timestamp
    const { data: images, error: imgError } = await supabase
      .from('vehicle_images')
      .select('id, taken_at, latitude, longitude, ai_processing_status')
      .eq('vehicle_id', vehicleId)
      .not('taken_at', 'is', null)
      .not('latitude', 'is', null)
      .order('taken_at', { ascending: true })
      .limit(50); // Limit for testing
    
    if (imgError || !images || images.length === 0) {
      console.log('  No images with GPS/timestamp found');
      continue;
    }
    
    console.log(`  Found ${images.length} images with GPS/timestamp`);
    
    // Group images by date
    const byDate = {};
    for (const img of images) {
      const date = img.taken_at.split('T')[0];
      if (!byDate[date]) byDate[date] = [];
      byDate[date].push(img);
    }
    
    console.log(`  Grouped into ${Object.keys(byDate).length} dates:\n`);
    
    // Process each date as a work session
    for (const [date, dateImages] of Object.entries(byDate)) {
      console.log(`  📅 ${date}: ${dateImages.length} images`);
      
      // Call generate-work-logs for this batch
      try {
        console.log(`     Calling generate-work-logs...`);
        
        const { data, error } = await supabase.functions.invoke('generate-work-logs', {
          body: {
            vehicleId: vehicleId,
            organizationId: TAYLOR_CUSTOMS_ID,
            imageIds: dateImages.map(i => i.id),
            eventDate: date
          }
        });
        
        if (error) {
          console.log(`     ❌ Error: ${error.message}`);
          continue;
        }
        
        if (data?.success) {
          console.log(`     ✅ Work log: "${data.workLog?.title}"`);
          console.log(`        Parts: ${data.partsCount || 0}, Labor tasks: ${data.laborTasksCount || 0}`);
          console.log(`        Event ID: ${data.eventId}`);
        } else {
          console.log(`     ⚠️ No work log generated`);
        }
        
      } catch (err) {
        console.log(`     ❌ Exception: ${err.message}`);
      }
      
      // Rate limit to avoid overwhelming the API
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  
  console.log('\n\n🔬 Forensic Analysis Complete!');
}

main().catch(console.error);

