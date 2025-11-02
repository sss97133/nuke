/**
 * Intelligent Work Log Generator
 * Groups images by visual similarity and work type, then generates AI work logs
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function generateWorkLogs(vehicleId, organizationId) {
  console.log('🔍 Analyzing image groups for intelligent work log generation...\n');
  
  // Get all GPS-tagged images for this vehicle at this org
  const { data: images, error } = await supabase
    .from('vehicle_images')
    .select('id, image_url, taken_at, latitude, longitude')
    .eq('vehicle_id', vehicleId)
    .not('latitude', 'is', null)
    .order('taken_at', { ascending: true });
  
  if (error) throw error;
  
  console.log(`Found ${images.length} GPS-tagged images\n`);
  
  // Group images by date
  const dateGroups = new Map();
  
  for (const img of images) {
    const date = new Date(img.taken_at).toISOString().split('T')[0];
    if (!dateGroups.has(date)) {
      dateGroups.set(date, []);
    }
    dateGroups.get(date).push(img);
  }
  
  console.log(`Grouped into ${dateGroups.size} work days\n`);
  
  let processed = 0;
  let skipped = 0;
  
  for (const [date, dayImages] of Array.from(dateGroups).sort((a, b) => b[0].localeCompare(a[0]))) {
    if (dayImages.length < 2) {
      console.log(`⚠️  ${date} - Only ${dayImages.length} image, skipping`);
      skipped++;
      continue;
    }
    
    // Check if already has AI analysis
    const { data: existingEvent } = await supabase
      .from('timeline_events')
      .select('id, title, metadata')
      .eq('vehicle_id', vehicleId)
      .eq('event_date', date)
      .eq('organization_id', organizationId)
      .maybeSingle();
    
    if (existingEvent && existingEvent.metadata?.ai_generated) {
      console.log(`✅ ${date} - Already analyzed (${existingEvent.title})`);
      skipped++;
      continue;
    }
    
    console.log(`📸 ${date} - Analyzing ${dayImages.length} images...`);
    
    try {
      // Call generate-work-logs edge function
      const response = await fetch(`${supabaseUrl}/functions/v1/generate-work-logs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`
        },
        body: JSON.stringify({
          vehicleId,
          organizationId,
          imageIds: dayImages.map(img => img.id),
          eventDate: date
        })
      });
      
      if (!response.ok) {
        const error = await response.text();
        console.error(`   ❌ Failed: ${error.slice(0, 100)}`);
        skipped++;
        continue;
      }
      
      const result = await response.json();
      const workLog = result.workLog;
      
      console.log(`   ✅ ${workLog.title}`);
      console.log(`      ${workLog.estimatedLaborHours}h labor • ${workLog.partsIdentified.length} parts • ${workLog.workPerformed.length} actions`);
      console.log(`      Tags: ${workLog.tags.slice(0, 3).join(', ')}\n`);
      
      processed++;
      
      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } catch (error) {
      console.error(`   ❌ Error:`, error.message);
      skipped++;
    }
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('✅ INTELLIGENT WORK LOG GENERATION COMPLETE');
  console.log(`   - Analyzed: ${processed} work sessions`);
  console.log(`   - Skipped: ${skipped} sessions`);
  console.log('='.repeat(70));
}

// Main
const vehicleId = process.argv[2] || '79fe1a2b-9099-45b5-92c0-54e7f896089e'; // Bronco
const organizationId = process.argv[3] || 'e796ca48-f3af-41b5-be13-5335bb422b41'; // Ernie's

generateWorkLogs(vehicleId, organizationId)
  .then(() => process.exit(0))
  .catch(error => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });

