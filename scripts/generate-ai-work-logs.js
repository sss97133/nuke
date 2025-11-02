/**
 * Generate AI Work Logs for Existing Timeline Events
 * Groups images by date/org and generates detailed work descriptions
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function generateWorkLogs(vehicleId = null, organizationId = null) {
  console.log('🤖 Generating AI work logs from images...\n');
  
  // Find timeline events that need AI analysis
  let query = supabase
    .from('timeline_events')
    .select('id, vehicle_id, organization_id, event_date, title')
    .not('organization_id', 'is', null)
    .order('event_date', { ascending: false });
  
  if (vehicleId) {
    query = query.eq('vehicle_id', vehicleId);
  }
  
  if (organizationId) {
    query = query.eq('organization_id', organizationId);
  }
  
  const { data: events, error } = await query.limit(100);
  
  if (error) throw error;
  
  console.log(`Found ${events.length} timeline events to analyze\n`);
  
  let analyzed = 0;
  let skipped = 0;
  
  for (const event of events) {
    // Find images for this event date
    const { data: images } = await supabase
      .from('vehicle_images')
      .select('id, image_url')
      .eq('vehicle_id', event.vehicle_id)
      .gte('taken_at', `${event.event_date}T00:00:00`)
      .lt('taken_at', `${event.event_date}T23:59:59`)
      .limit(20);
    
    if (!images || images.length === 0) {
      console.log(`⚠️  ${event.event_date} - No images found for event`);
      skipped++;
      continue;
    }
    
    console.log(`📸 ${event.event_date} - Analyzing ${images.length} images...`);
    
    try {
      // Call the generate-work-logs edge function
      const { data: authData } = await supabase.auth.getSession();
      
      const response = await fetch(`${supabaseUrl}/functions/v1/generate-work-logs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`
        },
        body: JSON.stringify({
          vehicleId: event.vehicle_id,
          organizationId: event.organization_id,
          imageIds: images.map(img => img.id),
          eventDate: event.event_date
        })
      });
      
      if (!response.ok) {
        const error = await response.text();
        console.error(`   ❌ AI analysis failed: ${error}`);
        skipped++;
        continue;
      }
      
      const result = await response.json();
      console.log(`   ✅ Work Log: ${result.workLog.title}`);
      console.log(`      Hours: ${result.workLog.estimatedLaborHours}h`);
      console.log(`      Work: ${result.workLog.workPerformed.slice(0, 2).join(', ')}${result.workLog.workPerformed.length > 2 ? '...' : ''}\n`);
      
      analyzed++;
      
      // Rate limit to avoid OpenAI throttling
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      console.error(`   ❌ Error:`, error.message);
      skipped++;
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ WORK LOG GENERATION COMPLETE');
  console.log(`   - Analyzed: ${analyzed} events`);
  console.log(`   - Skipped: ${skipped} events`);
  console.log('='.repeat(60));
}

// Main
const vehicleId = process.argv[2]; // Optional
const organizationId = process.argv[3]; // Optional

generateWorkLogs(vehicleId, organizationId)
  .then(() => process.exit(0))
  .catch(error => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });

