#!/usr/bin/env node

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function consolidateTimelineEvents(vehicleId) {
  console.log(`🔄 Consolidating timeline events for vehicle: ${vehicleId}\n`);

  // Step 1: Delete ALL AI-generated events (we'll recreate them properly)
  const { data: deleted } = await supabase
    .from('timeline_events')
    .delete()
    .eq('vehicle_id', vehicleId)
    .eq('source', 'ai_agent_detected')
    .select('id');

  console.log(`🗑️  Deleted ${deleted?.length || 0} AI-generated events\n`);

  // Step 2: Group images by date and create ONE event per work session
  const { data: images } = await supabase
    .from('vehicle_images')
    .select('id, taken_at, image_url, user_id')
    .eq('vehicle_id', vehicleId)
    .not('taken_at', 'is', null)
    .order('taken_at');

  if (!images || images.length === 0) {
    console.log('❌ No images with EXIF dates found');
    return;
  }

  console.log(`📊 Found ${images.length} images with EXIF dates\n`);

  // Group by date
  const byDate = {};
  images.forEach(img => {
    const date = img.taken_at.split('T')[0];
    if (!byDate[date]) {
      byDate[date] = [];
    }
    byDate[date].push(img);
  });

  console.log(`📅 Grouped into ${Object.keys(byDate).length} work sessions\n`);

  // Step 3: For each date, analyze all tags and create ONE consolidated event
  let created = 0;
  for (const [date, dateImages] of Object.entries(byDate)) {
    const imageIds = dateImages.map(img => img.id);
    const userId = dateImages[0].user_id;

    // Get all AI tags for this date's images
    const { data: tags } = await supabase
      .from('image_tags')
      .select('tag_name, tag_type, confidence, metadata')
      .in('image_id', imageIds)
      .eq('source_type', 'ai');

    // Get AI-supervised tags (intelligent ones)
    const supervisedTags = (tags || []).filter(t => t.metadata?.ai_supervised === true);
    const parts = supervisedTags.filter(t => t.tag_type === 'part' || t.metadata?.category?.includes('part'));
    const tools = supervisedTags.filter(t => t.tag_type === 'tool' || t.metadata?.category?.includes('tool'));

    // Determine work type from tags
    let workType = 'Documentation';
    let laborEstimate = 1;

    if (parts.length > 0) {
      // Categorize by parts detected
      const partNames = parts.map(p => p.tag_name.toLowerCase()).join(' ');
      
      if (partNames.includes('paint') || partNames.includes('masking')) {
        workType = 'Paint Preparation';
        laborEstimate = 3;
      } else if (partNames.includes('engine') || partNames.includes('transmission')) {
        workType = 'Drivetrain Service';
        laborEstimate = 6;
      } else if (partNames.includes('body') || partNames.includes('panel') || partNames.includes('fender')) {
        workType = 'Body Panel Work';
        laborEstimate = 4;
      } else if (partNames.includes('rust') || partNames.includes('repair')) {
        workType = 'Rust Repair';
        laborEstimate = 5;
      } else if (partNames.includes('suspension') || partNames.includes('axle')) {
        workType = 'Suspension/Chassis Work';
        laborEstimate = 4;
      } else {
        workType = 'Mechanical Work';
        laborEstimate = 3;
      }
    }

    // Create ONE consolidated event for this work session
    const { data: event, error } = await supabase
      .from('timeline_events')
      .insert({
        vehicle_id: vehicleId,
        user_id: userId,
        event_date: date,
        event_type: 'maintenance',
        title: `${workType} (${dateImages.length} photos)`,
        description: parts.length > 0 
          ? `Parts detected: ${parts.slice(0, 5).map(p => p.tag_name).join(', ')}${parts.length > 5 ? ` +${parts.length - 5} more` : ''}`
          : `${dateImages.length} photos documented`,
        labor_hours: laborEstimate,
        source: 'ai_consolidated',
        metadata: {
          image_count: dateImages.length,
          ai_detected_parts: parts.map(p => p.tag_name),
          tools_used: tools.map(t => t.tag_name),
          exif_verified: true,
          consolidated_from_images: true
        }
      })
      .select()
      .single();

    if (!error) {
      console.log(`✓ ${date}: ${workType} (${dateImages.length} photos, ${parts.length} parts detected)`);
      created++;
    } else {
      console.error(`❌ Failed to create event for ${date}:`, error.message);
    }

    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log(`\n✅ Consolidation complete!`);
  console.log(`   Deleted: ${deleted?.length || 0} old events`);
  console.log(`   Created: ${created} consolidated events`);
  console.log(`   Work sessions: ${Object.keys(byDate).length}`);
}

const vehicleId = process.argv[2] || 'e08bf694-970f-4cbe-8a74-8715158a0f2e';
consolidateTimelineEvents(vehicleId).catch(console.error);

